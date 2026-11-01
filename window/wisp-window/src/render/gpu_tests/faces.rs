//! Which faces of a layer reach the screen: Warcraft draws a layer's back faces only when its shading has the two-sided flag.

use super::*;

const FRONT: [u32; 6] = [0, 1, 2, 0, 2, 3];
const BACK: [u32; 6] = [0, 2, 1, 0, 3, 2];

/// Draws a white sheet across the middle of the view, its corners wound `winding` as the camera sees them, and says whether the middle pixel differs from the same view without the sheet.
fn sheet_shows(winding: [u32; 6], two_sided: bool) -> Option<bool> {
    let (device, queue) = device()?;
    let mut renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, crate::remaster::Quality::Off, crate::settings::Preset::Low.features());
    let vertices = [(-60.0, -60.0), (60.0, -60.0), (60.0, 60.0), (-60.0, 60.0)].map(|(x, y)| Vertex { position: [x, y, 0.0], normal: [0.0, 0.0, 1.0], uv: [0.0; 2], bones: [0; 4], weights: [1.0, 0.0, 0.0, 0.0] }).to_vec();
    let layer = model::Layer { paint: Paint::None, filter: Filter::Opaque, color_slot: 1, unshaded: true, two_sided };
    renderer.add_model("sheet", ModelData { vertices, indices: winding.to_vec(), parts: vec![model::Part { color_slot: 0, first_index: 0, index_count: 6, layers: vec![layer] }], rig: Box::new(FlatRig::new([1.0; 4])), emitters: Vec::new(), ribbons: Vec::new(), spawners: Vec::new() });
    let mut scene = Scene { frame: 0, clear: BACKGROUND, ..Scene::default() };
    scene.camera = scene::Camera { view: translation(0.0, 0.0, -500.0), eye: [0.0, 0.0, 500.0], tangent: 1.0, near: 1.0, far: 10_000.0, sky_far: 10_000.0, rise: 0.0, reach: 0.0 };
    let empty = render(&mut renderer, &device, &queue, &scene);
    scene.poses = vec![scene::Pose { id: 0, model: "sheet".into(), matrix: IDENTITY, sequence: 0, frame: 0.0, clock: 0.0, alpha: 1.0, color: [1.0; 3], team: TEAM, unit: false }];
    scene.frame = 1;
    let drawn = render(&mut renderer, &device, &queue, &scene);
    Some(pixel(&drawn, SIDE / 2, SIDE / 2) != pixel(&empty, SIDE / 2, SIDE / 2))
}

#[test]
fn a_one_sided_layer_shows_its_front_and_hides_its_back() {
    let (Some(front), Some(back)) = (sheet_shows(FRONT, false), sheet_shows(BACK, false)) else { return };
    assert!(front, "a one-sided layer's front face is drawn");
    assert!(!back, "a one-sided layer's back face is culled, as Warcraft culls the inside of a cloak");
}

#[test]
fn a_two_sided_layer_shows_both_faces() {
    let (Some(front), Some(back)) = (sheet_shows(FRONT, true), sheet_shows(BACK, true)) else { return };
    assert!(front && back, "a layer with the two-sided flag is drawn from either side: front {front}, back {back}");
}
