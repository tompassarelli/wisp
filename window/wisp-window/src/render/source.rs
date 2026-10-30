//! Where the file formats meet the renderer: MDX bytes become a `ModelData`, texture bytes an `Image`.

use crate::model::{self, global_sequence_frame, Playhead, Pose};

use super::math::Mat4;
use crate::remaster::Quality;

use super::model::{Filter, Layer, ModelData, Paint, Part, Rig, Vertex};
use super::tessellate::tessellate;

const TEAM_COLOR: u32 = 1;
const TEAM_GLOW: u32 = 2;

struct MdxRig {
    model: &'static model::Model,
    playhead: Playhead,
    pose: Pose<'static>,
}

impl Rig for MdxRig {
    fn bone_count(&self) -> usize {
        self.model.nodes.len().max(1)
    }

    fn pose(&mut self, sequence: i32, frame: f32, clock_seconds: f32, out: &mut [Mat4]) {
        self.playhead.set_sequence(self.model, usize::try_from(sequence).ok());
        self.playhead.frame = frame;
        for (index, &length) in self.model.global_sequences.iter().enumerate() {
            self.playhead.set_global_frame(index, global_sequence_frame(clock_seconds, length));
        }
        self.pose.update(&self.playhead);
        let palette = self.pose.matrices();
        let count = palette.len().min(out.len());
        out[..count].copy_from_slice(&palette[..count]);
    }
}

fn paint(model: &model::Model, texture_id: i32) -> Paint {
    let Some(texture) = usize::try_from(texture_id).ok().and_then(|index| model.textures.get(index)) else { return Paint::None };
    match texture.replaceable_id {
        TEAM_COLOR => Paint::TeamColor,
        TEAM_GLOW => Paint::TeamGlow,
        0 if !texture.image.is_empty() => Paint::Texture(texture.image.clone()),
        _ => Paint::None,
    }
}

pub fn model(bytes: &[u8], quality: Quality) -> Result<ModelData, String> {
    let parsed = model::Model::from_mdx(bytes).map_err(|error| error.to_string())?;
    // A model lives as long as the window does, and its pose borrows it, so it is leaked rather than made self-referential.
    let model: &'static model::Model = Box::leak(Box::new(parsed));
    let mut vertices = Vec::new();
    let mut indices = Vec::new();
    let mut parts = Vec::new();
    for geoset in &model.geosets {
        let base = vertices.len() as u32;
        let first_index = indices.len() as u32;
        for (index, skin) in geoset.skin_vertices().map_err(|error| error.to_string())?.into_iter().enumerate() {
            vertices.push(Vertex {
                position: skin.position,
                normal: geoset.normals.get(index).copied().unwrap_or([0.0, 0.0, 1.0]),
                uv: geoset.uvs.get(index).copied().unwrap_or([0.0, 0.0]),
                bones: skin.bones.map(|bone| bone as u16),
                weights: skin.weights,
            });
        }
        indices.extend(geoset.indices.iter().map(|&index| base + index));
        let layers = model
            .materials
            .get(geoset.material_id as usize)
            .map(|material| material.layers.iter().map(|layer| Layer { paint: paint(model, layer.texture_id), filter: Filter::from_index(layer.filter_mode) }).collect())
            .unwrap_or_else(|| vec![Layer { paint: Paint::None, filter: Filter::Opaque }]);
        parts.push(Part { first_index, index_count: indices.len() as u32 - first_index, layers });
    }
    let pose = Pose::new(model, &[]).map_err(|error| error.to_string())?;
    let mut data = ModelData { vertices, indices, parts, rig: Box::new(MdxRig { model, playhead: Playhead::new(model), pose }) };
    tessellate(&mut data, quality.tessellation_levels());
    Ok(data)
}

