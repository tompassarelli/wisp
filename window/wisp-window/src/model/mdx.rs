use super::track::{Key, LineType, Track};
use super::emitter::{Emitter2, Scalar};
use super::{Color, Geoset, GeosetAnim, TextureAnim, Model, ModelError, Node, Sequence};

mod materials;

use materials::{parse_materials, parse_textures};

const NO_ID: i32 = -1;
const NAME_LENGTH: usize = 80;
const SKIN_WORD_VERSION: u32 = 1800;
const SKIN_VERSION: u32 = 900;

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, count: usize) -> Result<&'a [u8], ModelError> {
        let end = self.at.checked_add(count).filter(|&end| end <= self.bytes.len()).ok_or(ModelError::Truncated { at: self.at })?;
        let slice = &self.bytes[self.at..end];
        self.at = end;
        Ok(slice)
    }

    fn u8(&mut self) -> Result<u8, ModelError> {
        Ok(self.take(1)?[0])
    }

    fn u16(&mut self) -> Result<u16, ModelError> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }

    fn i32(&mut self) -> Result<i32, ModelError> {
        Ok(i32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }

    fn count(&mut self) -> Result<usize, ModelError> {
        let at = self.at;
        usize::try_from(self.i32()?).map_err(|_| ModelError::Truncated { at })
    }

    fn f32(&mut self) -> Result<f32, ModelError> {
        Ok(f32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }

    fn floats<const N: usize>(&mut self) -> Result<[f32; N], ModelError> {
        let mut out = [0.0; N];
        for slot in &mut out {
            *slot = self.f32()?;
        }
        Ok(out)
    }

    fn vectors<const N: usize>(&mut self) -> Result<Vec<[f32; N]>, ModelError> {
        (0..self.count()?).map(|_| self.floats::<N>()).collect()
    }

    fn keyword(&mut self) -> Result<&'a [u8], ModelError> {
        self.take(4)
    }

    fn expect(&mut self, keyword: &'static str) -> Result<(), ModelError> {
        let at = self.at;
        if self.keyword()? == keyword.as_bytes() { Ok(()) } else { Err(ModelError::Keyword { expected: keyword, at }) }
    }

    fn text(&mut self, length: usize) -> Result<String, ModelError> {
        let raw = self.take(length)?;
        let end = raw.iter().position(|&byte| byte == 0).unwrap_or(raw.len());
        Ok(String::from_utf8_lossy(&raw[..end]).into_owned())
    }

    fn track<const N: usize>(&mut self) -> Result<Track<N>, ModelError> {
        self.track_of(Self::floats::<N>)
    }

    /// A track whose keys are texture indices: the format stores them as integers, read here into the track's floats.
    fn index_track(&mut self) -> Result<Track<1>, ModelError> {
        self.track_of(|reader| Ok([reader.i32()? as f32]))
    }

    fn track_of<const N: usize>(&mut self, read: impl Fn(&mut Self) -> Result<[f32; N], ModelError>) -> Result<Track<N>, ModelError> {
        let keys = self.count()?;
        let line = LineType::from_code(self.i32()?).ok_or(ModelError::Chunk { chunk: "track", reason: "unknown interpolation" })?;
        let global = self.i32()?;
        let mut track = Track::new(line);
        track.global_sequence = (global != NO_ID).then_some(global as usize);
        for _ in 0..keys {
            let frame = self.i32()?;
            let value = read(self)?;
            let (in_tan, out_tan) = if line.has_tangents() { (read(self)?, read(self)?) } else { ([0.0; N], [0.0; N]) };
            track.keys.push(Key { frame, value, in_tan, out_tan });
        }
        Ok(track)
    }

    fn node(&mut self) -> Result<Node, ModelError> {
        let start = self.at;
        let size = self.count()?;
        let name = self.text(NAME_LENGTH)?;
        let object_id = self.i32()?;
        let parent = self.i32()?;
        let flags = self.i32()?;
        let mut node = Node {
            name,
            object_id: usize::try_from(object_id).map_err(|_| ModelError::Chunk { chunk: "node", reason: "node without an object id" })?,
            parent: (parent != NO_ID).then_some(parent as usize),
            flags: flags as u32,
            ..Node::default()
        };
        while self.at < start + size {
            match self.keyword()? {
                b"KGTR" => node.translation = Some(self.track()?),
                b"KGRT" => node.rotation = Some(self.track()?),
                b"KGSC" => node.scaling = Some(self.track()?),
                _ => return Err(ModelError::Chunk { chunk: "node", reason: "unknown animation keyword" }),
            }
        }
        Ok(node)
    }
}

pub(super) fn parse(bytes: &[u8]) -> Result<Model, ModelError> {
    let mut reader = Reader { bytes, at: 0 };
    reader.expect("MDLX")?;
    let mut model = Model { version: 800, ..Model::default() };
    let mut pivots = Vec::new();
    while reader.at < bytes.len() {
        let keyword: [u8; 4] = reader.keyword()?.try_into().unwrap();
        let size = reader.count()?;
        let end = reader.at + size;
        let mut chunk = Reader { bytes: reader.take(size)?, at: 0 };
        match &keyword {
            b"VERS" => model.version = chunk.i32()? as u32,
            b"SEQS" => parse_sequences(&mut chunk, &mut model)?,
            b"GLBS" => (0..size / 4).try_for_each(|_| chunk.i32().map(|length| model.global_sequences.push(length as u32)))?,
            b"GEOS" => parse_geosets(&mut chunk, &mut model)?,
            b"TEXS" => parse_textures(&mut chunk, &mut model)?,
            b"MTLS" => parse_materials(&mut chunk, &mut model)?,
            b"BONE" => parse_each_node(&mut chunk, &mut model, 8)?,
            b"HELP" => parse_each_node(&mut chunk, &mut model, 0)?,
            b"GEOA" | b"TXAN" | b"PRE2" => parse_animated(&keyword, &mut chunk, &mut model)?,
            b"ATCH" | b"LITE" | b"PREM" | b"RIBB" | b"CORN" => parse_sized_nodes(&mut chunk, &mut model)?,
            b"PIVT" => (0..size / 12).try_for_each(|_| chunk.floats::<3>().map(|point| pivots.push(point)))?,
            _ => {}
        }
        reader.at = end;
    }
    model.finish(&pivots)
}

fn parse_sequences(chunk: &mut Reader, model: &mut Model) -> Result<(), ModelError> {
    while chunk.at < chunk.bytes.len() {
        let name = chunk.text(NAME_LENGTH)?;
        let interval = [chunk.i32()? as u32, chunk.i32()? as u32];
        let move_speed = chunk.f32()?;
        let non_looping = chunk.i32()? > 0;
        let rarity = chunk.f32()?;
        chunk.take(4 + 28)?;
        model.sequences.push(Sequence { name, interval, non_looping, move_speed, rarity });
    }
    Ok(())
}

fn parse_each_node(chunk: &mut Reader, model: &mut Model, trailer: usize) -> Result<(), ModelError> {
    while chunk.at < chunk.bytes.len() {
        let node = chunk.node()?;
        chunk.take(trailer)?;
        model.insert_node(node);
    }
    Ok(())
}

fn parse_sized_nodes(chunk: &mut Reader, model: &mut Model) -> Result<(), ModelError> {
    while chunk.at < chunk.bytes.len() {
        let start = chunk.at;
        let size = chunk.count()?;
        let node = chunk.node()?;
        chunk.at = start + size;
        model.insert_node(node);
    }
    Ok(())
}

fn parse_animated(keyword: &[u8; 4], chunk: &mut Reader, model: &mut Model) -> Result<(), ModelError> {
    match keyword {
        b"GEOA" => parse_geoset_anims(chunk, model),
        b"TXAN" => parse_texture_anims(chunk, model),
        _ => parse_particle_emitters2(chunk, model),
    }
}

fn parse_texture_anims(chunk: &mut Reader, model: &mut Model) -> Result<(), ModelError> {
    while chunk.at < chunk.bytes.len() {
        let start = chunk.at;
        let size = chunk.count()?;
        let mut anim = TextureAnim::default();
        while chunk.at < start + size {
            match chunk.keyword()? {
                b"KTAT" => anim.translation = Some(chunk.track()?),
                b"KTAR" => anim.rotation = Some(chunk.track()?),
                b"KTAS" => anim.scaling = Some(chunk.track()?),
                _ => return Err(ModelError::Chunk { chunk: "TXAN", reason: "unknown animation keyword" }),
            }
        }
        chunk.at = start + size;
        model.texture_anims.push(anim);
    }
    Ok(())
}

fn parse_geoset_anims(chunk: &mut Reader, model: &mut Model) -> Result<(), ModelError> {
    while chunk.at < chunk.bytes.len() {
        let start = chunk.at;
        let size = chunk.count()?;
        let mut alpha = Scalar::fixed(chunk.f32()?);
        chunk.take(4)?;
        // Classic draws the stored colour order as red, green, blue, whatever the flags say.
        let mut color = Color { fixed: chunk.floats::<3>()?, track: None };
        let geoset = chunk.i32()?;
        while chunk.at < start + size {
            match chunk.keyword()? {
                b"KGAO" => alpha.track = Some(chunk.track::<1>()?),
                b"KGAC" => color.track = Some(chunk.track::<3>()?),
                _ => return Err(ModelError::Chunk { chunk: "GEOA", reason: "unknown animation keyword" }),
            }
        }
        chunk.at = start + size;
        if let Ok(geoset) = usize::try_from(geoset) {
            model.geoset_anims.push(GeosetAnim { geoset, alpha, color });
        }
    }
    Ok(())
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
    chunk.take(8)?;
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

fn parse_geosets(chunk: &mut Reader, model: &mut Model) -> Result<(), ModelError> {
    let version = model.version;
    while chunk.at < chunk.bytes.len() {
        let mut geoset = Geoset::default();
        chunk.i32()?;
        chunk.expect("VRTX")?;
        geoset.vertices = chunk.vectors()?;
        chunk.expect("NRMS")?;
        geoset.normals = chunk.vectors()?;
        chunk.expect("PTYP")?;
        let types = chunk.count()?;
        chunk.take(types * 4)?;
        chunk.expect("PCNT")?;
        let counts = chunk.count()?;
        chunk.take(counts * 4)?;
        chunk.expect("PVTX")?;
        for _ in 0..chunk.count()? {
            geoset.indices.push(u32::from(chunk.u16()?));
        }
        chunk.expect("GNDX")?;
        let assigned = chunk.count()?;
        geoset.vertex_group = chunk.take(assigned)?.to_vec();
        chunk.expect("MTGC")?;
        let sizes = (0..chunk.count()?).map(|_| chunk.count()).collect::<Result<Vec<_>, _>>()?;
        chunk.expect("MATS")?;
        chunk.count()?;
        for size in sizes {
            geoset.groups.push((0..size).map(|_| chunk.i32().map(|bone| bone as u32)).collect::<Result<_, _>>()?);
        }
        geoset.material_id = u32::try_from(chunk.i32()?).unwrap_or(0);
        chunk.take(8)?;
        if version >= SKIN_VERSION {
            chunk.take(4 + NAME_LENGTH)?;
        }
        chunk.take(28)?;
        let animations = chunk.count()?;
        chunk.take(animations * 28)?;
        let mut keyword = chunk.keyword()?;
        if version >= SKIN_VERSION {
            while keyword != b"UVAS" {
                match keyword {
                    b"TANG" => {
                        let tangents = chunk.count()?;
                        chunk.take(tangents * 16)?;
                    }
                    b"SKIN" => geoset.skin_weights = parse_skin(chunk, version)?,
                    _ => return Err(ModelError::Chunk { chunk: "GEOS", reason: "unknown geoset keyword" }),
                }
                keyword = chunk.keyword()?;
            }
        } else if keyword != b"UVAS" {
            return Err(ModelError::Keyword { expected: "UVAS", at: chunk.at - 4 });
        }
        for _ in 0..chunk.count()? {
            chunk.expect("UVBS")?;
            let coordinates = chunk.vectors::<2>()?;
            if geoset.uvs.is_empty() {
                geoset.uvs = coordinates;
            }
        }
        model.geosets.push(geoset);
    }
    Ok(())
}

fn parse_skin(chunk: &mut Reader, version: u32) -> Result<Vec<[u8; 8]>, ModelError> {
    let length = chunk.count()?;
    let mut flat = Vec::with_capacity(length);
    for _ in 0..length {
        flat.push(if version >= SKIN_WORD_VERSION {
            u8::try_from(chunk.u16()?).map_err(|_| ModelError::Chunk { chunk: "SKIN", reason: "bone id past the 256-bone palette" })?
        } else {
            chunk.u8()?
        });
    }
    Ok(flat.chunks_exact(8).map(|row| row.try_into().unwrap()).collect())
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::XY_QUAD;

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
        for value in [0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 0, 0] {
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
        assert_eq!(emitter.visibility.track.as_ref().map(|track| track.keys.len()), Some(1));
        assert!(model.nodes[0].is_some());
    }

    fn geoset_anim(geoset: i32, color: [f32; 3], track: Option<[f32; 3]>) -> Vec<u8> {
        let mut body = Vec::new();
        float(&mut body, 1.0);
        int(&mut body, 2);
        color.iter().for_each(|&value| float(&mut body, value));
        int(&mut body, geoset);
        if let Some(value) = track {
            body.extend_from_slice(b"KGAC");
            for word in [1, 0, -1, 0] {
                int(&mut body, word);
            }
            value.iter().for_each(|&value| float(&mut body, value));
        }
        let mut anim = Vec::new();
        int(&mut anim, (4 + body.len()) as i32);
        anim.extend_from_slice(&body);
        anim
    }

    #[test]
    fn a_geoset_animation_reads_its_fixed_and_animated_colour_in_stored_order() {
        let chunk = [geoset_anim(4, [0.0, 0.4, 0.4], None), geoset_anim(7, [1.0; 3], Some([0.5, 0.0, 1.0]))].concat();
        let mut model = Model::default();
        parse_geoset_anims(&mut Reader { bytes: &chunk, at: 0 }, &mut model).unwrap();
        let [fixed, animated] = model.geoset_anims.as_slice() else { panic!("two geoset animations") };
        assert_eq!((fixed.geoset, fixed.color.fixed, fixed.color.track.is_none()), (4, [0.0, 0.4, 0.4], true));
        assert_eq!((animated.geoset, animated.color.track.as_ref().map(|track| track.keys[0].value)), (7, Some([0.5, 0.0, 1.0])));
    }

}
