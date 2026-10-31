//! The files a renderer is fed and what they are built with: ingest and pump, the Original or Remastered quality rebuilt beside the set on screen, and the preset's features.

use super::*;

/// `base` with the final-image pass's bloom, occlusion and contact-shadow strengths at their defaults when the features are on and zero when off.
pub(super) fn tuning_of(features: Features, base: Tuning) -> Tuning {
    Tuning {
        bloom_strength: if features.bloom { TUNING.bloom_strength } else { 0.0 },
        occlusion_strength: if features.ssao { TUNING.occlusion_strength } else { 0.0 },
        contact_strength: if features.contact_shadows { TUNING.contact_strength } else { 0.0 },
        cloud_layers: features.cloud_layers as u32,
        ..base
    }
}

impl Renderer {
    /// Takes a file Bun pushed, a model or a texture told apart by its magic. Textures decode on worker threads; a model waits for them so its bind groups hold its real textures, and one that cannot be read is left out.
    pub fn ingest(&mut self, path: &str, bytes: Vec<u8>) {
        let bytes: Arc<[u8]> = bytes.into();
        if let Some(incoming) = self.incoming.as_mut() {
            incoming.ingest_shared(path, bytes.clone());
        }
        self.sources.push((path.to_string(), bytes.clone()));
        self.ingest_shared(path, bytes);
    }

    pub(super) fn ingest_shared(&mut self, path: &str, bytes: Arc<[u8]>) {
        if bytes.starts_with(b"MDLX") {
            self.waiting.push((path.to_string(), bytes));
        } else {
            self.next_job += 1;
            self.decoding.insert(self.next_job, path.to_ascii_lowercase());
            if let Some(baker) = &self.baker {
                baker.add(path, bytes.clone());
            }
            let (quality, cache, upscaler, edges) = (self.quality, self.cache.clone(), self.upscaler.clone(), Edges::for_path(path));
            self.decoder.submit(self.next_job, move || remaster::load(&bytes, quality, cache.as_deref(), &upscaler, edges));
        }
    }

    /// Uploads the textures that finished decoding and, once none is outstanding, builds the models that were waiting on them; returns how many files that finished, built or failed.
    pub fn pump(&mut self) -> u64 {
        let finished = self.pump_own();
        self.steer();
        self.hand_over();
        finished
    }

    pub(super) fn pump_own(&mut self) -> u64 {
        let mut finished = 0;
        while let Some((job, decoded)) = self.decoder.try_recv() {
            let Some(path) = self.decoding.remove(&job) else { continue };
            finished += 1;
            let decoded = decoded.map(|loaded| {
                self.unbaked |= loaded.unbaked;
                loaded.prepared
            });
            match decoded {
                Ok(prepared) if water::is_frame(&path) => self.water.keep(path, prepared.albedo),
                Ok(prepared) => {
                    if let Some(relief) = &prepared.relief {
                        self.reliefs.insert(path.clone(), upload(&self.device, &self.queue, relief));
                    }
                    let view = upload(&self.device, &self.queue, &prepared.albedo);
                    self.textures.insert(path, view);
                }
                Err(error) => self.problems.push(format!("{path}: {error}")),
            }
        }
        if self.decoding.is_empty() {
            self.problems.extend(self.water.build(&self.device, &self.queue));
            for (path, bytes) in std::mem::take(&mut self.waiting) {
                finished += 1;
                match source::model(&bytes, self.quality) {
                    Ok(data) => self.add_model(&path, data),
                    Err(error) => self.problems.push(format!("{path}: {error}")),
                }
            }
        }
        finished
    }

    /// The remaster quality the textures and models are drawn with, or are being rebuilt to draw with.
    pub fn quality(&self) -> Quality {
        self.incoming.as_ref().map_or(self.quality, |incoming| incoming.quality)
    }

    /// Switches the art without a restart; the set on screen keeps drawing until the one built beside it is complete. Original is built at once. A remastered quality starts the bake over every texture seen so far, and its set is built from the cache once the bake has caught up and the game is not playing.
    pub fn set_quality(&mut self, quality: Quality) {
        self.wanted = quality;
        if quality == Quality::Off {
            self.baker = None;
        } else if self.baker.as_ref().map(Baker::quality) != Some(quality) {
            self.baker = Cache::open().map(|cache| Baker::start(quality, Arc::new(cache), self.upscaler.clone()));
            if let Some(baker) = &self.baker {
                baker.set_playing(self.playing);
                for (path, bytes) in self.sources.iter().filter(|(_, bytes)| !bytes.starts_with(b"MDLX")) {
                    baker.add(path, bytes.clone());
                }
            }
        }
        if self.incoming.as_ref().is_some_and(|incoming| incoming.quality != quality) {
            self.incoming = None;
        }
        self.steer();
    }

    /// Whether the game is in play, as its scene says: the bake waits, and no remastered set is built or swapped in until play stops, so a match keeps the art it started with.
    pub fn set_playing(&mut self, playing: bool) {
        if playing == self.playing {
            return;
        }
        self.playing = playing;
        if let Some(baker) = &self.baker {
            baker.set_playing(playing);
        }
        self.steer();
    }

    /// How far the bake is, while a remastered quality is wanted.
    pub fn bake_progress(&self) -> Option<remaster::Progress> {
        self.baker.as_ref().map(Baker::progress)
    }

    /// True when the GPU cannot run the learned upscaler, so the bake doubles textures with the edge-directed filter.
    pub fn upscales_with_filter(&self) -> bool {
        self.upscaler.method() == remaster::FILTER
    }

    /// True while the art on screen is not yet the art wanted.
    pub fn art_pending(&self) -> bool {
        self.quality != self.wanted || self.unbaked
    }

    /// Starts building the wanted set beside the drawn one when it would differ and every texture it needs is in the cache; while playing, only a switch to Original may start.
    fn steer(&mut self) {
        let held = self.playing && self.wanted != Quality::Off;
        if held && self.incoming.as_ref().is_some_and(|incoming| incoming.quality != Quality::Off) {
            self.incoming = None;
        }
        if held || self.incoming.is_some() {
            return;
        }
        let baked = self.bake_progress().filter(|progress| progress.ready()).map(|progress| progress.done);
        let rebuild = match (self.wanted, baked) {
            (Quality::Off, _) => self.quality != Quality::Off,
            (_, Some(baked)) => self.quality != self.wanted || (self.unbaked && baked > self.baked_at_build),
            (_, None) => false,
        };
        if !rebuild {
            return;
        }
        self.baked_at_build = baked.unwrap_or(0);
        let mut incoming = Box::new(Renderer::new(self.device.clone(), self.queue.clone(), self.format, self.wanted, self.features).with_upscaler(self.upscaler.clone()));
        for (path, bytes) in &self.sources {
            incoming.ingest_shared(path, bytes.clone());
        }
        self.incoming = Some(incoming);
    }

    pub(super) fn settled(&self) -> bool {
        self.decoding.is_empty() && self.waiting.is_empty()
    }

    pub(super) fn hand_over(&mut self) {
        let Some(incoming) = self.incoming.as_mut() else { return };
        incoming.pump_own();
        if !incoming.settled() {
            return;
        }
        if self.playing && incoming.quality != Quality::Off {
            return;
        }
        let Some(mut next) = self.incoming.take() else { return };
        next.sources = std::mem::take(&mut self.sources);
        next.baker = self.baker.take();
        (next.wanted, next.playing, next.baked_at_build) = (self.wanted, self.playing, self.baked_at_build);
        next.problems.append(&mut self.problems);
        let features = self.features;
        *self = *next;
        self.set_features(features);
    }

    pub fn features(&self) -> Features {
        self.features
    }

    /// Applies a preset's features. Bloom and ambient occlusion are the final-image pass's strengths, and a strength of zero skips that effect's passes; the other keys are read by their features as they land.
    pub fn set_features(&mut self, features: Features) {
        self.features = features;
        self.set_shadow_side(match features.shadows { Shadows::Off => 0, Shadows::Map(side) => side });
        self.set_post_tuning(tuning_of(features, self.tuning));
        if let Some(incoming) = self.incoming.as_mut() {
            incoming.set_features(features);
        }
    }
}
