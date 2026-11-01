//! The Low preset on a water stage: the scene draws at one sample per pixel and the sea with Medium's water, its chop as fine, still behind the fighters and unlike the sky.

use super::liquids::{block_spread, FINE_DETAIL, OPEN};
use super::{pixel, Preset, Stage};
use crate::settings::Preset as Quality;

#[test]
fn low_draws_the_water_stage_without_multisampling_and_with_mediums_water() {
    let low = Quality::Low.features();
    assert_eq!((low.msaa, low.water), (1, Quality::Medium.features().water));
    let size = (960, 640);
    let Some(mut stage) = Stage::with(size, low) else { return };
    let scope = stage.device.push_error_scope(wgpu::ErrorFilter::Validation);
    stage.draw(&Stage::scene(1.0, Preset::Water));
    let rgba = stage.read();
    let error = pollster::block_on(scope.pop());
    assert!(error.is_none(), "{error:?}");
    assert_eq!(stage.renderer.samples, 1);
    assert!(stage.renderer.water_level.is_some());
    assert!(stage.renderer.problems.is_empty(), "{:?}", stage.renderer.problems);
    let (sea, sky) = (pixel(&rgba, size.0, 40, 560), pixel(&rgba, size.0, 480, 20));
    assert_ne!(sea, sky, "the sea should not look like the sky");
    let fighter = pixel(&rgba, size.0, 326, 300);
    assert!(fighter[0] > fighter[2], "the red fighter should stay in front of the water, got {fighter:?}");
    for (x, y) in OPEN {
        let (_, _, detail) = block_spread(&rgba, x.clone(), y.clone());
        println!("Low open water {x:?} {y:?}: fine detail {detail:.3}");
        assert!(detail > FINE_DETAIL, "Low's sea at {x:?} {y:?} should carry Medium's chop, fine detail {detail:.3}");
    }
}
