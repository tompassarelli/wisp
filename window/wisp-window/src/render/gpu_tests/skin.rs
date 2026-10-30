use super::*;

fn six_bone_quad() -> crate::model::Model {
    let bone = |shift: f32| {
        let key = crate::model::Key { frame: 0, value: [shift, 0.0, 0.0], in_tan: [0.0; 3], out_tan: [0.0; 3] };
        Some(crate::model::Node { translation: Some(crate::model::Track { line: crate::model::LineType::Linear, global_sequence: None, keys: vec![key] }), ..crate::model::Node::default() })
    };
    let corners = [[-20.0, -20.0, -100.0], [20.0, -20.0, -100.0], [20.0, 20.0, -100.0], [-20.0, 20.0, -100.0]];
    let geoset = crate::model::Geoset { vertices: corners.to_vec(), vertex_group: vec![0; 4], groups: vec![(0..6).collect()], indices: vec![0, 1, 2, 0, 2, 3], ..crate::model::Geoset::default() };
    let sequence = crate::model::Sequence { name: "Stand".into(), interval: [0, 1000], non_looping: false, move_speed: 0.0, rarity: 0.0 };
    crate::model::Model { sequences: vec![sequence], geosets: vec![geoset], nodes: [0.0, 0.0, 0.0, 0.0, 60.0, 60.0].map(bone).to_vec(), ..crate::model::Model::default() }
}

#[test]
fn a_vertex_group_of_six_bones_draws_where_the_mean_of_its_bones_puts_it() {
    let Some((device, queue)) = device() else { return };
    let mut renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, crate::remaster::Quality::Off, crate::settings::Preset::High.features());
    renderer.add_model("six", crate::render::source::build(six_bone_quad(), crate::remaster::Quality::Off).expect("a model of six bones builds"));
    let mut scene = Scene { frame: 0, clear: BACKGROUND, ..Scene::default() };
    scene.camera = scene::Camera { view: IDENTITY, eye: [0.0; 3], tangent: 1.0, near: 1.0, far: 10_000.0, sky_far: 10_000.0, rise: 0.0, reach: 0.0 };
    scene.poses = vec![scene::Pose { id: 0, model: "six".into(), matrix: IDENTITY, sequence: 0, frame: 0.0, clock: 0.0, alpha: 1.0, color: [1.0; 3], team: TEAM }];
    let image = render(&mut renderer, &device, &queue, &scene);
    let drawn = |x: u32| pixel(&image, x, SIDE / 2)[0] > 160;
    // The bones shift the quad by 20 world units on average, which at a depth of 100 and a tangent of 1 is 12.8 pixels, so it spans pixels 64 to 89.6.
    assert!(drawn(66) && drawn(70) && drawn(88), "the quad covers the pixels the mean puts it on");
    assert!(!drawn(61) && !drawn(55) && !drawn(92), "and none left of 64 (where four of the bones would leave it) or right of 90");
}
