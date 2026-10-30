use bytemuck::{Pod, Zeroable};

use super::pose::{transform_point, Mat4};
use super::{Geoset, ModelError};

/// One vertex as the skinning vertex shader reads it: four bone ids into the pose palette and their weights.
/// Classic matrix groups load as equal weights over the group's bones, so one skin serves both kinds of model.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct SkinVertex {
    pub position: [f32; 3],
    pub bones: [u32; 4],
    pub weights: [f32; 4],
}

impl Geoset {
    /// The geoset's vertices ready for upload, built once at load.
    pub fn skin_vertices(&self) -> Result<Vec<SkinVertex>, ModelError> {
        let weighted = !self.skin_weights.is_empty();
        self.vertices
            .iter()
            .enumerate()
            .map(|(index, &position)| {
                let (bones, weights) = if weighted { self.four_weights(index) } else { self.group_weights(index)? };
                Ok(SkinVertex { position, bones, weights })
            })
            .collect()
    }

    fn four_weights(&self, index: usize) -> ([u32; 4], [f32; 4]) {
        let row = self.skin_weights.get(index).copied().unwrap_or_default();
        (std::array::from_fn(|i| u32::from(row[i])), std::array::from_fn(|i| f32::from(row[4 + i]) / 255.0))
    }

    fn group_weights(&self, index: usize) -> Result<([u32; 4], [f32; 4]), ModelError> {
        let group = self.vertex_group.get(index).and_then(|&group| self.groups.get(usize::from(group)));
        let group = group.map_or(&[][..], Vec::as_slice);
        if group.len() > 4 {
            return Err(ModelError::GroupTooLarge { vertex: index, bones: group.len() });
        }
        let share = 1.0 / group.len() as f32;
        Ok((std::array::from_fn(|i| group.get(i).copied().unwrap_or(0)), std::array::from_fn(|i| if i < group.len() { share } else { 0.0 })))
    }
}

/// The vertex shader's skin on the CPU: the weighted sum of the vertex moved by each bone's palette matrix.
pub fn skin_position(vertex: &SkinVertex, palette: &[Mat4]) -> [f32; 3] {
    let mut sum = [0.0; 3];
    for (&bone, &weight) in vertex.bones.iter().zip(&vertex.weights) {
        if weight == 0.0 {
            continue;
        }
        let moved = transform_point(&palette[bone as usize], vertex.position);
        for axis in 0..3 {
            sum[axis] += moved[axis] * weight;
        }
    }
    sum
}
