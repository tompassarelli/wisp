use super::track::{Key, LineType, Track};
use super::{Geoset, Layer, Material, Model, ModelError, Node, Sequence, Texture};

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
        let keys = self.count()?;
        let line = LineType::from_code(self.i32()?).ok_or(ModelError::Chunk { chunk: "track", reason: "unknown interpolation" })?;
        let global = self.i32()?;
        let mut track = Track::new(line);
        track.global_sequence = (global != NO_ID).then_some(global as usize);
        for _ in 0..keys {
            let frame = self.i32()?;
            let value = self.floats::<N>()?;
            let (in_tan, out_tan) = if line.has_tangents() { (self.floats::<N>()?, self.floats::<N>()?) } else { ([0.0; N], [0.0; N]) };
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
            b"ATCH" | b"LITE" | b"PREM" | b"PRE2" | b"RIBB" | b"CORN" => parse_sized_nodes(&mut chunk, &mut model)?,
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

const TEXTURE_RECORD: usize = 268;
const PATH_LENGTH: usize = 260;

fn parse_textures(chunk: &mut Reader, model: &mut Model) -> Result<(), ModelError> {
    for _ in 0..chunk.bytes.len() / TEXTURE_RECORD {
        let replaceable_id = u32::try_from(chunk.i32()?).unwrap_or(0);
        let path = chunk.take(PATH_LENGTH)?;
        let end = path.iter().position(|&byte| byte == 0).unwrap_or(PATH_LENGTH);
        model.textures.push(Texture { replaceable_id, image: String::from_utf8_lossy(&path[..end]).into_owned() });
        chunk.take(4)?;
    }
    Ok(())
}

fn parse_materials(chunk: &mut Reader, model: &mut Model) -> Result<(), ModelError> {
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
            let texture_id = chunk.i32()?;
            material.layers.push(Layer { filter_mode, texture_id, shading_flags });
            chunk.at = layer_start + layer_size;
        }
        model.materials.push(material);
        chunk.at = start + size;
    }
    Ok(())
}
