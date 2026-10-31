//! The graphics settings on a water stage: each sample count `msaa` asks for, and a scene drawn smaller than the window and stretched over it by the final-image pass.

use std::path::PathBuf;

use super::{pixel, Preset, Stage};
use crate::capture;
use crate::settings::{Features, Preset as Graphics, RenderScale};

/// The water stage drawn once with `features`, checked to raise no validation error and no renderer problem.
fn drawn(features: Features, label: &str) -> Option<(Stage, Vec<u8>)> {
    let size = (960, 640);
    let mut stage = Stage::with(size, features)?;
    let scope = stage.device.push_error_scope(wgpu::ErrorFilter::Validation);
    stage.draw(&Stage::scene(1.0, Preset::Water));
    let rgba = stage.read();
    let error = pollster::block_on(scope.pop());
    assert!(error.is_none(), "{label}: {error:?}");
    assert!(stage.renderer.water_level.is_some());
    assert!(stage.renderer.problems.is_empty(), "{label}: {:?}", stage.renderer.problems);
    if let Ok(dir) = std::env::var("WISP_WATER_CAPTURE_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        capture::write(&PathBuf::from(dir).join(format!("{label}.png")), size.0, size.1, &rgba).unwrap();
    }
    Some((stage, rgba))
}

fn fighter_stands_in_front(rgba: &[u8], label: &str) {
    let fighter = pixel(rgba, 960, 326, 300);
    assert!(fighter[0] > fighter[2], "{label}: the red fighter should stay in front of the water, got {fighter:?}");
}

#[test]
fn each_sample_count_draws_the_scene_at_that_count_where_the_device_offers_it() {
    for msaa in [1, 2, 4] {
        let label = format!("msaa-{msaa}");
        let Some((stage, rgba)) = drawn(Features { msaa, ..Graphics::High.features() }, &label) else { return };
        let offered = stage.renderer.offered_samples & msaa != 0;
        let expected = if msaa == 1 || offered { msaa } else { 4 };
        assert_eq!(stage.renderer.samples, expected, "{label}: the device offers {:#b}", stage.renderer.offered_samples);
        assert_eq!(stage.renderer.targets.as_ref().map(|targets| targets.samples), Some(expected), "{label}: the scene targets hold the count");
        fighter_stands_in_front(&rgba, &label);
    }
}

#[test]
fn a_scene_at_three_quarters_and_at_half_fills_the_window_with_the_same_picture() {
    let at = |percent: u8| drawn(Features { render_scale: RenderScale::Fixed(percent), ..Graphics::High.features() }, &format!("scaled-{percent}"));
    let Some((_, full)) = at(100) else { return };
    for percent in [75, 50] {
        let (stage, scaled) = at(percent).expect("the adapter drew at 100%");
        assert_eq!(stage.renderer.targets.as_ref().map(|targets| targets.size), Some(super::super::targets::scaled((960, 640), percent)));
        fighter_stands_in_front(&scaled, &format!("{percent}%"));
        let sky = (pixel(&full, 960, 480, 20), pixel(&scaled, 960, 480, 20));
        assert!((0..3).all(|channel| sky.0[channel].abs_diff(sky.1[channel]) <= 4), "the sky's colour holds at {percent}%: {sky:?}");
        let mean = full.iter().zip(&scaled).map(|(a, b)| f64::from(a.abs_diff(*b))).sum::<f64>() / full.len() as f64;
        assert!(mean < 6.0, "at {percent}% the picture is the full-size one, softened: mean difference {mean:.2} of 255");
    }
}
