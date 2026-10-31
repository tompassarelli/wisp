//! Chooses how a texture doubles by its role: figures take Real-CUGAN on the window's GPU when the adapter is real hardware and the network runs, scenery and every texture otherwise take the edge-directed filter of `upscale.rs`, which also supplies the alpha either way so cutout and team-colour edges are the same under both.

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
            Role::Scenery => None,
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
                self.notices.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).push(format!("Real-CUGAN failed on {name} ({error}), so this texture uses the edge-directed filter"));
                (classical, true)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Any adapter on the machine, with its description made to say it is software.
    fn device() -> Option<(wgpu::Device, wgpu::Queue, wgpu::AdapterInfo)> {
        let (info, device, queue) = crate::test_gpu::with_info()?;
        let software = wgpu::AdapterInfo { name: "llvmpipe (LLVM 19.1.7, 256 bits)".into(), device_type: wgpu::DeviceType::Cpu, ..info };
        Some((device, queue, software))
    }

    fn checker() -> Image {
        let rgba = (0..64).flat_map(|index| if (index % 8 / 2 + index / 8 / 2) % 2 == 0 { [220, 40, 40, 255] } else { [30, 30, 200, 128] }).collect();
        Image { width: 8, height: 8, rgba }
    }

    #[test]
    fn a_software_adapter_runs_todays_filter_and_says_so_once() {
        let Some((device, queue, software)) = device() else { return };
        let upscaler = Upscaler::on(device, queue, &software);
        assert_eq!(upscaler.method(Role::Figure), "edge-directed");
        let mut log = Vec::new();
        upscaler.announce(&mut log);
        upscaler.announce(&mut log);
        let text = String::from_utf8(log).unwrap();
        assert_eq!(text.lines().count(), 1, "{text}");
        assert!(text.contains("llvmpipe") && text.contains("edge-directed filter"));
        let image = checker();
        assert_eq!(upscaler.doubled(&image, Edges::Mirror, Role::Figure, "checker").0.rgba, upscale::steps(&image, 1).rgba);
    }

    #[test]
    fn one_texture_that_fails_falls_back_alone_and_is_named_once() {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let Some(adapter) = pollster::block_on(instance.enumerate_adapters(wgpu::Backends::all())).into_iter().find(|adapter| adapter.get_info().device_type != wgpu::DeviceType::Cpu) else { return };
        let Ok((device, queue)) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default())) else { return };
        let upscaler = Upscaler::on(device, queue, &adapter.get_info());
        let (_, failed) = upscaler.doubled(&Image { width: 0, height: 0, rgba: Vec::new() }, Edges::Mirror, Role::Figure, "units\\broken.blp");
        assert!(failed);
        let image = checker();
        let (doubled, failed) = upscaler.doubled(&image, Edges::Mirror, Role::Figure, "units\\fine.blp");
        assert!(!failed);
        assert_eq!(upscaler.method(Role::Figure), cugan::MODEL);
        assert_ne!(doubled.rgba, upscale::steps(&image, 1).rgba);
        let mut log = Vec::new();
        upscaler.announce(&mut log);
        upscaler.announce(&mut log);
        let text = String::from_utf8(log).unwrap();
        assert_eq!(text.lines().count(), 1, "{text}");
        assert!(text.contains("units\\broken.blp"));
    }

    fn hardware() -> Option<Upscaler> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let adapter = pollster::block_on(instance.enumerate_adapters(wgpu::Backends::all())).into_iter().find(|adapter| adapter.get_info().device_type != wgpu::DeviceType::Cpu)?;
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default())).ok()?;
        Some(Upscaler::on(device, queue, &adapter.get_info()))
    }

    fn skin(size: u32) -> Image {
        let rgba = (0..size * size).flat_map(|index| [(index * 37 % 251) as u8, (index / size * 5 % 256) as u8, (index % size * 9 % 256) as u8, 255]).collect();
        Image { width: size, height: size, rgba }
    }

    #[test]
    fn a_two_pixel_texture_does_not_stop_the_network_for_the_next_texture() {
        let Some(upscaler) = hardware() else { return };
        let tiny = Image { width: 2, height: 2, rgba: [200, 30, 30, 255].repeat(4) };
        let (doubled, failed) = upscaler.doubled(&tiny, Edges::Mirror, Role::Figure, "war3mapImported\\FighterWhite-65bfd307.tga");
        assert!(!failed);
        assert_eq!((doubled.width, doubled.height), (4, 4));
        let image = skin(64);
        let (doubled, failed) = upscaler.doubled(&image, Edges::Mirror, Role::Figure, "war3mapImported\\FighterWhite-1.tga");
        assert!(!failed);
        assert_eq!(upscaler.method(Role::Figure), cugan::MODEL);
        assert_ne!(doubled.rgba, upscale::steps(&image, 1).rgba, "the 64x64 skin went through the network");
        let mut log = Vec::new();
        upscaler.announce(&mut log);
        assert!(log.is_empty(), "{}", String::from_utf8_lossy(&log));
    }

    #[test]
    fn a_terrain_tile_takes_the_edge_directed_filter_and_a_fighter_skin_takes_real_cugan() {
        let Some(upscaler) = hardware() else { return };
        let image = skin(64);
        let tile = Role::for_path("TerrainArt\\LordaeronSummer\\Lords_Grass.blp");
        let fighter = Role::for_path("war3mapImported\\FighterWhite-65bfd307.tga");
        assert_eq!((upscaler.method(tile), upscaler.method(fighter)), ("edge-directed", cugan::MODEL));
        assert_eq!(upscaler.doubled(&image, Edges::Wrap, tile, "tile").0.rgba, upscale::steps(&image, 1).rgba);
        assert_ne!(upscaler.doubled(&image, Edges::Mirror, fighter, "skin").0.rgba, upscale::steps(&image, 1).rgba);
    }

    #[test]
    fn a_real_software_adapter_falls_back_the_same_way() {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let Some(adapter) = pollster::block_on(instance.enumerate_adapters(wgpu::Backends::all())).into_iter().find(|adapter| adapter.get_info().device_type == wgpu::DeviceType::Cpu) else { return };
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default())).unwrap();
        let upscaler = Upscaler::on(device, queue, &adapter.get_info());
        let mut log = Vec::new();
        upscaler.announce(&mut log);
        assert_eq!(upscaler.method(Role::Figure), "edge-directed");
        assert!(String::from_utf8(log).unwrap().contains("software adapter"));
        let image = checker();
        assert_eq!(upscaler.doubled(&image, Edges::Mirror, Role::Figure, "checker").0.rgba, upscale::steps(&image, 1).rgba);
    }
}
