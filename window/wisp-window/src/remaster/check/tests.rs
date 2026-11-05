use super::*;
use crate::remaster::upscale;

fn scaled(image: &Image, factor: u32) -> Image {
    let (width, height) = (image.width * factor, image.height * factor);
    let mut rgba = Vec::new();
    for y in 0..height {
        for x in 0..width {
            let at = ((y / factor * image.width + x / factor) * 4) as usize;
            rgba.extend_from_slice(&image.rgba[at..at + 4]);
        }
    }
    Image { width, height, rgba }
}

fn noise(size: u32, seed: u32) -> Image {
    let mut state = seed;
    let rgba = (0..size * size)
        .flat_map(|_| {
            state = state.wrapping_mul(1664525).wrapping_add(1013904223);
            let value = (state >> 24) as u8 / 2 + 60;
            [value, value / 2 + 30, 40, 255]
        })
        .collect();
    Image { width: size, height: size, rgba }
}

fn smooth(size: u32) -> Image {
    let rgba = (0..size * size)
        .flat_map(|index| {
            let (x, y) = ((index % size) as f32, (index / size) as f32);
            let value = (128.0 + 70.0 * (x * 0.4).sin() * (y * 0.3).cos()) as u8;
            [value, value / 2 + 40, 60, 255]
        })
        .collect();
    Image { width: size, height: size, rgba }
}

fn red_blue_swapped(image: &Image) -> Image {
    let mut copy = Image { width: image.width, height: image.height, rgba: image.rgba.clone() };
    for pixel in copy.rgba.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }
    copy
}

fn failed(report: &Report, name: &str) -> bool {
    report.failures(&LIMITS).iter().any(|gate| gate.name == name)
}

#[test]
fn seven_degrees_of_hue_fail_a_figure_and_scenery_and_pass_interface_art() {
    let source = smooth(24);
    let mut report = measure(&source, &upscale::steps(&source, 1), false).unwrap();
    report.hue_degrees = 7.0;
    report.saturation = 0.045;
    for role in [Role::Figure, Role::Scenery] {
        let failed: Vec<_> = report.failures(limits_for(role)).iter().map(|gate| gate.name).collect();
        assert_eq!(failed, ["hue", "saturation"], "{role:?}");
    }
    assert!(report.failures(limits_for(Role::Interface)).is_empty(), "{report:?}");
    report.hue_degrees = 8.5;
    assert!(report.failures(limits_for(Role::Interface)).iter().any(|gate| gate.name == "hue"));
}

#[test]
fn a_faithful_enlargement_passes_every_gate() {
    let source = smooth(24);
    let report = measure(&source, &upscale::steps(&source, 1), false).unwrap();
    assert!(report.failures(&LIMITS).is_empty(), "{report:?}");
}

#[test]
fn a_swapped_palette_fails_hue() {
    let source = noise(16, 3);
    let report = measure(&source, &red_blue_swapped(&scaled(&source, 2)), false).unwrap();
    assert!(failed(&report, "hue"), "{report:?}");
}

#[test]
fn invented_texture_fails_detail() {
    let source = Image { width: 16, height: 16, rgba: [100, 100, 100, 255].repeat(256) };
    let mut grit = scaled(&source, 2);
    let mut state = 9u32;
    for pixel in grit.rgba.chunks_exact_mut(4) {
        state = state.wrapping_mul(1664525).wrapping_add(1013904223);
        pixel[..3].fill(70 + ((state >> 24) % 60) as u8);
    }
    let report = measure(&source, &grit, false).unwrap();
    assert!(report.detail_added > LIMITS.detail_added && failed(&report, "detail added"), "{report:?}");
}

#[test]
fn a_moved_mask_fails_alpha() {
    let mut source = noise(16, 5);
    for pixel in source.rgba.chunks_exact_mut(4).take(128) {
        pixel[3] = 0;
    }
    let mut upscaled = scaled(&source, 2);
    for pixel in upscaled.rgba.chunks_exact_mut(4) {
        pixel[3] = 255;
    }
    let report = measure(&source, &upscaled, false).unwrap();
    assert!(report.alpha_moved > 0.4 && failed(&report, "alpha"), "{report:?}");
}

#[test]
fn a_tiling_source_that_stops_tiling_fails_the_seam() {
    let size = 16usize;
    let mut rgba = Vec::new();
    for _ in 0..size {
        for x in 0..size {
            let value = (128.0 + 100.0 * (x as f32 * std::f32::consts::TAU / size as f32).sin()) as u8;
            rgba.extend([value, value, value, 255]);
        }
    }
    let source = Image { width: size as u32, height: size as u32, rgba };
    let faithful = measure(&source, &scaled(&source, 2), true).unwrap();
    assert_eq!(faithful.seam.map(|seam| seam < LIMITS.seam), Some(true), "{faithful:?}");
    let mut cut = scaled(&source, 2);
    let width = cut.width as usize;
    for y in 0..cut.height as usize {
        for x in width - 2..width {
            cut.rgba[(y * width + x) * 4..(y * width + x) * 4 + 3].fill(255);
        }
    }
    assert!(failed(&measure(&source, &cut, true).unwrap(), "seam"));
}

#[test]
fn a_texture_not_sampled_with_wrap_has_no_seam_gate() {
    let size = 16usize;
    let rgba = (0..size * size).flat_map(|index| {
        let value = ((index % size) * 16) as u8;
        [value, value, value, 255]
    });
    let source = Image { width: size as u32, height: size as u32, rgba: rgba.collect() };
    assert_eq!(measure(&source, &scaled(&source, 2), false).unwrap().seam, None);
}

#[test]
fn a_size_that_is_not_a_whole_multiple_is_refused() {
    assert!(measure(&noise(16, 1), &noise(24, 1), false).is_err());
}

#[test]
fn the_most_changed_block_finds_the_edit() {
    let source = noise(32, 7);
    let mut edited = Image { width: 32, height: 32, rgba: source.rgba.clone() };
    for y in 20..28 {
        for x in 4..12 {
            edited.rgba[(y * 32 + x) * 4] = 255;
        }
    }
    let (x, y) = most_changed_block(&source, &edited, 8);
    assert!((x as i32 - 4).abs() <= 2 && (y as i32 - 20).abs() <= 2, "({x}, {y})");
}
