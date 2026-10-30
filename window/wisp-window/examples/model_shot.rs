use std::path::PathBuf;

use wisp_window::model::Model;
use wisp_window::remaster::Quality;
use wisp_window::render::{DrawScene, Renderer};

const SIDE: (u32, u32) = (1280, 720);
const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

fn texture_bytes(stocks: &[PathBuf], name: &str) -> Option<Vec<u8>> {
    let key = name.replace('\\', "/").to_ascii_lowercase();
    let stem = key.rsplit_once('.').map_or(key.as_str(), |(stem, _)| stem);
    stocks.iter().find_map(|stock| ["png", "dds", "blp"].iter().find_map(|extension| std::fs::read(stock.join(format!("{stem}.{extension}"))).ok()))
}

fn look_at(eye: [f32; 3], target: [f32; 3]) -> [f32; 16] {
    let sub = |a: [f32; 3], b: [f32; 3]| [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    let cross = |a: [f32; 3], b: [f32; 3]| [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    let dot = |a: [f32; 3], b: [f32; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let unit = |a: [f32; 3]| { let n = dot(a, a).sqrt(); [a[0] / n, a[1] / n, a[2] / n] };
    let forward = unit(sub(target, eye));
    let right = unit(cross(forward, [0.0, 0.0, 1.0]));
    let up = cross(right, forward);
    let back = [-forward[0], -forward[1], -forward[2]];
    [right[0], up[0], back[0], 0.0, right[1], up[1], back[1], 0.0, right[2], up[2], back[2], 0.0, -dot(right, eye), -dot(up, eye), -dot(back, eye), 1.0]
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let out = PathBuf::from(&args[0]);
    let stocks: Vec<PathBuf> = args[1].split(':').map(PathBuf::from).collect();
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions::default())).expect("adapter");
    println!("adapter {}", adapter.get_info().name);
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default())).expect("device");
    let mut renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, Quality::Off);
    let mut poses = Vec::new();
    for (index, path) in args[2..].iter().enumerate() {
        let bytes = stocks.iter().find_map(|stock| std::fs::read(stock.join(path)).ok()).expect("model");
        let model = Model::from_mdx(&bytes).expect("model parses");
        for texture in &model.textures {
            if texture.replaceable_id == 0 && !texture.image.is_empty() {
                match texture_bytes(&stocks, &texture.image) {
                    Some(data) => renderer.ingest(&texture.image, data),
                    None => println!("missing texture {}", texture.image),
                }
            }
        }
        let (sequence, frame) = model.sequences.iter().position(|s| s.name.to_ascii_lowercase().starts_with("stand")).map_or((0, 0.0), |at| (at as i32, model.sequences[at].interval[0] as f32));
        renderer.ingest(path, bytes);
        poses.push(serde_json::json!({ "model": path, "matrix": [1.0,0.0,0.0,0.0, 0.0,1.0,0.0,0.0, 0.0,0.0,1.0,0.0, index as f32 * 700.0, 0.0, 0.0, 1.0], "sequence": sequence, "frame": frame, "clock": 0.0, "alpha": 1.0, "color": [1.0, 1.0, 1.0], "team": [1.0, 0.0, 0.0] }));
    }
    std::thread::sleep(std::time::Duration::from_secs(2));
    renderer.pump();
    for problem in renderer.problems.drain(..) {
        println!("problem: {problem}");
    }
    let centre = (args.len() as f32 - 3.0) * 350.0;
    let view = look_at([centre, -1400.0, 500.0], [centre, 0.0, 150.0]);
    let scene = serde_json::json!({ "camera": { "view": view, "eye": [centre, -1400.0, 500.0], "tangent": 0.6, "near": 10.0, "far": 20000.0, "skyFar": 20000.0, "rise": 0.0 }, "poses": poses, "clear": [0.3, 0.4, 0.6], "frame": 1 });
    let scene = DrawScene::parse(scene.to_string().as_bytes()).expect("scene");
    let target = device.create_texture(&wgpu::TextureDescriptor { label: None, size: wgpu::Extent3d { width: SIDE.0, height: SIDE.1, depth_or_array_layers: 1 }, mip_level_count: 1, sample_count: 1, dimension: wgpu::TextureDimension::D2, format: FORMAT, usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC, view_formats: &[] });
    let mut encoder = device.create_command_encoder(&Default::default());
    renderer.draw(&mut encoder, &target.create_view(&Default::default()), SIDE, SIDE.0 as f32 / SIDE.1 as f32, &scene);
    let buffer = device.create_buffer(&wgpu::BufferDescriptor { label: None, size: (SIDE.0 * SIDE.1 * 4) as u64, usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false });
    encoder.copy_texture_to_buffer(target.as_image_copy(), wgpu::TexelCopyBufferInfo { buffer: &buffer, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(SIDE.0 * 4), rows_per_image: Some(SIDE.1) } }, wgpu::Extent3d { width: SIDE.0, height: SIDE.1, depth_or_array_layers: 1 });
    queue.submit([encoder.finish()]);
    buffer.slice(..).map_async(wgpu::MapMode::Read, |_| ());
    let _ = device.poll(wgpu::PollType::wait_indefinitely());
    let pixels = buffer.slice(..).get_mapped_range().expect("mapped").to_vec();
    image::save_buffer(&out, &pixels, SIDE.0, SIDE.1, image::ColorType::Rgba8).expect("png");
    println!("wrote {}", out.display());
}
