use super::{Blends, Model, ModelError, Node};

/// Column-major, as `gl-matrix` and WGSL's `mat4x4<f32>` store it.
pub type Mat4 = [f32; 16];

pub const IDENTITY: Mat4 = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0];

#[derive(Clone, Copy, Debug)]
struct GlobalClock {
    frame: f32,
    length: f32,
}

/// Where a model is in time: a frame inside a sequence's interval, plus one clock per global sequence.
#[derive(Clone, Debug)]
pub struct Playhead {
    pub frame: f32,
    interval: [f32; 2],
    globals: Vec<GlobalClock>,
}

impl Playhead {
    pub fn new(model: &Model) -> Self {
        let globals = model.global_sequences.iter().map(|&length| GlobalClock { frame: 0.0, length: length as f32 }).collect();
        Self { frame: 0.0, interval: [u32::MAX as f32; 2], globals }
    }

    /// Shows `sequence` of `model`, or no sequence (a sentinel interval no key reaches) when it is `None` or out of range.
    pub fn set_sequence(&mut self, model: &Model, sequence: Option<usize>) {
        self.interval = sequence
            .and_then(|index| model.sequences.get(index))
            .map_or([u32::MAX as f32; 2], |found| found.interval.map(|edge| edge as f32));
    }

    pub fn set_global_frame(&mut self, index: usize, frame: u32) {
        if let Some(clock) = self.globals.get_mut(index) {
            clock.frame = frame as f32;
        }
    }

    pub(crate) fn window(&self, global_sequence: Option<usize>) -> (f32, f32, f32) {
        match global_sequence.and_then(|index| self.globals.get(index)) {
            Some(clock) => (clock.frame, 0.0, clock.length),
            None => (self.frame, self.interval[0], self.interval[1]),
        }
    }
}

/// A model's bone palette. `update` writes one matrix per node id into a buffer allocated at load, so a frame allocates nothing.
/// Only nodes that place vertices, nodes the caller names (emitters) and their ancestors are posed; the rest stay identity.
pub struct Pose<'model> {
    model: &'model Model,
    order: Vec<usize>,
    matrices: Vec<Mat4>,
    blends: Blends,
}

impl<'model> Pose<'model> {
    pub fn new(model: &'model Model, also_placed: &[usize]) -> Result<Self, ModelError> {
        let mut placed = vec![false; model.nodes.len()];
        let mut mark = |id: usize| {
            if let Some(slot) = placed.get_mut(id) {
                *slot = true;
            }
        };
        for geoset in &model.geosets {
            geoset.groups.iter().flatten().for_each(|&id| mark(id as usize));
            geoset.skin_weights.iter().flat_map(|row| &row[..4]).for_each(|&id| mark(usize::from(id)));
        }
        also_placed.iter().for_each(|&id| mark(id));
        let mut order = Vec::new();
        let mut emitted = vec![false; model.nodes.len()];
        let mut chain = Vec::new();
        for start in (0..placed.len()).filter(|&id| placed[id]) {
            let mut next = Some(start);
            while let Some(id) = next.filter(|&id| !emitted[id]) {
                if chain.len() > model.nodes.len() {
                    return Err(ModelError::ParentCycle { node: start });
                }
                chain.push(id);
                next = model.node(id).and_then(|node| node.parent);
            }
            for id in chain.drain(..).rev() {
                emitted[id] = true;
                if model.node(id).is_some() {
                    order.push(id);
                }
            }
        }
        let blends = model.blends();
        Ok(Self { model, order, matrices: vec![IDENTITY; model.nodes.len() + blends.len()], blends })
    }

    /// The palette, indexed by node object id with the blend entries of `Model::blends` after the nodes; upload it as the storage buffer the skinning vertex shader reads.
    pub fn matrices(&self) -> &[Mat4] {
        &self.matrices
    }

    pub fn update(&mut self, playhead: &Playhead) {
        for &id in &self.order {
            let Some(node) = self.model.node(id) else { continue };
            let mut matrix = local_matrix(node, playhead);
            if let Some(parent) = node.parent {
                matrix = multiply(&self.matrices[parent], &matrix);
            }
            self.matrices[id] = matrix;
        }
        self.blends.write(&mut self.matrices);
    }
}

fn local_matrix(node: &Node, playhead: &Playhead) -> Mat4 {
    let translation = node.translation.as_ref().and_then(|track| track.vector(playhead));
    let rotation = node.rotation.as_ref().and_then(|track| track.quaternion(playhead));
    let scaling = node.scaling.as_ref().and_then(|track| track.vector(playhead));
    if translation.is_none() && rotation.is_none() && scaling.is_none() {
        return IDENTITY;
    }
    rotation_translation_scale_origin(rotation.unwrap_or([0.0, 0.0, 0.0, 1.0]), translation.unwrap_or([0.0; 3]), scaling.unwrap_or([1.0; 3]), node.pivot)
}

fn rotation_translation_scale_origin(q: [f32; 4], v: [f32; 3], s: [f32; 3], o: [f32; 3]) -> Mat4 {
    let [x, y, z, w] = q;
    let (x2, y2, z2) = (x + x, y + y, z + z);
    let (xx, xy, xz, yy, yz, zz) = (x * x2, x * y2, x * z2, y * y2, y * z2, z * z2);
    let (wx, wy, wz) = (w * x2, w * y2, w * z2);
    let (c0, c1, c2) = ([(1.0 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0]], [(xy - wz) * s[1], (1.0 - (xx + zz)) * s[1], (yz + wx) * s[1]], [(xz + wy) * s[2], (yz - wx) * s[2], (1.0 - (xx + yy)) * s[2]]);
    let shift = |row: usize| v[row] + o[row] - (c0[row] * o[0] + c1[row] * o[1] + c2[row] * o[2]);
    [c0[0], c0[1], c0[2], 0.0, c1[0], c1[1], c1[2], 0.0, c2[0], c2[1], c2[2], 0.0, shift(0), shift(1), shift(2), 1.0]
}

pub(crate) fn multiply(a: &Mat4, b: &Mat4) -> Mat4 {
    std::array::from_fn(|index| {
        let (column, row) = (index / 4, index % 4);
        (0..4).map(|k| a[k * 4 + row] * b[column * 4 + k]).sum()
    })
}

pub(crate) fn transform_point(matrix: &Mat4, p: [f32; 3]) -> [f32; 3] {
    let w = matrix[3] * p[0] + matrix[7] * p[1] + matrix[11] * p[2] + matrix[15];
    let w = if w == 0.0 { 1.0 } else { w };
    std::array::from_fn(|row| (matrix[row] * p[0] + matrix[4 + row] * p[1] + matrix[8 + row] * p[2] + matrix[12 + row]) / w)
}
