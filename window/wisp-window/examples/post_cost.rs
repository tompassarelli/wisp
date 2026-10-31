//! Times the final-image pass and the sky's cloud pass at 2880x1920 with GPU timestamps, a hundred frames in one submission, and prints the cost of each pass. Usage: `cargo run --release -p wisp-window --example post_cost [CLOUD_LAYERS]`; the budget is 2 ms per frame on the laptop GPU, and 0.5 ms for the clouds.

use wisp_window::post::{Look, Post, Tuning, TUNING};
use wisp_window::render::DrawScene;

const SCENE: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
const DEPTH: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;
const OUTPUT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;
const SIZE: (u32, u32) = (2880, 1920);
const FRAMES: u32 = 100;
const STAMPS: u32 = 4096;

fn sky_scene() -> DrawScene {
    let mut scene = DrawScene::default();
    scene.camera.view = [1.0, 0.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0];
    scene.camera.tangent = 0.5;
    scene.camera.near = 10.0;
    scene.camera.far = 1000.0;
    scene.sky_look = Some(serde_json::from_str(r#"{"zenith":[0.1,0.2,0.4],"cover":0.55,"sunAzimuth":90,"sunElevation":14,"sun":[1,0.88,0.7],"stars":0.5,"glow":0.4}"#).unwrap());
    scene
}

fn main() {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions { power_preference: wgpu::PowerPreference::HighPerformance, ..Default::default() })).expect("a GPU adapter");
    println!("adapter: {}", adapter.get_info().name);
    let timing = wgpu::Features::TIMESTAMP_QUERY | wgpu::Features::TIMESTAMP_QUERY_INSIDE_ENCODERS;
    assert!(adapter.features().contains(timing), "this adapter has no timestamp queries");
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor { required_features: timing, ..Default::default() })).expect("a device");
    let make = |format, samples, usage| {
        device
            .create_texture(&wgpu::TextureDescriptor { label: None, size: wgpu::Extent3d { width: SIZE.0, height: SIZE.1, depth_or_array_layers: 1 }, mip_level_count: 1, sample_count: samples, dimension: wgpu::TextureDimension::D2, format, usage, view_formats: &[] })
            .create_view(&Default::default())
    };
    let both = wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING;
    let (hdr, depth, target) = (make(SCENE, 1, both), make(DEPTH, 4, both), make(OUTPUT, 1, wgpu::TextureUsages::RENDER_ATTACHMENT));
    let mut post = Post::new(&device, &queue, OUTPUT, SCENE, DEPTH, 4);
    post.fit(SIZE, &hdr, &depth);
    let scene = sky_scene();
    let layers = std::env::args().nth(1).and_then(|layers| layers.parse().ok()).unwrap_or(TUNING.cloud_layers);
    post.prepare(&Look::of(&scene, SIZE.0 as f32 / SIZE.1 as f32, [0.0, 0.0, SIZE.0 as f32, SIZE.1 as f32], false, &Tuning { cloud_layers: layers, ..TUNING }));
    let mut run = |frames: u32| -> (f64, Vec<(String, f64)>) {
        let mut encoder = device.create_command_encoder(&Default::default());
        drop(encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: None,
            color_attachments: &[Some(wgpu::RenderPassColorAttachment { view: &hdr, depth_slice: None, resolve_target: None, ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color { r: 0.3, g: 0.3, b: 0.3, a: 1.0 }), store: wgpu::StoreOp::Store } })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        }));
        drop(encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: None,
            color_attachments: &[],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment { view: &depth, depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(0.5), store: wgpu::StoreOp::Store }), stencil_ops: None }),
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        }));
        let stamps = device.create_query_set(&wgpu::QuerySetDescriptor { label: None, ty: wgpu::QueryType::Timestamp, count: STAMPS });
        let resolve = device.create_buffer(&wgpu::BufferDescriptor { label: None, size: STAMPS as u64 * 8, usage: wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC, mapped_at_creation: false });
        let read = device.create_buffer(&wgpu::BufferDescriptor { label: None, size: STAMPS as u64 * 8, usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false });
        let mut timed = device.create_command_encoder(&Default::default());
        let mut labels: Vec<String> = Vec::new();
        timed.write_timestamp(&stamps, 0);
        for _ in 0..frames {
            post.draw_clouds(&mut timed);
            labels.push("clouds".to_string());
            timed.write_timestamp(&stamps, labels.len() as u32);
            post.encode_marked(&mut timed, &target, &mut |encoder, label| {
                labels.push(label.to_string());
                encoder.write_timestamp(&stamps, labels.len() as u32);
            });
        }
        timed.resolve_query_set(&stamps, 0..labels.len() as u32 + 1, &resolve, 0);
        timed.copy_buffer_to_buffer(&resolve, 0, &read, 0, STAMPS as u64 * 8);
        queue.submit([encoder.finish(), timed.finish()]);
        device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
        read.slice(..).map_async(wgpu::MapMode::Read, |_| ());
        device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
        let ticks: Vec<u64> = bytemuck::cast_slice(&read.slice(..).get_mapped_range().unwrap()).to_vec();
        let period = queue.get_timestamp_period() as f64 / 1e6;
        let mut per_pass: Vec<(String, f64)> = Vec::new();
        for (index, label) in labels.iter().enumerate() {
            let took = (ticks[index + 1] - ticks[index]) as f64 * period;
            match per_pass.iter_mut().find(|(name, _)| name == label) {
                Some((_, sum)) => *sum += took,
                None => per_pass.push((label.clone(), took)),
            }
        }
        ((ticks[labels.len()] - ticks[0]) as f64 * period, per_pass)
    };
    run(5);
    let (total, per_pass) = run(FRAMES);
    println!("post pass at {}x{}: {:.3} ms per frame", SIZE.0, SIZE.1, total / FRAMES as f64);
    for (label, sum) in per_pass {
        println!("  {label}: {:.3} ms", sum / FRAMES as f64);
    }
}
