use super::shadow::flat_quad;
use super::*;
use std::time::Instant;

use crate::settings::{Features, Preset};

const FLOOR: f32 = 4000.0;

fn lamp(lights: Vec<model::ModelLight>) -> ModelData {
    let (mut vertices, mut indices) = (Vec::new(), Vec::new());
    let (first_index, index_count) = flat_quad(&mut vertices, &mut indices, 1.0, 0.0);
    let part = model::Part { color_slot: 0, first_index, index_count, layers: vec![model::Layer { paint: Paint::None, filter: Filter::Additive, color_slot: 1, unshaded: true }] };
    ModelData { vertices, indices, parts: vec![part], rig: Box::new(FlatRig { lights, ..FlatRig::new([1.0; 4]) }), emitters: Vec::new() }
}

fn light_at(color: f32) -> model::ModelLight {
    model::ModelLight { node: 0, pivot: [0.0; 3], start: 100.0, end: 900.0, color: [color; 3] }
}

fn stage(features: Features) -> Option<(Renderer, wgpu::Device, wgpu::Queue)> {
    let (device, queue) = device()?;
    let mut renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, crate::remaster::Quality::Off, features);
    renderer.textures.insert("grey".into(), upload(&device, &queue, &crate::texture::Image { width: 1, height: 1, rgba: vec![128, 128, 128, 255] }));
    let (mut vertices, mut indices) = (Vec::new(), Vec::new());
    let floor = flat_quad(&mut vertices, &mut indices, FLOOR, 0.0);
    let caster = flat_quad(&mut vertices, &mut indices, 40.0, 150.0);
    let part = |(first_index, index_count)| model::Part { color_slot: 0, first_index, index_count, layers: vec![model::Layer { paint: Paint::Texture("grey".into()), filter: Filter::Opaque, color_slot: 1, unshaded: false }] };
    renderer.add_model("stage", ModelData { vertices, indices, parts: vec![part(floor), part(caster)], rig: Box::new(FlatRig::new([1.0; 4])), emitters: Vec::new() });
    for (name, color) in [("lamp-strong", 1.0), ("lamp-weak", 0.6), ("lamp-faint", 0.2)] {
        renderer.add_model(name, lamp(vec![light_at(color)]));
    }
    Some((renderer, device, queue))
}

fn pose(model: &str, id: u32, at: [f32; 3]) -> scene::Pose {
    scene::Pose { id, model: model.into(), matrix: translation(at[0], at[1], at[2]), sequence: 0, frame: 0.0, clock: 0.0, alpha: 1.0, color: [1.0; 3], team: TEAM }
}

fn scene_of(lamps: &[(&str, u32, [f32; 3])], eye_shift: f32) -> Scene {
    let mut scene = Scene { frame: 0, clear: BACKGROUND, ..Scene::default() };
    scene.camera = scene::Camera { view: translation(-eye_shift, 0.0, -500.0), eye: [eye_shift, 0.0, 500.0], tangent: 1.0, near: 1.0, far: 10_000.0, sky_far: 10_000.0, rise: 0.0, reach: 2000.0 };
    scene.poses = vec![pose("stage", 0, [0.0; 3])];
    scene.poses.extend(lamps.iter().map(|&(model, id, at)| pose(model, id, at)));
    scene
}

fn floor_at(image: &[u8], x: f32) -> f32 {
    let column = (SIDE as f32 / 2.0 + x / 500.0 * SIDE as f32 / 2.0).round() as u32;
    f32::from(pixel(image, column, SIDE / 2)[0]) / 255.0
}

fn with_shadows(preset: Preset, count: u8) -> Features {
    Features { point_shadows: count, ..preset.features() }
}

const LEFT: [f32; 3] = [-100.0, 0.0, 300.0];
const RIGHT: [f32; 3] = [100.0, 0.0, 300.0];

fn floor_lit_by(count: u8, lamps: &[(&str, u32, [f32; 3])]) -> Option<(f32, f32)> {
    let (mut renderer, device, queue) = stage(with_shadows(Preset::High, count))?;
    let image = render(&mut renderer, &device, &queue, &scene_of(lamps, 0.0));
    Some((floor_at(&image, 100.0), floor_at(&image, -100.0)))
}

#[test]
fn a_point_light_casts_the_shadow_of_a_caster_away_from_itself() {
    let Some((shadowed, near_side)) = floor_lit_by(2, &[("lamp-strong", 1, LEFT)]) else { return };
    let (lit, near_side_lit) = floor_lit_by(0, &[("lamp-strong", 1, LEFT)]).expect("same device");
    assert!(lit > shadowed + 0.05, "the floor beyond the caster, away from the light, is darker with shadows: {shadowed} against {lit}");
    assert!((near_side - near_side_lit).abs() < 0.02, "the floor under the light is lit alike: {near_side} against {near_side_lit}");
}

#[test]
fn lights_beyond_the_count_cast_no_shadow() {
    let lamps = [("lamp-strong", 1, LEFT), ("lamp-weak", 2, RIGHT)];
    let Some((none_right, none_left)) = floor_lit_by(0, &lamps) else { return };
    let (one_right, one_left) = floor_lit_by(1, &lamps).expect("same device");
    let (two_right, two_left) = floor_lit_by(2, &lamps).expect("same device");
    assert!(none_right > one_right + 0.03, "the strongest light's shadow lands on the right: {one_right} against {none_right}");
    assert!((none_left - one_left).abs() < 0.02, "the weaker light has no shadow with one map: {one_left} against {none_left}");
    assert!(none_left > two_left + 0.02, "with two maps the weaker light shadows too: {two_left} against {none_left}");
    assert!(two_right <= one_right + 0.02);
}

#[test]
fn each_preset_draws_as_many_shadowed_lights_as_it_names() {
    let lamps = [("lamp-strong", 1, LEFT), ("lamp-weak", 2, RIGHT), ("lamp-faint", 3, [0.0, 300.0, 300.0]), ("lamp-faint", 4, [0.0, -300.0, 300.0]), ("lamp-faint", 5, [0.0, 600.0, 300.0])];
    for (preset, expected) in [(Preset::Low, 0), (Preset::Medium, 0), (Preset::High, 2), (Preset::Ultra, 4)] {
        let Some((mut renderer, device, queue)) = stage(preset.features()) else { return };
        render(&mut renderer, &device, &queue, &scene_of(&lamps, 0.0));
        assert_eq!(renderer.points.shadowed().len(), expected, "{preset:?}");
        assert_eq!(renderer.points.lit, 5, "{preset:?} lights every lamp");
    }
}

#[test]
fn the_shadowed_lights_do_not_change_while_two_lights_stay_close_in_rank() {
    let lamps = [("lamp-weak", 1, [-300.0, 0.0, 300.0]), ("lamp-weak", 2, [300.0, 0.0, 300.0]), ("lamp-faint", 3, [0.0, 900.0, 300.0])];
    let Some((mut renderer, device, queue)) = stage(with_shadows(Preset::High, 1)) else { return };
    let mut held = Vec::new();
    for frame in 0..40 {
        let shift = (frame as f32 * 0.9).sin() * 40.0;
        render(&mut renderer, &device, &queue, &scene_of(&lamps, shift));
        held.push(renderer.points.shadowed().iter().map(|light| light.key).collect::<Vec<_>>());
    }
    assert!(held.windows(2).all(|pair| pair[0] == pair[1]), "the shadowed light popped between frames: {held:?}");
}

fn pillar() -> (Vec<Vertex>, Vec<u32>) {
    let (mut vertices, mut indices) = (Vec::new(), Vec::new());
    let corner = |x: f32, y: f32, z: f32| Vertex { position: [x * 34.0, y * 34.0, z * 220.0], normal: [x, y, 0.0], uv: [0.0, 0.0], bones: [0; 4], weights: [1.0, 0.0, 0.0, 0.0] };
    for (x, y, z) in (0..8).map(|bits| (if bits & 1 == 0 { -1.0 } else { 1.0 }, if bits & 2 == 0 { -1.0 } else { 1.0 }, f32::from(u8::from(bits & 4 != 0)))) {
        vertices.push(corner(x, y, z));
    }
    for quad in [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]] {
        indices.extend([quad[0], quad[1], quad[2], quad[0], quad[2], quad[3]]);
    }
    (vertices, indices)
}

/// Times a frame at the laptop panel with 60 pillars and the lamps of a stage, for `WISP_POINT_BENCH`; the difference between the rows is what the cube passes cost.
#[test]
fn frame_time_with_point_shadows_at_the_laptop_panel() {
    if std::env::var("WISP_POINT_BENCH").is_err() {
        return;
    }
    let Some((device, queue)) = device() else { return };
    let size = (2880u32, 1920u32);
    let target = device.create_texture(&wgpu::TextureDescriptor { label: Some("bench"), size: wgpu::Extent3d { width: size.0, height: size.1, depth_or_array_layers: 1 }, mip_level_count: 1, sample_count: 1, dimension: wgpu::TextureDimension::D2, format: FORMAT, usage: wgpu::TextureUsages::RENDER_ATTACHMENT, view_formats: &[] });
    let view = target.create_view(&Default::default());
    let lamps: Vec<(&str, u32, [f32; 3])> = (0..6).map(|index| ("lamp-strong", 1 + index, [-900.0 + index as f32 * 360.0, 120.0, 260.0])).collect();
    let mut rows = Vec::new();
    for count in [0u8, 2, 4] {
        let Some((mut renderer, _, _)) = stage(with_shadows(Preset::Ultra, count)) else { return };
        let (vertices, indices) = pillar();
        let part = model::Part { color_slot: 0, first_index: 0, index_count: indices.len() as u32, layers: vec![model::Layer { paint: Paint::Texture("grey".into()), filter: Filter::Opaque, color_slot: 1, unshaded: false }] };
        renderer.add_model("pillar", ModelData { vertices, indices, parts: vec![part], rig: Box::new(FlatRig::new([1.0; 4])), emitters: Vec::new() });
        let mut scene = scene_of(&lamps, 0.0);
        scene.camera.tangent = 0.5;
        scene.camera.view = translation(0.0, 0.0, -1500.0);
        scene.camera.eye = [0.0, 0.0, 1500.0];
        for index in 0..60 {
            scene.poses.push(pose("pillar", 100 + index, [-1100.0 + (index % 12) as f32 * 200.0, -500.0 + (index / 12) as f32 * 240.0, 0.0]));
        }
        let mut frame = || {
            let mut encoder = device.create_command_encoder(&Default::default());
            renderer.draw(&mut encoder, &view, size, size.0 as f32 / size.1 as f32, &scene);
            queue.submit([encoder.finish()]);
            device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
        };
        (0..20).for_each(|_| frame());
        let began = Instant::now();
        (0..200).for_each(|_| frame());
        let milliseconds = began.elapsed().as_secs_f64() * 1000.0 / 200.0;
        println!("{count} shadowed lights of {}: {milliseconds:.2} ms a frame at {}x{}", renderer.points.lit, size.0, size.1);
        rows.push(milliseconds);
    }
    println!("point shadows cost {:.2} ms at 2 lights and {:.2} ms at 4", rows[1] - rows[0], rows[2] - rows[0]);
}

fn look_at(eye: [f32; 3], target: [f32; 3]) -> Mat4 {
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

fn block(low: [f32; 3], high: [f32; 3]) -> (Vec<Vertex>, Vec<u32>) {
    let corner = |i: usize| [if i & 1 == 0 { low[0] } else { high[0] }, if i & 2 == 0 { low[1] } else { high[1] }, if i & 4 == 0 { low[2] } else { high[2] }];
    let faces: [([usize; 4], [f32; 3]); 6] = [([0, 1, 3, 2], [0.0, 0.0, -1.0]), ([4, 6, 7, 5], [0.0, 0.0, 1.0]), ([0, 4, 5, 1], [0.0, -1.0, 0.0]), ([2, 3, 7, 6], [0.0, 1.0, 0.0]), ([0, 2, 6, 4], [-1.0, 0.0, 0.0]), ([1, 5, 7, 3], [1.0, 0.0, 0.0])];
    let (mut vertices, mut indices) = (Vec::new(), Vec::new());
    for (corners, normal) in faces {
        let base = vertices.len() as u32;
        vertices.extend(corners.map(|i| Vertex { position: corner(i), normal, uv: [0.0; 2], bones: [0; 4], weights: [1.0, 0.0, 0.0, 0.0] }));
        indices.extend([0, 1, 2, 0, 2, 3].map(|i| base + i));
    }
    (vertices, indices)
}

fn solid((vertices, indices): (Vec<Vertex>, Vec<u32>)) -> ModelData {
    let part = model::Part { color_slot: 0, first_index: 0, index_count: indices.len() as u32, layers: vec![model::Layer { paint: Paint::Texture("grey".into()), filter: Filter::Opaque, color_slot: 1, unshaded: false }] };
    ModelData { vertices, indices, parts: vec![part], rig: Box::new(FlatRig::new([1.0; 4])), emitters: Vec::new() }
}

fn write_shot(features: Features, torches: &[[f32; 3]], color: [f32; 3], path: &std::path::Path) -> Option<()> {
    let (device, queue) = device()?;
    let size = (1280u32, 720u32);
    let mut renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, crate::remaster::Quality::Off, features);
    renderer.textures.insert("grey".into(), upload(&device, &queue, &crate::texture::Image { width: 1, height: 1, rgba: vec![150, 140, 130, 255] }));
    renderer.add_model("floor", solid(block([-3000.0, -1500.0, -40.0], [3000.0, 600.0, 0.0])));
    renderer.add_model("wall", solid(block([-3000.0, 560.0, 0.0], [3000.0, 600.0, 700.0])));
    renderer.add_model("fighter", solid(block([-40.0, -30.0, 0.0], [40.0, 30.0, 220.0])));
    renderer.add_model("torch", lamp(vec![model::ModelLight { node: 0, pivot: [0.0; 3], start: 80.0, end: 1100.0, color }]));
    let mut scene = Scene { frame: 0, clear: [0.04, 0.05, 0.08], ..Scene::default() };
    let eye = [0.0, -1500.0, 330.0];
    scene.camera = scene::Camera { view: look_at(eye, [0.0, 0.0, 120.0]), eye, tangent: 0.5, near: 20.0, far: 12000.0, sky_far: 12000.0, rise: 0.0, reach: 3500.0 };
    scene.light = Some(scene::Light { toward: [0.3, -0.5, 0.8], key: [0.2, 0.22, 0.3], ambient: [0.16, 0.18, 0.26] });
    scene.poses = vec![pose("floor", 0, [0.0; 3]), pose("wall", 0, [0.0; 3]), pose("fighter", 1, [-80.0, 0.0, 0.0]), pose("fighter", 2, [260.0, 20.0, 0.0])];
    scene.poses.extend(torches.iter().enumerate().map(|(index, &at)| pose("torch", 10 + index as u32, at)));
    let target = device.create_texture(&wgpu::TextureDescriptor { label: Some("shot"), size: wgpu::Extent3d { width: size.0, height: size.1, depth_or_array_layers: 1 }, mip_level_count: 1, sample_count: 1, dimension: wgpu::TextureDimension::D2, format: FORMAT, usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC, view_formats: &[] });
    let mut encoder = device.create_command_encoder(&Default::default());
    renderer.draw(&mut encoder, &target.create_view(&Default::default()), size, size.0 as f32 / size.1 as f32, &scene);
    let buffer = device.create_buffer(&wgpu::BufferDescriptor { label: Some("read"), size: u64::from(size.0 * size.1 * 4), usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false });
    encoder.copy_texture_to_buffer(target.as_image_copy(), wgpu::TexelCopyBufferInfo { buffer: &buffer, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(size.0 * 4), rows_per_image: Some(size.1) } }, wgpu::Extent3d { width: size.0, height: size.1, depth_or_array_layers: 1 });
    queue.submit([encoder.finish()]);
    buffer.slice(..).map_async(wgpu::MapMode::Read, |_| ());
    let _ = device.poll(wgpu::PollType::wait_indefinitely());
    let rgba = buffer.slice(..).get_mapped_range().expect("mapped").to_vec();
    crate::capture::write(path, size.0, size.1, &rgba).expect("the shot is written");
    Some(())
}

/// Writes a before and an after of two stand-in stages, a cold street with torches and a lava hall with fire pillars, with fighters at match zoom, into `WISP_POINT_CAPTURE_DIR`.
#[test]
fn point_shadow_captures_of_stand_in_stages() {
    let Ok(dir) = std::env::var("WISP_POINT_CAPTURE_DIR") else { return };
    let dir = std::path::PathBuf::from(dir);
    std::fs::create_dir_all(&dir).unwrap();
    for (name, torches, color) in [("torches", vec![[-330.0, -120.0, 190.0], [700.0, -100.0, 190.0]], [1.8, 1.0, 0.45]), ("fire-pillars", vec![[-420.0, 40.0, 250.0], [520.0, 60.0, 250.0]], [2.2, 0.8, 0.25])] {
        for (when, count) in [("before", 0), ("after", 2)] {
            if write_shot(with_shadows(Preset::High, count), &torches, color, &dir.join(format!("{name}-{when}.png"))).is_none() {
                return;
            }
        }
    }
}
