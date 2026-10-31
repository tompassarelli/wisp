use super::shadow::{box_of, flat_quad};
use super::*;
use crate::settings::{Features, Preset};

const WIDE: u32 = 512;

const EYE: f32 = 3000.0;
const TANGENT: f32 = 0.08;

/// What the scene holds beside the fighter: a plate high toward the sun whose shadow falls across the fighter's open top, or nothing.
#[derive(Clone, Copy, PartialEq)]
enum Overhead {
    Plate,
    Clear,
}

/// A grey floor under a 45 degree sun with a fighter on it, seen from straight above through a thin slice around the floor: a body 120 units square and 40 high with a pillar 120 high along its sunward side, whose shadow falls across the body's top from x 60 back to x -20 and onto the floor behind it.
/// `unit` says whether the fighter is posed as a unit; the plate, when there is one, sits above the near plane, so it shades without being seen.
fn fighter_on_floor(features: Features, unit: bool, overhead: Overhead) -> Option<Vec<u8>> {
    let (device, queue) = device()?;
    let mut renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, crate::remaster::Quality::Off, features);
    renderer.textures.insert("grey".into(), upload(&device, &queue, &crate::texture::Image { width: 1, height: 1, rgba: vec![128, 128, 128, 255] }));
    let part = |(first_index, index_count)| model::Part { color_slot: 0, first_index, index_count, layers: vec![model::Layer { paint: Paint::Texture("grey".into()), filter: Filter::Opaque, color_slot: 1, unshaded: false, two_sided: true }] };
    let (mut vertices, mut indices) = (Vec::new(), Vec::new());
    let mut parts = vec![part(flat_quad(&mut vertices, &mut indices, 6000.0, 0.0))];
    if overhead == Overhead::Plate {
        parts.push(part(box_of(&mut vertices, &mut indices, [50.0, 100.0, 2.0], [300.0, 0.0, 400.0])));
    }
    renderer.add_model("stage", ModelData { vertices, indices, parts, rig: Box::new(FlatRig::new([1.0; 4])), emitters: Vec::new() });
    let (mut vertices, mut indices) = (Vec::new(), Vec::new());
    let body = box_of(&mut vertices, &mut indices, [60.0, 60.0, 20.0], [0.0, 0.0, 20.0]);
    let pillar = box_of(&mut vertices, &mut indices, [10.0, 60.0, 60.0], [70.0, 0.0, 60.0]);
    renderer.add_model("fighter", ModelData { vertices, indices, parts: vec![part(body), part(pillar)], rig: Box::new(FlatRig::new([1.0; 4])), emitters: Vec::new() });
    let mut scene = Scene { frame: 0, clear: BACKGROUND, ..Scene::default() };
    let slant = std::f32::consts::FRAC_1_SQRT_2;
    scene.light = Some(scene::Light { toward: [slant, 0.0, slant], key: [0.7; 3], ambient: [0.4; 3] });
    let pose = |model: &str, unit| scene::Pose { id: 0, model: model.into(), matrix: IDENTITY, sequence: 0, frame: 0.0, clock: 0.0, alpha: 1.0, color: [1.0; 3], team: TEAM, unit };
    scene.poses = vec![pose("stage", false), pose("fighter", unit)];
    scene.camera = scene::Camera { view: translation(0.0, 0.0, -EYE), eye: [0.0, 0.0, EYE], tangent: TANGENT, near: EYE - 200.0, far: 20_000.0, sky_far: 20_000.0, rise: 0.0, reach: 3100.0 };
    Some(render_at(&mut renderer, &device, &queue, &scene, WIDE))
}

/// The mean grey level of the square of pixels `half` units each side of world (x, y) on a plane at `height`.
fn level(image: &[u8], x: f32, y: f32, height: f32, half: f32) -> f32 {
    let scale = WIDE as f32 / (2.0 * (EYE - height) * TANGENT);
    let (column, row) = (|at: f32| (at * scale + WIDE as f32 / 2.0) as u32, |at: f32| (WIDE as f32 / 2.0 - at * scale) as u32);
    let (columns, rows) = (column(x - half)..=column(x + half), row(y + half)..=row(y - half));
    let count = (columns.clone().count() * rows.clone().count()) as f32;
    rows.flat_map(|y| columns.clone().map(move |x| (x, y))).map(|(x, y)| image[((y * WIDE + x) * 4) as usize..][..3].iter().map(|&channel| f32::from(channel)).sum::<f32>() / 3.0).sum::<f32>() / count
}

const TOP: f32 = 40.0;
const OPEN_TOP: f32 = -45.0;
const SELF_SHADED_TOP: f32 = 25.0;

#[test]
fn a_fighter_takes_no_shadow_from_the_stage_and_its_own_only_at_high_and_ultra_within_the_cap() {
    let shots = |features: Features, unit, overhead| fighter_on_floor(features, unit, overhead);
    let Some(low) = shots(Preset::Low.features(), true, Overhead::Clear) else { return };
    let low_mean = level(&low, 0.0, 0.0, TOP, 50.0);
    for preset in [Preset::Medium, Preset::High, Preset::Ultra] {
        let features = preset.features();
        let (Some(clear), Some(plated)) = (shots(features, true, Overhead::Clear), shots(features, true, Overhead::Plate)) else { return };
        let (open, under_plate) = (level(&clear, OPEN_TOP, 0.0, TOP, 8.0), level(&plated, OPEN_TOP, 0.0, TOP, 8.0));
        assert!((open - under_plate).abs() < 2.0, "{preset:?}: the plate's shadow reaches the fighter's top: {under_plate} under it, {open} without it");
        let floor_open = level(&plated, -250.0, 0.0, 0.0, 10.0);
        let floor_under_plate = level(&plated, -130.0, 80.0, 0.0, 10.0);
        assert!(floor_open - floor_under_plate > 20.0, "{preset:?}: the plate shades the stage: {floor_under_plate} under it, {floor_open} open");
        let floor_behind = level(&clear, -80.0, 0.0, 0.0, 8.0);
        assert!(floor_open - floor_behind > 20.0, "{preset:?}: the fighter shades the stage behind it: {floor_behind}, open floor {floor_open}");
        let self_shaded = level(&clear, SELF_SHADED_TOP, 0.0, TOP, 8.0);
        let darkening = (open - self_shaded) / open;
        if features.fighter_shadows == 0 {
            assert!(darkening.abs() < 0.02, "{preset:?}: no fighter map, yet the pillar shades the fighter's own top by {darkening}: {self_shaded} against {open}");
        } else {
            assert!((0.05..0.3).contains(&darkening), "{preset:?}: the pillar's shadow on the fighter's own top darkens it by {darkening}: {self_shaded} against {open}");
        }
        let mean = level(&clear, 0.0, 0.0, TOP, 50.0);
        assert!(mean >= 0.85 * low_mean, "{preset:?}: the fighter's mean level {mean} is more than 15% under Low's {low_mean}");
    }
}

#[test]
fn ambient_occlusion_and_contact_shadows_darken_a_fighter_less_than_the_stage() {
    let features = Features { shadows: crate::settings::Shadows::Off, fighter_shadows: 0, bloom: false, ..Preset::Ultra.features() };
    let crease = |unit| fighter_on_floor(features, unit, Overhead::Clear).map(|image| 1.0 - level(&image, 56.0, 0.0, TOP, 2.0) / level(&image, OPEN_TOP, 0.0, TOP, 8.0));
    let (Some(stage), Some(unit)) = (crease(false), crease(true)) else { return };
    assert!(stage > 0.05, "the crease at the pillar's foot darkens on the stage: {stage}");
    assert!(unit < 0.5 * stage, "a fighter's crease darkens by {unit}, against the stage's {stage}");
}
