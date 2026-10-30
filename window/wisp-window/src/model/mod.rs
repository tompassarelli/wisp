//! Warcraft III models as the native renderer loads them: parsed once into plain data, posed per frame into a bone palette
//! the vertex shader skins with (wisp:docs/native-window-plan.md, box W3, "Models").

mod mdl;
mod mdx;
mod pose;
mod skin;
mod track;

use std::fmt;

pub use pose::{Mat4, Playhead, Pose};
pub use skin::{skin_position, SkinVertex};
pub use track::{global_sequence_frame, rotate, sample, Key, LineType, Track};

#[derive(Clone, Debug, PartialEq)]
pub struct Sequence {
    pub name: String,
    pub interval: [u32; 2],
    pub non_looping: bool,
    pub move_speed: f32,
    pub rarity: f32,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Node {
    pub name: String,
    pub object_id: usize,
    pub parent: Option<usize>,
    pub flags: u32,
    pub pivot: [f32; 3],
    pub translation: Option<Track<3>>,
    pub rotation: Option<Track<4>>,
    pub scaling: Option<Track<3>>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Geoset {
    pub vertices: Vec<[f32; 3]>,
    pub vertex_group: Vec<u8>,
    pub groups: Vec<Vec<u32>>,
    pub skin_weights: Vec<[u8; 8]>,
    pub normals: Vec<[f32; 3]>,
    pub uvs: Vec<[f32; 2]>,
    /// A triangle list; strips and fans other than triangles are not read.
    pub indices: Vec<u32>,
    pub material_id: u32,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Layer {
    pub filter_mode: u32,
    pub texture_id: i32,
    pub shading_flags: u32,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Material {
    pub layers: Vec<Layer>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Texture {
    pub replaceable_id: u32,
    pub image: String,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Model {
    pub version: u32,
    pub sequences: Vec<Sequence>,
    pub global_sequences: Vec<u32>,
    pub geosets: Vec<Geoset>,
    pub nodes: Vec<Option<Node>>,
    pub materials: Vec<Material>,
    pub textures: Vec<Texture>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ModelError {
    Truncated { at: usize },
    Keyword { expected: &'static str, at: usize },
    Syntax { expected: &'static str, at: usize },
    Chunk { chunk: &'static str, reason: &'static str },
    MissingParent { node: usize, parent: usize },
    ParentCycle { node: usize },
    GroupTooLarge { vertex: usize, bones: usize },
}

impl fmt::Display for ModelError {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Truncated { at } => write!(out, "model data ends early at byte {at}"),
            Self::Keyword { expected, at } => write!(out, "expected keyword {expected} at byte {at}"),
            Self::Syntax { expected, at } => write!(out, "expected {expected} at byte {at}"),
            Self::Chunk { chunk, reason } => write!(out, "chunk {chunk}: {reason}"),
            Self::MissingParent { node, parent } => write!(out, "node {node} names parent {parent}, which the model does not define"),
            Self::ParentCycle { node } => write!(out, "node {node} is its own ancestor"),
            Self::GroupTooLarge { vertex, bones } => write!(out, "vertex {vertex} is skinned to {bones} bones; the palette skin takes four"),
        }
    }
}

impl std::error::Error for ModelError {}

impl Model {
    /// Parses an MDX (`MDLX`) file.
    pub fn from_mdx(bytes: &[u8]) -> Result<Self, ModelError> {
        mdx::parse(bytes)
    }

    /// Parses an MDL text file.
    pub fn from_mdl(text: &str) -> Result<Self, ModelError> {
        mdl::parse(text)
    }

    pub(crate) fn node(&self, id: usize) -> Option<&Node> {
        self.nodes.get(id).and_then(Option::as_ref)
    }

    pub(crate) fn finish(mut self, pivots: &[[f32; 3]]) -> Result<Self, ModelError> {
        for node in self.nodes.iter_mut().flatten() {
            node.pivot = pivots.get(node.object_id).copied().unwrap_or_default();
        }
        for node in self.nodes.iter().flatten() {
            if let Some(parent) = node.parent {
                if self.node(parent).is_none() {
                    return Err(ModelError::MissingParent { node: node.object_id, parent });
                }
            }
        }
        Ok(self)
    }

    pub(crate) fn insert_node(&mut self, node: Node) {
        if self.nodes.len() <= node.object_id {
            self.nodes.resize(node.object_id + 1, None);
        }
        let id = node.object_id;
        self.nodes[id] = Some(node);
    }
}
