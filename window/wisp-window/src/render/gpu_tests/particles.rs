use super::*;

fn particle_light(filter_mode: u32, texel: [u8; 4]) -> [f32; 3] {
    let Some((device, queue)) = device() else { return [f32::NAN; 3] };
    let mut renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, crate::remaster::Quality::Off, crate::settings::Preset::High.features());
    let view = upload(&device, &queue, &crate::texture::Image { width: 1, height: 1, rgba: texel.to_vec() });
    let spec = Emitter2 { rows: 1, columns: 1, head: true, life_span: 5.0, time: 0.5, scaling: [20.0; 3], alphas: [1.0; 3], colors: [[1.0; 3]; 3], filter_mode, ..Emitter2::default() };
    let emitter = ModelEmitter { spec, paint: Paint::None };
    let slot = renderer.particles.register(&device, &queue, &emitter, ("shine", &view), &renderer.sampler).expect("room for an emitter");
    let mut scene = Scene { frame: 0, clear: BACKGROUND, ..Scene::default() };
    scene.camera = scene::Camera { view: IDENTITY, eye: [0.0; 3], tangent: 1.0, near: 1.0, far: 10_000.0, sky_far: 10_000.0, rise: 0.0, reach: 0.0 };
    let _ = render(&mut renderer, &device, &queue, &scene);
    renderer.particles.begin(stepped(1));
    let sample = EmitterSample { visible: true, rate: 60.0, ..EmitterSample::default() };
    renderer.particles.emit((1, 0), slot, &emitter, &sample, &translation(0.0, 0.0, -100.0), 1.0);
    scene.frame = 1;
    light_at_centre(&mut renderer, &device, &queue, &scene)
}

#[test]
fn an_additive_particle_adds_its_colour_scaled_by_its_texture_alpha_in_display_colour() {
    let (faded, background) = (linear(SOURCE.map(|channel| channel * 0.5)), background());
    assert_pixel(particle_light(1, texel(SOURCE, 0.5)), [0, 1, 2].map(|channel| faded[channel] + background[channel]), "Classic scales by alpha before the light is linear, so a soft fringe adds as little as it does there and the Blood Elf orb's flames stay off its sphere");
}

#[test]
fn an_alpha_keyed_particle_cuts_at_three_quarters_and_adds_the_rest() {
    let background = background();
    assert_pixel(particle_light(4, texel(SOURCE, 0.5)), background, "alpha 0.5 is cut out");
    let faded = linear(SOURCE.map(|channel| channel * 0.8));
    assert_pixel(particle_light(4, texel(SOURCE, 0.8)), [0, 1, 2].map(|channel| faded[channel] + background[channel]), "alpha 0.8 adds by its alpha in display colour");
}

/// The centre of an opaque Blend sheet 150 units away with one additive particle 100 units away, drawn from an emitter at `priority_plane`, or none.
fn particle_and_blend_sheet(priority_plane: Option<i32>) -> [f32; 3] {
    let Some((device, queue)) = device() else { return [f32::NAN; 3] };
    let mut renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, crate::remaster::Quality::Off, crate::settings::Preset::High.features());
    renderer.textures.insert("sheet".into(), upload(&device, &queue, &crate::texture::Image { width: 1, height: 1, rgba: texel(SOURCE, 1.0).to_vec() }));
    let reach = 600.0;
    let corner = |x: f32, y: f32, u: f32, v: f32| Vertex { position: [x, y, -150.0], normal: [0.0, 0.0, 1.0], uv: [u, v], bones: [0; 4], weights: [1.0, 0.0, 0.0, 0.0] };
    let layer = model::Layer { paint: Paint::Texture("sheet".into()), filter: Filter::Blend, color_slot: 1, unshaded: true, two_sided: true };
    let vertices = vec![corner(-reach, -reach, 0.0, 1.0), corner(reach, -reach, 1.0, 1.0), corner(reach, reach, 1.0, 0.0), corner(-reach, reach, 0.0, 0.0)];
    renderer.add_model("sheet", ModelData { vertices, indices: vec![0, 1, 2, 0, 2, 3], parts: vec![model::Part { color_slot: 0, first_index: 0, index_count: 6, layers: vec![layer] }], rig: Box::new(FlatRig::new([1.0; 4])), emitters: Vec::new(), ribbons: Vec::new(), spawners: Vec::new() });
    let mut scene = Scene { frame: 0, clear: BACKGROUND, ..Scene::default() };
    scene.camera = scene::Camera { view: IDENTITY, eye: [0.0; 3], tangent: 1.0, near: 1.0, far: 10_000.0, sky_far: 10_000.0, rise: 0.0, reach: 0.0 };
    scene.poses = vec![scene::Pose { id: 0, model: "sheet".into(), matrix: IDENTITY, sequence: 0, frame: 0.0, clock: 0.0, alpha: 1.0, color: [1.0; 3], team: TEAM, unit: false }];
    let _ = render(&mut renderer, &device, &queue, &scene);
    if let Some(priority_plane) = priority_plane {
        let view = upload(&device, &queue, &crate::texture::Image { width: 1, height: 1, rgba: texel(FAR, 1.0).to_vec() });
        let spec = Emitter2 { rows: 1, columns: 1, head: true, life_span: 5.0, time: 0.5, scaling: [20.0; 3], alphas: [1.0; 3], colors: [[1.0; 3]; 3], filter_mode: 1, priority_plane, ..Emitter2::default() };
        let emitter = ModelEmitter { spec, paint: Paint::None };
        let slot = renderer.particles.register(&device, &queue, &emitter, ("flame", &view), &renderer.sampler).expect("room for an emitter");
        renderer.particles.begin(stepped(1));
        let sample = EmitterSample { visible: true, rate: 60.0, ..EmitterSample::default() };
        renderer.particles.emit((1, 0), slot, &emitter, &sample, &translation(0.0, 0.0, -100.0), 1.0);
    }
    scene.frame = 1;
    light_at_centre(&mut renderer, &device, &queue, &scene)
}

#[test]
fn a_particle_below_priority_plane_zero_draws_before_the_translucent_layers_that_cover_it() {
    let sheet = particle_and_blend_sheet(None);
    let flame = linear(FAR);
    assert_pixel(particle_and_blend_sheet(Some(-10)), sheet, "the Blood Elf orb's back flames (plane -10) sit behind its opaque Blend sphere");
    assert_pixel(particle_and_blend_sheet(Some(100)), [0, 1, 2].map(|channel| sheet[channel] + flame[channel]), "its front flames (plane 100) add over the sphere");
}
