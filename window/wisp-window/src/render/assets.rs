//! The files a renderer is fed and what they are built with: ingest and pump, the Original or Remastered quality rebuilt beside the set on screen, and the preset's features.

use super::*;

/// `base` with the final-image pass's bloom and occlusion strengths at their defaults when the features are on and zero when off.
pub(super) fn tuning_of(features: Features, base: Tuning) -> Tuning {
    Tuning {
        bloom_strength: if features.bloom { TUNING.bloom_strength } else { 0.0 },
        occlusion_strength: if features.ssao { TUNING.occlusion_strength } else { 0.0 },
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
            let (quality, cache, upscaler, edges) = (self.quality, self.cache.clone(), self.upscaler.clone(), Edges::for_path(path));
            self.decoder.submit(self.next_job, move || remaster::prepare(&bytes, quality, cache.as_deref(), &upscaler, edges));
        }
    }

    /// Uploads the textures that finished decoding and, once none is outstanding, builds the models that were waiting on them; returns how many files that finished, built or failed.
    pub fn pump(&mut self) -> u64 {
        let finished = self.pump_own();
        self.hand_over();
        finished
    }

    pub(super) fn pump_own(&mut self) -> u64 {
        let mut finished = 0;
        while let Some((job, decoded)) = self.decoder.try_recv() {
            let Some(path) = self.decoding.remove(&job) else { continue };
            finished += 1;
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

    /// Switches the art without a restart: every file seen so far is built again at `quality` beside the drawing set, which keeps drawing until the new one is complete and is then replaced by it.
    pub fn set_quality(&mut self, quality: Quality) {
        if quality == self.quality() {
            return;
        }
        if quality == self.quality {
            self.incoming = None;
            return;
        }
        let mut incoming = Box::new(Renderer::new(self.device.clone(), self.queue.clone(), self.format, quality, self.features).with_upscaler(self.upscaler.clone()));
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
        let Some(mut next) = self.incoming.take() else { return };
        next.sources = std::mem::take(&mut self.sources);
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
        self.set_post_tuning(tuning_of(features, self.tuning));
        if let Some(incoming) = self.incoming.as_mut() {
            incoming.set_features(features);
        }
    }
}
