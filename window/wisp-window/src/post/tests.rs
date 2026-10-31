use super::look::{display_bytes, Grade};
use super::*;
use crate::render::DrawScene;

const SIDE: u32 = 64;
const SCENE: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
const DEPTH: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;
const OUTPUT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;
const PLAIN: Tuning = Tuning { bloom_strength: 0.0, occlusion_strength: 0.0, contact_strength: 0.0, ..TUNING };

fn gpu() -> Option<(wgpu::Device, wgpu::Queue)> {
    crate::test_gpu::device()
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
    run_with(device, queue, light, None, |scene| {
        if grade_light {
            scene.light = Some(serde_json::from_str(r#"{"toward":[0,0,1],"key":[1,0.8,0.5],"ambient":[0.2,0.3,0.6]}"#).unwrap());
        }
    }, tuning)
}

/// `run` with the geometry's view depth at each texel from `depth` (zero is sky) in place of a flat 0.5 depth buffer, and `configure` to change the scene.
fn run_with(device: &wgpu::Device, queue: &wgpu::Queue, light: impl Fn(u32, u32) -> [f32; 3], depth_of: Option<&dyn Fn(u32, u32) -> f32>, configure: impl Fn(&mut DrawScene), tuning: Tuning) -> Vec<[u8; 4]> {
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
    configure(&mut scene);
    post.prepare(&Look::of(&scene, 1.0, [0.0, 0.0, SIDE as f32, SIDE as f32], false, &tuning));
    let mut encoder = device.create_command_encoder(&Default::default());
    match depth_of {
        None => drop(encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("flat geometry"),
            color_attachments: &[],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment { view: &depth_view, depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(0.5), store: wgpu::StoreOp::Store }), stencil_ops: None }),
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        })),
        Some(depth_of) => write_depth(device, queue, &mut encoder, &depth_view, depth_of),
    }
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

const DEPTH_WRITER: &str = r#"
@group(0) @binding(0) var source: texture_2d<f32>;

@vertex
fn vertex_main(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
    return vec4<f32>(f32((index << 1u) & 2u) * 2.0 - 1.0, f32(index & 2u) * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn depth_main(@builtin(position) at: vec4<f32>) -> @builtin(frag_depth) f32 {
    let w = textureLoad(source, vec2<i32>(at.xy), 0).r;
    let a = 1010.0 / -990.0;
    let b = 20000.0 / -990.0;
    return select((b / w - a + 1.0) * 0.5, 1.0, w <= 0.0);
}
"#;

/// Fills the multisampled `depth` with the view depth `depth_of` gives at each texel, for the camera `scene()` has (near 10, far 1000); zero is the sky.
fn write_depth(device: &wgpu::Device, queue: &wgpu::Queue, encoder: &mut wgpu::CommandEncoder, depth: &wgpu::TextureView, depth_of: &dyn Fn(u32, u32) -> f32) {
    let source = texture(device, wgpu::TextureFormat::R32Float, 1, wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST);
    let values: Vec<f32> = (0..SIDE * SIDE).map(|at| depth_of(at % SIDE, at / SIDE)).collect();
    queue.write_texture(source.as_image_copy(), bytemuck::cast_slice(&values), wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(SIDE * 4), rows_per_image: Some(SIDE) }, wgpu::Extent3d { width: SIDE, height: SIDE, depth_or_array_layers: 1 });
    let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor { label: None, entries: &[unfiltered_entry(0)] });
    let group = device.create_bind_group(&wgpu::BindGroupDescriptor { label: None, layout: &layout, entries: &[binding(0, wgpu::BindingResource::TextureView(&source.create_view(&Default::default())))] });
    let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: None, source: wgpu::ShaderSource::Wgsl(DEPTH_WRITER.into()) });
    let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: None, bind_group_layouts: &[Some(&layout)], immediate_size: 0 });
    let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: None,
        layout: Some(&pipeline_layout),
        vertex: wgpu::VertexState { module: &module, entry_point: Some("vertex_main"), compilation_options: Default::default(), buffers: &[] },
        fragment: Some(wgpu::FragmentState { module: &module, entry_point: Some("depth_main"), compilation_options: Default::default(), targets: &[] }),
        primitive: wgpu::PrimitiveState::default(),
        depth_stencil: Some(wgpu::DepthStencilState { format: DEPTH, depth_write_enabled: Some(true), depth_compare: Some(wgpu::CompareFunction::Always), stencil: Default::default(), bias: Default::default() }),
        multisample: wgpu::MultisampleState { count: 4, mask: !0, alpha_to_coverage_enabled: false },
        multiview_mask: None,
        cache: None,
    });
    let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
        label: Some("geometry from a depth profile"),
        color_attachments: &[],
        depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment { view: depth, depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(1.0), store: wgpu::StoreOp::Store }), stencil_ops: None }),
        timestamp_writes: None,
        occlusion_query_set: None,
        multiview_mask: None,
    });
    pass.set_pipeline(&pipeline);
    pass.set_bind_group(0, &group, &[]);
    pass.draw(0..3, 0..1);
}

const GREY: [f32; 3] = [0.5; 3];
const AO_ONLY: Tuning = Tuning { bloom_strength: 0.0, contact_strength: 0.0, occlusion_radius: 400.0, ..TUNING };
const CONTACT_ONLY: Tuning = Tuning { bloom_strength: 0.0, occlusion_strength: 0.0, contact_reach: 60.0, ..TUNING };

fn shade(device: &wgpu::Device, queue: &wgpu::Queue, depth: &dyn Fn(u32, u32) -> f32, tuning: Tuning) -> Vec<[u8; 4]> {
    run_with(device, queue, |_, _| GREY, Some(depth), |scene| scene.light = Some(serde_json::from_str(r#"{"toward":[0.8,0,0.6],"key":[1,0.8,0.5],"ambient":[0.2,0.3,0.6]}"#).unwrap()), tuning)
}

fn at(image: &[[u8; 4]], x: u32, y: u32) -> i32 {
    image[(y * SIDE + x) as usize][1] as i32
}

#[test]
fn post_occlusion_darkens_a_crease_and_not_the_flat_floor_beside_it() {
    let Some((device, queue)) = gpu() else { return };
    let groove = |x: u32, _: u32| 400.0 + 14.0 * (12.0 - (x as f32 - 32.0).abs()).max(0.0);
    let (flat, occluded) = (shade(&device, &queue, &groove, PLAIN), shade(&device, &queue, &groove, AO_ONLY));
    assert!(at(&flat, 4, 32) - at(&occluded, 4, 32) <= 2, "the open floor keeps its light");
    assert!(at(&flat, 32, 32) - at(&occluded, 32, 32) >= 8, "the groove's bottom is darker: {} against {}", at(&occluded, 32, 32), at(&flat, 32, 32));
}

#[test]
fn post_occlusion_leaves_no_halo_at_a_silhouette() {
    let Some((device, queue)) = gpu() else { return };
    let block = |x: u32, y: u32| x.abs_diff(32) < 10 && y.abs_diff(32) < 10;
    let against_sky = |x: u32, y: u32| if block(x, y) { 250.0_f32 } else { 0.0 };
    let against_backdrop = |x: u32, y: u32| if block(x, y) { 250.0 } else { 900.0 };
    for (name, depth) in [("sky", &against_sky as &dyn Fn(u32, u32) -> f32), ("backdrop", &against_backdrop)] {
        let (flat, occluded) = (shade(&device, &queue, depth, PLAIN), shade(&device, &queue, depth, AO_ONLY));
        for y in 16..48 {
            for x in 16..48 {
                assert!(at(&flat, x, y) - at(&occluded, x, y) <= 2, "{name}: ({x}, {y}) is {} where the unshaded picture is {}", at(&occluded, x, y), at(&flat, x, y));
            }
        }
    }
}

#[test]
fn post_occlusion_is_the_same_on_two_frames_of_a_still_scene() {
    let Some((device, queue)) = gpu() else { return };
    let groove = |x: u32, y: u32| 400.0 + 14.0 * (12.0 - (x as f32 - 32.0).abs()).max(0.0) + (y % 5) as f32;
    let frame = |index: u32| run_with(&device, &queue, |_, _| GREY, Some(&groove), |scene| scene.frame = index, AO_ONLY);
    assert_eq!(frame(10), frame(11));
}

#[test]
fn post_contact_shadows_darken_a_contact_and_not_open_floor() {
    let Some((device, queue)) = gpu() else { return };
    let wall_and_block = |x: u32, _: u32| if x >= 34 { 480.0 } else { 500.0 };
    let (flat, shadowed) = (shade(&device, &queue, &wall_and_block, PLAIN), shade(&device, &queue, &wall_and_block, CONTACT_ONLY));
    assert!(at(&flat, 33, 32) - at(&shadowed, 33, 32) >= 8, "the wall beside the block, toward the sun, is shadowed: {} against {}", at(&shadowed, 33, 32), at(&flat, 33, 32));
    assert_eq!(at(&flat, 10, 32), at(&shadowed, 10, 32), "open wall far from the block keeps its light");
    assert!(at(&flat, 50, 32) - at(&shadowed, 50, 32) <= 2, "the block's own lit face is not shadowed");
}
