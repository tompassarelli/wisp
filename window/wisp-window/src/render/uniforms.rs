//! The plain-data records the renderer uploads to its uniform and instance buffers.

use bytemuck::{Pod, Zeroable};

use super::math::{mirrored, multiply, projection, Mat4, IDENTITY};
use super::model::Filter;
use super::scene::Scene;
use super::water::Glow;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct FrameUniform {
    pub view_projection: Mat4,
    pub light_toward: [f32; 4],
    pub light_key: [f32; 4],
    pub light_ambient: [f32; 4],
    pub fog_color: [f32; 4],
    pub fog_range: [f32; 4],
}

/// The frame the model and water shaders read: the shared six, then the eye, the near and far planes with the water plane, the screen, the glow a lava surface throws on what is above it, the sun's lookup and the point lights'.
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct SceneFrame {
    pub base: FrameUniform,
    pub eye: [f32; 4],
    pub camera: [f32; 4],
    pub screen: [f32; 4],
    pub glow: [f32; 4],
    pub glow_at: [f32; 4],
    pub sun_projection: Mat4,
    pub shadow: [f32; 4],
    pub points: PointLights,
}

/// What the shader needs to look a world position up in the sun's map.
pub struct Sun {
    pub view_projection: Mat4,
    pub texel: f32,
    /// World units a receiver is pushed along its normal before the lookup, one and a half texels.
    pub offset: f32,
}

/// How a frame lights what it draws: the sky is drawn as its textures are, and only a sunlit frame holds a shadow map to look up.
#[derive(Clone, Copy)]
pub enum Lit<'a> {
    Unlit,
    Ambient,
    Sunlit(&'a Sun),
}

/// What the light does to a layer: nothing for the glowing and modulating layers whose colours are the effect and for layers the model marks unshaded, the key and ambient for translucent ones, and shadows and a rim as well for the solid ones.
pub fn lighting_of(filter: Filter, unshaded: bool) -> u32 {
    if unshaded {
        return 0;
    }
    match filter {
        Filter::Opaque | Filter::Cutout => 2,
        Filter::Blend => 1,
        Filter::Additive | Filter::AddAlpha | Filter::Modulate | Filter::Modulate2x => 0,
    }
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct Instance {
    pub model: Mat4,
    pub tint: [f32; 4],
    pub team: [f32; 4],
    /// Where the pose's bone matrices and opacities begin in their storage buffers.
    pub base: [u32; 2],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct LayerUniform {
    pub kind: u32,
    pub cutoff: f32,
    pub geoset_slot: u32,
    pub layer_slot: u32,
    pub ignores_texture_alpha: u32,
    pub lighting: u32,
    pub pad: [u32; 2],
}

impl super::Renderer {
    /// `mirror` is set when the frame is the mirrored copy drawn for the reflection, whose geometry below `plane` is cut away; `lit` says how the light and the sun's map reach what the frame draws.
    pub(super) fn scene_frame(scene: &Scene, aspect: f32, window: f32, far: f32, size: (u32, u32), plane: f32, mirror: bool, glow: Glow, lit: Lit) -> SceneFrame {
        let camera = &scene.camera;
        let view = camera.view;
        let (light_toward, light_key, light_ambient) = match (&scene.light, lit) {
            (Some(light), Lit::Ambient | Lit::Sunlit(_)) => ([light.toward[0], light.toward[1], light.toward[2], 0.0], [light.key[0], light.key[1], light.key[2], 1.0], [light.ambient[0], light.ambient[1], light.ambient[2], 0.0]),
            _ => ([0.0, 0.0, 1.0, 0.0], [0.0; 4], [1.0, 1.0, 1.0, 0.0]),
        };
        let (fog_color, fog_range) = match &scene.fog {
            Some(fog) => ([fog.color[0], fog.color[1], fog.color[2], 1.0], [fog.start, fog.end, fog.max, 0.0]),
            None => ([0.0; 4], [0.0, 1.0, 1.0, 0.0]),
        };
        let (sun_projection, shadow) = match lit {
            Lit::Sunlit(sun) => (sun.view_projection, [sun.texel, sun.offset, 1.0, 0.0]),
            Lit::Unlit | Lit::Ambient => (IDENTITY, [0.0; 4]),
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
            points: PointLights::zeroed(),
        }
    }
}

pub const MAX_LIT: usize = 16;

/// What the model shader reads of the lights: `counts` is the lit lights, the shadowed ones among them (the first), two over a cube's side in texels and the near plane.
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct PointLights {
    pub counts: [f32; 4],
    /// Position and the reach.
    pub position: [[f32; 4]; MAX_LIT],
    /// Colour times intensity, and the distance inside which it is at full strength.
    pub color: [[f32; 4]; MAX_LIT],
}
