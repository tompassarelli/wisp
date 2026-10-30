//! The plain-data records the renderer uploads to its uniform and instance buffers.

use bytemuck::{Pod, Zeroable};

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
    pub pad: [u32; 3],
}
