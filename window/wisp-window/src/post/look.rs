//! The final image's look in plain numbers: the AgX tone curve and a stage's grade baked into a 3D lookup table, and the per-frame constants the sky, occlusion and composite shaders read.
//!
//! The curve and the grade live here, on the CPU, so a test can pin what a known HDR value becomes on the display; the composite shader only samples the table.

use bytemuck::{Pod, Zeroable};

use crate::render::DrawScene;

/// Nodes per axis of the lookup table.
pub const LUT_SIZE: u32 = 64;
/// The table spans these exposure values (stops around 1.0) on each axis, log-spaced; node 0 is exactly black.
pub const LUT_MIN_EV: f32 = -10.0;
pub const LUT_MAX_EV: f32 = 6.0;

const AGX_MIN_EV: f32 = -12.47393;
const AGX_MAX_EV: f32 = 4.026069;

/// Lift, gamma and gain per channel and a saturation, applied to the tone-mapped image in display encoding.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct Grade {
    pub lift: [f32; 3],
    pub gamma: [f32; 3],
    pub gain: [f32; 3],
    pub saturation: f32,
}

impl Grade {
    pub const NEUTRAL: Grade = Grade { lift: [0.0; 3], gamma: [1.0; 3], gain: [1.0; 3], saturation: 1.0 };

    /// A stage's grade from its own light: shadows take a little of the ambient colour, highlights a little of the key's, and the saturation that AgX takes out comes back.
    pub fn of_light(key: [f32; 3], ambient: [f32; 3]) -> Grade {
        let tint = |colour: [f32; 3]| {
            let peak = colour[0].max(colour[1]).max(colour[2]).max(1e-4);
            colour.map(|channel| channel / peak - 1.0)
        };
        let (shadow, highlight) = (tint(ambient), tint(key));
        Grade {
            lift: shadow.map(|offset| offset * 0.02),
            gamma: [1.0; 3],
            gain: highlight.map(|offset| 1.0 + offset * 0.12),
            saturation: 1.18,
        }
    }
}

const SRGB_TO_REC2020: [[f32; 3]; 3] = [[0.6274, 0.3293, 0.0433], [0.0691, 0.9195, 0.0113], [0.0164, 0.0880, 0.8956]];
const REC2020_TO_SRGB: [[f32; 3]; 3] = [[1.6605, -0.5876, -0.0728], [-0.1246, 1.1329, -0.0083], [-0.0182, -0.1006, 1.1187]];
const AGX_INSET: [[f32; 3]; 3] = [[0.856627153315983, 0.0951212405381588, 0.0482516061458583], [0.137318972929847, 0.761241990602591, 0.101439036467562], [0.11189821299995, 0.0767994186031903, 0.811302368396859]];
const AGX_OUTSET: [[f32; 3]; 3] = [[1.1271005818144368, -0.11060664309660323, -0.016493938717834573], [-0.1413297634984383, 1.157823702216272, -0.016493938717834257], [-0.14132976349843826, -0.11060664309660294, 1.2519364065950405]];

fn apply(matrix: &[[f32; 3]; 3], v: [f32; 3]) -> [f32; 3] {
    matrix.map(|row| row[0] * v[0] + row[1] * v[1] + row[2] * v[2])
}

fn contrast(x: f32) -> f32 {
    let (x2, x4) = (x * x, x * x * x * x);
    15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232
}

/// AgX (Troy Sobotka's display transform, in the polynomial fit three.js ships): linear Rec.709 scene light in, linear Rec.709 display light out.
pub fn agx(scene: [f32; 3]) -> [f32; 3] {
    let inset = apply(&AGX_INSET, apply(&SRGB_TO_REC2020, scene));
    let curved = inset.map(|channel| contrast(((channel.max(1e-10).log2() - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV)).clamp(0.0, 1.0)));
    apply(&REC2020_TO_SRGB, apply(&AGX_OUTSET, curved).map(|channel| channel.max(0.0).powf(2.2))).map(|channel| channel.clamp(0.0, 1.0))
}

pub fn srgb_encode(linear: f32) -> f32 {
    if linear <= 0.0031308 { linear * 12.92 } else { 1.055 * linear.powf(1.0 / 2.4) - 0.055 }
}

/// Linear scene light to the display's sRGB encoding in 0..1: the curve, then the grade.
pub fn tone_map(scene: [f32; 3], grade: &Grade) -> [f32; 3] {
    let encoded = agx(scene).map(srgb_encode);
    let graded: [f32; 3] = std::array::from_fn(|c| {
        let lifted = grade.gain[c] * (encoded[c] + grade.lift[c] * (1.0 - encoded[c]));
        lifted.max(0.0).powf(1.0 / grade.gamma[c])
    });
    let luma = 0.2126 * graded[0] + 0.7152 * graded[1] + 0.0722 * graded[2];
    graded.map(|channel| (luma + (channel - luma) * grade.saturation).clamp(0.0, 1.0))
}

/// The display bytes of `tone_map`.
pub fn display_bytes(scene: [f32; 3], grade: &Grade) -> [u8; 3] {
    tone_map(scene, grade).map(|channel| (channel * 255.0 + 0.5) as u8)
}

fn node_light(index: u32) -> f32 {
    if index == 0 { 0.0 } else { (LUT_MIN_EV + (LUT_MAX_EV - LUT_MIN_EV) * index as f32 / (LUT_SIZE - 1) as f32).exp2() }
}

/// The table as RGBA8 texels, red varying fastest: node (r, g, b) holds the display colour of the scene light that node stands for.
pub fn build_lut(grade: &Grade) -> Vec<u8> {
    let nodes: Vec<f32> = (0..LUT_SIZE).map(node_light).collect();
    let mut texels = Vec::with_capacity((LUT_SIZE * LUT_SIZE * LUT_SIZE * 4) as usize);
    for &blue in &nodes {
        for &green in &nodes {
            for &red in &nodes {
                let [r, g, b] = display_bytes([red, green, blue], grade);
                texels.extend_from_slice(&[r, g, b, 255]);
            }
        }
    }
    texels
}

/// How strongly each effect of the pass acts.
#[derive(Clone, Copy)]
pub struct Tuning {
    pub exposure: f32,
    pub bloom_threshold: f32,
    pub bloom_knee: f32,
    pub bloom_strength: f32,
    pub occlusion_radius: f32,
    pub occlusion_strength: f32,
    pub occlusion_bias: f32,
}

pub const TUNING: Tuning = Tuning {
    exposure: 1.0,
    bloom_threshold: 1.1,
    bloom_knee: 0.3,
    bloom_strength: 0.3,
    occlusion_radius: 90.0,
    occlusion_strength: 0.7,
    occlusion_bias: 0.03,
};

/// What the shaders read each frame (std140: every member is a vec4).
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct Params {
    right: [f32; 4],
    up: [f32; 4],
    forward: [f32; 4],
    lens: [f32; 4],
    depth: [f32; 4],
    rect: [f32; 4],
    sun_toward: [f32; 4],
    sun_color: [f32; 4],
    zenith: [f32; 4],
    horizon: [f32; 4],
    ground: [f32; 4],
    bloom: [f32; 4],
    occlusion: [f32; 4],
    misc: [f32; 4],
}

fn linear(display: f32) -> f32 {
    if display <= 0.04045 { display / 12.92 } else { ((display + 0.055) / 1.055).powf(2.4) }
}

fn with(rgb: [f32; 3], w: f32) -> [f32; 4] {
    [rgb[0], rgb[1], rgb[2], w]
}

/// Everything one frame's passes need, built from the scene: the camera's rays, the sky's colours from the stage's fog and light, and the grade from the same light.
pub struct Look {
    pub params: Params,
    pub grade: Grade,
    pub occluding: bool,
    pub glowing: bool,
}

impl Look {
    /// `rect` is the picture's rectangle in the target (x, y, width, height); `srgb_surface` says the display encodes what the composite writes.
    pub fn of(scene: &DrawScene, aspect: f32, rect: [f32; 4], srgb_surface: bool, t: &Tuning) -> Look {
        let camera = &scene.camera;
        let v = &camera.view;
        let (key, ambient, toward) = match &scene.light {
            Some(light) => (light.key, light.ambient, light.toward),
            None => ([0.0; 3], [0.5; 3], [0.0, 0.0, 1.0]),
        };
        let clear = if scene.clear == [0.0; 3] { [0.04, 0.06, 0.09] } else { scene.clear };
        let horizon = scene.fog.as_ref().map_or(clear.map(linear), |fog| fog.color.map(linear));
        let peak = ambient[0].max(ambient[1]).max(ambient[2]).max(1e-4);
        let sky_tint = ambient.map(|channel| channel / peak);
        let zenith: [f32; 3] = std::array::from_fn(|c| horizon[c] * (0.30 + 0.35 * sky_tint[c]) + 0.015 * sky_tint[c]);
        let ground = horizon.map(|channel| channel * 0.55);
        let sun_strength = key[0].max(key[1]).max(key[2]);
        let grade = if scene.light.is_some() { Grade::of_light(key, ambient) } else { Grade::NEUTRAL };
        let params = Params {
            right: [v[0], v[4], v[8], 0.0],
            up: [v[1], v[5], v[9], 0.0],
            forward: [-v[2], -v[6], -v[10], 0.0],
            lens: [camera.tangent, camera.tangent / aspect, camera.rise, aspect],
            depth: [camera.near, camera.far, 0.0, 0.0],
            rect,
            sun_toward: with(toward, if sun_strength > 0.0 { 1.0 } else { 0.0 }),
            sun_color: with(key.map(|channel| channel * 1.5), 0.0),
            zenith: with(zenith, 0.0),
            horizon: with(horizon, 0.0),
            ground: with(ground, 0.0),
            bloom: [t.bloom_threshold, t.bloom_knee, t.bloom_strength, 0.0],
            occlusion: [t.occlusion_radius, t.occlusion_strength, t.occlusion_bias, 0.0],
            misc: [scene.frame as f32 / 60.0, if srgb_surface { 1.0 } else { 0.0 }, 0.0, t.exposure],
        };
        Look { params, grade, occluding: t.occlusion_strength > 0.0, glowing: t.bloom_strength > 0.0 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_known_hdr_input_maps_to_the_expected_srgb_bytes() {
        let grade = Grade::NEUTRAL;
        assert_eq!(display_bytes([0.0; 3], &grade), [0, 0, 0]);
        let grey = display_bytes([0.18; 3], &grade);
        assert_eq!(grey[0], grey[1]);
        assert_eq!(grey[1], grey[2]);
        assert!((100..=140).contains(&grey[0]), "scene grey 0.18 lands near the display's middle: {grey:?}");
        let (one, four) = (display_bytes([1.0; 3], &grade)[0], display_bytes([4.0; 3], &grade)[0]);
        assert!(grey[0] < one && one < four && four < 255, "the curve rises and rolls off before white: {grey:?} {one} {four}");
        assert_eq!(display_bytes([64.0; 3], &grade), [255, 255, 255]);
    }

    #[test]
    fn the_curve_keeps_hue_order_and_never_clips_a_hot_colour_to_a_flat_channel() {
        let hot = tone_map([8.0, 2.0, 0.2], &Grade::NEUTRAL);
        assert!(hot[0] > hot[1] && hot[1] > hot[2], "{hot:?}");
        assert!(hot[0] < 1.0 || hot[1] < 0.99, "{hot:?}");
    }

    #[test]
    fn a_grade_lifts_the_shadows_and_tints_the_highlights() {
        let grade = Grade::of_light([1.0, 0.8, 0.5], [0.2, 0.3, 0.6]);
        let neutral = display_bytes([0.02; 3], &Grade::NEUTRAL);
        let tinted = display_bytes([0.02; 3], &grade);
        assert!(tinted[2] > tinted[0], "shadows lean to the ambient blue: {tinted:?} against {neutral:?}");
        let bright = display_bytes([2.0; 3], &grade);
        assert!(bright[0] > bright[2], "highlights lean to the key's warmth: {bright:?}");
    }

    #[test]
    fn the_table_is_black_at_its_origin_and_matches_the_curve_at_a_node() {
        let grade = Grade::of_light([1.0, 0.9, 0.7], [0.3, 0.3, 0.4]);
        let lut = build_lut(&grade);
        assert_eq!(lut.len(), (LUT_SIZE * LUT_SIZE * LUT_SIZE * 4) as usize);
        assert_eq!(&lut[..4], &[0, 0, 0, 255]);
        let (r, g, b) = (40u32, 30u32, 20u32);
        let at = ((b * LUT_SIZE + g) * LUT_SIZE + r) as usize * 4;
        let expected = display_bytes([node_light(r), node_light(g), node_light(b)], &grade);
        assert_eq!(&lut[at..at + 3], &expected);
    }
}
