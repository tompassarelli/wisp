use bytemuck::{Pod, Zeroable};

use super::pose::{transform_point, Mat4};
use super::{Geoset, Model};

/// One vertex as the skinning vertex shader reads it: four bone ids into the pose palette and their weights.
/// Classic matrix groups load as equal weights over the group's bones, so one skin serves both kinds of model.
/// A group of more than four bones is one blend entry of the palette (see `Blends`), so its vertices still name one bone.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct SkinVertex {
    pub position: [f32; 3],
    pub bones: [u32; 4],
    pub weights: [f32; 4],
}

/// The palette entries after the nodes' that stand for matrix groups of more than four bones: entry `k` sits at palette index
/// `first + k` and is the mean of the group's node matrices, which skins exactly as the equal-weight sum of them would.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Blends {
    first: u32,
    groups: Vec<Vec<u32>>,
}

const MAX_DIRECT: usize = 4;

impl Model {
    pub fn blends(&self) -> Blends {
        let mut blends = Blends { first: self.nodes.len() as u32, groups: Vec::new() };
        for group in self.geosets.iter().flat_map(|geoset| &geoset.groups).filter(|group| group.len() > MAX_DIRECT) {
            if !blends.groups.contains(group) {
                blends.groups.push(group.clone());
            }
        }
        blends
    }
}

impl Blends {
    pub fn len(&self) -> usize {
        self.groups.len()
    }

    pub fn is_empty(&self) -> bool {
        self.groups.is_empty()
    }

    fn slot(&self, group: &[u32]) -> Option<u32> {
        self.groups.iter().position(|blend| blend == group).map(|at| self.first + at as u32)
    }

    /// Writes each blend's mean matrix into `palette` after the node matrices.
    pub fn write(&self, palette: &mut [Mat4]) {
        for (at, group) in self.groups.iter().enumerate() {
            let mut sum = [0.0f32; 16];
            for matrix in group.iter().filter_map(|&bone| palette.get(bone as usize)) {
                sum.iter_mut().zip(matrix).for_each(|(total, value)| *total += value);
            }
            let share = 1.0 / group.len() as f32;
            if let Some(out) = palette.get_mut(self.first as usize + at) {
                *out = sum.map(|value| value * share);
            }
        }
    }
}

impl Geoset {
    /// The geoset's vertices ready for upload, built once at load.
    pub fn skin_vertices(&self, blends: &Blends) -> Vec<SkinVertex> {
        let weighted = !self.skin_weights.is_empty();
        let slots: Vec<Option<u32>> = self.groups.iter().map(|group| blends.slot(group)).collect();
        self.vertices
            .iter()
            .enumerate()
            .map(|(index, &position)| {
                let (bones, weights) = if weighted { self.four_weights(index) } else { self.group_weights(index, &slots) };
                SkinVertex { position, bones, weights }
            })
            .collect()
    }

    fn four_weights(&self, index: usize) -> ([u32; 4], [f32; 4]) {
        let row = self.skin_weights.get(index).copied().unwrap_or_default();
        (std::array::from_fn(|i| u32::from(row[i])), std::array::from_fn(|i| f32::from(row[4 + i]) / 255.0))
    }

    fn group_weights(&self, index: usize, slots: &[Option<u32>]) -> ([u32; 4], [f32; 4]) {
        let at = self.vertex_group.get(index).map(|&group| usize::from(group));
        if let Some(slot) = at.and_then(|at| slots.get(at).copied().flatten()) {
            return ([slot, 0, 0, 0], [1.0, 0.0, 0.0, 0.0]);
        }
        let group = at.and_then(|at| self.groups.get(at)).map_or(&[][..], Vec::as_slice);
        let share = 1.0 / group.len() as f32;
        (std::array::from_fn(|i| group.get(i).copied().unwrap_or(0)), std::array::from_fn(|i| if i < group.len() { share } else { 0.0 }))
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
