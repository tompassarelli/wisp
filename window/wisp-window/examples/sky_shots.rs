//! Draws each stage's sky offscreen at match zoom from three camera pans and times the sky at the laptop panel.
//! Usage: `cargo run --release -p wisp-window --example sky_shots -- OUT_DIR STAGES.json [low|medium|high|ultra]`, where STAGES.json is `[{ "name", "fog": [r, g, b], "look": { zenith, cover, sunAzimuth, sunElevation, sun, stars, glow } }]`; set `WISP_SKY_BENCH` to time 2880x1920 frames with and without the clouds.

use std::path::PathBuf;
use std::time::Instant;

use serde_json::{json, Value};
use wisp_window::remaster::Quality;
use wisp_window::render::{DrawScene, Renderer};
use wisp_window::settings::Preset;

const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;
const PANS: [f32; 3] = [-500.0, 0.0, 500.0];

fn look_at(eye: [f32; 3], target: [f32; 3]) -> [f32; 16] {
    let sub = |a: [f32; 3], b: [f32; 3]| [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    let cross = |a: [f32; 3], b: [f32; 3]| [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    let dot = |a: [f32; 3], b: [f32; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let unit = |a: [f32; 3]| {
        let length = dot(a, a).sqrt();
        [a[0] / length, a[1] / length, a[2] / length]
    };
    let forward = unit(sub(target, eye));
    let right = unit(cross(forward, [0.0, 0.0, 1.0]));
    let up = cross(right, forward);
    let back = forward.map(|axis| -axis);
    [right[0], up[0], back[0], 0.0, right[1], up[1], back[1], 0.0, right[2], up[2], back[2], 0.0, -dot(right, eye), -dot(up, eye), -dot(back, eye), 1.0]
}

fn scene(stage: &Value, pan: f32, clouds: bool, frame: u32) -> DrawScene {
    let eye = [pan, -1500.0, 120.0];
    let mut look = stage["look"].clone();
    if !clouds && !look.is_null() {
        look["cover"] = json!(0.0);
    }
    let scene = json!({
        "camera": { "view": look_at(eye, [pan, 0.0, 330.0]), "eye": eye, "tangent": 0.5, "near": 20.0, "far": 12000.0, "skyFar": 12000.0, "rise": 0.0 },
        "fog": { "color": stage["fog"], "start": 2500.0, "end": 9000.0, "max": 0.75 },
        "skyLook": look,
        "clear": stage["fog"],
        "frame": frame,
    });
    DrawScene::parse(scene.to_string().as_bytes()).expect("scene")
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let out = PathBuf::from(&args[0]);
    let stages: Vec<Value> = serde_json::from_slice(&std::fs::read(&args[1]).expect("stages file")).expect("stages json");
    let preset = match args.get(2).map(String::as_str) {
        Some("low") => Preset::Low,
        Some("medium") => Preset::Medium,
        Some("ultra") => Preset::Ultra,
        _ => Preset::High,
    };
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions { power_preference: wgpu::PowerPreference::HighPerformance, ..Default::default() })).expect("adapter");
    println!("adapter {}", adapter.get_info().name);
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default())).expect("device");
    let mut renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, Quality::Off, preset.features());
    let target_of = |size: (u32, u32)| {
        device.create_texture(&wgpu::TextureDescriptor { label: None, size: wgpu::Extent3d { width: size.0, height: size.1, depth_or_array_layers: 1 }, mip_level_count: 1, sample_count: 1, dimension: wgpu::TextureDimension::D2, format: FORMAT, usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC, view_formats: &[] })
    };
    let aspect = |size: (u32, u32)| size.0 as f32 / size.1 as f32;
    if std::env::var("WISP_SKY_BENCH").is_ok() {
        let size = (2880, 1920);
        let target = target_of(size);
        let view = target.create_view(&Default::default());
        for stage in &stages {
            let mut times = [0.0f64; 2];
            for (slot, clouds) in [false, true].into_iter().enumerate() {
                let draw = |renderer: &mut Renderer, frames: u32| {
                    let started = Instant::now();
                    for frame in 0..frames {
                        let mut encoder = device.create_command_encoder(&Default::default());
                        renderer.draw(&mut encoder, &view, size, aspect(size), &scene(stage, 0.0, clouds, frame));
                        queue.submit([encoder.finish()]);
                    }
                    let _ = device.poll(wgpu::PollType::wait_indefinitely());
                    started.elapsed().as_secs_f64() * 1000.0 / frames as f64
                };
                draw(&mut renderer, 10);
                times[slot] = draw(&mut renderer, 120);
            }
            println!("{}: {:.3} ms without clouds, {:.3} ms with, {:+.3} ms added", stage["name"], times[0], times[1], times[1] - times[0]);
        }
        return;
    }
    let size = (1920, 1080);
    let target = target_of(size);
    let row = (size.0 * 4).next_multiple_of(256);
    for stage in &stages {
        for (index, pan) in PANS.into_iter().enumerate() {
            let mut encoder = device.create_command_encoder(&Default::default());
            renderer.draw(&mut encoder, &target.create_view(&Default::default()), size, aspect(size), &scene(stage, pan, true, 180 * (index as u32 + 1)));
            let buffer = device.create_buffer(&wgpu::BufferDescriptor { label: None, size: u64::from(row * size.1), usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false });
            encoder.copy_texture_to_buffer(target.as_image_copy(), wgpu::TexelCopyBufferInfo { buffer: &buffer, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row), rows_per_image: Some(size.1) } }, wgpu::Extent3d { width: size.0, height: size.1, depth_or_array_layers: 1 });
            queue.submit([encoder.finish()]);
            buffer.slice(..).map_async(wgpu::MapMode::Read, |_| ());
            let _ = device.poll(wgpu::PollType::wait_indefinitely());
            let mapped = buffer.slice(..).get_mapped_range().expect("mapped");
            let pixels: Vec<u8> = mapped.chunks(row as usize).flat_map(|line| line[..(size.0 * 4) as usize].iter().copied()).collect();
            let path = out.join(format!("sky-{}-pan{index}.png", stage["name"].as_str().expect("a stage name")));
            image::save_buffer(&path, &pixels, size.0, size.1, image::ColorType::Rgba8).expect("png");
            println!("wrote {}", path.display());
        }
    }
    assert!(renderer.problems.is_empty(), "{:?}", renderer.problems);
}
