//! Times what ribbon strips add to a frame at 2880x1920 with GPU timestamps: frames that alternate between an empty scene and the same scene with `STRIPS` strips of `EDGES` edges each, a swing arc apiece whose outer radius is `REACH` world units (40 by default, about a ninth of the frame height across) 600 units in front of the camera, since the cost grows with the screen the strips cover, so the GPU clock drifts alike for both, and prints each kind of frame's p50 and p99 and what the strips add. Usage: `cargo run --release -p wisp-window --example ribbon_cost [low|medium|high|ultra] [STRIPS] [EDGES] [REACH]`; the budget is 0.2 ms at p99 for four strips of sixteen edges.

use wisp_window::remaster::Quality;
use wisp_window::render::{DrawScene, Renderer};
use wisp_window::settings::PRESETS;

const OUTPUT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;
const SIZE: (u32, u32) = (2880, 1920);
const FRAMES: u32 = 400;

fn scene_json(frame: u32, strips: usize, edges: usize, reach: f32) -> String {
    let arcs: Vec<String> = (0..strips)
        .map(|strip| {
            let centre = -300.0 + 200.0 * strip as f32;
            let points: Vec<String> = (0..edges)
                .map(|edge| {
                    let angle = std::f32::consts::PI * (0.15 + 0.7 * edge as f32 / (edges.max(2) - 1) as f32) + 0.05 * frame as f32;
                    let (inner, outer) = (reach * 0.4, reach);
                    let alpha = edge as f32 / (edges.max(2) - 1) as f32;
                    format!("[{},{},-600,{},{},-600,{alpha}]", centre + outer * angle.cos(), outer * angle.sin() - 80.0, centre + inner * angle.cos(), inner * angle.sin() - 80.0)
                })
                .collect();
            format!(r#"{{"edges":[{}],"color":[1.0,0.85,0.5]}}"#, points.join(","))
        })
        .collect();
    format!(
        r#"{{"frame":{frame},"camera":{{"view":[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],"eye":[0,0,0],"tangent":0.6,"near":10,"far":10000,"skyFar":10000,"rise":0}},"strips":[{}]}}"#,
        arcs.join(",")
    )
}

fn percentile(sorted: &[f64], fraction: f64) -> f64 {
    sorted[((sorted.len() as f64 * fraction).ceil() as usize).clamp(1, sorted.len()) - 1]
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let preset = PRESETS.into_iter().find(|preset| args.first().is_some_and(|name| preset.name().eq_ignore_ascii_case(name))).unwrap_or(PRESETS[2]);
    let strips: usize = args.get(1).and_then(|value| value.parse().ok()).unwrap_or(4);
    let edges: usize = args.get(2).and_then(|value| value.parse().ok()).unwrap_or(16);
    let reach: f32 = args.get(3).and_then(|value| value.parse().ok()).unwrap_or(40.0);
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions { power_preference: wgpu::PowerPreference::HighPerformance, ..Default::default() })).expect("a GPU adapter");
    println!("adapter: {}, preset {}, {strips} strips of {edges} edges at {}x{}", adapter.get_info().name, preset.name(), SIZE.0, SIZE.1);
    let timing = wgpu::Features::TIMESTAMP_QUERY | wgpu::Features::TIMESTAMP_QUERY_INSIDE_ENCODERS;
    assert!(adapter.features().contains(timing), "this adapter has no timestamp queries");
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor { required_features: timing, ..Default::default() })).expect("a device");
    let mut renderer = Renderer::new(device.clone(), queue.clone(), OUTPUT, Quality::Off, preset.features());
    let target = device
        .create_texture(&wgpu::TextureDescriptor { label: None, size: wgpu::Extent3d { width: SIZE.0, height: SIZE.1, depth_or_array_layers: 1 }, mip_level_count: 1, sample_count: 1, dimension: wgpu::TextureDimension::D2, format: OUTPUT, usage: wgpu::TextureUsages::RENDER_ATTACHMENT, view_formats: &[] })
        .create_view(&Default::default());
    let queries = device.create_query_set(&wgpu::QuerySetDescriptor { label: None, ty: wgpu::QueryType::Timestamp, count: FRAMES * 2 });
    let resolved = device.create_buffer(&wgpu::BufferDescriptor { label: None, size: u64::from(FRAMES * 2 * 8), usage: wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC, mapped_at_creation: false });
    let read = device.create_buffer(&wgpu::BufferDescriptor { label: None, size: u64::from(FRAMES * 2 * 8), usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false });
    let period = f64::from(queue.get_timestamp_period());
    let scene = |frame: u32, strips: usize| DrawScene::parse(scene_json(frame, strips, edges, reach).as_bytes()).expect("the scene parses");
    for frame in 0..20 {
        let mut encoder = device.create_command_encoder(&Default::default());
        renderer.draw(&mut encoder, &target, SIZE, SIZE.0 as f32 / SIZE.1 as f32, &scene(frame, strips * (frame % 2) as usize));
        queue.submit([encoder.finish()]);
    }
    let mut encoder = device.create_command_encoder(&Default::default());
    for at in 0..FRAMES {
        let shown = scene(20 + at, strips * (at % 2) as usize);
        encoder.write_timestamp(&queries, at * 2);
        renderer.draw(&mut encoder, &target, SIZE, SIZE.0 as f32 / SIZE.1 as f32, &shown);
        encoder.write_timestamp(&queries, at * 2 + 1);
    }
    encoder.resolve_query_set(&queries, 0..FRAMES * 2, &resolved, 0);
    encoder.copy_buffer_to_buffer(&resolved, 0, &read, 0, u64::from(FRAMES * 2 * 8));
    queue.submit([encoder.finish()]);
    read.slice(..).map_async(wgpu::MapMode::Read, |_| ());
    let _ = device.poll(wgpu::PollType::wait_indefinitely());
    let stamps: Vec<u64> = bytemuck::cast_slice(&read.slice(..).get_mapped_range().expect("mapped")).to_vec();
    read.unmap();
    let costs: Vec<f64> = stamps.chunks_exact(2).map(|pair| (pair[1].saturating_sub(pair[0])) as f64 * period / 1e6).collect();
    let sorted = |parity: usize| {
        let mut kind: Vec<f64> = costs.iter().skip(parity).step_by(2).copied().collect();
        kind.sort_by(f64::total_cmp);
        kind
    };
    let (empty, drawn) = (sorted(0), sorted(1));
    let line = |name: &str, costs: &[f64]| println!("{name}: frame p50 {:.3} ms, p99 {:.3} ms", percentile(costs, 0.5), percentile(costs, 0.99));
    line("without strips", &empty);
    line("with strips", &drawn);
    println!("strips add: p50 {:.3} ms, p99 {:.3} ms", percentile(&drawn, 0.5) - percentile(&empty, 0.5), percentile(&drawn, 0.99) - percentile(&empty, 0.99));
    if !renderer.problems.is_empty() {
        println!("problems: {:?}", renderer.problems);
    }
}
