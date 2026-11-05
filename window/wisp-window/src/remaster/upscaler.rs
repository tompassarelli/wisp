//! Chooses how a texture doubles by its role: figures take Real-CUGAN on the window's GPU when the adapter is real hardware and the network runs, scenery, interface art and every texture otherwise take the edge-directed filter of `upscale.rs`, which also supplies the alpha either way so cutout and team-colour edges are the same under both.

use std::io::Write;
use std::sync::{Mutex, OnceLock};

use super::cugan::{self, Cugan, Edges};
use super::role::Role;
use super::upscale;
use crate::texture::Image;

/// The method name of the edge-directed filter, in cache keys and in `method`.
pub const FILTER: &str = "edge-directed";

pub struct Upscaler {
    device: Option<(wgpu::Device, wgpu::Queue, String)>,
    learned: OnceLock<Option<Mutex<Cugan>>>,
    notices: Mutex<Vec<String>>,
}

impl Upscaler {
    /// The edge-directed filter alone.
    pub fn classical() -> Self {
        Self { device: None, learned: OnceLock::from(None), notices: Mutex::new(Vec::new()) }
    }

    /// Real-CUGAN on `device` when `adapter` is hardware, built when the first texture needs it; a software adapter (llvmpipe, WARP), weights that do not load or a device the kernels do not validate on fall back to the edge-directed filter, and `announce` says so once.
    pub fn on(device: wgpu::Device, queue: wgpu::Queue, adapter: &wgpu::AdapterInfo) -> Self {
        if adapter.device_type == wgpu::DeviceType::Cpu {
            return Self::falling_back(format!("{} is a software adapter, so textures use the edge-directed filter instead of Real-CUGAN", adapter.name));
        }
        Self { device: Some((device, queue, adapter.name.clone())), learned: OnceLock::new(), notices: Mutex::new(Vec::new()) }
    }

    fn falling_back(notice: String) -> Self {
        Self { device: None, learned: OnceLock::from(None), notices: Mutex::new(vec![notice]) }
    }

    fn learned(&self) -> Option<&Mutex<Cugan>> {
        self.learned
            .get_or_init(|| {
                let (device, queue, name) = self.device.as_ref()?;
                let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
                let built = Cugan::new(device.clone(), queue.clone());
                let invalid = pollster::block_on(scope.pop());
                let reason = match (built, invalid) {
                    (Ok(network), None) => return Some(Mutex::new(network)),
                    (Err(error), _) => format!("Real-CUGAN did not load on {name} ({error})"),
                    (Ok(_), Some(error)) => format!("Real-CUGAN's kernels were refused by {name} ({error})"),
                };
                self.notices.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).push(format!("{reason}, so textures use the edge-directed filter"));
                None
            })
            .as_ref()
    }

    fn learned_for(&self, role: Role) -> Option<&Mutex<Cugan>> {
        match role {
            Role::Figure => self.learned(),
            Role::Scenery | Role::Interface => None,
        }
    }

    /// What makes the textures of `role`: part of every cache key, so entries from the other method are never read.
    pub fn method(&self, role: Role) -> &'static str {
        if self.learned_for(role).is_some() {
            cugan::MODEL
        } else {
            FILTER
        }
    }

    /// Writes each reason for a fallback to `out` once.
    pub fn announce(&self, out: &mut dyn Write) {
        for notice in std::mem::take(&mut *self.notices.lock().unwrap_or_else(|poisoned| poisoned.into_inner())) {
            let _ = writeln!(out, "wisp remaster: {notice}");
        }
    }

    /// `image` at twice the size, and whether Real-CUGAN failed on this texture alone so that the edge-directed filter made its colour; `name` is the texture's path for the notice.
    pub fn doubled(&self, image: &Image, edges: Edges, role: Role, name: &str) -> (Image, bool) {
        let Some(learned) = self.learned_for(role) else { return (upscale::steps(image, 1), false) };
        let (mut classical, colour) = std::thread::scope(|scope| {
            let alpha = scope.spawn(|| upscale::steps(image, 1));
            let colour = learned.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).upscale(image, edges);
            (alpha.join().expect("the edge-directed filter does not panic"), colour)
        });
        match colour {
            Ok(colour) => {
                for (pixel, learned) in classical.rgba.chunks_exact_mut(4).zip(colour.rgba.chunks_exact(4)) {
                    pixel[..3].copy_from_slice(&learned[..3]);
                }
                (classical, false)
            }
            Err(error) => {
                self.notices.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).push(format!("Real-CUGAN failed on {name} ({error}), so the edge-directed filter doubled it"));
                (classical, true)
            }
        }
    }
}
