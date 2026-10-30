use super::*;

fn flat_quad(vertices: &mut Vec<Vertex>, indices: &mut Vec<u32>, reach: f32, height: f32) -> (u32, u32) {
    let base = vertices.len() as u32;
    for (x, y) in [(-reach, -reach), (reach, -reach), (reach, reach), (-reach, reach)] {
        vertices.push(Vertex { position: [x, y, height], normal: [0.0, 0.0, 1.0], uv: [0.0, 0.0], bones: [0; 4], weights: [1.0, 0.0, 0.0, 0.0] });
    }
    let first = indices.len() as u32;
    indices.extend([0, 1, 2, 0, 2, 3].map(|corner| base + corner));
    (first, 6)
}

fn shade_under_a_caster(features: crate::settings::Features) -> Option<(f32, f32)> {
    let (device, queue) = device()?;
    let mut renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, crate::remaster::Quality::Off, features);
    renderer.textures.insert("grey".into(), upload(&device, &queue, &crate::texture::Image { width: 1, height: 1, rgba: vec![128, 128, 128, 255] }));
    let (mut vertices, mut indices) = (Vec::new(), Vec::new());
    let floor = flat_quad(&mut vertices, &mut indices, 4000.0, 0.0);
    let caster = flat_quad(&mut vertices, &mut indices, 60.0, 200.0);
    let part = |(first_index, index_count)| model::Part { color_slot: 0, first_index, index_count, layers: vec![model::Layer { paint: Paint::Texture("grey".into()), filter: Filter::Opaque, color_slot: 1, unshaded: false }] };
    renderer.add_model("stage", ModelData { vertices, indices, parts: vec![part(floor), part(caster)], rig: Box::new(FlatRig::new([1.0; 4])), emitters: Vec::new() });
    let mut scene = Scene { frame: 0, clear: BACKGROUND, ..Scene::default() };
    scene.camera = scene::Camera { view: translation(0.0, 0.0, -500.0), eye: [0.0, 0.0, 500.0], tangent: 1.0, near: 1.0, far: 10_000.0, sky_far: 10_000.0, rise: 0.0, reach: 2000.0 };
    let slant = std::f32::consts::FRAC_1_SQRT_2;
    scene.light = Some(scene::Light { toward: [slant, 0.0, slant], key: [0.7; 3], ambient: [0.4; 3] });
    scene.poses = vec![scene::Pose { id: 0, model: "stage".into(), matrix: IDENTITY, sequence: 0, frame: 0.0, clock: 0.0, alpha: 1.0, color: [1.0; 3], team: TEAM }];
    let image = render(&mut renderer, &device, &queue, &scene);
    let at = |x| f32::from(pixel(&image, x, SIDE / 2)[0]) / 255.0;
    Some((at(38), at(96)))
}

#[test]
fn a_caster_darkens_the_floor_it_shades_only_where_the_settings_draw_shadows() {
    let Some((shaded, sunlit)) = shade_under_a_caster(crate::settings::Preset::High.features()) else { return };
    assert!(sunlit > shaded + 0.05, "the floor under the caster's shadow is darker: shaded {shaded}, sunlit {sunlit}");
    let Some((flat_shaded, flat_sunlit)) = shade_under_a_caster(crate::settings::Preset::Low.features()) else { return };
    assert!((flat_sunlit - flat_shaded).abs() < 0.02, "with shadows off the floor is lit alike: {flat_shaded} and {flat_sunlit}");
}
