//! Where the file formats meet the renderer: MDX bytes become a `ModelData`, texture bytes an `Image`.

use crate::model::{self, global_sequence_frame, Playhead, Pose};

use super::math::Mat4;
use crate::remaster::Quality;

use super::model::{EmitterSample, Filter, Layer, ModelData, ModelEmitter, Paint, Part, Rig, Vertex};
use super::tessellate::tessellate;

const TEAM_COLOR: u32 = 1;
const TEAM_GLOW: u32 = 2;

/// One draw of one material layer: a layer whose texture changes draws once per texture it can show, and only the draw for the current texture is opaque to the shader.
struct LayerSlot {
    material: usize,
    layer: usize,
    variant: Option<i32>,
}

struct MdxRig {
    model: &'static model::Model,
    playhead: Playhead,
    pose: Pose<'static>,
    samples: Vec<EmitterSample>,
    opacities: Vec<f32>,
    slots: Vec<LayerSlot>,
    uv_rows: Vec<[f32; 4]>,
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
        let head = &self.playhead;
        let geosets = self.model.geosets.len();
        for (index, opacity) in self.opacities[..geosets].iter_mut().enumerate() {
            *opacity = self.model.geoset_anims.iter().rev().find(|anim| anim.geoset == index).map_or(1.0, |anim| anim.alpha.at(head, 1.0));
        }
        for (slot, opacity) in self.slots.iter().zip(&mut self.opacities[geosets..]) {
            let layer = &self.model.materials[slot.material].layers[slot.layer];
            let shown = layer.texture_track.as_ref().and_then(|track| track.vector(head)).map_or(layer.texture_id, |value| value[0].round() as i32);
            *opacity = if slot.variant.is_none_or(|variant| variant == shown) { layer.alpha.at(head, 1.0) } else { 0.0 };
        }
        for (at, slot) in self.slots.iter().enumerate() {
            let layer = &self.model.materials[slot.material].layers[slot.layer];
            let Some(anim) = layer.texture_anim.and_then(|id| self.model.texture_anims.get(id)) else { continue };
            let shift = anim.translation.as_ref().and_then(|track| track.vector(head)).unwrap_or([0.0; 3]);
            let scale = anim.scaling.as_ref().and_then(|track| track.vector(head)).unwrap_or([1.0; 3]);
            let [x, y, z, w] = anim.rotation.as_ref().and_then(|track| track.quaternion(head)).unwrap_or([0.0, 0.0, 0.0, 1.0]);
            let (xx, yy, zz, xy, wz, xz, wy, yz, wx) = (x * x, y * y, z * z, x * y, w * z, x * z, w * y, y * z, w * x);
            let _ = (xz, wy, yz, wx);
            let rows = &mut self.uv_rows[(geosets + at) * 2..(geosets + at) * 2 + 2];
            rows[0] = [(1.0 - 2.0 * (yy + zz)) * scale[0], 2.0 * (xy - wz) * scale[1], 0.0, shift[0]];
            rows[1] = [2.0 * (xy + wz) * scale[0], (1.0 - 2.0 * (xx + zz)) * scale[1], 0.0, shift[1]];
        }
        for (emitter, sample) in self.model.emitters.iter().zip(&mut self.samples) {
            let head = &self.playhead;
            let key = if emitter.squirt { emitter.emission_rate.key_at(head).map(|key| (key.frame, key.value[0])) } else { None };
            *sample = EmitterSample {
                visible: emitter.visibility.at(head, 1.0) > 0.0,
                rate: emitter.emission_rate.at(head, 0.0),
                key,
                width: emitter.width.at(head, 0.0),
                length: emitter.length.at(head, 0.0),
                speed: emitter.speed.at(head, 0.0),
                variation: emitter.variation.at(head, 0.0),
                latitude: emitter.latitude.at(head, 0.0),
                gravity: emitter.gravity.at(head, 0.0),
            };
        }
    }

    fn opacities(&self) -> &[f32] {
        &self.opacities
    }

    fn uv_rows(&self) -> &[[f32; 4]] {
        &self.uv_rows
    }

    fn emitters(&self) -> &[EmitterSample] {
        &self.samples
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
    let mut slots = Vec::new();
    let mut layer_draws: Vec<Vec<Vec<(Option<i32>, u32)>>> = Vec::new();
    for (material_index, material) in model.materials.iter().enumerate() {
        let mut layers = Vec::new();
        for (layer_index, layer) in material.layers.iter().enumerate() {
            let mut variants = match &layer.texture_track {
                Some(track) => track.keys.iter().map(|key| Some(key.value[0].round() as i32)).chain([Some(layer.texture_id)]).collect(),
                None => vec![None],
            };
            variants.sort_unstable();
            variants.dedup();
            layers.push(
                variants
                    .into_iter()
                    .map(|variant| {
                        slots.push(LayerSlot { material: material_index, layer: layer_index, variant });
                        (variant, (model.geosets.len() + slots.len() - 1) as u32)
                    })
                    .collect(),
            );
        }
        layer_draws.push(layers);
    }
    let next_slot = (model.geosets.len() + slots.len()) as u32;
    let mut vertices = Vec::new();
    let mut indices = Vec::new();
    let mut parts = Vec::new();
    for (geoset_index, geoset) in model.geosets.iter().enumerate() {
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
            .map(|material| {
                let mut layers = Vec::new();
                for (layer, draws) in material.layers.iter().zip(&layer_draws[geoset.material_id as usize]) {
                    for &(variant, opacity_slot) in draws {
                        layers.push(Layer { paint: paint(model, variant.unwrap_or(layer.texture_id)), filter: Filter::from_index(layer.filter_mode), opacity_slot });
                    }
                }
                layers
            })
            .unwrap_or_else(|| vec![Layer { paint: Paint::None, filter: Filter::Opaque, opacity_slot: geoset_index as u32 }]);
        parts.push(Part { opacity_slot: geoset_index as u32, first_index, index_count: indices.len() as u32 - first_index, layers });
    }
    let emitters = model.emitters.iter().map(|emitter| ModelEmitter { spec: emitter.clone(), paint: paint(model, emitter.texture_id) }).collect();
    let placed: Vec<usize> = model.emitters.iter().map(|emitter| emitter.node).collect();
    let pose = Pose::new(model, &placed).map_err(|error| error.to_string())?;
    let rig = MdxRig {
        model,
        playhead: Playhead::new(model),
        pose,
        samples: vec![EmitterSample::default(); model.emitters.len()],
        opacities: vec![1.0; next_slot as usize],
        slots,
        uv_rows: vec![[[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0]]; next_slot as usize].into_iter().flatten().collect(),
    };
    let mut data = ModelData { vertices, indices, parts, rig: Box::new(rig), emitters };
    tessellate(&mut data, quality.tessellation_levels());
    Ok(data)
}

