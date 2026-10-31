//! Draws models from eight sides with the window's renderer, to compare two builds of it: `face_shots OUT_DIR TEXTURE_ROOTS MODEL.mdx...` writes OUT_DIR/INDEX.png for the INDEX-th model, a strip of eight square views of its stand sequence's first frame, turning a model's eighth of a circle at a time under a camera a little above it. TEXTURE_ROOTS is a colon-separated list of folders holding textures by their lower-case path. Output stays in OUT_DIR, outside any repository.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use wisp_window::model::Model;
use wisp_window::remaster::Quality;
use wisp_window::render::{DrawScene, Renderer};

const SIDE: u32 = 192;
const VIEWS: u32 = 8;
const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

fn texture_bytes(roots: &[PathBuf], name: &str) -> Option<Vec<u8>> {
    let key = name.replace('\\', "/").to_ascii_lowercase();
    let stem = key.rsplit_once('.').map_or(key.as_str(), |(stem, _)| stem);
    roots.iter().find_map(|root| ["png", "dds", "blp", "tga"].iter().find_map(|extension| std::fs::read(root.join(format!("{stem}.{extension}"))).ok()))
}

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
    let back = [-forward[0], -forward[1], -forward[2]];
    [right[0], up[0], back[0], 0.0, right[1], up[1], back[1], 0.0, right[2], up[2], back[2], 0.0, -dot(right, eye), -dot(up, eye), -dot(back, eye), 1.0]
}

/// The middle of the model's vertices and the radius of a ball around it that holds them all.
fn ball(model: &Model) -> ([f32; 3], f32) {
    let (mut low, mut high) = ([f32::MAX; 3], [f32::MIN; 3]);
    for vertex in model.geosets.iter().flat_map(|geoset| &geoset.vertices) {
        for axis in 0..3 {
            low[axis] = low[axis].min(vertex[axis]);
            high[axis] = high[axis].max(vertex[axis]);
        }
    }
    let centre = [0, 1, 2].map(|axis| (low[axis] + high[axis]) / 2.0);
    let radius = [0, 1, 2].map(|axis| (high[axis] - low[axis]) / 2.0).iter().map(|half| half * half).sum::<f32>().sqrt();
    (centre, radius.max(1.0))
}

/// Hands the renderer every model that parses and the textures it paints with, and waits up to two minutes for them to build.
fn loaded(renderer: &mut Renderer, roots: &[PathBuf], paths: &[String]) -> Vec<(usize, String, Model)> {
    let mut models = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (index, path) in paths.iter().enumerate() {
        let Ok(bytes) = std::fs::read(path) else { continue };
        let Ok(model) = Model::from_mdx(&bytes) else { continue };
        for texture in model.textures.iter().filter(|texture| texture.replaceable_id == 0 && !texture.image.is_empty()) {
            if seen.insert(texture.image.to_ascii_lowercase()) {
                if let Some(data) = texture_bytes(roots, &texture.image) {
                    renderer.ingest(&texture.image, data);
                }
            }
        }
        let name = format!("model{index}");
        renderer.ingest(&name, bytes);
        models.push((index, name, model));
    }
    let started = Instant::now();
    while models.iter().any(|(_, name, _)| !renderer.has_model(name)) && started.elapsed() < Duration::from_secs(120) {
        renderer.pump();
        std::thread::sleep(Duration::from_millis(20));
    }
    models
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let out = PathBuf::from(&args[0]);
    let roots: Vec<PathBuf> = args[1].split(':').map(PathBuf::from).collect();
    std::fs::create_dir_all(&out).expect("output folder");
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions::default())).expect("adapter");
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default())).expect("device");
    let mut renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, Quality::Off, wisp_window::settings::Preset::Low.features());
    let models = loaded(&mut renderer, &roots, &args[2..]);
    let target = device.create_texture(&wgpu::TextureDescriptor { label: None, size: wgpu::Extent3d { width: SIDE, height: SIDE, depth_or_array_layers: 1 }, mip_level_count: 1, sample_count: 1, dimension: wgpu::TextureDimension::D2, format: FORMAT, usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC, view_formats: &[] });
    let buffer = device.create_buffer(&wgpu::BufferDescriptor { label: None, size: u64::from(SIDE * SIDE * 4), usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false });
    let mut frame = 0u64;
    for (index, name, model) in &models {
        if !renderer.has_model(name) {
            println!("{}\tnot built", args[2 + index]);
            continue;
        }
        if model.geosets.iter().all(|geoset| geoset.vertices.is_empty()) {
            println!("{}\tno geometry", args[2 + index]);
            continue;
        }
        let sequence = model.sequences.iter().position(|sequence| sequence.name.to_ascii_lowercase().starts_with("stand")).unwrap_or(0);
        let start = model.sequences.get(sequence).map_or(0.0, |sequence| sequence.interval[0] as f32);
        let (centre, radius) = ball(model);
        let distance = radius / 0.6 * 1.1;
        let eye = [centre[0], centre[1] - distance * 0.94, centre[2] + distance * 0.34];
        let view = look_at(eye, centre);
        let mut strip = vec![0u8; (SIDE * VIEWS * SIDE * 4) as usize];
        for turn in 0..VIEWS {
            let angle = turn as f32 * std::f32::consts::TAU / VIEWS as f32;
            let (sin, cos) = angle.sin_cos();
            let shift = [centre[0] - (cos * centre[0] - sin * centre[1]), centre[1] - (sin * centre[0] + cos * centre[1])];
            frame += 1;
            let scene = serde_json::json!({
                "camera": { "view": view, "eye": eye, "tangent": 0.6, "near": distance * 0.05, "far": distance * 4.0, "skyFar": distance * 4.0, "rise": 0.0 },
                "poses": [{ "model": name, "matrix": [cos, sin, 0.0, 0.0, -sin, cos, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, shift[0], shift[1], 0.0, 1.0], "sequence": sequence, "frame": start, "clock": 0.0, "alpha": 1.0, "color": [1.0, 1.0, 1.0], "team": [1.0, 0.0, 0.0] }],
                "clear": [0.3, 0.4, 0.6],
                "frame": frame,
            });
            let scene = DrawScene::parse(scene.to_string().as_bytes()).expect("scene");
            let mut encoder = device.create_command_encoder(&Default::default());
            renderer.draw(&mut encoder, &target.create_view(&Default::default()), (SIDE, SIDE), 1.0, &scene);
            encoder.copy_texture_to_buffer(target.as_image_copy(), wgpu::TexelCopyBufferInfo { buffer: &buffer, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(SIDE * 4), rows_per_image: Some(SIDE) } }, wgpu::Extent3d { width: SIDE, height: SIDE, depth_or_array_layers: 1 });
            queue.submit([encoder.finish()]);
            buffer.slice(..).map_async(wgpu::MapMode::Read, |_| ());
            let _ = device.poll(wgpu::PollType::wait_indefinitely());
            {
                let pixels = buffer.slice(..).get_mapped_range().expect("mapped");
                for row in 0..SIDE {
                    let from = (row * SIDE * 4) as usize;
                    let to = ((row * SIDE * VIEWS + turn * SIDE) * 4) as usize;
                    strip[to..to + (SIDE * 4) as usize].copy_from_slice(&pixels[from..from + (SIDE * 4) as usize]);
                }
            }
            buffer.unmap();
        }
        image::save_buffer(Path::new(&out).join(format!("{index}.png")), &strip, SIDE * VIEWS, SIDE, image::ColorType::Rgba8).expect("png");
    }
    for problem in renderer.problems.drain(..) {
        println!("problem: {problem}");
    }
}
