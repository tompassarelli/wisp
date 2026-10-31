//! Measured gates on a remastered texture against its Classic source: the upscale must sharpen the concept, never change it.

use image::imageops::{resize, FilterType};
use image::{ImageBuffer, Luma};

use crate::texture::Image;

type Gray = ImageBuffer<Luma<f32>, Vec<f32>>;

const BLOCK: usize = 8;
const SSIM_C1: f32 = 0.01 * 0.01;
const SSIM_C2: f32 = 0.03 * 0.03;
/// A source pixel is in the interior of a mask when every alpha within two pixels of it is within this of its own.
const MASK_FLAT: f32 = 0.1;
/// A source pixel is flat when every luma within two pixels of it is within this of its own.
const DETAIL_FLAT: f32 = 0.02;
/// Below this mean chroma a texture has no palette hue to compare.
const HUE_CHROMA: f32 = 0.04;
const HUE_BINS: usize = 72;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Limits {
    pub hue_degrees: f32,
    pub saturation: f32,
    pub seam: f32,
    pub detail_kept: f32,
    pub detail_added: f32,
    pub alpha_moved: f32,
}

/// Thresholds chosen from the edge-directed filter's outputs over Smashcraft's imported textures (remaster section of native-window-plan.md).
pub const LIMITS: Limits = Limits { hue_degrees: 6.0, saturation: 0.04, seam: 0.02, detail_kept: 0.95, detail_added: 0.01, alpha_moved: 0.02 };

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Report {
    pub hue_degrees: f32,
    pub saturation: f32,
    /// Excess colour step across the wrap edge over the source's, for a texture sampled with wrap; `None` for one that is not.
    pub seam: Option<f32>,
    pub detail_kept: f32,
    pub detail_added: f32,
    pub alpha_moved: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Gate {
    pub name: &'static str,
    pub value: f32,
    pub limit: f32,
}

impl Gate {
    pub fn fails(&self) -> bool {
        if self.name == "detail kept" {
            self.value < self.limit
        } else {
            self.value > self.limit
        }
    }

    /// 1.0 at the limit, growing as the value gets worse.
    pub fn ratio(&self) -> f32 {
        if self.name == "detail kept" {
            (1.0 - self.value) / (1.0 - self.limit).max(1e-6)
        } else {
            self.value / self.limit.max(1e-6)
        }
    }
}

impl Report {
    pub fn gates(&self, limits: &Limits) -> Vec<Gate> {
        let mut all = vec![
            Gate { name: "hue", value: self.hue_degrees, limit: limits.hue_degrees },
            Gate { name: "saturation", value: self.saturation, limit: limits.saturation },
            Gate { name: "detail kept", value: self.detail_kept, limit: limits.detail_kept },
            Gate { name: "detail added", value: self.detail_added, limit: limits.detail_added },
            Gate { name: "alpha", value: self.alpha_moved, limit: limits.alpha_moved },
        ];
        if let Some(seam) = self.seam {
            all.push(Gate { name: "seam", value: seam, limit: limits.seam });
        }
        all
    }

    pub fn failures(&self, limits: &Limits) -> Vec<Gate> {
        self.gates(limits).into_iter().filter(Gate::fails).collect()
    }

    /// The worst gate: the one furthest past its limit, or the one closest to it when none fails.
    pub fn worst(&self, limits: &Limits) -> Gate {
        let gates = self.gates(limits);
        gates.iter().copied().max_by(|a, b| a.ratio().total_cmp(&b.ratio())).expect("every report has gates")
    }
}

fn pixels(image: &Image) -> impl Iterator<Item = [f32; 4]> + '_ {
    image.rgba.chunks_exact(4).map(|pixel| [f32::from(pixel[0]) / 255.0, f32::from(pixel[1]) / 255.0, f32::from(pixel[2]) / 255.0, f32::from(pixel[3]) / 255.0])
}

/// Colour composed over mid grey, so transparent texels carry no colour of their own into a comparison.
fn composed(pixel: [f32; 4]) -> [f32; 3] {
    [0, 1, 2].map(|channel| pixel[channel] * pixel[3] + 0.5 * (1.0 - pixel[3]))
}

fn luma(rgb: [f32; 3]) -> f32 {
    0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]
}

fn gray(image: &Image) -> Gray {
    Gray::from_raw(image.width, image.height, pixels(image).map(|pixel| luma(composed(pixel))).collect()).expect("a full pixel buffer")
}

/// The upscale averaged back to the source's size, in premultiplied alpha so a silhouette edge folds the way it was drawn.
pub fn fold(upscaled: &Image, width: u32, height: u32) -> Result<Image, String> {
    if width == 0 || height == 0 || upscaled.width % width != 0 || upscaled.height % height != 0 || upscaled.width / width != upscaled.height / height {
        return Err(format!("{}x{} is not a whole multiple of {width}x{height}", upscaled.width, upscaled.height));
    }
    let factor = (upscaled.width / width) as usize;
    let (width, height) = (width as usize, height as usize);
    let mut rgba = Vec::with_capacity(width * height * 4);
    for y in 0..height {
        for x in 0..width {
            let mut sum = [0.0f32; 4];
            for dy in 0..factor {
                for dx in 0..factor {
                    let at = ((y * factor + dy) * upscaled.width as usize + x * factor + dx) * 4;
                    let alpha = f32::from(upscaled.rgba[at + 3]) / 255.0;
                    for channel in 0..3 {
                        sum[channel] += f32::from(upscaled.rgba[at + channel]) / 255.0 * alpha;
                    }
                    sum[3] += alpha;
                }
            }
            let alpha = sum[3] / (factor * factor) as f32;
            let scale = if sum[3] > 1e-4 { 1.0 / sum[3] } else { 0.0 };
            rgba.extend([0, 1, 2].map(|channel| to_byte(sum[channel] * scale)));
            rgba.push(to_byte(alpha));
        }
    }
    Ok(Image { width: width as u32, height: height as u32, rgba })
}

fn to_byte(value: f32) -> u8 {
    (value.clamp(0.0, 1.0) * 255.0 + 0.5) as u8
}

struct Palette {
    hues: [f32; HUE_BINS],
    saturation: f32,
    chroma: f32,
}

fn palette(image: &Image) -> Palette {
    let mut hues = [0.0f32; HUE_BINS];
    let (mut chroma_sum, mut value_sum, mut alpha_sum) = (0.0f32, 0.0f32, 0.0f32);
    for pixel in pixels(image) {
        let (high, low) = (pixel[..3].iter().cloned().fold(0.0, f32::max), pixel[..3].iter().cloned().fold(1.0, f32::min));
        let chroma = high - low;
        alpha_sum += pixel[3];
        value_sum += pixel[3] * high;
        chroma_sum += pixel[3] * chroma;
        if chroma > 1e-4 {
            let [r, g, b] = [pixel[0], pixel[1], pixel[2]];
            let sextant = if high == r { ((g - b) / chroma).rem_euclid(6.0) } else if high == g { (b - r) / chroma + 2.0 } else { (r - g) / chroma + 4.0 };
            hues[((sextant / 6.0 * HUE_BINS as f32) as usize).min(HUE_BINS - 1)] += pixel[3] * chroma;
        }
    }
    let weight: f32 = hues.iter().sum();
    if weight > 0.0 {
        hues.iter_mut().for_each(|bin| *bin /= weight);
    }
    Palette { hues, saturation: chroma_sum / value_sum.max(1e-6), chroma: chroma_sum / alpha_sum.max(1e-6) }
}

/// The mean distance in degrees the chroma-weighted hue distribution moved around the colour wheel, which stays stable for a palette of several hues where the mean hue of a distribution does not.
fn hue_shift(before: &[f32; HUE_BINS], after: &[f32; HUE_BINS]) -> f32 {
    let mut running = 0.0f32;
    let mut cumulative = [0.0f32; HUE_BINS];
    for (bin, slot) in cumulative.iter_mut().enumerate() {
        running += after[bin] - before[bin];
        *slot = running;
    }
    let mut sorted = cumulative;
    sorted.sort_by(f32::total_cmp);
    let middle = sorted[HUE_BINS / 2];
    cumulative.iter().map(|value| (value - middle).abs()).sum::<f32>() * 360.0 / HUE_BINS as f32
}

fn palette_drift(source: &Image, folded: &Image) -> (f32, f32) {
    let (before, after) = (palette(source), palette(folded));
    let saturation = (after.saturation - before.saturation).abs();
    if before.chroma < HUE_CHROMA {
        return (0.0, saturation);
    }
    (hue_shift(&before.hues, &after.hues), saturation)
}

fn edge_step(image: &Image, along_x: bool) -> f32 {
    let (width, height) = (image.width as usize, image.height as usize);
    let at = |x: usize, y: usize| composed([0, 1, 2, 3].map(|channel| f32::from(image.rgba[(y * width + x) * 4 + channel]) / 255.0));
    let (mut sum, mut count) = (0.0f32, 0usize);
    let (lines, along) = if along_x { (height, width) } else { (width, height) };
    for line in 0..lines {
        let (a, b) = if along_x { (at(0, line), at(along - 1, line)) } else { (at(line, 0), at(line, along - 1)) };
        sum += (0..3).map(|channel| (a[channel] - b[channel]).abs()).sum::<f32>() / 3.0;
        count += 1;
    }
    sum / count.max(1) as f32
}

fn wrap_step(image: &Image) -> f32 {
    edge_step(image, true).max(edge_step(image, false))
}

fn windows(width: usize, height: usize) -> impl Iterator<Item = (usize, usize, usize, usize)> {
    let (block_w, block_h) = (BLOCK.min(width), BLOCK.min(height));
    let step = (BLOCK / 2).max(1);
    (0..=height - block_h).step_by(step).flat_map(move |y| (0..=width - block_w).step_by(step).map(move |x| (x, y, block_w, block_h)))
}

fn structure_similarity(a: &Gray, b: &Gray) -> f32 {
    let (width, height) = (a.width() as usize, a.height() as usize);
    let (mut total, mut count) = (0.0f32, 0usize);
    for (x, y, block_w, block_h) in windows(width, height) {
        let n = (block_w * block_h) as f32;
        let (mut sa, mut sb, mut saa, mut sbb, mut sab) = (0.0f32, 0.0f32, 0.0f32, 0.0f32, 0.0f32);
        for dy in 0..block_h {
            for dx in 0..block_w {
                let (p, q) = (a.as_raw()[(y + dy) * width + x + dx], b.as_raw()[(y + dy) * width + x + dx]);
                sa += p;
                sb += q;
                saa += p * p;
                sbb += q * q;
                sab += p * q;
            }
        }
        let (ma, mb) = (sa / n, sb / n);
        let (va, vb, cov) = (saa / n - ma * ma, sbb / n - mb * mb, sab / n - ma * mb);
        total += ((2.0 * ma * mb + SSIM_C1) * (2.0 * cov + SSIM_C2)) / ((ma * ma + mb * mb + SSIM_C1) * (va + vb + SSIM_C2));
        count += 1;
    }
    total / count.max(1) as f32
}

/// Whether each pixel of `plane` (row-major, `width` by `height`) is within `tolerance` of every pixel within two of it.
fn flat_pixels(plane: &[f32], width: usize, height: usize, tolerance: f32) -> Vec<bool> {
    let at = |x: isize, y: isize| plane[y.clamp(0, height as isize - 1) as usize * width + x.clamp(0, width as isize - 1) as usize];
    let mut flat = Vec::with_capacity(plane.len());
    for y in 0..height as isize {
        for x in 0..width as isize {
            let centre = at(x, y);
            flat.push((-2..=2).all(|dy| (-2..=2).all(|dx| (at(x + dx, y + dy) - centre).abs() <= tolerance)));
        }
    }
    flat
}

/// Root-mean-square luma the upscale has over a plain Catmull-Rom enlargement of the source, counted only where the source was flat: sharpening a real edge puts nothing there, painting texture the source never had does.
fn detail_added(source: &Image, upscaled: &Image) -> f32 {
    let (width, height) = (source.width as usize, source.height as usize);
    let source_luma = gray(source);
    let flat = flat_pixels(source_luma.as_raw(), width, height, DETAIL_FLAT);
    let reference = resize(&source_luma, upscaled.width, upscaled.height, FilterType::CatmullRom);
    let upscaled_luma = gray(upscaled);
    let factor = upscaled.width as usize / width;
    let (mut sum, mut count) = (0.0f64, 0usize);
    for y in 0..upscaled.height as usize {
        for x in 0..upscaled.width as usize {
            if flat[y / factor * width + x / factor] {
                let at = y * upscaled.width as usize + x;
                sum += f64::from(upscaled_luma.as_raw()[at] - reference.as_raw()[at]).powi(2);
                count += 1;
            }
        }
    }
    if count == 0 { 0.0 } else { (sum / count as f64).sqrt() as f32 }
}

/// How far the upscale moved a mask: the larger of the share of mask-interior pixels whose alpha changed and the relative change in total alpha, so antialiasing a hard edge is not counted but growing, shrinking or filling a mask is.
fn alpha_moved(source: &Image, folded: &Image) -> f32 {
    let (width, height) = (source.width as usize, source.height as usize);
    let alpha = |image: &Image| -> Vec<f32> { image.rgba.chunks_exact(4).map(|pixel| f32::from(pixel[3]) / 255.0).collect() };
    let (before, after) = (alpha(source), alpha(folded));
    let interior = flat_pixels(&before, width, height, MASK_FLAT);
    let (mut inside, mut moved) = (0usize, 0usize);
    for ((&flat, a), b) in interior.iter().zip(&before).zip(&after) {
        if flat {
            inside += 1;
            moved += usize::from((a - b).abs() > MASK_FLAT);
        }
    }
    let (total_before, total_after) = (before.iter().sum::<f32>(), after.iter().sum::<f32>());
    let interior_moved = moved as f32 / inside.max(1) as f32;
    interior_moved.max((total_after - total_before).abs() / total_before.max(1.0))
}

/// Measures `upscaled` against the `source` it came from; the upscale must be a whole multiple of the source's size, and `wraps` says the texture is sampled with wrap, which turns the seam gate on.
pub fn measure(source: &Image, upscaled: &Image, wraps: bool) -> Result<Report, String> {
    let folded = fold(upscaled, source.width, source.height)?;
    let (hue_degrees, saturation) = palette_drift(source, &folded);
    let seam = wraps.then(|| (wrap_step(&folded) - wrap_step(source)).max(0.0));
    Ok(Report {
        hue_degrees,
        saturation,
        seam,
        detail_kept: structure_similarity(&gray(source), &gray(&folded)),
        detail_added: detail_added(source, upscaled),
        alpha_moved: alpha_moved(source, &folded),
    })
}

/// The top-left corner of the `size` x `size` block of source pixels the upscale changed most.
pub fn most_changed_block(source: &Image, folded: &Image, size: usize) -> (usize, usize) {
    let (width, height) = (source.width as usize, source.height as usize);
    let size = size.min(width).min(height);
    let (a, b) = (gray(source), gray(folded));
    let difference: Vec<f32> = a.as_raw().iter().zip(b.as_raw()).map(|(p, q)| (p - q).abs()).collect();
    let step = (size / 4).max(1);
    let mut best = (0.0f32, (0, 0));
    for y in (0..=height - size).step_by(step) {
        for x in (0..=width - size).step_by(step) {
            let sum: f32 = (0..size).map(|dy| difference[(y + dy) * width + x..(y + dy) * width + x + size].iter().sum::<f32>()).sum();
            if sum > best.0 {
                best = (sum, (x, y));
            }
        }
    }
    best.1
}

#[cfg(test)]
mod tests {
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
}
