//! What each liquid's surface does over the stand-in stage: the sea carries fine chop inside the style's quiet caps, lava flows visibly within a second or two and stays one molten surface, and a fall takes the sea's colour.

use super::super::clock::SceneClock;

use super::*;

const SIZE: (u32, u32) = (960, 640);

fn luma(rgba: &[u8], x: u32, y: u32) -> f32 {
    let [red, green, blue] = pixel(rgba, SIZE.0, x, y);
    0.2126 * f32::from(red) + 0.7152 * f32::from(green) + 0.0722 * f32::from(blue)
}

fn drawn_at(stage: &mut Stage, scene: &Scene, seconds: f32, label: &str) -> Vec<u8> {
    stage.renderer.clock = SceneClock::At(seconds);
    stage.draw(scene);
    let rgba = stage.read();
    if let Ok(dir) = std::env::var("WISP_WATER_CAPTURE_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        capture::write(&PathBuf::from(dir).join(format!("{label}-{seconds:.1}.png")), SIZE.0, SIZE.1, &rgba).unwrap();
    }
    rgba
}

/// Luma of a block of open water: its standard deviation, its 99th percentile over its median, and its fine detail (the mean luma step from a pixel to the one below it, which broad shading leaves near zero).
pub(super) fn block_spread(rgba: &[u8], x: std::ops::Range<u32>, y: std::ops::Range<u32>) -> (f32, f32, f32) {
    let steps: Vec<f32> = y.clone().flat_map(|row| x.clone().map(move |column| (column, row))).map(|(column, row)| (luma(rgba, column, row + 1) - luma(rgba, column, row)).abs()).collect();
    let detail = steps.iter().sum::<f32>() / steps.len() as f32;
    let mut values: Vec<f32> = y.flat_map(|row| x.clone().map(move |column| (column, row))).map(|(column, row)| luma(rgba, column, row)).collect();
    let count = values.len() as f32;
    let average = values.iter().sum::<f32>() / count;
    let deviation = (values.iter().map(|value| (value - average).powi(2)).sum::<f32>() / count).sqrt();
    values.sort_by(f32::total_cmp);
    (deviation, values[values.len() * 99 / 100] / values[values.len() / 2].max(1.0), detail)
}

/// The least fine detail open water shows once it carries chop.
pub(super) const FINE_DETAIL: f32 = 0.62;

/// Open water on both sides of the deck, below the horizon haze and clear of the shore, the deck and the fighters.
pub(super) const OPEN: [(std::ops::Range<u32>, std::ops::Range<u32>); 2] = [(30..190, 470..630), (770..930, 470..630)];

#[test]
fn the_sea_carries_fine_chop_inside_the_quiet_style() {
    let Some(mut stage) = Stage::new(SIZE) else { return };
    for (facing, name) in [(1.0, "right"), (-1.0, "left")] {
        let rgba = drawn_at(&mut stage, &Stage::scene(facing, Preset::Water), 10.0, &format!("chop-{name}"));
        for (x, y) in OPEN {
            let (deviation, highlight, detail) = block_spread(&rgba, x.clone(), y.clone());
            println!("open water {x:?} {y:?} {name}: luma deviation {deviation:.2}, p99/p50 {highlight:.2}, fine detail {detail:.3}");
            assert!(detail > FINE_DETAIL, "the sea at {x:?} {y:?} should carry fine chop, fine detail {detail:.3}");
            assert!(deviation <= 12.0 && highlight <= 1.75, "the chop stays quiet: deviation {deviation:.2} (at most 12), p99/p50 {highlight:.2} (at most 1.75)");
        }
    }
}

/// The best horizontal shift, in pixels, that lays a band of `first` over `later`.
fn shift_between(first: &[u8], later: &[u8], rows: std::ops::Range<u32>, columns: std::ops::Range<u32>) -> i32 {
    let gap = |shift: i32| {
        let mut total = 0.0;
        for y in rows.clone() {
            for x in columns.clone() {
                total += (luma(first, x, y) - luma(later, (x as i32 + shift) as u32, y)).abs();
            }
        }
        total
    };
    (-40..=40).min_by(|&a, &b| gap(a).total_cmp(&gap(b))).unwrap()
}

#[test]
fn lava_flows_visibly_within_two_seconds() {
    let Some(mut stage) = Stage::new(SIZE) else { return };
    let scene = Stage::scene(1.0, Preset::Lava);
    stage.draw(&scene);
    let first = drawn_at(&mut stage, &scene, 10.0, "lava-flow");
    let later = drawn_at(&mut stage, &scene, 12.0, "lava-flow");
    let moved = shift_between(&first, &later, 470..630, 60..900).abs();
    println!("lava crust moved {moved} px in 2 s");
    assert!(moved >= 6, "the crust should raft at least 6 px in 2 s at the stage camera, moved {moved}");
}

#[test]
fn a_fall_takes_the_colour_of_the_sea_it_falls_into() {
    let Some(mut stage) = Stage::new(SIZE) else { return };
    stage.renderer.add_model(falls::FALL, model(falls::wall(), Paint::Water, Filter::Blend));
    let rgba = drawn_at(&mut stage, &falls::scene_with_fall(), 10.0, "fall-colour");
    let (fall, sea) = (mean(&rgba, SIZE.0, falls::BODY.0, falls::BODY.1), mean(&rgba, SIZE.0, 30..190, 470..630));
    let hue = |[red, green, blue]: [f32; 3]| {
        let (high, low) = (red.max(green).max(blue), red.min(green).min(blue));
        let span = (high - low).max(1e-3);
        let sector = if high == red { (green - blue) / span } else if high == green { 2.0 + (blue - red) / span } else { 4.0 + (red - green) / span };
        (sector * 60.0).rem_euclid(360.0)
    };
    let saturation = |[red, green, blue]: [f32; 3]| { let high = red.max(green).max(blue); (high - red.min(green).min(blue)) / high.max(1.0) };
    println!("fall {fall:?} hue {:.0} saturation {:.2}, sea {sea:?} hue {:.0} saturation {:.2}", hue(fall), saturation(fall), hue(sea), saturation(sea));
    assert!((hue(fall) - hue(sea)).abs() < 20.0, "the fall keeps the sea's hue: fall {fall:?}, sea {sea:?}");
    assert!(saturation(fall) > saturation(sea) * 0.55, "the fall is the sea lightened by its streaks, not a pale white sheet: fall {fall:?}, sea {sea:?}");
}

fn longest_dark_run(rgba: &[u8], width: u32, rows: std::ops::Range<u32>) -> u32 {
    let mut longest = 0;
    for row in rows {
        let mut run = 0;
        for column in 0..width {
            let at = pixel(rgba, width, column, row);
            run = if at.iter().all(|&channel| channel < 135) { run + 1 } else { 0 };
            longest = longest.max(run);
        }
    }
    longest
}

#[test]
fn lava_is_one_molten_surface_and_not_flat_plates_between_cracks() {
    let Some((rendered, size)) = drawn(Preset::Lava, "lava-plates") else { return };
    let rgba = &rendered[0];
    let run = longest_dark_run(rgba, size.0, 440..640);
    assert!(run < 100, "crust never lies as flat plates 100 px wide or more, longest dark run {run}");
    let molten = mean(rgba, size.0, 0..size.0, 440..640);
    assert!(molten[0] > molten[2] * 1.5, "the surface stays warm, got {molten:?}");
}
