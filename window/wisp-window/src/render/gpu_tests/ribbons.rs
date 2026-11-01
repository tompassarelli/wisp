use super::*;
use crate::model::{Color, Emitter1, Key, LineType, Material, Node, Ribbon, Scalar, Sequence, Texture, Track, EMITTER_USES_MDL};

const TEXTURE: &str = "ribbon.blp";
const DEPTH_AWAY: f32 = -100.0;

/// The red channel of the scene's linear light along the middle row, before the final-image pass: a ribbon at a depth of 100 under a tangent of 1 puts 0.64 pixels on each world unit, x = 0 on pixel 64.
fn middle_row(renderer: &mut Renderer, device: &wgpu::Device, queue: &wgpu::Queue, scene: &Scene) -> Vec<f32> {
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
    (0..SIDE).map(|x| {
        let at = (((SIDE / 2) * SIDE + x) * 8) as usize;
        half_to_f32(u16::from_le_bytes([bytes[at], bytes[at + 1]]))
    }).collect()
}

fn pixel_of(x: f32) -> usize {
    (64.0 + x * 0.64).round() as usize
}

fn linear_track(from: f32, to: f32) -> Track<3> {
    let key = |frame, x| Key { frame, value: [x, 0.0, 0.0], in_tan: [0.0; 3], out_tan: [0.0; 3] };
    Track { line: LineType::Linear, global_sequence: None, keys: vec![key(0, from), key(1000, to)] }
}

/// A model with one ribbon on node 1, a child of bone 0, which `bone` moves along X over its one sequence; the ribbon adds its texture, 20 units tall, for a second.
fn ribbon_model(bone: Option<Track<3>>) -> crate::model::Model {
    let nodes = vec![Some(Node { object_id: 0, translation: bone, ..Node::default() }), Some(Node { object_id: 1, parent: Some(0), ..Node::default() })];
    let ribbon = Ribbon {
        node: 1,
        height_above: Scalar::fixed(10.0),
        height_below: Scalar::fixed(10.0),
        alpha: Scalar::fixed(1.0),
        color: Color { fixed: [1.0; 3], track: None },
        life_span: 1.0,
        texture_slot: Scalar::fixed(0.0),
        emission_rate: 60.0,
        rows: 1,
        columns: 1,
        material_id: 0,
        visibility: Scalar::fixed(1.0),
        ..Ribbon::default()
    };
    let layer = crate::model::Layer { filter_mode: 3, texture_id: 0, alpha: Scalar::fixed(1.0), ..crate::model::Layer::default() };
    crate::model::Model {
        sequences: vec![Sequence { name: "Stand".into(), interval: [0, 1000], non_looping: false, move_speed: 0.0, rarity: 0.0 }],
        nodes,
        materials: vec![Material { layers: vec![layer] }],
        textures: vec![Texture { replaceable_id: 0, image: TEXTURE.into() }],
        ribbons: vec![ribbon],
        ..crate::model::Model::default()
    }
}

/// A renderer at `preset` with the ribbon model loaded as "trail", painting with `texels` (RGBA, one row).
fn renderer_with(device: &wgpu::Device, queue: &wgpu::Queue, preset: crate::settings::Preset, bone: Option<Track<3>>, texels: Vec<u8>) -> Renderer {
    let mut renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, crate::remaster::Quality::Off, crate::settings::Features { render_scale: crate::settings::RenderScale::Fixed(100), ..preset.features() });
    let width = (texels.len() / 4) as u32;
    renderer.textures.insert(TEXTURE.into(), upload(device, queue, &crate::texture::Image { width, height: 1, rgba: texels }));
    renderer.add_model("trail", crate::render::source::build(ribbon_model(bone), crate::remaster::Quality::Off).expect("the ribbon model builds"));
    renderer
}

fn white() -> Vec<u8> {
    vec![255; 4 * 4]
}

/// Opaque at the start of the texture, fading to clear at its end: a ribbon drawn with it fades along its age.
fn fading() -> Vec<u8> {
    (0..32u32).flat_map(|texel| [255, 255, 255, (255 - texel * 255 / 31) as u8]).collect()
}

fn scene_at(frame: u32) -> Scene {
    let mut scene = Scene { frame, ..Scene::default() };
    scene.camera = scene::Camera { view: IDENTITY, eye: [0.0; 3], tangent: 1.0, near: 1.0, far: 10_000.0, sky_far: 10_000.0, rise: 0.0, reach: 0.0 };
    scene
}

fn trail_pose(matrix: Mat4, frame: f32) -> scene::Pose {
    scene::Pose { id: 7, model: "trail".into(), matrix, sequence: 0, frame, clock: 0.0, alpha: 1.0, color: [1.0; 3], team: TEAM, unit: false }
}

/// Flies the trail from x = -60 to x = 60 over frames 0 to 30, by its pose or by its bone, and returns the middle row at frame 30.
fn flown(renderer: &mut Renderer, device: &wgpu::Device, queue: &wgpu::Queue, by_bone: bool) -> Vec<f32> {
    let mut row = Vec::new();
    for frame in 0..=30u32 {
        let along = frame as f32 / 30.0;
        let mut scene = scene_at(frame);
        scene.poses = vec![if by_bone { trail_pose(translation(0.0, 0.0, DEPTH_AWAY), along * 1000.0) } else { trail_pose(translation(-60.0 + 120.0 * along, 0.0, DEPTH_AWAY), 0.0) }];
        row = middle_row(renderer, device, queue, &scene);
    }
    row
}

fn assert_traced(row: &[f32], what: &str) {
    for x in [-50.0, -25.0, 0.0, 25.0, 50.0] {
        assert!(row[pixel_of(x)] > 0.3, "{what}: the ribbon covers x = {x}: {:?}", &row[pixel_of(x) - 2..pixel_of(x) + 3]);
    }
    for x in [-85.0, 85.0] {
        assert!(row[pixel_of(x)] < 0.1, "{what}: nothing beyond the path at x = {x}: {}", row[pixel_of(x)]);
    }
}

#[test]
fn a_ribbon_follows_a_moving_pose() {
    let Some((device, queue)) = device() else { return };
    let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
    let mut renderer = renderer_with(&device, &queue, crate::settings::Preset::Medium, None, white());
    let row = flown(&mut renderer, &device, &queue, false);
    assert_traced(&row, "moved by its pose");
    assert!(pollster::block_on(scope.pop()).is_none(), "no wgpu validation error");
}

#[test]
fn a_ribbon_follows_a_skinned_node() {
    let Some((device, queue)) = device() else { return };
    let mut renderer = renderer_with(&device, &queue, crate::settings::Preset::Medium, Some(linear_track(-60.0, 60.0)), white());
    let row = flown(&mut renderer, &device, &queue, true);
    assert_traced(&row, "moved by its bone");
}

#[test]
fn a_ribbon_fades_over_its_life_and_is_gone_after_it() {
    let Some((device, queue)) = device() else { return };
    let mut renderer = renderer_with(&device, &queue, crate::settings::Preset::Medium, None, fading());
    let row = flown(&mut renderer, &device, &queue, false);
    let (new, old) = (row[pixel_of(45.0)], row[pixel_of(-45.0)]);
    assert!(new > 0.3 && old < new * 0.6, "the newer end is brighter than the older: {new} against {old}");
    let mut later = Vec::new();
    for frame in 31..=60 {
        let mut scene = scene_at(frame);
        scene.poses = vec![trail_pose(translation(60.0, 0.0, DEPTH_AWAY), 0.0)];
        later = middle_row(&mut renderer, &device, &queue, &scene);
    }
    assert!(later[pixel_of(45.0)] < new * 0.6, "half a second on, the same place is dimmer: {} against {new}", later[pixel_of(45.0)]);
    for frame in 61..=95 {
        let mut scene = scene_at(frame);
        scene.poses = vec![trail_pose(translation(60.0, 0.0, DEPTH_AWAY), 0.0)];
        later = middle_row(&mut renderer, &device, &queue, &scene);
    }
    let brightest = later[..pixel_of(55.0)].iter().copied().fold(0.0f32, f32::max);
    assert!(brightest < 0.05, "past its life the trail is gone: {brightest}");
}

#[test]
fn a_removed_hidden_or_parked_effect_leaves_no_streak() {
    let Some((device, queue)) = device() else { return };
    let mut renderer = renderer_with(&device, &queue, crate::settings::Preset::Medium, None, white());
    let traced = flown(&mut renderer, &device, &queue, false);
    assert!(traced[pixel_of(0.0)] > 0.3, "the trail is drawn before it goes");
    let gone = middle_row(&mut renderer, &device, &queue, &scene_at(31));
    assert!(gone.iter().all(|&light| light < 0.05), "a removed effect leaves nothing the next frame: {:?}", gone.iter().copied().fold(0.0f32, f32::max));
    let mut reused = Vec::new();
    for frame in 32..34 {
        let mut scene = scene_at(frame);
        let mut next = trail_pose(translation(60.0, 0.0, DEPTH_AWAY), 0.0);
        next.id = 8;
        scene.poses = vec![next];
        reused = middle_row(&mut renderer, &device, &queue, &scene);
    }
    let old_trail = reused[pixel_of(-50.0)..pixel_of(40.0)].iter().copied().fold(0.0f32, f32::max);
    assert!(old_trail < 0.05, "an effect that takes the removed one's record does not bring its strip back: {old_trail}");

    let mut renderer = renderer_with(&device, &queue, crate::settings::Preset::Medium, None, white());
    let _ = flown(&mut renderer, &device, &queue, false);
    let mut scene = scene_at(31);
    let mut hidden = trail_pose(translation(60.0, 0.0, DEPTH_AWAY), 0.0);
    hidden.alpha = 0.0;
    scene.poses = vec![hidden];
    let row = middle_row(&mut renderer, &device, &queue, &scene);
    assert!(row.iter().all(|&light| light < 0.05), "a hidden effect leaves nothing");

    let mut renderer = renderer_with(&device, &queue, crate::settings::Preset::Medium, None, white());
    let mut parked = translation(-60.0, 0.0, DEPTH_AWAY);
    for scale in [0, 5, 10] {
        parked[scale] = 0.0;
    }
    for frame in 0..10 {
        let mut scene = scene_at(frame);
        scene.poses = vec![trail_pose(parked, 0.0)];
        let _ = middle_row(&mut renderer, &device, &queue, &scene);
    }
    let mut row = Vec::new();
    for frame in 10..13 {
        let mut scene = scene_at(frame);
        scene.poses = vec![trail_pose(translation(60.0, 0.0, DEPTH_AWAY), 0.0)];
        row = middle_row(&mut renderer, &device, &queue, &scene);
    }
    let between = row[pixel_of(-50.0)..pixel_of(40.0)].iter().copied().fold(0.0f32, f32::max);
    assert!(between < 0.05, "no streak from the park at x = -60 to the launch at x = 60: {between}");
}

#[test]
fn low_lays_half_the_edges_and_still_draws_the_ribbon() {
    let Some((device, queue)) = device() else { return };
    let mut high = renderer_with(&device, &queue, crate::settings::Preset::High, None, white());
    let _ = flown(&mut high, &device, &queue, false);
    let mut low = renderer_with(&device, &queue, crate::settings::Preset::Low, None, white());
    let row = flown(&mut low, &device, &queue, false);
    let (laid_high, laid_low) = (high.effects.ribbons.drawn(), low.effects.ribbons.drawn());
    assert!(laid_low * 2 <= laid_high + 2 && laid_low * 2 + 4 >= laid_high, "Low lays half of High's quads: {laid_low} against {laid_high}");
    assert_traced(&row, "on Low");
}

#[test]
fn a_strip_adds_its_colour_by_each_edge_alpha_and_is_gone_when_the_scene_drops_it() {
    let Some((device, queue)) = device() else { return };
    let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
    let mut renderer = renderer_with(&device, &queue, crate::settings::Preset::Medium, None, white());
    let mut scene = scene_at(1);
    let edge = |x: f32| [x, 10.0, DEPTH_AWAY, x, -10.0, DEPTH_AWAY, (x + 60.0) / 120.0];
    scene.strips = vec![scene::StripPose { edges: (0..=12).map(|step| edge(-60.0 + 10.0 * step as f32)).collect(), color: [1.0, 0.5, 0.0] }];
    let row = middle_row(&mut renderer, &device, &queue, &scene);
    assert!(row[pixel_of(50.0)] > 0.5, "the opaque end adds its red: {}", row[pixel_of(50.0)]);
    assert!(row[pixel_of(-50.0)] < 0.05, "the clear end adds little: {}", row[pixel_of(-50.0)]);
    assert!(row[pixel_of(85.0)] < 0.01, "nothing past the strip: {}", row[pixel_of(85.0)]);
    scene.frame = 2;
    scene.strips.clear();
    let row = middle_row(&mut renderer, &device, &queue, &scene);
    assert!(row.iter().all(|red| *red < 0.01), "a strip the scene drops leaves nothing: {:?}", row.iter().copied().fold(0.0, f32::max));
    assert!(pollster::block_on(scope.pop()).is_none(), "no wgpu validation error");
}

#[test]
fn a_version_one_emitter_flings_copies_of_its_model() {
    let Some((device, queue)) = device() else { return };
    let mut renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, crate::remaster::Quality::Off, crate::settings::Preset::Medium.features());
    let corner = |x: f32, y: f32| Vertex { position: [x, y, 0.0], normal: [0.0, 0.0, 1.0], uv: [0.0; 2], bones: [0; 4], weights: [1.0, 0.0, 0.0, 0.0] };
    let layer = model::Layer { paint: Paint::None, filter: Filter::Additive, color_slot: 1, unshaded: true, two_sided: true };
    let part = model::Part { color_slot: 0, first_index: 0, index_count: 6, layers: vec![layer] };
    renderer.add_model("leaf", ModelData { vertices: vec![corner(-4.0, -4.0), corner(4.0, -4.0), corner(4.0, 4.0), corner(-4.0, 4.0)], indices: vec![0, 1, 2, 0, 2, 3], parts: vec![part], rig: Box::new(FlatRig::new([1.0; 4])), emitters: Vec::new(), ribbons: Vec::new(), spawners: Vec::new() });
    let emitter = Emitter1 { node: 0, flags: EMITTER_USES_MDL, emission_rate: Scalar::fixed(30.0), speed: Scalar::fixed(60.0), latitude: Scalar::fixed(0.0), gravity: Scalar::fixed(0.0), life_span: Scalar::fixed(2.0), visibility: Scalar::fixed(1.0), path: "leaf".into(), ..Emitter1::default() };
    let parent = crate::model::Model { sequences: vec![Sequence { name: "Stand".into(), interval: [0, 1000], non_looping: false, move_speed: 0.0, rarity: 0.0 }], nodes: vec![Some(Node::default())], emitters1: vec![emitter], ..crate::model::Model::default() };
    renderer.add_model("tree", crate::render::source::build(parent, crate::remaster::Quality::Off).expect("the emitting model builds"));
    let turned: Mat4 = [0.0, 0.0, -1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, -60.0, 0.0, DEPTH_AWAY, 1.0];
    let mut row = Vec::new();
    for frame in 0..=61 {
        let mut scene = scene_at(frame);
        scene.poses = vec![scene::Pose { id: 9, model: "tree".into(), matrix: turned, sequence: 0, frame: 0.0, clock: 0.0, alpha: 1.0, color: [1.0; 3], team: TEAM, unit: false }];
        row = middle_row(&mut renderer, &device, &queue, &scene);
    }
    assert!(renderer.effects.spawned.poses().len() >= 25, "a second at 30 a second flings about 30 copies: {}", renderer.effects.spawned.poses().len());
    for x in [-55.0, -30.0, -8.0] {
        assert!(row[pixel_of(x)] > 0.3, "a copy flies past x = {x}: {:?}", &row[pixel_of(x) - 2..pixel_of(x) + 3]);
    }
    assert!(row[pixel_of(20.0)] < 0.05, "none has flown past a second's flight: {}", row[pixel_of(20.0)]);
}
