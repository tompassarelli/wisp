//! Normal and roughness maps derived from the upscaled albedo. Warcraft textures carry their shading painted in, so luminance stands in for height: a difference of two box blurs keeps edges and cavities and drops the slow colour shifts that would tilt a whole surface, and alpha adds a bevel where a silhouette ends. Roughness is a heuristic, not a measurement: bright high-contrast detail (metal, trim) is smoother, flat dull areas (cloth, skin) rougher.

use crate::texture::Image;

/// Tilt per unit of height; larger is stronger relief.
const STRENGTH: f32 = 2.5;
const FINE_RADIUS: usize = 1;
const COARSE_RADIUS: usize = 5;
const DULL: f32 = 0.85;
const GLOSSIEST: f32 = 0.35;

fn lumas(albedo: &Image) -> Vec<f32> {
    albedo.rgba.chunks_exact(4).map(|pixel| (0.299 * f32::from(pixel[0]) + 0.587 * f32::from(pixel[1]) + 0.114 * f32::from(pixel[2])) / 255.0).collect()
}

fn heights(albedo: &Image, lumas: &[f32]) -> Vec<f32> {
    albedo
        .rgba
        .chunks_exact(4)
        .zip(lumas)
        .map(|(pixel, luma)| {
            let alpha = f32::from(pixel[3]) / 255.0;
            luma * alpha + 0.5 * (1.0 - alpha) + alpha
        })
        .collect()
}

fn blurred(values: &[f32], width: usize, height: usize, radius: usize) -> Vec<f32> {
    let pass = |source: &[f32], horizontal: bool| {
        let (outer, inner) = if horizontal { (height, width) } else { (width, height) };
        let mut out = vec![0.0; source.len()];
        for line in 0..outer {
            let index = |position: usize| if horizontal { line * width + position } else { position * width + line };
            let mut sum = 0.0;
            for position in 0..=radius.min(inner - 1) {
                sum += source[index(position)];
            }
            for position in 0..inner {
                let lo = position.saturating_sub(radius);
                let hi = (position + radius).min(inner - 1);
                if position > 0 && position + radius < inner {
                    sum += source[index(position + radius)];
                }
                if position > radius {
                    sum -= source[index(position - radius - 1)];
                }
                out[index(position)] = sum / (hi - lo + 1) as f32;
            }
        }
        out
    };
    pass(&pass(values, true), false)
}

pub fn derive(albedo: &Image) -> Image {
    let (width, height) = (albedo.width as usize, albedo.height as usize);
    let lumas = lumas(albedo);
    let base = heights(albedo, &lumas);
    let fine = blurred(&base, width, height, FINE_RADIUS);
    let coarse = blurred(&base, width, height, COARSE_RADIUS);
    let detail: Vec<f32> = fine.iter().zip(&coarse).map(|(f, c)| f - c).collect();
    let contrast = blurred(&detail.iter().map(|value| value.abs()).collect::<Vec<_>>(), width, height, COARSE_RADIUS);
    let at = |x: isize, y: isize| detail[y.clamp(0, height as isize - 1) as usize * width + x.clamp(0, width as isize - 1) as usize];
    let mut rgba = Vec::with_capacity(width * height * 4);
    for y in 0..height {
        for x in 0..width {
            let (xi, yi) = (x as isize, y as isize);
            let dx = (at(xi + 1, yi) - at(xi - 1, yi)) * 0.5;
            let dy = (at(xi, yi + 1) - at(xi, yi - 1)) * 0.5;
            let (nx, ny, nz) = (-dx * STRENGTH * width as f32 / 64.0, -dy * STRENGTH * height as f32 / 64.0, 1.0);
            let length = (nx * nx + ny * ny + nz * nz).sqrt();
            let luma = lumas[y * width + x];
            let glossy = (contrast[y * width + x] * 8.0).min(1.0) * (0.4 + 0.6 * luma);
            let roughness = DULL - (DULL - GLOSSIEST) * glossy;
            rgba.extend([nx, ny, nz].map(|component| ((component / length * 0.5 + 0.5) * 255.0 + 0.5) as u8));
            rgba.push((roughness * 255.0 + 0.5) as u8);
        }
    }
    Image { width: albedo.width, height: albedo.height, rgba }
}
