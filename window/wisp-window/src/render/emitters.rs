//! Where a model's particle emitters meet the renderer: each is registered with the texture it paints with, and one that has none says so.

use super::model::{ModelEmitter, Paint};
use super::particles::Slot;
use super::Renderer;

impl Renderer {
    pub(super) fn register_emitters(&mut self, path: &str, emitters: Vec<ModelEmitter>) -> Vec<(ModelEmitter, Option<Slot>)> {
        let mut registered = Vec::new();
        for emitter in emitters {
            let (key, view) = match &emitter.paint {
                Paint::Texture(name) => match self.textures.get(&name.to_ascii_lowercase()) {
                    Some(view) => (name.as_str(), view),
                    None => {
                        self.problems.push(format!("{path}: particle texture {name} was never decoded, so its particles draw as white squares"));
                        (name.as_str(), &self.white)
                    }
                },
                other => {
                    self.problems.push(format!("{path}: a particle emitter paints with {other:?}, which has no texture, so its particles draw as white squares"));
                    ("", &self.white)
                }
            };
            let slot = self.particles.register(&self.device, &self.queue, &emitter, (key, view), &self.sampler);
            registered.push((emitter, slot));
        }
        registered
    }
}
