//! Switches Original to Remastered in the middle of a match and times every frame of it: a renderer on Original art with `TEXTURES` baked textures and a model, a match in play (`set_playing(true)`), then the player's switch with the cache complete. Each frame is the pump, the draw and the GPU finishing it, paced to 60 Hz. Prints the frame time before the switch, during it and the worst frame; the library's own `wisp remaster:` line says how many scenes the swap took and its slowest pump. Usage: `XDG_CACHE_HOME=$(mktemp -d) cargo run --release -p wisp-window --example remaster_switch [TEXTURES]`; the cache the textures bake into is under `XDG_CACHE_HOME`.

use std::time::{Duration, Instant};

use image::ImageEncoder;
use wisp_window::remaster::Quality;
use wisp_window::render::{DrawScene, Renderer};
use wisp_window::settings::Preset;

const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;
const SIZE: (u32, u32) = (1920, 1080);
const PERIOD: Duration = Duration::from_micros(16_667);
const SALT: u32 = 7;
const RIG: &[u8] = include_bytes!("../tests/fixtures/rig.mdx");

fn texture(index: u32, salt: u32) -> Vec<u8> {
    let side = if index.is_multiple_of(10) { 256 } else { 128 };
    let pixels: Vec<u8> = (0..side * side).flat_map(|at| [((at % side) ^ index) as u8, ((at / side) ^ salt) as u8, (index.wrapping_mul(7) ^ salt) as u8, 255]).collect();
    let mut png = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png).write_image(&pixels, side, side, image::ExtendedColorType::Rgba8).unwrap();
    png
}

struct Rig {
    device: wgpu::Device,
    queue: wgpu::Queue,
    renderer: Renderer,
    target: wgpu::TextureView,
    scene: DrawScene,
}

impl Rig {
    fn frame(&mut self) -> f64 {
        let began = Instant::now();
        self.renderer.pump();
        let mut encoder = self.device.create_command_encoder(&Default::default());
        self.renderer.draw(&mut encoder, &self.target, SIZE, SIZE.0 as f32 / SIZE.1 as f32, &self.scene);
        self.queue.submit([encoder.finish()]);
        self.device.poll(wgpu::PollType::wait_indefinitely()).expect("poll");
        let took = began.elapsed();
        std::thread::sleep(PERIOD.saturating_sub(took));
        took.as_secs_f64() * 1e3
    }

    fn until(&mut self, mut done: impl FnMut(&Renderer) -> bool) -> Vec<f64> {
        let mut times = Vec::new();
        while !done(&self.renderer) {
            times.push(self.frame());
            assert!(times.len() < 100_000, "the art never settled");
        }
        times
    }
}

fn report(label: &str, times: &[f64]) {
    let mut sorted = times.to_vec();
    sorted.sort_by(f64::total_cmp);
    let at = |share: f64| sorted[((sorted.len() as f64 * share).ceil() as usize).clamp(1, sorted.len()) - 1];
    println!("{label}: {} frames, p50 {:.1} ms, p99 {:.1} ms, worst {:.1} ms", sorted.len(), at(0.5), at(0.99), sorted.last().copied().unwrap_or(0.0));
}

fn main() {
    let textures: u32 = std::env::args().nth(1).and_then(|count| count.parse().ok()).unwrap_or(1000);
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions { power_preference: wgpu::PowerPreference::HighPerformance, ..Default::default() })).expect("a GPU adapter");
    println!("adapter: {}", adapter.get_info().name);
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor { required_limits: wisp_window::remaster::device_limits(&adapter.limits()), ..Default::default() })).expect("a device");
    let target = device.create_texture(&wgpu::TextureDescriptor { label: None, size: wgpu::Extent3d { width: SIZE.0, height: SIZE.1, depth_or_array_layers: 1 }, mip_level_count: 1, sample_count: 1, dimension: wgpu::TextureDimension::D2, format: FORMAT, usage: wgpu::TextureUsages::RENDER_ATTACHMENT, view_formats: &[] }).create_view(&Default::default());
    let renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, Quality::Off, Preset::High.features());
    let mut rig = Rig { device, queue, renderer, target, scene: DrawScene::default() };

    rig.renderer.set_quality(Quality::Standard);
    rig.renderer.ingest("rig.mdx", RIG.to_vec());
    for index in 0..textures {
        rig.renderer.ingest(&format!("art{index}.png"), texture(index, SALT));
    }
    let baking = Instant::now();
    rig.until(|renderer| !renderer.art_pending() && renderer.bake_progress().is_some_and(|progress| progress.ready()));
    println!("baked and swapped in {:.1} s", baking.elapsed().as_secs_f64());

    rig.renderer.set_quality(Quality::Off);
    rig.until(|renderer| renderer.quality() == Quality::Off && !renderer.art_pending());
    rig.renderer.set_playing(true);
    let mut original = Vec::new();
    for _ in 0..180 {
        original.push(rig.frame());
    }
    report("Original, in the match", &original);

    rig.renderer.set_quality(Quality::Standard);
    let mut switching = vec![rig.frame()];
    switching.extend(rig.until(|renderer| !renderer.art_pending()));
    report("the switch to Remastered, in the match", &switching);
    let mut remastered = Vec::new();
    for _ in 0..180 {
        remastered.push(rig.frame());
    }
    report("Remastered, in the match", &remastered);
}
