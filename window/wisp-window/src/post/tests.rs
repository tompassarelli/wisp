use super::look::{display_bytes, Grade};
use super::*;
use crate::render::DrawScene;

const SIDE: u32 = 64;
const SCENE: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
const DEPTH: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;
const OUTPUT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;
const PLAIN: Tuning = Tuning { bloom_strength: 0.0, occlusion_strength: 0.0, ..TUNING };

fn gpu() -> Option<(wgpu::Device, wgpu::Queue)> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions { power_preference: wgpu::PowerPreference::HighPerformance, ..Default::default() })).ok()?;
    eprintln!("adapter: {}", adapter.get_info().name);
    let timing = wgpu::Features::TIMESTAMP_QUERY | wgpu::Features::TIMESTAMP_QUERY_INSIDE_ENCODERS;
    let wanted = adapter.features() & timing;
    pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor { required_features: wanted, ..Default::default() })).ok()
}

fn half(value: f32) -> u16 {
    if value == 0.0 {
        return 0;
    }
    let bits = value.to_bits();
    let exponent = ((bits >> 23) & 0xff) as i32 - 127 + 15;
    (((exponent.clamp(1, 30) as u32) << 10) | ((bits >> 13) & 0x3ff)) as u16
}

fn scene() -> DrawScene {
    let mut scene = DrawScene::default();
    scene.camera.view = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0];
    scene.camera.tangent = 1.0;
    scene.camera.near = 10.0;
    scene.camera.far = 1000.0;
    scene
}

fn texture(device: &wgpu::Device, format: wgpu::TextureFormat, samples: u32, usage: wgpu::TextureUsages) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: None,
        size: wgpu::Extent3d { width: SIDE, height: SIDE, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: samples,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage,
        view_formats: &[],
    })
}

/// Runs the whole pass over a SIDE x SIDE HDR picture whose texel (x, y) is `light(x, y)`, with geometry everywhere, and reads the output bytes back.
fn run(device: &wgpu::Device, queue: &wgpu::Queue, light: impl Fn(u32, u32) -> [f32; 3], grade_light: bool, tuning: Tuning) -> Vec<[u8; 4]> {
    let both = wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING;
    let hdr = texture(device, SCENE, 1, both | wgpu::TextureUsages::COPY_DST);
    let texels: Vec<u16> = (0..SIDE * SIDE).flat_map(|at| light(at % SIDE, at / SIDE).into_iter().chain([1.0]).map(half)).collect();
    queue.write_texture(hdr.as_image_copy(), bytemuck::cast_slice(&texels), wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(SIDE * 8), rows_per_image: Some(SIDE) }, wgpu::Extent3d { width: SIDE, height: SIDE, depth_or_array_layers: 1 });
    let depth = texture(device, DEPTH, 4, both);
    let target = texture(device, OUTPUT, 1, wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC);
    let (hdr_view, depth_view, target_view) = (hdr.create_view(&Default::default()), depth.create_view(&Default::default()), target.create_view(&Default::default()));
    let mut post = Post::new(device, queue, OUTPUT, SCENE, DEPTH, 4);
    post.fit((SIDE, SIDE), &hdr_view, &depth_view);
    let mut scene = scene();
    if grade_light {
        scene.light = Some(serde_json::from_str(r#"{"toward":[0,0,1],"key":[1,0.8,0.5],"ambient":[0.2,0.3,0.6]}"#).unwrap());
    }
    post.prepare(&Look::of(&scene, 1.0, [0.0, 0.0, SIDE as f32, SIDE as f32], false, &tuning));
    let mut encoder = device.create_command_encoder(&Default::default());
    drop(encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
        label: Some("flat geometry"),
        color_attachments: &[],
        depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment { view: &depth_view, depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(0.5), store: wgpu::StoreOp::Store }), stencil_ops: None }),
        timestamp_writes: None,
        occlusion_query_set: None,
        multiview_mask: None,
    }));
    post.encode(&mut encoder, &target_view);
    let buffer = device.create_buffer(&wgpu::BufferDescriptor { label: None, size: (SIDE * SIDE * 4) as u64, usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false });
    encoder.copy_texture_to_buffer(
        target.as_image_copy(),
        wgpu::TexelCopyBufferInfo { buffer: &buffer, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(SIDE * 4), rows_per_image: Some(SIDE) } },
        wgpu::Extent3d { width: SIDE, height: SIDE, depth_or_array_layers: 1 },
    );
    queue.submit([encoder.finish()]);
    buffer.slice(..).map_async(wgpu::MapMode::Read, |_| ());
    device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
    let mapped = buffer.slice(..).get_mapped_range().unwrap();
    mapped.chunks(4).map(|texel| [texel[0], texel[1], texel[2], texel[3]]).collect()
}

fn near(got: [u8; 4], want: [u8; 3]) -> bool {
    (0..3).all(|channel| got[channel].abs_diff(want[channel]) <= 3)
}

#[test]
fn post_tone_maps_a_flat_hdr_picture_to_the_curves_srgb_bytes() {
    let Some((device, queue)) = gpu() else { return eprintln!("no GPU adapter: the shader check is skipped, the curve's own tests still run") };
    for grey in [0.05f32, 0.18, 0.5, 1.0, 3.0] {
        let out = run(&device, &queue, |_, _| [grey; 3], false, PLAIN);
        let want = display_bytes([grey; 3], &Grade::NEUTRAL);
        let got = out[(SIDE / 2 * SIDE + SIDE / 2) as usize];
        assert!(near(got, want), "HDR {grey} came out {got:?}, the curve says {want:?}");
    }
}

#[test]
fn post_grades_with_the_stages_light() {
    let Some((device, queue)) = gpu() else { return };
    let grade = Grade::of_light([1.0, 0.8, 0.5], [0.2, 0.3, 0.6]);
    let got = run(&device, &queue, |_, _| [0.4; 3], true, PLAIN)[(SIDE / 2 * SIDE + SIDE / 2) as usize];
    assert!(near(got, display_bytes([0.4; 3], &grade)), "{got:?} against {:?}", display_bytes([0.4; 3], &grade));
}

#[test]
fn post_lets_a_hot_spot_glow_into_its_surroundings_but_not_a_lit_surface() {
    let Some((device, queue)) = gpu() else { return };
    let spark = |x: u32, y: u32| if x.abs_diff(SIDE / 2) <= 2 && y.abs_diff(SIDE / 2) <= 2 { [40.0; 3] } else { [0.05; 3] };
    let glowing = run(&device, &queue, spark, false, TUNING);
    let plain = display_bytes([0.05; 3], &Grade::NEUTRAL);
    let beside = glowing[(SIDE / 2 * SIDE + SIDE / 2 + 5) as usize];
    assert!(beside[0] > plain[0] + 8, "three pixels from the spark the image is lifted: {beside:?} against {plain:?}");
    let lit = run(&device, &queue, |_, _| [0.7; 3], false, TUNING);
    let want = display_bytes([0.7; 3], &Grade::NEUTRAL);
    assert!(near(lit[(SIDE / 2 * SIDE + SIDE / 2) as usize], want), "a surface under the threshold does not bloom");
}
