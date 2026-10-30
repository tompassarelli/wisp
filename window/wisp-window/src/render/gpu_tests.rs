use super::*;
use crate::model::Emitter2;
use model::EmitterSample;
use scene::Bolt;

const SIDE: u32 = 128;
const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

fn device() -> Option<(wgpu::Device, wgpu::Queue)> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions { force_fallback_adapter: false, ..Default::default() })).ok()?;
    pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default())).ok()
}

fn translation(x: f32, y: f32, z: f32) -> Mat4 {
    let mut matrix = IDENTITY;
    matrix[12..15].copy_from_slice(&[x, y, z]);
    matrix
}

fn render(renderer: &mut Renderer, device: &wgpu::Device, queue: &wgpu::Queue, scene: &Scene) -> Vec<u8> {
    let target = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("target"),
        size: wgpu::Extent3d { width: SIDE, height: SIDE, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let mut encoder = device.create_command_encoder(&Default::default());
    renderer.draw(&mut encoder, &target.create_view(&Default::default()), (SIDE, SIDE), 1.0, scene);
    let buffer = device.create_buffer(&wgpu::BufferDescriptor { label: Some("read"), size: (SIDE * SIDE * 4) as u64, usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false });
    encoder.copy_texture_to_buffer(
        target.as_image_copy(),
        wgpu::TexelCopyBufferInfo { buffer: &buffer, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(SIDE * 4), rows_per_image: Some(SIDE) } },
        wgpu::Extent3d { width: SIDE, height: SIDE, depth_or_array_layers: 1 },
    );
    queue.submit([encoder.finish()]);
    buffer.slice(..).map_async(wgpu::MapMode::Read, |_| ());
    let _ = device.poll(wgpu::PollType::wait_indefinitely());
    let bytes = buffer.slice(..).get_mapped_range().expect("mapped").to_vec();
    bytes
}

fn pixel(image: &[u8], x: u32, y: u32) -> [u8; 3] {
    let at = ((y * SIDE + x) * 4) as usize;
    [image[at], image[at + 1], image[at + 2]]
}

#[test]
fn a_particle_and_a_bolt_reach_the_screen() {
    let Some((device, queue)) = device() else { return };
    let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
    let mut renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, crate::remaster::Quality::Off);
    let spec = Emitter2 { rows: 1, columns: 1, head: true, life_span: 5.0, time: 0.5, scaling: [20.0; 3], alphas: [1.0; 3], colors: [[1.0; 3]; 3], ..Emitter2::default() };
    let emitter = ModelEmitter { spec, paint: Paint::None };
    let slot = renderer.particles.register(&device, &queue, &emitter, ("", &renderer.white), &renderer.sampler).expect("room for an emitter");
    let mut scene = Scene { frame: 0, ..Scene::default() };
    scene.camera = scene::Camera { view: IDENTITY, eye: [0.0; 3], tangent: 1.0, near: 1.0, far: 10_000.0, sky_far: 10_000.0, rise: 0.0 };
    let _ = render(&mut renderer, &device, &queue, &scene);
    renderer.particles.begin(1);
    let sample = EmitterSample { visible: true, rate: 120.0, ..EmitterSample::default() };
    renderer.particles.emit(1, 0, slot, &emitter, &sample, &translation(0.0, 0.0, -100.0), 1.0);
    scene.frame = 1;
    scene.lightnings = vec![Bolt { from: [-80.0, 70.0, -100.0], to: [80.0, 70.0, -100.0], color: [0.2, 0.4, 1.0, 1.0] }];
    let image = render(&mut renderer, &device, &queue, &scene);
    let centre = pixel(&image, SIDE / 2, SIDE / 2);
    let corner = pixel(&image, 2, SIDE - 3);
    assert!(centre[0] > 200 && centre[1] > 200, "the particle's white quad covers the middle: {centre:?}");
    assert!(corner[0] < 40, "the corner is clear: {corner:?}");
    let bolt_rows = (0..SIDE / 3).filter(|&y| (0..SIDE).any(|x| pixel(&image, x, y)[2] > 150)).count();
    assert!(bolt_rows > 0, "the bolt lights rows in the upper third");
    let error = pollster::block_on(scope.pop());
    assert!(error.is_none(), "wgpu validation: {error:?}");
}
