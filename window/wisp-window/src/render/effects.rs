//! What follows a pose besides its particles: the strips its ribbon emitters lay and the copies its version-1 emitters fling, on the emission clock the particles share.

use std::collections::HashMap;

use super::emission::{Clock, Tick};
use super::math::{multiply, Mat4};
use super::particles::Particles;
use super::ribbons::Ribbons;
use super::scene::{Pose, StripPose};
use super::spawned::Spawned;
use super::GpuModel;
use crate::settings::Features;

pub(super) struct Effects {
    clock: Clock,
    pub(super) ribbons: Ribbons,
    pub(super) spawned: Spawned,
}

impl Effects {
    pub(super) fn new(device: &wgpu::Device, format: wgpu::TextureFormat, particles: &Particles, samples: u32, features: &Features) -> Self {
        let mut ribbons = Ribbons::new(device, format, particles, samples);
        ribbons.density = f32::from(features.ribbon_percent) / 100.0;
        Self { clock: Clock::default(), ribbons, spawned: Spawned::new() }
    }

    /// Steps the clock to the scene's frame and starts the ribbons' and copies' frame on it; the particles start theirs on the tick it returns.
    pub(super) fn begin(&mut self, frame: u32) -> Tick {
        let tick = self.clock.tick(frame);
        self.ribbons.begin(tick);
        self.spawned.begin(tick);
        tick
    }

    /// Lays the edges of the pose's ribbons and flings the copies of its version-1 emitters, each from its node's matrix in `bones`.
    pub(super) fn emit(&mut self, model: &GpuModel, bones: &[Mat4], pose: &Pose) {
        for (index, ((ribbon, ring), sample)) in model.ribbons.iter().zip(model.rig.ribbons()).enumerate() {
            let Some(bone) = bones.get(ribbon.node) else { continue };
            self.ribbons.emit((pose.id, index), *ring, ribbon, sample, &multiply(&pose.matrix, bone), pose.alpha);
        }
        for (index, (spawner, sample)) in model.spawners.iter().zip(model.rig.spawners()).enumerate() {
            let Some(bone) = bones.get(spawner.node) else { continue };
            self.spawned.emit(index, spawner, sample, &multiply(&pose.matrix, bone), pose);
        }
    }

    /// Moves the flung copies on through the first sequence of the model each copies, found in `models` by `ids`, and lends their poses out to be laid out beside the scene's until `restore`.
    pub(super) fn fly(&mut self, ids: &HashMap<String, usize>, models: &[GpuModel]) -> Vec<Pose> {
        self.spawned.advance(|path| ids.get(path).and_then(|&id| models[id].rig.interval(0)));
        self.spawned.take()
    }

    pub(super) fn restore(&mut self, poses: Vec<Pose>) {
        self.spawned.restore(poses);
    }

    /// Stages the scene's own strips, uploads what the ribbons laid this frame, and moves what went wrong into `problems`.
    pub(super) fn finish(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, strips: &[StripPose], white: &wgpu::TextureView, sampler: &wgpu::Sampler, problems: &mut Vec<String>) {
        self.ribbons.strips(device, strips, white, sampler);
        self.ribbons.finish(queue);
        problems.append(&mut self.ribbons.problems);
        problems.append(&mut self.spawned.problems);
    }

    pub(super) fn draw<'a>(&'a self, pass: &mut wgpu::RenderPass<'a>, particles: &'a Particles) {
        self.ribbons.draw(pass, particles);
    }
}
