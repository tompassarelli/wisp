//! Edge-directed 2x upscaling. Each output pixel is a Catmull-Rom sample of the source; where the local structure tensor shows one dominant edge direction, the sample is averaged with two more taken along that edge, which smooths stair-steps without blurring across the edge. The result is clamped to the range of the four nearest source pixels, so it never rings or leaves the source's colours. Premultiplied alpha keeps cutout silhouettes free of fringes.

use crate::texture::Image;

type Texel = [f32; 4];

/// How far along the edge the two extra samples sit, in source pixels.
const ALONG_EDGE: f32 = 0.5;
/// How much of the clamp's range the Catmull-Rom overshoot may keep, so edges stay crisp.
const OVERSHOOT: f32 = 0.06;

struct Plane {
    width: usize,
    height: usize,
    texels: Vec<Texel>,
}

impl Plane {
    fn from_image(image: &Image) -> Self {
        let texels = image
            .rgba
            .chunks_exact(4)
            .map(|pixel| {
                let alpha = f32::from(pixel[3]) / 255.0;
                [f32::from(pixel[0]) / 255.0 * alpha, f32::from(pixel[1]) / 255.0 * alpha, f32::from(pixel[2]) / 255.0 * alpha, alpha]
            })
            .collect();
        Self { width: image.width as usize, height: image.height as usize, texels }
    }

    fn into_image(self) -> Image {
        let mut rgba = Vec::with_capacity(self.texels.len() * 4);
        for texel in &self.texels {
            let alpha = texel[3].clamp(0.0, 1.0);
            let scale = if alpha > 1e-4 { 1.0 / alpha } else { 0.0 };
            rgba.extend([0, 1, 2].map(|channel| to_byte(texel[channel] * scale)));
            rgba.push(to_byte(alpha));
        }
        Image { width: self.width as u32, height: self.height as u32, rgba }
    }

    fn at(&self, x: isize, y: isize) -> Texel {
        let x = x.clamp(0, self.width as isize - 1) as usize;
        let y = y.clamp(0, self.height as isize - 1) as usize;
        self.texels[y * self.width + x]
    }

    fn luma(&self, x: isize, y: isize) -> f32 {
        let texel = self.at(x, y);
        0.299 * texel[0] + 0.587 * texel[1] + 0.114 * texel[2] + texel[3]
    }

    fn gradient(&self, x: isize, y: isize) -> (f32, f32) {
        let l = |dx, dy| self.luma(x + dx, y + dy);
        let gx = (l(1, -1) + 2.0 * l(1, 0) + l(1, 1)) - (l(-1, -1) + 2.0 * l(-1, 0) + l(-1, 1));
        let gy = (l(-1, 1) + 2.0 * l(0, 1) + l(1, 1)) - (l(-1, -1) + 2.0 * l(0, -1) + l(1, -1));
        (gx, gy)
    }

    fn cubic(&self, x: f32, y: f32) -> Texel {
        let (fx, fy) = (x.floor(), y.floor());
        let (wx, wy) = (weights(x - fx), weights(y - fy));
        let mut sum = [0.0; 4];
        for (row, wy) in wy.iter().enumerate() {
            for (column, wx) in wx.iter().enumerate() {
                let texel = self.at(fx as isize + column as isize - 1, fy as isize + row as isize - 1);
                for channel in 0..4 {
                    sum[channel] += texel[channel] * wx * wy;
                }
            }
        }
        sum
    }

    fn range(&self, x: f32, y: f32) -> (Texel, Texel) {
        let (fx, fy) = (x.floor() as isize, y.floor() as isize);
        let (mut low, mut high) = ([f32::MAX; 4], [f32::MIN; 4]);
        for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
            let texel = self.at(fx + dx, fy + dy);
            for channel in 0..4 {
                low[channel] = low[channel].min(texel[channel]);
                high[channel] = high[channel].max(texel[channel]);
            }
        }
        (low, high)
    }

    /// The unit direction along the dominant edge near a pixel and how dominant it is, from the structure tensor smoothed over 3x3.
    fn edge(&self, x: isize, y: isize) -> ((f32, f32), f32) {
        let (mut xx, mut xy, mut yy) = (0.0, 0.0, 0.0);
        for dy in -1..=1 {
            for dx in -1..=1 {
                let (gx, gy) = self.gradient(x + dx, y + dy);
                xx += gx * gx;
                xy += gx * gy;
                yy += gy * gy;
            }
        }
        let trace = xx + yy;
        if trace < 1e-3 {
            return ((1.0, 0.0), 0.0);
        }
        let spread = ((xx - yy).powi(2) + 4.0 * xy * xy).sqrt();
        let angle = 0.5 * (2.0 * xy).atan2(xx - yy);
        let across = (angle.cos(), angle.sin());
        ((-across.1, across.0), spread / trace)
    }
}

fn weights(t: f32) -> [f32; 4] {
    let (t2, t3) = (t * t, t * t * t);
    [(-t3 + 2.0 * t2 - t) * 0.5, (3.0 * t3 - 5.0 * t2 + 2.0) * 0.5, (-3.0 * t3 + 4.0 * t2 + t) * 0.5, (t3 - t2) * 0.5]
}

fn to_byte(value: f32) -> u8 {
    (value.clamp(0.0, 1.0) * 255.0 + 0.5) as u8
}

fn doubled(source: &Plane) -> Plane {
    let (width, height) = (source.width * 2, source.height * 2);
    let mut texels = Vec::with_capacity(width * height);
    for oy in 0..height {
        let sy = oy as f32 / 2.0 - 0.25;
        for ox in 0..width {
            let sx = ox as f32 / 2.0 - 0.25;
            let ((tx, ty), coherence) = source.edge(sx.round() as isize, sy.round() as isize);
            let plain = source.cubic(sx, sy);
            let weight = coherence * coherence;
            let (low, high) = source.range(sx, sy);
            let mut texel = plain;
            if weight > 0.01 {
                let (a, b) = (source.cubic(sx - tx * ALONG_EDGE, sy - ty * ALONG_EDGE), source.cubic(sx + tx * ALONG_EDGE, sy + ty * ALONG_EDGE));
                for channel in 0..4 {
                    texel[channel] = plain[channel] + (0.5 * (a[channel] + b[channel]) - plain[channel]) * weight;
                }
            }
            for channel in 0..4 {
                let slack = (high[channel] - low[channel]) * OVERSHOOT;
                texel[channel] = texel[channel].clamp(low[channel] - slack, high[channel] + slack).max(0.0);
            }
            texels.push(texel);
        }
    }
    Plane { width, height, texels }
}

pub fn steps(image: &Image, count: u32) -> Image {
    let mut plane = Plane::from_image(image);
    for _ in 0..count {
        plane = doubled(&plane);
    }
    plane.into_image()
}
