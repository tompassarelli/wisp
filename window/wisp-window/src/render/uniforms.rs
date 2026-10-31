//! The plain-data records the renderer uploads to its uniform and instance buffers.

use bytemuck::{Pod, Zeroable};

use super::model::Filter;
use super::math::Mat4;

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

/// The frame the model and water shaders read: the shared six, then the eye, the near and far planes with the water plane, the screen, the glow a lava surface throws on what is above it, and the sun's lookup.
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
