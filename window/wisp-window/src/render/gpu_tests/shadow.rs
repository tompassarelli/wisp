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

const WIDE: u32 = 512;
const EYE: f32 = 3000.0;
const TANGENT: f32 = 0.08;

fn box_of(vertices: &mut Vec<Vertex>, indices: &mut Vec<u32>, half: [f32; 3], centre: [f32; 3]) -> (u32, u32) {
    let first = indices.len() as u32;
    for axis in 0..3 {
        for sign in [-1.0f32, 1.0] {
            let (u, v) = ((axis + 1) % 3, (axis + 2) % 3);
            let base = vertices.len() as u32;
            let mut normal = [0.0; 3];
            normal[axis] = sign;
            for (a, b) in [(-1.0f32, -1.0f32), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)] {
                let mut position = centre;
                position[axis] += sign * half[axis];
                position[u] += a * half[u];
                position[v] += b * half[v];
                vertices.push(Vertex { position, normal, uv: [0.0, 0.0], bones: [0; 4], weights: [1.0, 0.0, 0.0, 0.0] });
            }
            let order = if sign > 0.0 { [0, 1, 2, 0, 2, 3] } else { [0, 2, 1, 0, 3, 2] };
            indices.extend(order.map(|corner| base + corner));
        }
    }
    (first, 36)
}

fn sunlit_only(features: crate::settings::Features) -> crate::settings::Features {
    crate::settings::Features { ssao: false, bloom: false, contact_shadows: false, ..features }
}

/// A grey floor under a 45 degree sun with one box on it, seen from straight above through a thin slice around the floor, drawn `WIDE` pixels a side once for each reach.
fn box_on_floor(features: crate::settings::Features, half: [f32; 3], centre: [f32; 3], eye: f32, reaches: &[f32]) -> Option<Vec<Vec<u8>>> {
    let (device, queue) = device()?;
    let mut renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, crate::remaster::Quality::Off, features);
    renderer.textures.insert("grey".into(), upload(&device, &queue, &crate::texture::Image { width: 1, height: 1, rgba: vec![128, 128, 128, 255] }));
    let (mut vertices, mut indices) = (Vec::new(), Vec::new());
    let floor = flat_quad(&mut vertices, &mut indices, 6000.0, 0.0);
    let solid = box_of(&mut vertices, &mut indices, half, centre);
    let part = |(first_index, index_count)| model::Part { color_slot: 0, first_index, index_count, layers: vec![model::Layer { paint: Paint::Texture("grey".into()), filter: Filter::Opaque, color_slot: 1, unshaded: false }] };
    renderer.add_model("stage", ModelData { vertices, indices, parts: vec![part(floor), part(solid)], rig: Box::new(FlatRig::new([1.0; 4])), emitters: Vec::new() });
    let mut scene = Scene { frame: 0, clear: BACKGROUND, ..Scene::default() };
    let slant = std::f32::consts::FRAC_1_SQRT_2;
    scene.light = Some(scene::Light { toward: [slant, 0.0, slant], key: [0.7; 3], ambient: [0.4; 3] });
    scene.poses = vec![scene::Pose { id: 0, model: "stage".into(), matrix: IDENTITY, sequence: 0, frame: 0.0, clock: 0.0, alpha: 1.0, color: [1.0; 3], team: TEAM }];
    Some(reaches.iter().map(|&reach| {
        scene.camera = scene::Camera { view: translation(0.0, 0.0, -eye), eye: [0.0, 0.0, eye], tangent: TANGENT, near: eye - 200.0, far: 20_000.0, sky_far: 20_000.0, rise: 0.0, reach };
        render_at(&mut renderer, &device, &queue, &scene, WIDE)
    }).collect())
}

fn floor_x(eye: f32, column: u32) -> f32 {
    (column as f32 + 0.5 - WIDE as f32 / 2.0) * 2.0 * eye * TANGENT / WIDE as f32
}

fn column_of(eye: f32, x: f32) -> usize {
    (x * WIDE as f32 / (2.0 * eye * TANGENT) + WIDE as f32 / 2.0) as usize
}

/// The middle rows' mean red level at each column, which the sun's filter noise does not reach.
fn along_the_floor(image: &[u8]) -> Vec<f32> {
    (0..WIDE).map(|x| (WIDE / 2 - 16..WIDE / 2 + 16).map(|y| f32::from(image[((y * WIDE + x) * 4) as usize])).sum::<f32>() / 32.0).collect()
}

/// Where along the floor, in world units, a shadow's lit side drops to half way to its dark side, and how many pixels the drop from 90% to 10% takes.
fn edge(levels: &[f32], eye: f32, lit_at: f32, dark_at: f32) -> (f32, usize) {
    let (lit, dark) = (levels[column_of(eye, lit_at)], levels[column_of(eye, dark_at)]);
    let shade = |column: usize| (levels[column] - dark) / (lit - dark);
    let (from, to) = (column_of(eye, lit_at), column_of(eye, dark_at));
    let width = (from..=to).filter(|&column| (0.1..0.9).contains(&shade(column))).count();
    let half = (from..=to).find(|&column| shade(column) < 0.5).expect("the shadow crosses half way");
    (floor_x(eye, half as u32), width)
}

#[test]
fn a_shadow_edge_is_sharp_beside_a_low_caster_and_wide_beside_a_high_one() {
    let high = crate::settings::Features { shadows: crate::settings::Shadows::Map(512), ..sunlit_only(crate::settings::Preset::High.features()) };
    let (Some(low), Some(tall)) = (box_on_floor(high, [40.0, 40.0, 2.0], [0.0, 0.0, 10.0], EYE, &[3100.0]), box_on_floor(high, [40.0, 40.0, 2.0], [0.0, 0.0, 150.0], EYE, &[3100.0])) else { return };
    let (_, near_width) = edge(&along_the_floor(&low[0]), EYE, -62.0, -45.0);
    let (_, far_width) = edge(&along_the_floor(&tall[0]), EYE, -215.0, -150.0);
    assert!(near_width <= 3, "the edge beside a caster 10 units up is {near_width} pixels wide");
    assert!(far_width >= 3 * near_width.max(1) && far_width >= 7, "the edge beside a caster 150 units up is {far_width} pixels wide, against {near_width}");
}

#[test]
fn a_wall_s_shadow_starts_at_its_foot() {
    let high = crate::settings::Features { shadows: crate::settings::Shadows::Map(512), ..sunlit_only(crate::settings::Preset::High.features()) };
    let Some(images) = box_on_floor(high, [40.0, 40.0, 30.0], [0.0, 0.0, 30.0], EYE, &[3100.0]) else { return };
    let levels = along_the_floor(&images[0]);
    let (lit, dark) = (levels[column_of(EYE, -120.0)], levels[column_of(EYE, -55.0)]);
    assert!(lit - dark > 20.0, "the wall casts a shadow: lit {lit}, in shadow {dark}");
    let beside_the_foot = levels[column_of(EYE, -43.0)];
    assert!(beside_the_foot < dark + 0.15 * (lit - dark), "3 units from the wall's foot the floor is {beside_the_foot}, shadow {dark}, lit {lit}");
}

