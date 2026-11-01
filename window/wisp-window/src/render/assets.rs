//! The files a renderer is fed and what they are built with: ingest and pump, the Original or Remastered quality rebuilt beside the set on screen, and the preset's features.

use std::sync::mpsc::{self, Receiver, TryRecvError};
use std::thread;
use std::time::Duration;

use super::*;
use crate::texture::Image;

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

/// Most models the set built beside the drawn one builds in one pump.
const MODELS_PER_PUMP: usize = 4;

/// What the rebuild of the art beside the drawn one has cost: the textures of the bake it was started from, and the pumps it took with the slowest.
#[derive(Clone, Copy, Default)]
pub(super) struct Rebuild {
    pub(super) baked_at: usize,
    pumps: u32,
    worst: Duration,
}

impl Rebuild {
    fn note(&mut self, took: Duration) {
        self.pumps += 1;
        self.worst = self.worst.max(took);
    }

    fn report(self, quality: Quality) {
        eprintln!("wisp remaster: {quality:?} art swapped in over {} scenes, the slowest pump {:.1} ms", self.pumps, self.worst.as_secs_f64() * 1e3);
    }
}

/// A texture as a decode thread leaves it: uploaded to the GPU with its mip chain, so the render thread only files the view, or a water frame's pixels for the water pass to stack.
pub(super) enum Staged {
    Frame(Image),
    Texture { albedo: wgpu::TextureView, relief: Option<wgpu::TextureView> },
}

pub(super) struct Decoded {
    staged: Staged,
    unbaked: bool,
}

impl Decoded {
    fn of(loaded: remaster::Loaded, frame: bool, device: &wgpu::Device, queue: &wgpu::Queue) -> Self {
        let remaster::Loaded { prepared, unbaked } = loaded;
        let staged = if frame {
            Staged::Frame(prepared.albedo)
        } else {
            Staged::Texture { relief: prepared.relief.as_ref().map(|relief| upload(device, queue, relief)), albedo: upload(device, queue, &prepared.albedo) }
        };
        Self { staged, unbaked }
    }
}

/// The art being built beside the drawn one: its renderer is made on another thread (the pipelines take tens of milliseconds), files ingested meanwhile wait in `Building` to join it, and a complete set is swapped in whole.
#[derive(Default)]
pub(super) enum Incoming {
    #[default]
    Idle,
    Building { quality: Quality, samples: u32, receive: Receiver<Box<Renderer>>, late: Vec<(String, Arc<[u8]>)> },
    Ready(Box<Renderer>),
}

impl Incoming {
    pub(super) fn is_idle(&self) -> bool {
        matches!(self, Incoming::Idle)
    }

    fn samples(&self) -> Option<u32> {
        match self {
            Incoming::Idle => None,
            Incoming::Building { samples, .. } => Some(*samples),
            Incoming::Ready(renderer) => Some(renderer.samples),
        }
    }

    fn quality(&self) -> Option<Quality> {
        match self {
            Incoming::Idle => None,
            Incoming::Building { quality, .. } => Some(*quality),
            Incoming::Ready(renderer) => Some(renderer.quality),
        }
    }
}

/// True when a rebuild to `target` is the automatic top-up of the art `drawn`, which waits for the match to end; the player's switch to another quality does not wait.
pub(super) fn waits_for_match(playing: bool, target: Quality, drawn: Quality) -> bool {
    playing && target != Quality::Off && target == drawn
}

impl Renderer {
    /// Takes a file Bun pushed, a model or a texture told apart by its magic. Textures decode on worker threads; a model waits for them so its bind groups hold its real textures, and one that cannot be read is left out.
    pub fn ingest(&mut self, path: &str, bytes: Vec<u8>) {
        let bytes: Arc<[u8]> = bytes.into();
        match &mut self.incoming {
            Incoming::Idle => {}
            Incoming::Building { late, .. } => late.push((path.to_string(), bytes.clone())),
            Incoming::Ready(incoming) => incoming.ingest_shared(path, bytes.clone()),
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
            let (quality, cache, upscaler, edges, role) = (self.quality, self.cache.clone(), self.upscaler.clone(), Edges::for_path(path), Role::for_path(path));
            let (device, queue, frame) = (self.device.clone(), self.queue.clone(), water::is_frame(&path.to_ascii_lowercase()));
            self.decoder.submit(self.next_job, move || remaster::load(&bytes, quality, cache.as_deref(), &upscaler, edges, role).map(|loaded| Decoded::of(loaded, frame, &device, &queue)));
        }
    }

    /// Uploads the textures that finished decoding and, once none is outstanding, builds the models that were waiting on them; returns how many files that finished, built or failed.
    pub fn pump(&mut self) -> u64 {
        let finished = self.pump_own(false);
        let began = Instant::now();
        self.steer();
        let building = !self.incoming.is_idle();
        let mut rebuild = self.rebuild;
        let swapped = self.hand_over();
        if building {
            rebuild.note(began.elapsed());
            match swapped {
                Some(quality) => rebuild.report(quality),
                None => self.rebuild = rebuild,
            }
        }
        finished
    }

    /// Files what finished decoding; `spread` builds only a few models, which is how the set built beside the one on screen is paced.
    pub(super) fn pump_own(&mut self, spread: bool) -> u64 {
        let mut finished = 0;
        while let Some((job, decoded)) = self.decoder.try_recv() {
            let Some(path) = self.decoding.remove(&job) else { continue };
            finished += 1;
            match decoded {
                Ok(Decoded { staged, unbaked }) => {
                    self.unbaked |= unbaked;
                    match staged {
                        Staged::Frame(image) => self.water.keep(path, image),
                        Staged::Texture { albedo, relief } => {
                            if let Some(relief) = relief {
                                self.reliefs.insert(path.clone(), relief);
                            }
                            self.textures.insert(path, albedo);
                        }
                    }
                }
                Err(error) => self.problems.push(format!("{path}: {error}")),
            }
        }
        if self.decoding.is_empty() {
            self.problems.extend(self.water.build(&self.device, &self.queue));
            let later = self.waiting.split_off(if spread { MODELS_PER_PUMP.min(self.waiting.len()) } else { self.waiting.len() });
            for (path, bytes) in std::mem::replace(&mut self.waiting, later) {
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
        self.incoming.quality().unwrap_or(self.quality)
    }

    /// Switches the art without a restart; the set on screen keeps drawing until the one built beside it is complete. Original is built at once. A remastered quality starts the bake over every texture seen so far, and its set is built from the cache, spread over frames, as soon as the bake has caught up, in a match too.
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
        if self.incoming.quality().is_some_and(|building| building != quality) {
            self.incoming = Incoming::Idle;
        }
        self.steer();
    }

    /// Whether the game is in play, as its scene says: the bake rests longer between textures, and the textures that arrive mid-match are baked but not rebuilt in until play stops, so a match keeps the art it started with unless the player switches it.
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
        self.upscaler.method(Role::Figure) == remaster::FILTER
    }

    /// True while the art on screen is not yet the art wanted.
    pub fn art_pending(&self) -> bool {
        self.quality != self.wanted || self.unbaked
    }

    /// Starts building the wanted set beside the drawn one when it would differ and every texture it needs is in the cache. A quality the player chose applies at once, mid-match too; textures that arrived since the art was built wait for the match to end. A change of samples per pixel rebuilds the drawn set the same way.
    pub(super) fn steer(&mut self) {
        let samples = samples_of(self.features, self.offered_samples);
        if self.incoming.samples().is_some_and(|building| building != samples) {
            self.incoming = Incoming::Idle;
        }
        let held = waits_for_match(self.playing, self.wanted, self.quality);
        if self.incoming.quality().is_some_and(|building| waits_for_match(self.playing, building, self.quality)) {
            self.incoming = Incoming::Idle;
        }
        if held || !self.incoming.is_idle() {
            return;
        }
        let rebuild = self.art_rebuild();
        if rebuild.is_none() && self.samples == samples {
            return;
        }
        if let Some(baked) = rebuild {
            self.rebuild = Rebuild { baked_at: baked, ..Rebuild::default() };
        }
        let quality = if rebuild.is_some() { self.wanted } else { self.quality };
        let (device, queue, format, features, upscaler) = (self.device.clone(), self.queue.clone(), self.format, self.features, self.upscaler.clone());
        let sources = self.sources.clone();
        let (send, receive) = mpsc::channel();
        let built = thread::Builder::new().name("wisp-remaster-build".into()).spawn(move || {
            let mut incoming = Box::new(Renderer::new(device, queue, format, quality, features).with_upscaler(upscaler));
            for (path, bytes) in &sources {
                incoming.ingest_shared(path, bytes.clone());
            }
            let _ = send.send(incoming);
        });
        if built.is_ok() {
            self.incoming = Incoming::Building { quality, samples, receive, late: Vec::new() };
        }
    }

    fn art_rebuild(&self) -> Option<usize> {
        let baked = self.bake_progress().filter(|progress| progress.ready()).map(|progress| progress.done);
        let rebuild = match (self.wanted, baked) {
            (Quality::Off, _) => self.quality != Quality::Off,
            (_, Some(baked)) => self.quality != self.wanted || (self.unbaked && baked > self.rebuild.baked_at),
            (_, None) => false,
        };
        rebuild.then(|| baked.unwrap_or(0))
    }

    pub(super) fn settled(&self) -> bool {
        self.decoding.is_empty() && self.waiting.is_empty()
    }

    /// Builds a share of the set beside the drawn one and, once it is complete, replaces the drawn one with it; returns the quality it swapped in.
    pub(super) fn hand_over(&mut self) -> Option<Quality> {
        if let Incoming::Building { receive, late, .. } = &mut self.incoming {
            match receive.try_recv() {
                Ok(mut built) => {
                    for (path, bytes) in late.drain(..) {
                        built.ingest_shared(&path, bytes);
                    }
                    self.incoming = Incoming::Ready(built);
                }
                Err(TryRecvError::Empty) => return None,
                Err(TryRecvError::Disconnected) => {
                    self.incoming = Incoming::Idle;
                    return None;
                }
            }
        }
        let Incoming::Ready(incoming) = &mut self.incoming else { return None };
        incoming.pump_own(true);
        if !incoming.settled() || waits_for_match(self.playing, incoming.quality, self.quality) {
            return None;
        }
        let Incoming::Ready(mut next) = std::mem::take(&mut self.incoming) else { return None };
        next.sources = std::mem::take(&mut self.sources);
        next.baker = self.baker.take();
        std::mem::swap(&mut next.resolution, &mut self.resolution);
        (next.wanted, next.playing, next.rebuild) = (self.wanted, self.playing, Rebuild { baked_at: self.rebuild.baked_at, ..Rebuild::default() });
        next.problems.append(&mut self.problems);
        let features = self.features;
        let quality = next.quality;
        let drawn = std::mem::replace(self, *next);
        self.set_features(features);
        let _ = thread::Builder::new().name("wisp-remaster-drop".into()).spawn(move || drop(drawn));
        Some(quality)
    }

    pub fn features(&self) -> Features {
        self.features
    }

    /// Applies a preset's features. Bloom and ambient occlusion are the final-image pass's strengths, and a strength of zero skips that effect's passes; the other keys are read by their features as they land.
    pub fn set_features(&mut self, features: Features) {
        self.features = features;
        self.resolution.set(features.render_scale);
        self.effects.ribbons.density = f32::from(features.ribbon_percent) / 100.0;
        self.set_shadow_side(match features.shadows { Shadows::Off => 0, Shadows::Map(side) => side });
        self.set_fighter_side(features.fighter_shadows);
        self.set_post_tuning(tuning_of(features, self.tuning));
        if samples_of(features, self.offered_samples) != self.samples {
            self.steer();
        }
        if let Incoming::Ready(incoming) = &mut self.incoming {
            incoming.set_features(features);
        }
    }
}
