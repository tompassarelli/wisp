use super::scene::{Camera, WeatherPose};
use super::*;

const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;
const FRAMES: u32 = 60;

fn adapter_device() -> Option<(wgpu::AdapterInfo, wgpu::Device, wgpu::Queue)> {
    crate::test_gpu::with_info()
}

fn look_at(eye: [f32; 3], target: [f32; 3]) -> Mat4 {
    let normalize = |v: [f32; 3]| {
        let length = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
        [v[0] / length, v[1] / length, v[2] / length]
    };
    let cross = |a: [f32; 3], b: [f32; 3]| [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    let dot = |a: [f32; 3], b: [f32; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let forward = normalize([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
    let right = normalize(cross(forward, [0.0, 0.0, 1.0]));
    let up = cross(right, forward);
    let back = [-forward[0], -forward[1], -forward[2]];
    let mut view = IDENTITY;
    for (row, axis) in [right, up, back].into_iter().enumerate() {
        for column in 0..3 {
            view[column * 4 + row] = axis[column];
        }
        view[12 + row] = -dot(axis, eye);
    }
    view
}

fn stage(weathers: &[&str], frame: u32) -> Scene {
    let target = [0.0, 0.0, 1800.0];
    let eye = [0.0, -1650.0 * 0.5, 1800.0 + 1650.0 * 0.866];
    let rect = [-8192.0, -6144.0, 8192.0, 10240.0];
    Scene {
        frame,
        camera: Camera { view: look_at(eye, target), eye, tangent: 0.45, near: 10.0, far: 10_000.0, sky_far: 10_000.0, rise: 0.0 },
        weathers: weathers.iter().map(|id| WeatherPose { id: id.to_string(), rect }).collect(),
        ..Scene::default()
    }
}

fn target(device: &wgpu::Device, size: (u32, u32)) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some("target"),
        size: wgpu::Extent3d { width: size.0, height: size.1, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    })
}

fn picture(renderer: &mut Renderer, device: &wgpu::Device, queue: &wgpu::Queue, scene: &Scene, size: (u32, u32)) -> Vec<u8> {
    let texture = target(device, size);
    let mut encoder = device.create_command_encoder(&Default::default());
    renderer.draw(&mut encoder, &texture.create_view(&Default::default()), size, size.0 as f32 / size.1 as f32, scene);
    let padded = (size.0 * 4).next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
    let buffer = device.create_buffer(&wgpu::BufferDescriptor { label: Some("read"), size: (padded * size.1) as u64, usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false });
    encoder.copy_texture_to_buffer(
        texture.as_image_copy(),
        wgpu::TexelCopyBufferInfo { buffer: &buffer, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(padded), rows_per_image: Some(size.1) } },
        wgpu::Extent3d { width: size.0, height: size.1, depth_or_array_layers: 1 },
    );
    queue.submit([encoder.finish()]);
    buffer.slice(..).map_async(wgpu::MapMode::Read, |_| ());
    let _ = device.poll(wgpu::PollType::wait_indefinitely());
    let mapped = buffer.slice(..).get_mapped_range().expect("mapped");
    mapped.chunks(padded as usize).flat_map(|row| row[..(size.0 * 4) as usize].iter().copied()).collect()
}

fn lit(image: &[u8]) -> usize {
    image.chunks(4).filter(|pixel| pixel[0] as u32 + pixel[1] as u32 + pixel[2] as u32 > 120).count()
}

#[test]
fn snow_rain_fog_and_rays_reach_the_screen() {
    let Some((_, device, queue)) = adapter_device() else { return };
    let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
    let mut renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, crate::remaster::Quality::Off, crate::settings::Preset::Ultra.features());
    let size = (640, 360);
    let clear = lit(&picture(&mut renderer, &device, &queue, &stage(&[], 0), size));
    assert_eq!(clear, 0, "no weather leaves the background dark");
    for (index, ids) in [["SNhs"], ["SNbs"], ["RAhr"], ["FDwh"], ["LRma"]].iter().enumerate() {
        let image = picture(&mut renderer, &device, &queue, &stage(ids, 60 + index as u32 * 60), size);
        let changed = image.chunks(4).filter(|pixel| pixel[0] as u32 + pixel[1] as u32 + pixel[2] as u32 > 60).count();
        assert!(changed > 50, "{ids:?} marks the picture: {changed} pixels");
        if let Some(directory) = std::env::var_os("WISP_WEATHER_OUT") {
            let path = std::path::Path::new(&directory).join(format!("{}.png", ids[0]));
            crate::capture::write(&path, size.0, size.1, &image).expect("write the capture");
        }
    }
    let error = pollster::block_on(scope.pop());
    assert!(error.is_none(), "wgpu validation: {error:?}");
}

#[test]
fn the_heaviest_weather_holds_the_frame_budget() {
    let Some((info, device, queue)) = adapter_device() else { return };
    let mut renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, crate::remaster::Quality::Off, crate::settings::Preset::Ultra.features());
    let size = (2880, 1920);
    let texture = target(&device, size);
    let view = texture.create_view(&Default::default());
    let heaviest = ["SNbs", "SNhs", "RAhr", "FDbh", "LRma"];
    let mut frame = |number: u32| {
        let mut encoder = device.create_command_encoder(&Default::default());
        renderer.draw(&mut encoder, &view, size, 1.5, &stage(&heaviest, number));
        queue.submit([encoder.finish()]);
        let _ = device.poll(wgpu::PollType::wait_indefinitely());
    };
    for number in 0..10 {
        frame(number);
    }
    let began = std::time::Instant::now();
    for number in 0..FRAMES {
        frame(10 + number);
    }
    let milliseconds = began.elapsed().as_secs_f64() * 1000.0 / FRAMES as f64;
    println!("adapter: {} ({:?}), {} weathers at {}x{}: {milliseconds:.2} ms per frame", info.name, info.device_type, heaviest.len(), size.0, size.1);
    if matches!(info.device_type, wgpu::DeviceType::DiscreteGpu | wgpu::DeviceType::IntegratedGpu) {
        assert!(milliseconds < 8.3, "{milliseconds:.2} ms per frame");
    }
}

#[test]
fn volumetrics_off_draws_no_fog_or_rays_and_a_quarter_of_the_snow() {
    let Some((_, device, queue)) = adapter_device() else { return };
    let size = (640, 360);
    let marked = |features: crate::settings::Features, id: &str| {
        let mut renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, crate::remaster::Quality::Off, features);
        let image = picture(&mut renderer, &device, &queue, &stage(&[id], 120), size);
        image.chunks(4).filter(|pixel| pixel[0] as u32 + pixel[1] as u32 + pixel[2] as u32 > 60).count()
    };
    use crate::settings::Preset::{High, Low, Ultra};
    assert_eq!(marked(High.features(), "FDwh"), 0, "fog needs volumetrics");
    assert_eq!(marked(High.features(), "LRma"), 0, "rays need volumetrics");
    assert!(marked(Ultra.features(), "FDwh") > 1000 && marked(Ultra.features(), "LRma") > 50, "Ultra draws both");
    let (full, quarter) = (marked(High.features(), "SNhs"), marked(Low.features(), "SNhs"));
    assert!(quarter > 0 && quarter * 2 < full, "Low draws a quarter of the flakes: {quarter} against {full}");
}
