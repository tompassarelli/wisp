//! The frame uniform a scene pass reads: the camera, the light, the fog, the lava's glow and the shadow maps' lookups.

use super::liquid::Glow;
use super::math::{mirrored, multiply, projection, IDENTITY};
use super::scene::Scene;
use super::uniforms::{FrameUniform, Lit, SceneFrame};
use super::Renderer;

/// How much of the key light a fighter's own shadow takes: a fighter in its own shadow still reads, as a Warcraft unit does.
pub(super) const FIGHTER_SELF_SHADOW: f32 = 0.35;

/// The shape of the picture a frame is built for: its aspect, the window it fills, the far plane and the target size.
#[derive(Clone, Copy)]
pub(super) struct Viewport {
    pub(super) aspect: f32,
    pub(super) window: f32,
    pub(super) far: f32,
    pub(super) size: (u32, u32),
}

impl Renderer {
    /// `mirror` is set when the frame is the mirrored copy drawn for the reflection, whose geometry below `plane` is cut away; `lit` says how the light and the sun's and the fighters' maps reach what the frame draws.
    pub(super) fn scene_frame(scene: &Scene, view: Viewport, plane: f32, mirror: bool, glow: Glow, lit: Lit) -> SceneFrame {
        let Viewport { aspect, window, far, size } = view;
        let camera = &scene.camera;
        let view = camera.view;
        let (light_toward, light_key, light_ambient) = match (&scene.light, lit) {
            (Some(light), Lit::Ambient | Lit::Sunlit(..)) => ([light.toward[0], light.toward[1], light.toward[2], 0.0], [light.key[0], light.key[1], light.key[2], 1.0], [light.ambient[0], light.ambient[1], light.ambient[2], 0.0]),
            _ => ([0.0, 0.0, 1.0, 0.0], [0.0; 4], [1.0, 1.0, 1.0, 0.0]),
        };
        let (fog_color, fog_range) = match &scene.fog {
            Some(fog) => ([fog.color[0], fog.color[1], fog.color[2], 1.0], [fog.start, fog.end, fog.max, 0.0]),
            None => ([0.0; 4], [0.0, 1.0, 1.0, 0.0]),
        };
        let (sun_projection, shadow, shadow_filter) = match lit {
            Lit::Sunlit(sun, _) => (sun.view_projection, [sun.texel, sun.offset, 1.0, 0.0], [sun.depth_range, sun.light_tan, sun.texel_world, sun.taps]),
            Lit::Unlit | Lit::Ambient => (IDENTITY, [0.0; 4], [0.0; 4]),
        };
        let (fighter_projection, fighter_shadow) = match lit {
            Lit::Sunlit(_, Some(fighters)) => (fighters.view_projection, [fighters.texel, fighters.offset, 1.0, FIGHTER_SELF_SHADOW]),
            _ => (IDENTITY, [0.0; 4]),
        };
        let flat = multiply(&projection(camera.tangent, camera.near, far, aspect, window, camera.rise), &view);
        let view_projection = if mirror { multiply(&flat, &mirrored(plane)) } else { flat };
        let (width, height) = (size.0 as f32, size.1 as f32);
        SceneFrame {
            base: FrameUniform { view_projection, light_toward, light_key, light_ambient, fog_color, fog_range },
            eye: [camera.eye[0], camera.eye[1], camera.eye[2], 0.0],
            camera: [camera.near, far, plane, f32::from(u8::from(mirror))],
            screen: [width, height, 1.0 / width.max(1.0), 1.0 / height.max(1.0)],
            glow: glow.light,
            glow_at: glow.at,
            sun_projection,
            shadow,
            shadow_filter,
            fighter_projection,
            fighter_shadow,
        }
    }
}
