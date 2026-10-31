//! The water's reflection: the scene is mirrored in the widest liquid surface, the far sea shows the sky, and a one-sided layer keeps the faces the camera's own picture keeps, since the mirrored pass reverses every triangle's winding on screen.

use super::*;

#[test]
fn the_far_sea_mirrors_the_sky_and_not_the_clear_colour() {
    let size = (960, 640);
    let Some(mut stage) = Stage::new(size) else { return };
    let scene = Scene { clear: [0.0; 3], ..Stage::scene(1.0, Preset::Water) };
    stage.draw(&scene);
    let rgba = stage.read();
    if let Ok(dir) = std::env::var("WISP_WATER_CAPTURE_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        capture::write(&PathBuf::from(dir).join("far-sea.png"), size.0, size.1, &rgba).unwrap();
    }
    let darkest = |rgba: &[u8]| (300..340).flat_map(|y| (0..280).map(move |x| (x, y))).map(|(x, y)| pixel(&rgba, size.0, x, y).iter().map(|&channel| u32::from(channel)).sum::<u32>()).min().unwrap();
    let (black, white) = (darkest(&rgba), { stage.draw(&Scene { clear: [1.0; 3], ..scene }); darkest(&stage.read()) });
    assert!(black.abs_diff(white) <= 16, "the far sea changes with the clear colour: its darkest pixel sums to {black} over black and {white} over white");
}

/// Tomb of Sargeras lays a narrow water strip at the deck before a wide sea far below it; the scene is mirrored in the sea's plane, so a reflection sits under what it reflects.
#[test]
fn the_scene_is_mirrored_in_the_widest_liquid_surface_at_its_own_height() {
    let Some(mut stage) = Stage::new((320, 200)) else { return };
    stage.renderer.add_model("strip", model(block([-50.0, -60.0, 0.0], [50.0, 60.0, 0.0]), Paint::Water, Filter::Blend));
    let mut scene = Stage::scene(1.0, Preset::Water);
    let mut strip = placed("strip", 0.0, 0.0, 1.0, [1.0; 3]);
    strip.matrix[0] = 12.0;
    scene.poses.insert(0, strip);
    for pose in scene.poses.iter_mut().filter(|pose| pose.model == sea(Preset::Water)) {
        pose.matrix[14] = -360.0;
    }
    stage.draw(&scene);
    assert_eq!(stage.renderer.water_level, Some(-360.0));
}

fn banner(two_sided: bool) -> ModelData {
    let corner = |x: f32, z: f32| vertex([x, 0.0, z], [0.0, -1.0, 0.0]);
    let vertices = vec![corner(-50.0, 40.0), corner(50.0, 40.0), corner(50.0, 180.0), corner(-50.0, 180.0)];
    ModelData { vertices, indices: vec![0, 1, 2, 0, 2, 3], parts: vec![Part { color_slot: 0, first_index: 0, index_count: 6, layers: vec![Layer { paint: Paint::None, filter: Filter::Opaque, color_slot: 1, unshaded: false, two_sided }] }], emitters: Vec::new(), rig: Box::new(Still) }
}

fn drawn_with(sheet: Option<bool>) -> Option<(Vec<u8>, (u32, u32))> {
    let size = (480, 320);
    let mut stage = Stage::new(size)?;
    let mut scene = Stage::scene(1.0, Preset::Water);
    if let Some(two_sided) = sheet {
        stage.renderer.add_model("banner", banner(two_sided));
        scene.poses.push(placed("banner", 0.0, -600.0, 0.0, [0.95, 0.9, 0.2]));
    }
    stage.renderer.started = std::time::Instant::now() + std::time::Duration::from_secs(3600);
    stage.draw(&scene);
    assert!(stage.renderer.problems.is_empty(), "{:?}", stage.renderer.problems);
    let rgba = stage.read();
    if let Ok(dir) = std::env::var("WISP_WATER_CAPTURE_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        crate::capture::write(&std::path::PathBuf::from(dir).join(format!("banner-{sheet:?}.png")), size.0, size.1, &rgba).unwrap();
    }
    Some((rgba, size))
}

fn differing(a: &[u8], b: &[u8]) -> usize {
    a.chunks_exact(4).zip(b.chunks_exact(4)).filter(|(p, q)| p.iter().zip(q.iter()).take(3).any(|(x, y)| x.abs_diff(*y) > 8)).count()
}

#[test]
fn a_one_sided_sheet_facing_the_camera_is_in_the_reflection_as_a_two_sided_one_is() {
    let (Some((none, _)), Some((one_sided, _)), Some((two_sided, size))) = (drawn_with(None), drawn_with(Some(false)), drawn_with(Some(true))) else { return };
    let banner_and_reflection = differing(&none, &two_sided);
    assert!(banner_and_reflection > 0, "the banner is drawn");
    let lower = (size.0 * size.1 / 2 * 4) as usize;
    assert!(differing(&none[lower..], &two_sided[lower..]) > 0, "the banner's reflection reaches the lower half of the picture");
    assert_eq!(differing(&one_sided, &two_sided), 0, "a one-sided banner and its reflection draw as a two-sided one does, since the camera and its mirror both see its front");
}
