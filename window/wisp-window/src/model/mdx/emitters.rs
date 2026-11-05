use super::Reader;
use crate::model::emitter::{Emitter1, Emitter2, Ribbon, Scalar};
use crate::model::{Color, Model, ModelError};

const PATH_LENGTH: usize = 260;

/// Reads a chunk of version-2 particle emitters (`PRE2`), ribbon emitters (`RIBB`) or version-1 emitters (`PREM`).
pub(super) fn parse_emitters(keyword: &[u8; 4], chunk: &mut Reader, model: &mut Model) -> Result<(), ModelError> {
    match keyword {
        b"RIBB" => parse_ribbons(chunk, model),
        b"PREM" => parse_particle_emitters1(chunk, model),
        _ => parse_particle_emitters2(chunk, model),
    }
}

fn read_emitter_look(chunk: &mut Reader, emitter: &mut Emitter2) -> Result<(), ModelError> {
    for value in [&mut emitter.speed, &mut emitter.variation, &mut emitter.latitude, &mut emitter.gravity] {
        *value = Scalar::fixed(chunk.f32()?);
    }
    emitter.life_span = chunk.f32()?;
    emitter.emission_rate = Scalar::fixed(chunk.f32()?);
    emitter.width = Scalar::fixed(chunk.f32()?);
    emitter.length = Scalar::fixed(chunk.f32()?);
    emitter.filter_mode = chunk.i32()? as u32;
    emitter.rows = chunk.i32()?.max(1) as u32;
    emitter.columns = chunk.i32()?.max(1) as u32;
    let frames = chunk.i32()?;
    emitter.head = frames == 0 || frames == 2;
    emitter.tail = frames == 1 || frames == 2;
    emitter.tail_length = chunk.f32()?;
    emitter.time = chunk.f32()?;
    for color in &mut emitter.colors {
        *color = chunk.floats::<3>()?;
    }
    for alpha in &mut emitter.alphas {
        *alpha = f32::from(chunk.u8()?) / 255.0;
    }
    emitter.scaling = chunk.floats::<3>()?;
    for animation in [&mut emitter.head_life, &mut emitter.head_decay, &mut emitter.tail_life, &mut emitter.tail_decay] {
        for frame in animation.iter_mut() {
            *frame = chunk.i32()? as f32;
        }
    }
    emitter.texture_id = chunk.i32()?;
    emitter.squirt = chunk.i32()? > 0;
    emitter.priority_plane = chunk.i32()?;
    chunk.take(4)?;
    Ok(())
}

fn parse_particle_emitters2(chunk: &mut Reader, model: &mut Model) -> Result<(), ModelError> {
    while chunk.at < chunk.bytes.len() {
        let start = chunk.at;
        let size = chunk.count()?;
        let node = chunk.node()?;
        let mut emitter = Emitter2 { node: node.object_id, ..Emitter2::default() };
        read_emitter_look(chunk, &mut emitter)?;
        while chunk.at < start + size {
            let target = match chunk.keyword()? {
                b"KP2V" => &mut emitter.visibility,
                b"KP2E" => &mut emitter.emission_rate,
                b"KP2W" => &mut emitter.width,
                b"KP2N" => &mut emitter.length,
                b"KP2S" => &mut emitter.speed,
                b"KP2L" => &mut emitter.latitude,
                b"KP2G" => &mut emitter.gravity,
                b"KP2R" => &mut emitter.variation,
                _ => return Err(ModelError::Chunk { chunk: "PRE2", reason: "unknown animation keyword" }),
            };
            target.track = Some(chunk.track::<1>()?);
        }
        chunk.at = start + size;
        model.insert_node(node);
        model.emitters.push(emitter);
    }
    Ok(())
}

fn parse_ribbons(chunk: &mut Reader, model: &mut Model) -> Result<(), ModelError> {
    while chunk.at < chunk.bytes.len() {
        let start = chunk.at;
        let size = chunk.count()?;
        let node = chunk.node()?;
        let mut ribbon = Ribbon { node: node.object_id, ..Ribbon::default() };
        ribbon.height_above = Scalar::fixed(chunk.f32()?);
        ribbon.height_below = Scalar::fixed(chunk.f32()?);
        ribbon.alpha = Scalar::fixed(chunk.f32()?);
        ribbon.color = Color { fixed: chunk.floats::<3>()?, track: None };
        ribbon.life_span = chunk.f32()?;
        ribbon.texture_slot = Scalar::fixed(chunk.i32()? as f32);
        ribbon.emission_rate = chunk.i32()? as f32;
        ribbon.rows = chunk.i32()?.max(1) as u32;
        ribbon.columns = chunk.i32()?.max(1) as u32;
        ribbon.material_id = chunk.i32()?;
        ribbon.gravity = chunk.f32()?;
        ribbon.visibility = Scalar::fixed(1.0);
        while chunk.at < start + size {
            match chunk.keyword()? {
                b"KRHA" => ribbon.height_above.track = Some(chunk.track()?),
                b"KRHB" => ribbon.height_below.track = Some(chunk.track()?),
                b"KRAL" => ribbon.alpha.track = Some(chunk.track()?),
                b"KRCO" => ribbon.color.track = Some(chunk.track()?),
                b"KRTX" => ribbon.texture_slot.track = Some(chunk.index_track()?),
                b"KRVS" => ribbon.visibility.track = Some(chunk.track()?),
                _ => return Err(ModelError::Chunk { chunk: "RIBB", reason: "unknown animation keyword" }),
            }
        }
        chunk.at = start + size;
        model.insert_node(node);
        model.ribbons.push(ribbon);
    }
    Ok(())
}

fn parse_particle_emitters1(chunk: &mut Reader, model: &mut Model) -> Result<(), ModelError> {
    while chunk.at < chunk.bytes.len() {
        let start = chunk.at;
        let size = chunk.count()?;
        let node = chunk.node()?;
        let mut emitter = Emitter1 { node: node.object_id, ..Emitter1::default() };
        for value in [&mut emitter.emission_rate, &mut emitter.gravity, &mut emitter.longitude, &mut emitter.latitude] {
            *value = Scalar::fixed(chunk.f32()?);
        }
        emitter.path = chunk.text(PATH_LENGTH)?;
        emitter.life_span = Scalar::fixed(chunk.f32()?);
        emitter.speed = Scalar::fixed(chunk.f32()?);
        emitter.visibility = Scalar::fixed(1.0);
        while chunk.at < start + size {
            let target = match chunk.keyword()? {
                b"KPEV" => &mut emitter.visibility,
                b"KPEE" => &mut emitter.emission_rate,
                b"KPEG" => &mut emitter.gravity,
                b"KPLN" => &mut emitter.longitude,
                b"KPLT" => &mut emitter.latitude,
                b"KPEL" => &mut emitter.life_span,
                b"KPES" => &mut emitter.speed,
                _ => return Err(ModelError::Chunk { chunk: "PREM", reason: "unknown animation keyword" }),
            };
            target.track = Some(chunk.track::<1>()?);
        }
        chunk.at = start + size;
        model.insert_node(node);
        model.emitters1.push(emitter);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::XY_QUAD;
    use crate::model::mdx::NAME_LENGTH;

    fn int(out: &mut Vec<u8>, value: i32) {
        out.extend_from_slice(&value.to_le_bytes());
    }

    fn float(out: &mut Vec<u8>, value: f32) {
        out.extend_from_slice(&value.to_le_bytes());
    }

    fn emitter_chunk() -> Vec<u8> {
        let mut node = Vec::new();
        int(&mut node, 96);
        node.extend_from_slice(&[b'e'; 1]);
        node.resize(4 + NAME_LENGTH, 0);
        for value in [0, -1, XY_QUAD as i32] {
            int(&mut node, value);
        }
        let mut body = Vec::new();
        for value in [100.0, 0.5, 30.0, 9.0, 1.5, 20.0, 4.0, 6.0] {
            float(&mut body, value);
        }
        for value in [1, 4, 2, 1] {
            int(&mut body, value);
        }
        float(&mut body, 0.25);
        float(&mut body, 0.4);
        for value in [1.0, 0.5, 0.0, 0.2, 0.3, 0.4, 0.0, 0.0, 1.0] {
            float(&mut body, value);
        }
        body.extend_from_slice(&[255, 128, 0]);
        for value in [10.0, 20.0, 5.0] {
            float(&mut body, value);
        }
        for value in [0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1, -10, 0] {
            int(&mut body, value);
        }
        body.extend_from_slice(b"KP2V");
        int(&mut body, 1);
        int(&mut body, 0);
        int(&mut body, -1);
        int(&mut body, 0);
        float(&mut body, 0.0);
        let mut chunk = Vec::new();
        int(&mut chunk, (4 + node.len() + body.len()) as i32);
        chunk.extend_from_slice(&node);
        chunk.extend_from_slice(&body);
        chunk
    }

    #[test]
    fn a_particle_emitter_reads_its_look_and_its_animated_visibility() {
        let chunk = emitter_chunk();
        let mut model = Model::default();
        parse_particle_emitters2(&mut Reader { bytes: &chunk, at: 0 }, &mut model).unwrap();
        let [emitter] = model.emitters.as_slice() else { panic!("one emitter") };
        assert_eq!((emitter.speed.fixed, emitter.life_span, emitter.emission_rate.fixed), (100.0, 1.5, 20.0));
        assert_eq!((emitter.filter_mode, emitter.rows, emitter.columns, emitter.head, emitter.tail), (1, 4, 2, false, true));
        assert_eq!((emitter.alphas, emitter.scaling, emitter.head_decay), ([1.0, 128.0 / 255.0, 0.0], [10.0, 20.0, 5.0], [0.0, 0.0, 0.0]));
        assert_eq!(emitter.head_life, [0.0, 3.0, 0.0]);
        assert!(emitter.squirt);
        assert_eq!(emitter.priority_plane, -10);
        assert_eq!(emitter.visibility.track.as_ref().map(|track| track.keys.len()), Some(1));
        assert!(model.nodes[0].is_some());
    }
}
