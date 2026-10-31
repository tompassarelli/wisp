//! The final image's look in plain numbers: the AgX tone curve and a stage's grade baked into a 3D lookup table, and the per-frame constants the sky, occlusion and composite shaders read.
//!
//! The curve and the grade live here, on the CPU, so a test can pin what a known HDR value becomes on the display; the composite shader only samples the table.

use bytemuck::{Pod, Zeroable};

use crate::render::DrawScene;

/// Nodes per axis of the lookup table.
pub const LUT_SIZE: u32 = 32;

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

/// The display light for `scene` that keeps its hue: AgX's grey ramp is applied to the brightest channel and every channel is scaled by the same factor, so a bright saturated colour (a golden column of light, fel green) stays that colour instead of sliding to white as AgX's per-channel curve takes it.
pub fn hue_keeping(scene: [f32; 3]) -> [f32; 3] {
    let peak = scene[0].max(scene[1]).max(scene[2]);
    if peak <= 1e-6 {
        return [0.0; 3];
    }
    let scale = agx([peak; 3])[0] / peak;
    scene.map(|channel| (channel * scale).clamp(0.0, 1.0))
}

pub fn srgb_encode(linear: f32) -> f32 {
    if linear <= 0.0031308 { linear * 12.92 } else { 1.055 * linear.powf(1.0 / 2.4) - 0.055 }
}

/// The grade applied to display-encoded colour in 0..1: lift, gain and gamma per channel, then saturation.
pub fn grade_display(encoded: [f32; 3], grade: &Grade) -> [f32; 3] {
    let graded: [f32; 3] = std::array::from_fn(|c| {
        let lifted = grade.gain[c] * (encoded[c] + grade.lift[c] * (1.0 - encoded[c]));
        lifted.max(0.0).powf(1.0 / grade.gamma[c])
    });
    let luma = 0.2126 * graded[0] + 0.7152 * graded[1] + 0.0722 * graded[2];
    graded.map(|channel| (luma + (channel - luma) * grade.saturation).clamp(0.0, 1.0))
}

/// Linear scene light to the display's sRGB encoding in 0..1: the hue-keeping curve, then the grade.
pub fn tone_map(scene: [f32; 3], grade: &Grade) -> [f32; 3] {
    grade_display(hue_keeping(scene).map(srgb_encode), grade)
}

/// The display bytes of `tone_map`.
pub fn display_bytes(scene: [f32; 3], grade: &Grade) -> [u8; 3] {
    tone_map(scene, grade).map(|channel| (channel * 255.0 + 0.5) as u8)
}

/// The table as RGBA8 texels, red varying fastest: node (r, g, b) holds the grade of the display colour whose channels are the nodes' positions on 0..1. The curve runs in the shader, so only the smooth grade is interpolated.
pub fn build_lut(grade: &Grade) -> Vec<u8> {
    let nodes: Vec<f32> = (0..LUT_SIZE).map(|index| index as f32 / (LUT_SIZE - 1) as f32).collect();
    let mut texels = Vec::with_capacity((LUT_SIZE * LUT_SIZE * LUT_SIZE * 4) as usize);
    for &blue in &nodes {
        for &green in &nodes {
            for &red in &nodes {
                let [r, g, b] = grade_display([red, green, blue], grade).map(|channel| (channel * 255.0 + 0.5) as u8);
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
    pub contact_strength: f32,
    pub contact_reach: f32,
    pub cloud_layers: u32,
}

pub const TUNING: Tuning = Tuning {
    exposure: 1.0,
    bloom_threshold: 1.1,
    bloom_knee: 0.3,
    bloom_strength: 0.3,
    occlusion_radius: 90.0,
    occlusion_strength: 1.0,
    contact_strength: 0.7,
    contact_reach: 45.0,
    cloud_layers: 3,
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
    cloud: [f32; 4],
    eye: [f32; 4],
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
    pub clouded: bool,
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
        let sun_strength = key[0].max(key[1]).max(key[2]);
        let look = scene.sky_look;
        let zenith: [f32; 3] = match look {
            Some(look) => look.zenith.map(linear),
            None => std::array::from_fn(|c| horizon[c] * (0.30 + 0.35 * sky_tint[c]) + 0.015 * sky_tint[c]),
        };
        let (toward, sun_color, sun_on) = match look {
            Some(look) => {
                let (azimuth, elevation) = (look.sun_azimuth.to_radians(), look.sun_elevation.to_radians());
                ([elevation.cos() * azimuth.cos(), elevation.cos() * azimuth.sin(), elevation.sin()], look.sun.map(linear), 1.0)
            }
            None => (toward, key.map(|channel| channel * 1.5), if sun_strength > 0.0 { 1.0 } else { 0.0 }),
        };
        let (cover, stars, glow) = look.map_or((0.0, 0.0, 0.0), |look| (look.cover, look.stars, look.glow));
        let ground = horizon.map(|channel| channel * 0.55);
        let grade = if scene.light.is_some() { Grade::of_light(key, ambient) } else { Grade::NEUTRAL };
        let params = Params {
            right: [v[0], v[4], v[8], 0.0],
            up: [v[1], v[5], v[9], 0.0],
            forward: [-v[2], -v[6], -v[10], 0.0],
            lens: [camera.tangent, camera.tangent / aspect, camera.rise, aspect],
            depth: [camera.near, camera.far, 0.0, 0.0],
            rect,
            sun_toward: with(toward, sun_on),
            sun_color: with(sun_color, 0.0),
            zenith: with(zenith, 0.0),
            horizon: with(horizon, 0.0),
            ground: with(ground, 0.0),
            bloom: [t.bloom_threshold, t.bloom_knee, t.bloom_strength, 0.0],
            occlusion: [t.occlusion_radius, t.occlusion_strength, 0.0, t.contact_strength],
            misc: [scene.frame as f32 / 60.0, if srgb_surface { 1.0 } else { 0.0 }, t.contact_reach, t.exposure],
            cloud: [cover, stars, glow, if cover > 0.0 { t.cloud_layers as f32 } else { 0.0 }],
            eye: with(camera.eye, 0.0),
        };
        Look { params, grade, occluding: t.occlusion_strength > 0.0 || t.contact_strength > 0.0, glowing: t.bloom_strength > 0.0, clouded: cover > 0.0 && t.cloud_layers > 0 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sky_scene(cover: f32) -> DrawScene {
        let look = format!(r#"{{"zenith":[0.1,0.2,0.4],"cover":{cover},"sunAzimuth":90,"sunElevation":30,"sun":[1,0.5,0.25],"stars":0.5,"glow":0.25}}"#);
        let mut scene = DrawScene::default();
        scene.sky_look = Some(serde_json::from_str(&look).unwrap());
        scene
    }

    #[test]
    fn a_stages_sky_look_sets_the_sun_the_zenith_and_how_many_cloud_layers_draw() {
        let rect = [0.0, 0.0, 64.0, 64.0];
        let look = Look::of(&sky_scene(0.5), 1.0, rect, false, &TUNING);
        let toward = look.params.sun_toward;
        assert!(toward[0].abs() < 1e-5 && (toward[1] - 0.866).abs() < 1e-3 && (toward[2] - 0.5).abs() < 1e-3 && toward[3] == 1.0, "{toward:?}");
        assert!((look.params.zenith[2] - linear(0.4)).abs() < 1e-6);
        assert_eq!(look.params.cloud, [0.5, 0.5, 0.25, 3.0]);
        assert!(look.clouded);
        let low = Look::of(&sky_scene(0.5), 1.0, rect, false, &Tuning { cloud_layers: 1, ..TUNING });
        assert_eq!(low.params.cloud[3], 1.0);
        assert!(!Look::of(&sky_scene(0.0), 1.0, rect, false, &TUNING).clouded, "a stage with no cloud draws no cloud pass");
        assert!(!Look::of(&DrawScene::default(), 1.0, rect, false, &TUNING).clouded, "a map that sets no sky look keeps the plain gradient");
    }

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
    fn a_bright_saturated_colour_keeps_its_hue_through_the_curve() {
        let saturation = |rgb: [f32; 3]| (rgb[0].max(rgb[1]).max(rgb[2]) - rgb[0].min(rgb[1]).min(rgb[2])) / rgb[0].max(rgb[1]).max(rgb[2]);
        for gold in [[1.0, 0.78, 0.2], [4.0, 3.1, 0.8], [16.0, 12.5, 3.2]] {
            let shown = tone_map(gold, &Grade::NEUTRAL);
            assert!(shown[0] >= shown[1] && shown[1] > shown[2], "gold keeps its channel order: {shown:?}");
            assert!(saturation(shown) > 0.4, "{gold:?} stays gold, not white: {shown:?}");
        }
        let fel = tone_map([2.0, 8.0, 1.0], &Grade::NEUTRAL);
        assert!(fel[1] > fel[0] * 1.3 && fel[1] > fel[2] * 1.8, "fel green stays green: {fel:?}");
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
        let (r, g, b) = (25u32, 18u32, 9u32);
        let at = ((b * LUT_SIZE + g) * LUT_SIZE + r) as usize * 4;
        let node = |index: u32| index as f32 / (LUT_SIZE - 1) as f32;
        let expected = grade_display([node(r), node(g), node(b)], &grade).map(|channel| (channel * 255.0 + 0.5) as u8);
        assert_eq!(&lut[at..at + 3], &expected);
    }
}
