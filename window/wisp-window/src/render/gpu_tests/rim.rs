use super::*;

fn edge_on(unit: bool) -> Option<f32> {
    let (device, queue) = device()?;
    let mut renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, crate::remaster::Quality::Off, crate::settings::Preset::High.features());
    renderer.textures.insert("grey".into(), upload(&device, &queue, &crate::texture::Image { width: 1, height: 1, rgba: vec![128, 128, 128, 255] }));
    let (mut vertices, mut indices) = (Vec::new(), Vec::new());
    let (first_index, index_count) = shadow::flat_quad(&mut vertices, &mut indices, 60.0, 0.0);
    for vertex in &mut vertices {
        vertex.normal = [0.0, 1.0, 0.0];
    }
    let part = model::Part { color_slot: 0, first_index, index_count, layers: vec![model::Layer { paint: Paint::Texture("grey".into()), filter: Filter::Opaque, color_slot: 1, unshaded: false, two_sided: true }] };
    renderer.add_model("edge", ModelData { vertices, indices, parts: vec![part], rig: Box::new(FlatRig::new([1.0; 4])), emitters: Vec::new() });
    let mut scene = Scene { frame: 0, clear: BACKGROUND, ..Scene::default() };
    scene.camera = scene::Camera { view: translation(0.0, 0.0, -500.0), eye: [0.0, 0.0, 500.0], tangent: 1.0, near: 1.0, far: 10_000.0, sky_far: 10_000.0, rise: 0.0, reach: 2000.0 };
    scene.light = Some(scene::Light { toward: [0.0, 0.0, 1.0], key: [0.5; 3], ambient: [0.4; 3] });
    scene.poses = vec![scene::Pose { id: 0, model: "edge".into(), matrix: IDENTITY, sequence: 0, frame: 0.0, clock: 0.0, alpha: 1.0, color: [1.0; 3], team: TEAM, unit }];
    let image = render(&mut renderer, &device, &queue, &scene);
    Some(f32::from(pixel(&image, SIDE / 2, SIDE / 2)[0]) / 255.0)
}

#[test]
fn a_unit_takes_the_rim_light_at_its_edge_and_a_stage_piece_does_not() {
    let (Some(unit), Some(stage)) = (edge_on(true), edge_on(false)) else { return };
    assert!(unit > stage + 0.1, "the unit's grazing surface is brighter: unit {unit}, stage {stage}");
}
