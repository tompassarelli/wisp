use super::*;
use crate::model::Emitter2;
use model::EmitterSample;
use scene::Bolt;
use image::ImageEncoder;

const SIDE: u32 = 128;
const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

pub(super) fn device() -> Option<(wgpu::Device, wgpu::Queue)> {
    static SHARED: std::sync::OnceLock<Option<(wgpu::Device, wgpu::Queue)>> = std::sync::OnceLock::new();
    SHARED
        .get_or_init(|| {
            let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
            let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions { power_preference: wgpu::PowerPreference::HighPerformance, force_fallback_adapter: false, ..Default::default() })).ok()?;
            pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default())).ok()
        })
        .clone()
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

fn half_to_f32(bits: u16) -> f32 {
    let (sign, exponent, fraction) = ((bits >> 15) & 1, i32::from((bits >> 10) & 0x1f), f32::from(bits & 0x3ff));
    let magnitude = match exponent {
        0 => fraction * 2f32.powi(-24),
        31 => f32::INFINITY,
        _ => (1.0 + fraction / 1024.0) * 2f32.powi(exponent - 15),
    };
    if sign == 1 { -magnitude } else { magnitude }
}

/// Draws `scene` and reads the middle pixel of the linear light the scene pass resolved, before the final-image pass tone maps it.
fn light_at_centre(renderer: &mut Renderer, device: &wgpu::Device, queue: &wgpu::Queue, scene: &Scene) -> [f32; 3] {
    let target = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("target"),
        size: wgpu::Extent3d { width: SIDE, height: SIDE, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    });
    let mut encoder = device.create_command_encoder(&Default::default());
    renderer.draw(&mut encoder, &target.create_view(&Default::default()), (SIDE, SIDE), 1.0, scene);
    let buffer = device.create_buffer(&wgpu::BufferDescriptor { label: Some("light"), size: u64::from(SIDE * SIDE * 8), usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false });
    let resolved = &renderer.targets.as_ref().expect("a drawn frame has targets").resolved_texture;
    encoder.copy_texture_to_buffer(
        resolved.as_image_copy(),
        wgpu::TexelCopyBufferInfo { buffer: &buffer, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(SIDE * 8), rows_per_image: Some(SIDE) } },
        wgpu::Extent3d { width: SIDE, height: SIDE, depth_or_array_layers: 1 },
    );
    queue.submit([encoder.finish()]);
    buffer.slice(..).map_async(wgpu::MapMode::Read, |_| ());
    let _ = device.poll(wgpu::PollType::wait_indefinitely());
    let bytes = buffer.slice(..).get_mapped_range().expect("mapped").to_vec();
    let at = ((SIDE / 2 * SIDE + SIDE / 2) * 8) as usize;
    [0, 1, 2].map(|channel| half_to_f32(u16::from_le_bytes([bytes[at + channel * 2], bytes[at + channel * 2 + 1]])))
}

fn pixel(image: &[u8], x: u32, y: u32) -> [u8; 3] {
    let at = ((y * SIDE + x) * 4) as usize;
    [image[at], image[at + 1], image[at + 2]]
}

#[test]
fn a_particle_and_a_bolt_reach_the_screen() {
    let Some((device, queue)) = device() else { return };
    let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
    let mut renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, crate::remaster::Quality::Off, crate::settings::Preset::High.features());
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

#[test]
fn each_preset_draws_the_scene_with_its_post_effects_on_or_off() {
    use crate::settings::PRESETS;
    let Some((device, queue)) = device() else { return };
    let mut scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
    let mut renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, crate::remaster::Quality::Off, PRESETS[2].features());
    let spec = Emitter2 { rows: 1, columns: 1, head: true, life_span: 5.0, time: 0.5, scaling: [20.0; 3], alphas: [1.0; 3], colors: [[1.0; 3]; 3], ..Emitter2::default() };
    let emitter = ModelEmitter { spec, paint: Paint::None };
    let slot = renderer.particles.register(&device, &queue, &emitter, ("", &renderer.white), &renderer.sampler).expect("room for an emitter");
    let mut scene = Scene { frame: 0, ..Scene::default() };
    scene.camera = scene::Camera { view: IDENTITY, eye: [0.0; 3], tangent: 1.0, near: 1.0, far: 10_000.0, sky_far: 10_000.0, rise: 0.0 };
    for (round, preset) in [PRESETS[0], PRESETS[1], PRESETS[2], PRESETS[0]].into_iter().enumerate() {
        renderer.set_features(preset.features());
        scene.frame = round as u32 * 2;
        let _ = render(&mut renderer, &device, &queue, &scene);
        scene.frame += 1;
        renderer.particles.begin(scene.frame);
        let sample = EmitterSample { visible: true, rate: 120.0, ..EmitterSample::default() };
        renderer.particles.emit(1, 0, slot, &emitter, &sample, &translation(0.0, 0.0, -100.0), 1.0);
        let image = render(&mut renderer, &device, &queue, &scene);
        let round_error = pollster::block_on(scope.pop());
        assert!(round_error.is_none(), "{preset:?}: wgpu validation: {round_error:?}");
        scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
        let centre = pixel(&image, SIDE / 2, SIDE / 2);
        let corner = pixel(&image, 2, SIDE - 3);
        assert!(centre[0] > 200 && centre[1] > 200, "{preset:?}: the particle covers the middle: {centre:?}");
        assert!(corner[0] < 40, "{preset:?}: the corner is clear: {corner:?}");
    }
    let error = pollster::block_on(scope.pop());
    assert!(error.is_none(), "wgpu validation: {error:?}");
}

const BACKGROUND: [f32; 3] = [0.5, 0.25, 0.75];
const TEAM: [f32; 3] = [0.9, 0.1, 0.3];

/// A still rig whose geoset slot 0 has `geoset` as its colour and opacity, and every other slot white.
struct FlatRig {
    colors: [[f32; 4]; 8],
}

impl FlatRig {
    fn new(geoset: [f32; 4]) -> Self {
        let mut colors = [[1.0; 4]; 8];
        colors[0] = geoset;
        Self { colors }
    }
}

impl model::Rig for FlatRig {
    fn bone_count(&self) -> usize {
        1
    }

    fn pose(&mut self, _sequence: i32, _frame: f32, _clock_ms: f32, out: &mut [Mat4]) {
        out[0] = IDENTITY;
    }

    fn colors(&self) -> &[[f32; 4]] {
        &self.colors
    }

    fn uv_rows(&self) -> &[[f32; 4]] {
        const ROWS: [[f32; 4]; 16] = {
            let mut rows = [[0.0; 4]; 16];
            let mut slot = 0;
            while slot < 8 {
                rows[slot * 2] = [1.0, 0.0, 0.0, 0.0];
                rows[slot * 2 + 1] = [0.0, 1.0, 0.0, 0.0];
                slot += 1;
            }
            rows
        };
        &ROWS
    }

    fn emitters(&self) -> &[EmitterSample] {
        &[]
    }
}

struct Sheet {
    filter: Filter,
    depth: f32,
    paint: Paint,
    texel: [u8; 4],
}

fn sheet(filter: Filter, depth: f32, texel: [u8; 4]) -> Sheet {
    Sheet { filter, depth, paint: Paint::Texture(String::new()), texel }
}

fn centre_of(sheets: &[Sheet]) -> [f32; 3] {
    centre_of_geoset(sheets, [1.0; 4])
}

/// Draws `sheets` as the layers of one geoset whose animated colour and opacity are `geoset`.
fn centre_of_geoset(sheets: &[Sheet], geoset: [f32; 4]) -> [f32; 3] {
    let Some((device, queue)) = device() else { return [f32::NAN; 3] };
    let mut renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, crate::remaster::Quality::Off, crate::settings::Preset::High.features());
    let mut vertices = Vec::new();
    let mut indices = Vec::new();
    let mut parts = Vec::new();
    for (index, sheet) in sheets.iter().enumerate() {
        let name = format!("sheet{index}");
        renderer.textures.insert(name.clone(), upload(&device, &queue, &crate::texture::Image { width: 1, height: 1, rgba: sheet.texel.to_vec() }));
        let reach = sheet.depth * 4.0;
        let base = vertices.len() as u32;
        for (x, y, u, v) in [(-reach, -reach, 0.0, 1.0), (reach, -reach, 1.0, 1.0), (reach, reach, 1.0, 0.0), (-reach, reach, 0.0, 0.0)] {
            vertices.push(Vertex { position: [x, y, -sheet.depth], normal: [0.0, 0.0, 1.0], uv: [u, v], bones: [0; 4], weights: [1.0, 0.0, 0.0, 0.0] });
        }
        let first_index = indices.len() as u32;
        indices.extend([0, 1, 2, 0, 2, 3].map(|corner| base + corner));
        let paint = match &sheet.paint {
            Paint::Texture(_) => Paint::Texture(name),
            other => other.clone(),
        };
        parts.push(model::Part { color_slot: 0, first_index, index_count: 6, layers: vec![model::Layer { paint, filter: sheet.filter, color_slot: 1, unshaded: false }] });
    }
    renderer.add_model("sheets", ModelData { vertices, indices, parts, rig: Box::new(FlatRig::new(geoset)), emitters: Vec::new() });
    let mut scene = Scene { frame: 0, clear: BACKGROUND, ..Scene::default() };
    scene.camera = scene::Camera { view: IDENTITY, eye: [0.0; 3], tangent: 1.0, near: 1.0, far: 10_000.0, sky_far: 10_000.0, rise: 0.0 };
    scene.poses = vec![scene::Pose { id: 0, model: "sheets".into(), matrix: IDENTITY, sequence: 0, frame: 0.0, clock: 0.0, alpha: 1.0, color: [1.0; 3], team: TEAM }];
    let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
    let light = light_at_centre(&mut renderer, &device, &queue, &scene);
    let error = pollster::block_on(scope.pop());
    assert!(error.is_none(), "wgpu validation: {error:?}");
    light
}

fn linear(display: [f32; 3]) -> [f32; 3] {
    display.map(|channel| linear_of(f64::from(channel)) as f32)
}

fn background() -> [f32; 3] {
    linear(BACKGROUND)
}

fn source() -> [f32; 3] {
    linear(SOURCE)
}

fn far() -> [f32; 3] {
    linear(FAR)
}

fn team_light() -> [f32; 3] {
    linear(TEAM)
}

fn assert_pixel(actual: [f32; 3], expected: [f32; 3], rule: &str) {
    if actual[0].is_nan() {
        return;
    }
    assert!((0..3).all(|channel| (actual[channel] - expected[channel]).abs() < 0.015), "{rule}: drew {actual:?}, expected {expected:?}");
}

fn over(source: [f32; 3], alpha: f32, destination: [f32; 3]) -> [f32; 3] {
    [0, 1, 2].map(|channel| source[channel] * alpha + destination[channel] * (1.0 - alpha))
}

const SOURCE: [f32; 3] = [0.8, 0.4, 0.2];
const FAR: [f32; 3] = [0.2, 0.6, 0.4];

fn texel(color: [f32; 3], alpha: f32) -> [u8; 4] {
    [color[0], color[1], color[2], alpha].map(|channel| (channel * 255.0).round() as u8)
}

#[test]
fn transparent_tests_alpha_at_three_quarters_and_writes_depth() {
    assert_pixel(centre_of(&[sheet(Filter::Cutout, 100.0, texel(SOURCE, 0.7))]), background(), "alpha 0.7 is cut out");
    assert_pixel(centre_of(&[sheet(Filter::Cutout, 100.0, texel(SOURCE, 0.8))]), source(), "alpha 0.8 is drawn whole, not blended");
    let behind = sheet(Filter::Opaque, 200.0, texel(FAR, 1.0));
    assert_pixel(centre_of(&[sheet(Filter::Cutout, 100.0, texel(SOURCE, 0.8)), behind]), source(), "a cut-out hides what is drawn behind it afterwards");
}

#[test]
fn blend_is_source_alpha_over_with_no_depth_write() {
    let near = over(source(), 0.5, background());
    assert_pixel(centre_of(&[sheet(Filter::Blend, 100.0, texel(SOURCE, 0.5))]), near, "source alpha over the background");
    assert_pixel(centre_of(&[sheet(Filter::Blend, 100.0, texel(SOURCE, 0.5)), sheet(Filter::Blend, 200.0, texel(FAR, 0.5))]), over(far(), 0.5, near), "a blended sheet leaves what is behind it drawable");
}

#[test]
fn additive_adds_the_colour_and_ignores_the_texture_alpha() {
    let expected = [0, 1, 2].map(|channel| (source()[channel] + background()[channel]));
    assert_pixel(centre_of(&[sheet(Filter::Additive, 100.0, texel(SOURCE, 0.25))]), expected, "one plus one");
}

#[test]
fn add_alpha_adds_the_colour_scaled_by_the_texture_alpha() {
    let expected = [0, 1, 2].map(|channel| (source()[channel] * 0.5 + background()[channel]));
    assert_pixel(centre_of(&[sheet(Filter::AddAlpha, 100.0, texel(SOURCE, 0.5))]), expected, "source alpha plus one");
}

#[test]
fn modulate_multiplies_the_background_by_the_colour() {
    let expected = [0, 1, 2].map(|channel| source()[channel] * background()[channel]);
    assert_pixel(centre_of(&[sheet(Filter::Modulate, 100.0, texel(SOURCE, 1.0))]), expected, "destination colour times source colour");
}

#[test]
fn modulate_twice_doubles_the_product() {
    let expected = [0, 1, 2].map(|channel| (source()[channel] * background()[channel] * 2.0));
    assert_pixel(centre_of(&[sheet(Filter::Modulate2x, 100.0, texel(SOURCE, 1.0))]), expected, "twice destination times source");
}

#[test]
fn a_window_that_starts_on_original_art_swaps_the_remaster_in_when_it_is_built() {
    let Some((device, queue)) = device() else { return };
    let mut renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, crate::remaster::Quality::Off, crate::settings::Preset::High.features());
    renderer.set_quality(crate::remaster::Quality::Standard);
    let mut png = Vec::new();
    let pixels: Vec<u8> = (0..8 * 8).flat_map(|index| [index as u8 * 3, 40, 200, 255]).collect();
    image::codecs::png::PngEncoder::new(&mut png).write_image(&pixels, 8, 8, image::ExtendedColorType::Rgba8).unwrap();
    renderer.ingest("art.png", png);
    for _ in 0..4000 {
        renderer.pump();
        if renderer.incoming.is_none() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
    assert!(renderer.incoming.is_none(), "the remastered set never replaced the Original one");
    assert_eq!(renderer.quality(), crate::remaster::Quality::Standard);
    assert!(renderer.textures.contains_key("art.png") && renderer.reliefs.contains_key("art.png"), "the swapped-in set carries the remastered texture and its relief");
}

#[test]
fn replaceable_one_and_two_draw_the_players_team_colour_and_glow() {
    let team = Sheet { filter: Filter::Opaque, depth: 100.0, paint: Paint::TeamColor, texel: [0; 4] };
    assert_pixel(centre_of(&[team]), team_light(), "replaceable 1 is the team colour");
    let glow = Sheet { filter: Filter::Blend, depth: 100.0, paint: Paint::TeamGlow, texel: [0; 4] };
    let expected = over(team_light(), 1.0f32.sin(), background());
    assert_pixel(centre_of(&[glow]), expected, "replaceable 2 is the team glow at its centre");
}

#[test]
fn a_geoset_colour_multiplies_every_layer_of_its_geoset() {
    let teal = [0.0, 0.4, 0.4];
    let tinted = [0, 1, 2].map(|channel| SOURCE[channel] * teal[channel]);
    assert_pixel(centre_of_geoset(&[sheet(Filter::Opaque, 100.0, texel(SOURCE, 1.0))], [teal[0], teal[1], teal[2], 1.0]), linear(tinted), "a texture layer is multiplied by the geoset colour");
    let team = Sheet { filter: Filter::Opaque, depth: 100.0, paint: Paint::TeamColor, texel: [0; 4] };
    assert_pixel(centre_of_geoset(&[team], [teal[0], teal[1], teal[2], 1.0]), linear([0, 1, 2].map(|channel| TEAM[channel] * teal[channel])), "a team colour layer is multiplied by the geoset colour");
    assert_pixel(centre_of_geoset(&[sheet(Filter::Blend, 100.0, texel(SOURCE, 1.0))], [1.0, 1.0, 1.0, 0.5]), over(source(), 0.5, background()), "the geoset alpha still fades its layers");
}

struct ClockRig(std::sync::Arc<std::sync::Mutex<f32>>);

impl model::Rig for ClockRig {
    fn bone_count(&self) -> usize {
        1
    }

    fn pose(&mut self, _sequence: i32, _frame: f32, clock_seconds: f32, out: &mut [Mat4]) {
        *self.0.lock().unwrap() = clock_seconds;
        out[0] = IDENTITY;
    }

    fn colors(&self) -> &[[f32; 4]] {
        &[[1.0; 4]; 8]
    }

    fn uv_rows(&self) -> &[[f32; 4]] {
        &[[0.0; 4]; 16]
    }

    fn emitters(&self) -> &[EmitterSample] {
        &[]
    }
}

#[test]
fn a_rig_is_posed_with_the_scene_clock_in_seconds() {
    let Some((device, queue)) = device() else { return };
    let mut renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, crate::remaster::Quality::Off, crate::settings::Preset::High.features());
    let seen = std::sync::Arc::new(std::sync::Mutex::new(-1.0));
    let draw = model::Part { color_slot: 0, first_index: 0, index_count: 3, layers: vec![model::Layer { paint: Paint::None, filter: Filter::Opaque, color_slot: 1, unshaded: false }] };
    let vertices = vec![Vertex { position: [0.0; 3], normal: [0.0, 0.0, 1.0], uv: [0.0; 2], bones: [0; 4], weights: [1.0, 0.0, 0.0, 0.0] }; 3];
    renderer.add_model("clock", ModelData { vertices, indices: vec![0, 1, 2], parts: vec![draw], rig: Box::new(ClockRig(seen.clone())), emitters: Vec::new() });
    let mut scene = Scene::default();
    scene.camera = scene::Camera { view: IDENTITY, eye: [0.0; 3], tangent: 1.0, near: 1.0, far: 10_000.0, sky_far: 10_000.0, rise: 0.0 };
    scene.poses = vec![scene::Pose { id: 0, model: "clock".into(), matrix: IDENTITY, sequence: 0, frame: 0.0, clock: 2.5, alpha: 1.0, color: [1.0; 3], team: TEAM }];
    let _ = render(&mut renderer, &device, &queue, &scene);
    assert_eq!(*seen.lock().unwrap(), 2.5, "the pose clock reaches the rig as seconds, which the rig turns into global sequence milliseconds");
}

fn particle_light(filter_mode: u32, texel: [u8; 4]) -> [f32; 3] {
    let Some((device, queue)) = device() else { return [f32::NAN; 3] };
    let mut renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, crate::remaster::Quality::Off, crate::settings::Preset::High.features());
    let view = upload(&device, &queue, &crate::texture::Image { width: 1, height: 1, rgba: texel.to_vec() });
    let spec = Emitter2 { rows: 1, columns: 1, head: true, life_span: 5.0, time: 0.5, scaling: [20.0; 3], alphas: [1.0; 3], colors: [[1.0; 3]; 3], filter_mode, ..Emitter2::default() };
    let emitter = ModelEmitter { spec, paint: Paint::None };
    let slot = renderer.particles.register(&device, &queue, &emitter, ("shine", &view), &renderer.sampler).expect("room for an emitter");
    let mut scene = Scene { frame: 0, clear: BACKGROUND, ..Scene::default() };
    scene.camera = scene::Camera { view: IDENTITY, eye: [0.0; 3], tangent: 1.0, near: 1.0, far: 10_000.0, sky_far: 10_000.0, rise: 0.0 };
    let _ = render(&mut renderer, &device, &queue, &scene);
    renderer.particles.begin(1);
    let sample = EmitterSample { visible: true, rate: 60.0, ..EmitterSample::default() };
    renderer.particles.emit(1, 0, slot, &emitter, &sample, &translation(0.0, 0.0, -100.0), 1.0);
    scene.frame = 1;
    light_at_centre(&mut renderer, &device, &queue, &scene)
}

#[test]
fn an_additive_particle_adds_its_colour_in_linear_light_scaled_by_its_texture_alpha() {
    let (source, background) = (source(), background());
    assert_pixel(particle_light(1, texel(SOURCE, 0.5)), [0, 1, 2].map(|channel| source[channel] * 0.5 + background[channel]), "source alpha plus one, so a soft edge stays soft and a colour is not brighter than its texture");
}

#[test]
fn an_alpha_keyed_particle_cuts_at_three_quarters_and_adds_the_rest() {
    let (source, background) = (source(), background());
    assert_pixel(particle_light(4, texel(SOURCE, 0.5)), background, "alpha 0.5 is cut out");
    assert_pixel(particle_light(4, texel(SOURCE, 0.8)), [0, 1, 2].map(|channel| source[channel] * 0.8 + background[channel]), "alpha 0.8 adds by its alpha");
}
