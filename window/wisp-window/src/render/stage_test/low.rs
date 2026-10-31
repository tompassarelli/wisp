//! The Low preset on a water stage: the scene draws at one sample per pixel and the sea as flat water, still behind the fighters and unlike the sky.

use super::{pixel, Preset, Stage};
use crate::settings::Water;

#[test]
fn low_draws_the_water_stage_without_multisampling_and_with_flat_water() {
    let low = crate::settings::Preset::Low.features();
    assert_eq!((low.msaa, low.water), (1, Water::Flat));
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
    assert_ne!(sea, sky, "the flat sea should not look like the sky");
    let fighter = pixel(&rgba, size.0, 326, 300);
    assert!(fighter[0] > fighter[2], "the red fighter should stay in front of the water, got {fighter:?}");
}
