//! Draws a stand-in water stage offscreen: water over a sea floor, a deck and fighter-sized pillars in front of it, seen from the side at match zoom.
//! Without a GPU adapter the tests pass without drawing; `WISP_WATER_CAPTURE_DIR` makes the first write both facings as PNGs and `WISP_WATER_BENCH` makes the second time frames.

use std::path::PathBuf;
use std::time::Instant;

use super::math::{Mat4, IDENTITY};
use super::model::{EmitterSample, Filter, Layer, ModelData, Paint, Part, Rig, Vertex};
use super::scene::{Camera, Fog, Light, Pose, Scene};
use super::water::{Preset, WaterSettings};
use super::Renderer;
use crate::capture;
use crate::remaster::Quality;
use crate::texture::Image;

struct Clocked(std::sync::Arc<std::sync::atomic::AtomicU32>);

impl Rig for Clocked {
    fn bone_count(&self) -> usize {
        1
    }
    fn pose(&mut self, _: i32, _: f32, clock_seconds: f32, out: &mut [Mat4]) {
        self.0.store(clock_seconds.to_bits(), std::sync::atomic::Ordering::Relaxed);
        out[0] = IDENTITY;
    }
    fn colors(&self) -> &[[f32; 4]] {
        &[[1.0; 4]; 2]
    }
    fn uv_rows(&self) -> &[[f32; 4]] {
        &[]
    }
    fn emitters(&self) -> &[EmitterSample] {
        &[]
    }
}

struct Still;

impl Rig for Still {
    fn bone_count(&self) -> usize {
        1
    }
    fn pose(&mut self, _: i32, _: f32, _: f32, out: &mut [Mat4]) {
        out[0] = IDENTITY;
    }
    fn colors(&self) -> &[[f32; 4]] {
        &[[1.0; 4]; 2]
    }
    fn uv_rows(&self) -> &[[f32; 4]] {
        &[[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0]]
    }
    fn emitters(&self) -> &[EmitterSample] {
        &[]
    }
}

fn vertex(position: [f32; 3], normal: [f32; 3]) -> Vertex {
    Vertex { position, normal, uv: [0.0; 2], bones: [0; 4], weights: [1.0, 0.0, 0.0, 0.0] }
}

fn block(low: [f32; 3], high: [f32; 3]) -> (Vec<Vertex>, Vec<u32>) {
    let corner = |i: usize| [if i & 1 == 0 { low[0] } else { high[0] }, if i & 2 == 0 { low[1] } else { high[1] }, if i & 4 == 0 { low[2] } else { high[2] }];
    let faces: [([usize; 4], [f32; 3]); 6] = [([0, 1, 3, 2], [0.0, 0.0, -1.0]), ([4, 6, 7, 5], [0.0, 0.0, 1.0]), ([0, 4, 5, 1], [0.0, -1.0, 0.0]), ([2, 3, 7, 6], [0.0, 1.0, 0.0]), ([0, 2, 6, 4], [-1.0, 0.0, 0.0]), ([1, 5, 7, 3], [1.0, 0.0, 0.0])];
    let mut vertices = Vec::new();
    let mut indices = Vec::new();
    for (corners, normal) in faces {
        let base = vertices.len() as u32;
        vertices.extend(corners.map(|i| vertex(corner(i), normal)));
        indices.extend([0, 1, 2, 0, 2, 3].map(|i| base + i));
    }
    (vertices, indices)
}

fn model((vertices, indices): (Vec<Vertex>, Vec<u32>), paint: Paint, filter: Filter) -> ModelData {
    let count = indices.len() as u32;
    ModelData { vertices, indices, parts: vec![Part { color_slot: 0, first_index: 0, index_count: count, layers: vec![Layer { paint, filter, color_slot: 1, unshaded: false }] }], emitters: Vec::new(), rig: Box::new(Still) }
}

/// A bed that rises from deep water in front to the shore at the back, so the water has a shallow end to read against.
fn shore() -> (Vec<Vertex>, Vec<u32>) {
    let up = [0.0, -0.3, 1.0];
    let corner = |x: f32, y: f32, z: f32| vertex([x, y, z], up);
    let vertices = vec![corner(-6000.0, 300.0, -520.0), corner(6000.0, 300.0, -520.0), corner(6000.0, 1500.0, 12.0), corner(-6000.0, 1500.0, 12.0)];
    (vertices, vec![0, 1, 2, 0, 2, 3])
}

fn water_frame(seed: u32) -> Image {
    let size = 128u32;
    let mut rgba = Vec::new();
    for y in 0..size {
        for x in 0..size {
            let (fx, fy) = (x as f32 / size as f32 * std::f32::consts::TAU, y as f32 / size as f32 * std::f32::consts::TAU);
            let phase = seed as f32 * 0.4;
            let ripple = ((fx * 3.0 + phase).sin() * (fy * 2.0 - phase).cos() + (fx * 5.0 - fy * 4.0 + phase).sin() * 0.6 + (fy * 7.0 + fx * 2.0 + phase * 1.3).cos() * 0.4) * 0.25 + 0.5;
            let level = (ripple.clamp(0.0, 1.0) * 255.0) as u8;
            rgba.extend([level / 2 + 40, level / 2 + 90, level, 255]);
        }
    }
    Image { width: size, height: size, rgba }
}

/// The player's own frames when `WISP_WATER_FRAMES_DIR` names a folder of the install's decoded `waterNN.png`; otherwise a stand-in.
fn water_frames() -> Vec<Image> {
    let Ok(dir) = std::env::var("WISP_WATER_FRAMES_DIR") else { return (0..8).map(water_frame).collect() };
    (0..45).map_while(|index| std::fs::read(PathBuf::from(&dir).join(format!("water{index:02}.png"))).ok()).map(|bytes| crate::texture::decode(&bytes).expect("a water frame decodes")).collect()
}

fn look_at(eye: [f32; 3], target: [f32; 3]) -> Mat4 {
    let norm = |v: [f32; 3]| {
        let length = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
        [v[0] / length, v[1] / length, v[2] / length]
    };
    let cross = |a: [f32; 3], b: [f32; 3]| [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    let dot = |a: [f32; 3], b: [f32; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let back = norm([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
    let right = norm(cross([0.0, 0.0, 1.0], back));
    let up = cross(back, right);
    [right[0], up[0], back[0], 0.0, right[1], up[1], back[1], 0.0, right[2], up[2], back[2], 0.0, -dot(right, eye), -dot(up, eye), -dot(back, eye), 1.0]
}

fn placed(model: &str, x: f32, y: f32, z: f32, color: [f32; 3]) -> Pose {
    let mut matrix = IDENTITY;
    matrix[12] = x;
    matrix[13] = y;
    matrix[14] = z;
    Pose { id: 0, model: model.into(), matrix, sequence: 0, frame: 0.0, clock: 0.0, alpha: 1.0, color, team: [1.0; 3] }
}

struct Stage {
    renderer: Renderer,
    device: wgpu::Device,
    queue: wgpu::Queue,
    target: wgpu::Texture,
    size: (u32, u32),
}

impl Stage {
    fn new(size: (u32, u32)) -> Option<Self> {
        let (device, queue) = super::gpu_tests::device()?;
        let format = wgpu::TextureFormat::Rgba8Unorm;
        let mut renderer = Renderer::new(device.clone(), queue.clone(), format, Quality::Off, crate::settings::Preset::High.features());
        for (index, frame) in water_frames().into_iter().enumerate() {
            renderer.water.keep(format!("replaceabletextures\\water\\water{index:02}.blp"), frame);
        }
        assert_eq!(renderer.water.build(&device, &queue), None);
        renderer.add_model("sea", model(block([-6000.0, -1300.0, -0.01], [6000.0, 6000.0, 0.0]), Paint::Water, Filter::Blend));
        renderer.add_model("bed", model(block([-6000.0, -1300.0, -520.0], [6000.0, 300.0, -500.0]), Paint::None, Filter::Opaque));
        renderer.add_model("shore", model(shore(), Paint::None, Filter::Opaque));
        renderer.add_model("land", model(block([-6000.0, 1500.0, -520.0], [6000.0, 9000.0, 12.0]), Paint::None, Filter::Opaque));
        renderer.add_model("deck", model(block([-700.0, -250.0, -160.0], [700.0, 250.0, 30.0]), Paint::None, Filter::Opaque));
        renderer.add_model("fighter", model(block([-40.0, -30.0, 0.0], [40.0, 30.0, 220.0]), Paint::None, Filter::Opaque));
        renderer.add_model("pillar", model(block([-34.0, -34.0, -260.0], [34.0, 34.0, 70.0]), Paint::None, Filter::Opaque));
        let target = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("capture"),
            size: wgpu::Extent3d { width: size.0, height: size.1, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        Some(Self { renderer, device, queue, target, size })
    }

    fn scene(facing: f32, preset: Preset) -> Scene {
        let mut fighter = placed("fighter", -240.0, 0.0, 0.0, [0.95, 0.25, 0.2]);
        fighter.matrix[0] = facing;
        let eye = [0.0, -1500.0, 330.0];
        Scene {
            camera: Camera { view: look_at(eye, [0.0, 0.0, 120.0]), eye, tangent: 0.5, near: 20.0, far: 12000.0, sky_far: 12000.0, rise: 0.0 },
            light: Some(Light { toward: [0.3, -0.5, 0.8], key: [0.9, 0.85, 0.8], ambient: [0.45, 0.5, 0.55] }),
            fog: Some(Fog { color: [0.55, 0.7, 0.85], start: 2500.0, end: 9000.0, max: 0.75 }),
            poses: vec![placed("bed", 0.0, 0.0, 0.0, [0.55, 0.5, 0.35]), placed("shore", 0.0, 0.0, 0.0, [0.78, 0.68, 0.45]), placed("land", 0.0, 0.0, 0.0, [0.72, 0.62, 0.42]), placed("sea", 0.0, 0.0, 0.0, [1.0; 3]), placed("deck", 0.0, 0.0, 0.0, [0.45, 0.4, 0.5]), fighter, placed("fighter", 260.0, 0.0, 0.0, [0.2, 0.4, 0.95])],
            clear: [0.55, 0.7, 0.85],
            water: WaterSettings::of(preset),
            ..Scene::default()
        }
    }

    fn draw(&mut self, scene: &Scene) {
        self.renderer.pump();
        let view = self.target.create_view(&Default::default());
        let mut encoder = self.device.create_command_encoder(&Default::default());
        self.renderer.draw(&mut encoder, &view, self.size, 16.0 / 9.0, scene);
        self.queue.submit([encoder.finish()]);
    }

    fn read(&mut self) -> Vec<u8> {
        let row = (self.size.0 * 4).next_multiple_of(256);
        let buffer = self.device.create_buffer(&wgpu::BufferDescriptor { label: None, size: u64::from(row * self.size.1), usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false });
        let mut encoder = self.device.create_command_encoder(&Default::default());
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo { texture: &self.target, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            wgpu::TexelCopyBufferInfo { buffer: &buffer, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row), rows_per_image: Some(self.size.1) } },
            wgpu::Extent3d { width: self.size.0, height: self.size.1, depth_or_array_layers: 1 },
        );
        self.queue.submit([encoder.finish()]);
        buffer.slice(..).map_async(wgpu::MapMode::Read, |_| ());
        self.device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
        let mapped = buffer.slice(..).get_mapped_range().expect("a mapped range");
        mapped.chunks(row as usize).flat_map(|line| line[..(self.size.0 * 4) as usize].iter().copied()).collect()
    }
}

fn pixel(rgba: &[u8], width: u32, x: u32, y: u32) -> [u8; 3] {
    let at = ((y * width + x) * 4) as usize;
    [rgba[at], rgba[at + 1], rgba[at + 2]]
}

fn drawn(preset: Preset, label: &str) -> Option<(Vec<Vec<u8>>, (u32, u32))> {
    let size = (960, 640);
    let mut stage = Stage::new(size)?;
    let mut rendered = Vec::new();
    for (name, facing) in [("right", 1.0), ("left", -1.0)] {
        stage.draw(&Stage::scene(facing, preset));
        assert!(stage.renderer.problems.is_empty(), "{:?}", stage.renderer.problems);
        assert!(stage.renderer.water_level.is_some());
        let rgba = stage.read();
        if let Ok(dir) = std::env::var("WISP_WATER_CAPTURE_DIR") {
            std::fs::create_dir_all(&dir).unwrap();
            capture::write(&PathBuf::from(dir).join(format!("{label}-stage-{name}.png")), size.0, size.1, &rgba).unwrap();
        }
        rendered.push(rgba);
    }
    Some((rendered, size))
}

#[test]
fn water_is_drawn_behind_the_fighter_and_the_deck() {
    let Some((rendered, size)) = drawn(Preset::Water, "water") else { return };
    let rgba = &rendered[0];
    let sea = pixel(rgba, size.0, 40, 560);
    let sea_further = pixel(rgba, size.0, 400, 600);
    let sky = pixel(rgba, size.0, 480, 20);
    assert_ne!(sea, sea_further, "water should vary across the surface");
    assert_ne!(sea, sky, "water should not look like the sky");
    let fighter = pixel(rgba, size.0, 326, 300);
    assert!(fighter[0] > fighter[2], "the red fighter should stay in front of the water, got {fighter:?}");
}

fn milliseconds_a_frame(stage: &mut Stage, scene: &Scene) -> f64 {
    for _ in 0..20 {
        stage.draw(scene);
    }
    stage.device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
    let frames = 200;
    let began = Instant::now();
    for _ in 0..frames {
        stage.draw(scene);
        stage.device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
    }
    began.elapsed().as_secs_f64() * 1000.0 / f64::from(frames)
}

/// Times a frame of the stage with no body in the water and then with a fighter and seven pillars standing in it; `WISP_WATER_BUDGET_MS` sets the frame budget (8.3 by default, the 120 Hz of the laptop panel).
#[test]
fn frame_time_with_water_at_the_laptop_panel() {
    if std::env::var("WISP_WATER_BENCH").is_err() {
        return;
    }
    let Some(mut stage) = Stage::new((2880, 1920)) else { return };
    let budget: f64 = std::env::var("WISP_WATER_BUDGET_MS").ok().and_then(|value| value.parse().ok()).unwrap_or(8.3);
    let bare = milliseconds_a_frame(&mut stage, &Stage::scene(1.0, Preset::Water));
    let mut scene = reacting(-240.0, -70.0, 100);
    for index in 0..6 {
        let mut pillar = placed("pillar", -900.0 + index as f32 * 360.0, -430.0 + index as f32 * 30.0, 0.0, [0.5, 0.36, 0.2]);
        pillar.id = 10 + index;
        scene.poses.push(pillar);
    }
    let reacting = milliseconds_a_frame(&mut stage, &scene);
    println!("water frame: {bare:.2} ms with nothing in the water, {reacting:.2} ms with eight bodies in it");
    assert!(reacting - bare < 1.5, "eight bodies in the water cost {:.2} ms a frame", reacting - bare);
    assert!(reacting < budget, "water at 2880x1920 took {reacting:.2} ms a frame, over the {budget} ms budget");
}

fn mean(rgba: &[u8], width: u32, x: std::ops::Range<u32>, y: std::ops::Range<u32>) -> [f32; 3] {
    let (mut sum, mut count) = ([0.0f32; 3], 0.0);
    for row in y {
        for column in x.clone() {
            let at = pixel(rgba, width, column, row);
            for channel in 0..3 {
                sum[channel] += f32::from(at[channel]);
            }
            count += 1.0;
        }
    }
    sum.map(|total| total / count)
}

#[test]
fn poison_is_green_and_lava_is_bright_and_warm_with_fighters_in_front() {
    for (preset, label) in [(Preset::Poison, "poison"), (Preset::Lava, "lava")] {
        let Some((rendered, size)) = drawn(preset, label) else { return };
        let rgba = &rendered[0];
        let liquid = mean(rgba, size.0, 40..200, 520..620);
        match preset {
            Preset::Poison => assert!(liquid[1] > liquid[0] && liquid[1] > liquid[2], "poison reads green, got {liquid:?}"),
            _ => assert!(liquid[0] > liquid[2] * 1.5 && liquid[0] > 60.0, "lava reads warm and lit, got {liquid:?}"),
        }
        let fighter = pixel(rgba, size.0, 326, 300);
        assert!(fighter[0] > fighter[2], "the red fighter stays in front of the {label}, got {fighter:?}");
        let left = &rendered[1];
        assert_ne!(rgba, left, "both facings should draw");
    }
}

#[test]
fn a_pose_hands_the_rig_its_clock_in_seconds_so_global_sequences_run_at_game_speed() {
    let Some((device, queue)) = super::gpu_tests::device() else { return };
    let seen = std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0));
    let mut renderer = Renderer::new(device, queue, wgpu::TextureFormat::Rgba8Unorm, Quality::Off, crate::settings::Preset::High.features());
    let mut data = model(block([0.0; 3], [1.0; 3]), Paint::None, Filter::Opaque);
    data.rig = Box::new(Clocked(seen.clone()));
    renderer.add_model("clocked", data);
    let mut pose = placed("clocked", 0.0, 0.0, 0.0, [1.0; 3]);
    pose.clock = 2.5;
    renderer.layout(&[pose]);
    assert_eq!(f32::from_bits(seen.load(std::sync::atomic::Ordering::Relaxed)), 2.5);
}

/// A fighter at `x` and height `z` over a stage with two pillars standing in the sea, as game frame `frame`.
fn reacting(x: f32, z: f32, frame: u32) -> Scene {
    let mut scene = Stage::scene(1.0, Preset::Water);
    scene.poses.truncate(5);
    let mut fighter = placed("fighter", x, -450.0, z, [0.95, 0.25, 0.2]);
    fighter.id = 1;
    let mut left = placed("pillar", -560.0, -420.0, 0.0, [0.5, 0.36, 0.2]);
    left.id = 2;
    let mut right = placed("pillar", 470.0, -420.0, 0.0, [0.5, 0.36, 0.2]);
    right.id = 3;
    scene.poses.extend([left, right, fighter]);
    scene.frame = frame;
    scene
}

fn panel(stage: &mut Stage, scene: &Scene, wait: f32) -> Vec<u8> {
    std::thread::sleep(std::time::Duration::from_secs_f32(wait));
    stage.draw(scene);
    stage.read()
}

/// A fighter falls into the sea, wades and is launched out while two pillars stand in it; `WISP_WATER_CAPTURE_DIR` gets the six moments as one strip.
#[test]
fn bodies_in_the_water_send_rings_a_splash_and_a_wake() {
    let Some(mut stage) = Stage::new((960, 640)) else { return };
    let mut panels = Vec::new();
    panels.push(panel(&mut stage, &reacting(-240.0, 300.0, 100), 0.0));
    let kinds = |stage: &Stage| stage.renderer.ripples.sources().iter().map(|source| source.motion[3] as u32).collect::<Vec<_>>();
    panels.push({
        stage.draw(&reacting(-240.0, 60.0, 101));
        panel(&mut stage, &reacting(-240.0, -70.0, 108), 0.0)
    });
    assert_eq!(kinds(&stage), vec![1, 0, 0, 0], "falling in sends one entry burst, then the fighter and two pillars keep rings");
    panels.push(panel(&mut stage, &reacting(-240.0, -70.0, 109), 0.45));
    let mut x = -240.0;
    for frame in 110..156 {
        x += 5.0;
        stage.draw(&reacting(x, -70.0, frame));
    }
    panels.push(panel(&mut stage, &reacting(x + 5.0, -70.0, 156), 0.0));
    stage.draw(&reacting(x + 10.0, 200.0, 165));
    panels.push(panel(&mut stage, &reacting(x + 12.0, 330.0, 166), 0.12));
    let after = kinds(&stage);
    assert_eq!(after.iter().filter(|kind| **kind == 2).count(), 1, "leaving sends one exit burst: {after:?}");
    assert_eq!(after.iter().filter(|kind| **kind == 0).count(), 2, "the pillars keep their rings and the fighter above the water has none: {after:?}");
    panels.push(panel(&mut stage, &reacting(x + 12.0, 330.0, 167), 0.5));
    assert!(stage.renderer.problems.is_empty(), "{:?}", stage.renderer.problems);
    if let Ok(dir) = std::env::var("WISP_WATER_CAPTURE_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        let (width, height) = (stage.size.0 as usize, stage.size.1 as usize);
        let mut strip = vec![0u8; width * 3 * height * 2 * 4];
        for (index, rgba) in panels.iter().enumerate() {
            let (column, row) = (index % 3, index / 3);
            for line in 0..height {
                let to = ((row * height + line) * width * 3 + column * width) * 4;
                strip[to..to + width * 4].copy_from_slice(&rgba[line * width * 4..(line + 1) * width * 4]);
            }
        }
        capture::write(&PathBuf::from(dir).join("splash-strip.png"), (width * 3) as u32, (height * 2) as u32, &strip).unwrap();
    }
}
