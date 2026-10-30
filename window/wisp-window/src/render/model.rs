//! What the renderer needs of a model, independent of the file format it was read from: `source.rs` fills it from MDX bytes and a texture's bytes.

use super::math::Mat4;

/// One skinned vertex: up to four bones with weights summing to 1.
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct Vertex {
    pub position: [f32; 3],
    pub normal: [f32; 3],
    pub uv: [f32; 2],
    pub bones: [u16; 4],
    pub weights: [f32; 4],
}

/// Warcraft's layer filter modes, in file order.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Filter {
    Opaque,
    Cutout,
    Blend,
    Additive,
    AddAlpha,
    Modulate,
    Modulate2x,
}

pub const FILTERS: [Filter; 7] = [Filter::Opaque, Filter::Cutout, Filter::Blend, Filter::Additive, Filter::AddAlpha, Filter::Modulate, Filter::Modulate2x];

impl Filter {
    pub fn from_index(index: u32) -> Self {
        FILTERS.get(index as usize).copied().unwrap_or(Filter::Opaque)
    }

    pub fn index(self) -> usize {
        self as usize
    }

    pub fn writes_depth(self) -> bool {
        matches!(self, Filter::Opaque | Filter::Cutout)
    }
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Paint {
    Texture(String),
    TeamColor,
    TeamGlow,
    None,
}

pub struct Layer {
    pub paint: Paint,
    pub filter: Filter,
}

/// A run of indices drawn with one material's layers, one draw per layer.
pub struct Part {
    pub first_index: u32,
    pub index_count: u32,
    pub layers: Vec<Layer>,
}

/// Writes one skinning matrix per bone for a sequence and frame, with no allocation once built.
pub trait Rig: Send {
    fn bone_count(&self) -> usize;
    fn pose(&mut self, sequence: i32, frame: f32, clock_ms: f32, out: &mut [Mat4]);
}

pub struct ModelData {
    pub vertices: Vec<Vertex>,
    pub indices: Vec<u32>,
    pub parts: Vec<Part>,
    pub rig: Box<dyn Rig>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_opaque_and_cutout_layers_write_depth() {
        assert!(FILTERS.iter().filter(|filter| filter.writes_depth()).count() == 2);
        assert_eq!(Filter::from_index(3), Filter::Additive);
        assert_eq!(Filter::from_index(99), Filter::Opaque);
    }
}
