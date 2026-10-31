//! A lava pool lying over a deck, seen as the match camera sees Blackrock's: its crust colour, its edge and its flow.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use super::{pixel, Stage};
use crate::capture;

/// The deck pool drawn at `seconds` on the game's own camera, written to `WISP_WATER_CAPTURE_DIR` when it names a folder.
fn pooled(label: &str, seconds: f32) -> Option<(Vec<u8>, (u32, u32))> {
    let size = (960, 540);
    let mut stage = Stage::new(size)?;
    stage.renderer.started = if seconds > 0.0 { Instant::now() - Duration::from_secs_f32(seconds) } else { Instant::now() + Duration::from_secs(3600) };
    stage.draw(&Stage::pool_scene());
    assert!(stage.renderer.problems.is_empty(), "{:?}", stage.renderer.problems);
    let rgba = stage.read();
    if let Ok(dir) = std::env::var("WISP_WATER_CAPTURE_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        capture::write(&PathBuf::from(dir).join(format!("{label}.png")), size.0, size.1, &rgba).unwrap();
    }
    Some((rgba, size))
}

fn hue_degrees(at: [u8; 3]) -> f32 {
    let [r, g, b] = at.map(f32::from);
    60.0 * (g - b) / (r - g.min(b)).max(1.0)
}

const POOL_BOX: (std::ops::Range<u32>, std::ops::Range<u32>) = (240..700, 245..330);

#[test]
fn lava_crust_is_dark_red_with_no_grey_or_mauve_in_it() {
    let Some((rgba, size)) = pooled("pool", 0.0) else { return };
    let mut crust = 0;
    for row in POOL_BOX.1 {
        for column in POOL_BOX.0.clone() {
            let at = pixel(&rgba, size.0, column, row);
            if at[0] >= 125 {
                continue;
            }
            let [r, g, b] = at.map(f32::from);
            assert!(r > g * 1.7 && r > b * 2.2, "dark lava stays red, got {at:?} at {column},{row}");
            let hue = hue_degrees(at);
            assert!((0.0..=24.0).contains(&hue), "crust hue stays between red and orange, got {hue} for {at:?} at {column},{row}");
            crust += usize::from(at[2] < 30);
        }
    }
    assert!(crust > 300, "the pool shows dark cooled crust, got {crust} pixels");
}

#[test]
fn a_lava_pool_fades_into_the_deck_at_its_edge_instead_of_ending_as_a_tile() {
    let Some((rgba, size)) = pooled("pool", 0.0) else { return };
    let row = 285;
    let deck = pixel(&rgba, size.0, 200, row);
    let first_left = (200..760).find(|&column| pixel(&rgba, size.0, column, row).iter().zip(deck).any(|(a, b)| a.abs_diff(b) > 6)).expect("the pool starts");
    let first_right = (200..760).rev().find(|&column| pixel(&rgba, size.0, column, row).iter().zip(deck).any(|(a, b)| a.abs_diff(b) > 6)).expect("the pool ends");
    for column in [first_left, first_right] {
        let step = pixel(&rgba, size.0, column, row).iter().zip(deck).map(|(a, b)| a.abs_diff(b)).max().unwrap();
        assert!(step < 45, "the pool's outermost pixel at {column} is within {step} of the deck, not a hard edge");
    }
}

#[test]
fn a_lava_pool_flows_between_two_moments() {
    let (Some((before, size)), Some((after, _))) = (pooled("pool-t0", 0.0), pooled("pool-t0.5", 0.5)) else { return };
    let moved = POOL_BOX.1.flat_map(|row| POOL_BOX.0.clone().map(move |column| (column, row))).filter(|&(column, row)| pixel(&before, size.0, column, row).iter().zip(pixel(&after, size.0, column, row)).any(|(a, b)| a.abs_diff(b) > 20)).count();
    assert!(moved > 800, "half a second moves the melt, got {moved} changed pixels");
}
