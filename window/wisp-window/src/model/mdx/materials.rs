use super::{Reader, NAME_LENGTH};
use crate::model::emitter::Scalar;
use crate::model::{Layer, Material, Model, ModelError, Texture};

const EMISSIVE_VERSION: u32 = 900;
const FRESNEL_VERSION: u32 = 1000;
const HD_MATERIAL_VERSION: u32 = 1100;

const TEXTURE_RECORD: usize = 268;
const PATH_LENGTH: usize = 260;

pub(super) fn parse_textures(chunk: &mut Reader, model: &mut Model) -> Result<(), ModelError> {
    for _ in 0..chunk.bytes.len() / TEXTURE_RECORD {
        let replaceable_id = u32::try_from(chunk.i32()?).unwrap_or(0);
        let path = chunk.take(PATH_LENGTH)?;
        let end = path.iter().position(|&byte| byte == 0).unwrap_or(PATH_LENGTH);
        model.textures.push(Texture { replaceable_id, image: String::from_utf8_lossy(&path[..end]).into_owned() });
        chunk.take(4)?;
    }
    Ok(())
}

pub(super) fn parse_materials(chunk: &mut Reader, model: &mut Model) -> Result<(), ModelError> {
    while chunk.at < chunk.bytes.len() {
        let start = chunk.at;
        let size = chunk.count()?;
        chunk.take(8)?;
        if chunk.bytes.get(chunk.at..chunk.at + 4) != Some(b"LAYS".as_slice()) {
            chunk.take(NAME_LENGTH)?;
        }
        chunk.expect("LAYS")?;
        let mut material = Material::default();
        for _ in 0..chunk.count()? {
            let layer_start = chunk.at;
            let layer_size = chunk.count()?;
            let filter_mode = u32::try_from(chunk.i32()?).unwrap_or(0);
            let shading_flags = u32::try_from(chunk.i32()?).unwrap_or(0);
            let mut texture_id = chunk.i32()?;
            let texture_anim = usize::try_from(chunk.i32()?).ok();
            chunk.take(4)?;
            let mut alpha = Scalar::fixed(chunk.f32()?);
            let mut texture_track = None;
            if model.version >= EMISSIVE_VERSION {
                chunk.take(4)?;
            }
            if model.version >= FRESNEL_VERSION {
                chunk.take(5 * 4)?;
            }
            if model.version >= HD_MATERIAL_VERSION {
                chunk.take(4)?;
                for slot in 0..chunk.count()? {
                    let id = chunk.i32()?;
                    chunk.take(4)?;
                    let track = (chunk.bytes.get(chunk.at..chunk.at + 4) == Some(b"KMTF".as_slice())).then(|| chunk.keyword().and_then(|_| chunk.index_track())).transpose()?;
                    if slot == 0 {
                        texture_id = id;
                        texture_track = track;
                    }
                }
            }
            while chunk.at < layer_start + layer_size {
                match chunk.keyword()? {
                    b"KMTA" => alpha.track = Some(chunk.track::<1>()?),
                    b"KMTF" => texture_track = Some(chunk.index_track()?),
                    b"KMTE" => {
                        chunk.track::<1>()?;
                    }
                    _ => return Err(ModelError::Chunk { chunk: "MTLS", reason: "unknown layer keyword" }),
                }
            }
            material.layers.push(Layer { filter_mode, texture_id, shading_flags, alpha, texture_track, texture_anim });
            chunk.at = layer_start + layer_size;
        }
        model.materials.push(material);
        chunk.at = start + size;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn int(out: &mut Vec<u8>, value: i32) {
        out.extend_from_slice(&value.to_le_bytes());
    }

    fn float(out: &mut Vec<u8>, value: f32) {
        out.extend_from_slice(&value.to_le_bytes());
    }

    fn hd_material_chunk() -> Vec<u8> {
        let mut layer = Vec::new();
        for value in [1, 0, 7, -1, 0] {
            int(&mut layer, value);
        }
        float(&mut layer, 0.5);
        for value in [0.0, 0.0, 0.0, 0.0, 0.0, 0.0] {
            float(&mut layer, value);
        }
        for value in [0, 1, 7, 0] {
            int(&mut layer, value);
        }
        layer.extend_from_slice(b"KMTF");
        for value in [1, 0, -1, 0, 3] {
            int(&mut layer, value);
        }
        let mut chunk = Vec::new();
        for value in [0, 0] {
            int(&mut chunk, value);
        }
        chunk.extend_from_slice(b"LAYS");
        int(&mut chunk, 1);
        int(&mut chunk, layer.len() as i32 + 4);
        chunk.extend_from_slice(&layer);
        let size = chunk.len() as i32 + 4;
        let mut out = Vec::new();
        int(&mut out, size);
        out.extend_from_slice(&chunk);
        out
    }

    #[test]
    fn a_version_1800_layer_reads_its_texture_list_and_its_animated_texture() {
        let chunk = hd_material_chunk();
        let mut model = Model { version: 1800, ..Model::default() };
        parse_materials(&mut Reader { bytes: &chunk, at: 0 }, &mut model).unwrap();
        let layer = &model.materials[0].layers[0];
        assert_eq!((layer.filter_mode, layer.texture_id, layer.alpha.fixed), (1, 7, 0.5));
        assert_eq!(layer.texture_track.as_ref().map(|track| track.keys[0].value[0]), Some(3.0));
    }
}
