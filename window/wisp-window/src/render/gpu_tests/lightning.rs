use super::*;

const WIDE: u32 = 256;
const TEXTURE: &str = "textures\\stripes.blp";

fn stripes() -> crate::texture::Image {
    let mut rgba = Vec::new();
    for row in 0..8 {
        let across = ((row as f32 + 0.5) / 8.0 - 0.5).abs() * 2.0;
        for column in 0..16 {
            let level = if (column / 4) % 2 == 0 { 1.0 - across } else { 0.0 };
            rgba.extend([(level * 255.0) as u8, (level * 255.0) as u8, (level * 255.0) as u8, 255]);
        }
    }
    crate::texture::Image { width: 16, height: 8, rgba }
}

fn bolt_scene(look: bool) -> Scene {
    let look = if look { r#","look":{"texture":"Textures\\Stripes.blp","width":12,"segment":40,"noise":0,"scale":1,"color":[1,1,1]}"#.to_string() } else { String::new() };
    let mut scene = Scene { frame: 3, ..Scene::default() };
    scene.camera = scene::Camera { view: IDENTITY, eye: [0.0; 3], tangent: 1.0, near: 1.0, far: 10_000.0, sky_far: 10_000.0, rise: 0.0, reach: 0.0 };
    scene.lightnings = serde_json::from_str(&format!(r#"[{{"from":[-80,0,-100],"to":[80,0,-100],"color":[1,1,1,1]{look}}}]"#)).expect("a bolt");
    scene
}

fn level(image: &[u8], x: u32, y: u32) -> u32 {
    let at = ((y * WIDE + x) * 4) as usize;
    image[at..at + 3].iter().map(|&channel| u32::from(channel)).sum::<u32>() / 3
}

fn brightest(image: &[u8], x: u32) -> (u32, u32) {
    (WIDE / 2 - 3..=WIDE / 2 + 3).map(|y| (level(image, x, y), y)).max().expect("rows")
}

#[test]
fn a_bolt_draws_its_types_texture_along_and_across_the_ribbon() {
    let Some((device, queue)) = device() else { return };
    let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
    let mut renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, crate::remaster::Quality::Off, crate::settings::Preset::High.features());
    renderer.textures.insert(TEXTURE.into(), upload(&device, &queue, &stripes()));
    let image = render_at(&mut renderer, &device, &queue, &bolt_scene(true), WIDE);
    let along: Vec<u32> = (40..WIDE - 40).map(|x| brightest(&image, x).0).collect();
    let (mut bright, mut changes) = (false, 0);
    for &value in &along {
        if !bright && value > 120 {
            bright = true;
            changes += 1;
        } else if bright && value < 40 {
            bright = false;
            changes += 1;
        }
    }
    assert!(changes >= 8, "the texture's stripes run along the bolt: {changes} changes in {along:?}");
    let column = (40..WIDE - 40).max_by_key(|&x| brightest(&image, x).0).expect("columns");
    let (centre, row) = brightest(&image, column);
    let edge = level(&image, column, row - 6).max(level(&image, column, row + 6));
    assert!(centre > 120 && edge * 2 < centre, "the texture fades across the bolt: {centre} in the middle, {edge} near the edge");
    assert!(renderer.problems.is_empty(), "{:?}", renderer.problems);
    let error = pollster::block_on(scope.pop());
    assert!(error.is_none(), "wgpu validation: {error:?}");
}

#[test]
fn a_bolt_whose_texture_is_missing_draws_the_plain_strip_and_reports_it_once() {
    let Some((device, queue)) = device() else { return };
    let mut renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, crate::remaster::Quality::Off, crate::settings::Preset::High.features());
    let first = render_at(&mut renderer, &device, &queue, &bolt_scene(true), WIDE);
    let mut scene = bolt_scene(true);
    scene.frame = 4;
    render_at(&mut renderer, &device, &queue, &scene, WIDE);
    let plain = render_at(&mut renderer, &device, &queue, &bolt_scene(false), WIDE);
    let lit = |image: &[u8]| (0..WIDE).filter(|&y| (40..WIDE - 40).any(|x| level(image, x, y) > 150)).count();
    assert!(lit(&first) > 0 && lit(&first) == lit(&plain), "the strip stands in: {} against {}", lit(&first), lit(&plain));
    let reports = renderer.problems.iter().filter(|problem| problem.contains("Textures\\Stripes.blp")).count();
    assert_eq!(reports, 1, "{:?}", renderer.problems);
}
