//! Times the final-image pass and the sky's cloud pass at 2880x1920 with GPU timestamps, a hundred frames in one submission, over a receding bumpy floor lit from the camera's side so every ambient-occlusion and contact-shadow step runs, and prints the cost of each pass for each graphics preset, with what ambient occlusion and contact shadows add. Usage: `cargo run --release -p wisp-window --example post_cost [low|medium|high|ultra]`; the budget is 2 ms per frame on the laptop GPU, and 0.5 ms for the clouds.

use wisp_window::post::{Look, Post, Tuning, TUNING};
use wisp_window::render::DrawScene;
use wisp_window::settings::{Features, PRESETS};

const SCENE: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
const DEPTH: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;
const OUTPUT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;
const SIZE: (u32, u32) = (2880, 1920);
const FRAMES: u32 = 100;
const STAMPS: u32 = 4096;
const NEAR: f32 = 100.0;
const FAR: f32 = 20000.0;
const FLOOR: &str = r#"
@vertex
fn vertex_main(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
    return vec4<f32>(f32((index << 1u) & 2u) * 2.0 - 1.0, f32(index & 2u) * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn floor_main(@builtin(position) at: vec4<f32>) -> @builtin(frag_depth) f32 {
    let w = 1200.0 + 1800.0 * at.y / 1920.0 + 60.0 * sin(at.x * 0.031) * sin(at.y * 0.047);
    let a = (20000.0 + 100.0) / (100.0 - 20000.0);
    let b = 2.0 * 20000.0 * 100.0 / (100.0 - 20000.0);
    return (b / w - a + 1.0) * 0.5;
}
"#;

type Timing = (f64, Vec<(String, f64)>);

fn sky_scene() -> DrawScene {
    let mut scene = DrawScene::default();
    scene.camera.view = [1.0, 0.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0];
    scene.camera.tangent = 0.5;
    scene.camera.near = NEAR;
    scene.camera.far = FAR;
    scene.sky_look = Some(serde_json::from_str(r#"{"zenith":[0.1,0.2,0.4],"cover":0.55,"sunAzimuth":270,"sunElevation":35,"sun":[1,0.88,0.7],"stars":0.5,"glow":0.4}"#).unwrap());
    scene
}

fn tuning_of(features: Features) -> Tuning {
    Tuning {
        bloom_strength: if features.bloom { TUNING.bloom_strength } else { 0.0 },
        occlusion_strength: if features.ssao { TUNING.occlusion_strength } else { 0.0 },
        contact_strength: if features.contact_shadows { TUNING.contact_strength } else { 0.0 },
        cloud_layers: TUNING.cloud_layers.min(features.cloud_layers as u32),
        ..TUNING
    }
}

struct Rig {
    device: wgpu::Device,
    queue: wgpu::Queue,
    hdr: wgpu::TextureView,
    depth: wgpu::TextureView,
    target: wgpu::TextureView,
    floor: wgpu::RenderPipeline,
}

impl Rig {
    fn new() -> Rig {
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
        let floor = Self::floor_pipeline(&device);
        Rig { device, queue, hdr, depth, target, floor }
    }

    fn floor_pipeline(device: &wgpu::Device) -> wgpu::RenderPipeline {
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: None, source: wgpu::ShaderSource::Wgsl(FLOOR.into()) });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: None, bind_group_layouts: &[], immediate_size: 0 });
        device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: None,
            layout: Some(&layout),
            vertex: wgpu::VertexState { module: &module, entry_point: Some("vertex_main"), compilation_options: Default::default(), buffers: &[] },
            fragment: Some(wgpu::FragmentState { module: &module, entry_point: Some("floor_main"), compilation_options: Default::default(), targets: &[] }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: Some(wgpu::DepthStencilState { format: DEPTH, depth_write_enabled: Some(true), depth_compare: Some(wgpu::CompareFunction::Always), stencil: Default::default(), bias: Default::default() }),
            multisample: wgpu::MultisampleState { count: 4, mask: !0, alpha_to_coverage_enabled: false },
            multiview_mask: None,
            cache: None,
        })
    }

    fn draw_scene(&self, encoder: &mut wgpu::CommandEncoder) {
        let clear = wgpu::Color { r: 0.3, g: 0.3, b: 0.3, a: 1.0 };
        drop(encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: None,
            color_attachments: &[Some(wgpu::RenderPassColorAttachment { view: &self.hdr, depth_slice: None, resolve_target: None, ops: wgpu::Operations { load: wgpu::LoadOp::Clear(clear), store: wgpu::StoreOp::Store } })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        }));
        let mut ground = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: None,
            color_attachments: &[],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment { view: &self.depth, depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(1.0), store: wgpu::StoreOp::Store }), stencil_ops: None }),
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        ground.set_pipeline(&self.floor);
        ground.draw(0..3, 0..1);
    }

    fn run(&self, post: &Post, frames: u32) -> Timing {
        let device = &self.device;
        let mut encoder = device.create_command_encoder(&Default::default());
        self.draw_scene(&mut encoder);
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
            post.encode_marked(&mut timed, &self.target, &mut |encoder, label| {
                labels.push(label.to_string());
                encoder.write_timestamp(&stamps, labels.len() as u32);
            });
        }
        timed.resolve_query_set(&stamps, 0..labels.len() as u32 + 1, &resolve, 0);
        timed.copy_buffer_to_buffer(&resolve, 0, &read, 0, STAMPS as u64 * 8);
        self.queue.submit([encoder.finish(), timed.finish()]);
        device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
        read.slice(..).map_async(wgpu::MapMode::Read, |_| ());
        device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
        let ticks: Vec<u64> = bytemuck::cast_slice(&read.slice(..).get_mapped_range().unwrap()).to_vec();
        let period = self.queue.get_timestamp_period() as f64 / 1e6;
        let mut per_pass: Vec<(String, f64)> = Vec::new();
        for (index, label) in labels.iter().enumerate() {
            let took = (ticks[index + 1] - ticks[index]) as f64 * period;
            match per_pass.iter_mut().find(|(name, _)| name == label) {
                Some((_, sum)) => *sum += took,
                None => per_pass.push((label.clone(), took)),
            }
        }
        ((ticks[labels.len()] - ticks[0]) as f64 * period, per_pass)
    }

    fn best_of_five(&self, post: &mut Post, scene: &DrawScene, tuning: Tuning) -> Timing {
        let rect = [0.0, 0.0, SIZE.0 as f32, SIZE.1 as f32];
        post.prepare(&Look::of(scene, SIZE.0 as f32 / SIZE.1 as f32, rect, false, &tuning));
        self.run(post, 5);
        let runs = (0..5).map(|_| self.run(post, FRAMES));
        runs.min_by(|left, right| left.0.total_cmp(&right.0)).unwrap()
    }
}

fn main() {
    let rig = Rig::new();
    let mut post = Post::new(&rig.device, &rig.queue, OUTPUT, SCENE, DEPTH, 4);
    post.fit(SIZE, &rig.hdr, &rig.depth);
    let scene = sky_scene();
    let asked = std::env::args().nth(1).map(|name| name.to_ascii_lowercase());
    for preset in PRESETS.iter().filter(|preset| asked.as_deref().is_none_or(|name| name == preset.name().to_ascii_lowercase())) {
        let tuning = tuning_of(preset.features());
        let (total, per_pass) = rig.best_of_five(&mut post, &scene, tuning);
        let without = rig.best_of_five(&mut post, &scene, Tuning { occlusion_strength: 0.0, contact_strength: 0.0, ..tuning }).0;
        println!("{} post pass at {}x{}: {:.3} ms per frame; ambient occlusion and contact shadows add {:.3} ms", preset.name(), SIZE.0, SIZE.1, total / FRAMES as f64, (total - without) / FRAMES as f64);
        for (label, sum) in per_pass {
            println!("  {label}: {:.3} ms", sum / FRAMES as f64);
        }
    }
}
