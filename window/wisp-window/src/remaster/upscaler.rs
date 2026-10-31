//! Chooses how a texture doubles: Real-CUGAN on the window's GPU when the adapter is real hardware and the network runs, else the edge-directed filter of `upscale.rs`, which also supplies the alpha either way so cutout and team-colour edges are the same under both.

use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use super::cugan::{self, Cugan, Edges};
use super::upscale;
use crate::texture::Image;

/// The method name of the edge-directed filter, in cache keys and in `method`.
pub const FILTER: &str = "edge-directed";

pub struct Upscaler {
    device: Option<(wgpu::Device, wgpu::Queue, String)>,
    learned: OnceLock<Option<Mutex<Cugan>>>,
    stopped: AtomicBool,
    notice: Mutex<Option<String>>,
}

impl Upscaler {
    /// The edge-directed filter alone.
    pub fn classical() -> Self {
        Self { device: None, learned: OnceLock::from(None), stopped: AtomicBool::new(false), notice: Mutex::new(None) }
    }

    /// Real-CUGAN on `device` when `adapter` is hardware, built when the first texture needs it; a software adapter (llvmpipe, WARP), weights that do not load or a device the kernels do not validate on fall back to the edge-directed filter, and `announce` says so once.
    pub fn on(device: wgpu::Device, queue: wgpu::Queue, adapter: &wgpu::AdapterInfo) -> Self {
        if adapter.device_type == wgpu::DeviceType::Cpu {
            return Self::falling_back(format!("{} is a software adapter, so textures use the edge-directed filter instead of Real-CUGAN", adapter.name));
        }
        Self { device: Some((device, queue, adapter.name.clone())), learned: OnceLock::new(), stopped: AtomicBool::new(false), notice: Mutex::new(None) }
    }

    fn falling_back(notice: String) -> Self {
        Self { device: None, learned: OnceLock::from(None), stopped: AtomicBool::new(false), notice: Mutex::new(Some(notice)) }
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
                *self.notice.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(format!("{reason}, so textures use the edge-directed filter"));
                None
            })
            .as_ref()
    }

    /// What made the textures: part of every cache key, so entries from the other method are never read.
    pub fn method(&self) -> &'static str {
        if self.learned().is_some() && !self.stopped.load(Ordering::Relaxed) {
            cugan::MODEL
        } else {
            FILTER
        }
    }

    /// Writes the reason for a fallback to `out`, the first time only.
    pub fn announce(&self, out: &mut dyn Write) {
        if let Some(notice) = self.notice.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take() {
            let _ = writeln!(out, "wisp remaster: {notice}");
        }
    }

    /// `image` at twice the size.
    pub fn doubled(&self, image: &Image, edges: Edges) -> Image {
        let Some(learned) = self.learned().filter(|_| !self.stopped.load(Ordering::Relaxed)) else { return upscale::steps(image, 1) };
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
            }
            Err(error) => {
                self.stopped.store(true, Ordering::Relaxed);
                *self.notice.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(format!("Real-CUGAN failed ({error}), so textures use the edge-directed filter"));
            }
        }
        classical
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Any adapter on the machine, with its description made to say it is software.
    fn device() -> Option<(wgpu::Device, wgpu::Queue, wgpu::AdapterInfo)> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions::default())).ok()?;
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default())).ok()?;
        let software = wgpu::AdapterInfo { name: "llvmpipe (LLVM 19.1.7, 256 bits)".into(), device_type: wgpu::DeviceType::Cpu, ..adapter.get_info() };
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
        assert_eq!(upscaler.method(), "edge-directed");
        let mut log = Vec::new();
        upscaler.announce(&mut log);
        upscaler.announce(&mut log);
        let text = String::from_utf8(log).unwrap();
        assert_eq!(text.lines().count(), 1, "{text}");
        assert!(text.contains("llvmpipe") && text.contains("edge-directed filter"));
        let image = checker();
        assert_eq!(upscaler.doubled(&image, Edges::Mirror).rgba, upscale::steps(&image, 1).rgba);
    }

    #[test]
    fn a_real_software_adapter_falls_back_the_same_way() {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let Some(adapter) = pollster::block_on(instance.enumerate_adapters(wgpu::Backends::all())).into_iter().find(|adapter| adapter.get_info().device_type == wgpu::DeviceType::Cpu) else { return };
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default())).unwrap();
        let upscaler = Upscaler::on(device, queue, &adapter.get_info());
        let mut log = Vec::new();
        upscaler.announce(&mut log);
        assert_eq!(upscaler.method(), "edge-directed");
        assert!(String::from_utf8(log).unwrap().contains("software adapter"));
        let image = checker();
        assert_eq!(upscaler.doubled(&image, Edges::Mirror).rgba, upscale::steps(&image, 1).rgba);
    }
}
