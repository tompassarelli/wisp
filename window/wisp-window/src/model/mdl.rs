use super::track::{Key, LineType, Track};
use super::{Geoset, Model, ModelError, Node, Sequence};

const NODE_BLOCKS: [&str; 10] = [
    "Bone",
    "Helper",
    "Attachment",
    "Light",
    "EventObject",
    "CollisionShape",
    "ParticleEmitter",
    "ParticleEmitter2",
    "ParticleEmitterPopcorn",
    "RibbonEmitter",
];

const NODE_FLAGS: [(&str, u32); 5] = [("Billboarded", 8), ("BillboardedLockX", 16), ("BillboardedLockY", 32), ("BillboardedLockZ", 64), ("CameraAnchored", 128)];
const DONT_INHERIT: [(&str, u32); 3] = [("Translation", 1), ("Rotation", 2), ("Scaling", 4)];

struct Parser<'a> {
    text: &'a [u8],
    at: usize,
}

type Parsed<T> = Result<T, ModelError>;

impl<'a> Parser<'a> {
    fn space(&mut self) {
        loop {
            while self.text.get(self.at).is_some_and(u8::is_ascii_whitespace) {
                self.at += 1;
            }
            if self.text[self.at.min(self.text.len())..].starts_with(b"//") {
                while self.text.get(self.at).is_some_and(|&byte| byte != b'\n') {
                    self.at += 1;
                }
            } else {
                return;
            }
        }
    }

    fn peek(&mut self) -> Option<u8> {
        self.space();
        self.text.get(self.at).copied()
    }

    fn fail<T>(&self, expected: &'static str) -> Parsed<T> {
        Err(ModelError::Syntax { expected, at: self.at })
    }

    fn symbol(&mut self, symbol: u8) -> bool {
        let found = self.peek() == Some(symbol);
        self.at += usize::from(found);
        found
    }

    fn expect(&mut self, symbol: u8, expected: &'static str) -> Parsed<()> {
        if self.symbol(symbol) { Ok(()) } else { self.fail(expected) }
    }

    fn keyword(&mut self) -> Option<&'a str> {
        if !self.peek()?.is_ascii_alphabetic() {
            return None;
        }
        let start = self.at;
        while self.text.get(self.at).is_some_and(u8::is_ascii_alphanumeric) {
            self.at += 1;
        }
        std::str::from_utf8(&self.text[start..self.at]).ok()
    }

    fn number(&mut self) -> Option<f64> {
        if !matches!(self.peek()?, b'-' | b'+' | b'.' | b'0'..=b'9') {
            return None;
        }
        let start = self.at;
        while self.text.get(self.at).is_some_and(|byte| matches!(byte, b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9')) {
            self.at += 1;
        }
        std::str::from_utf8(&self.text[start..self.at]).ok()?.parse().ok()
    }

    fn require_number(&mut self) -> Parsed<f64> {
        self.number().map_or_else(|| self.fail("a number"), Ok)
    }

    fn string(&mut self) -> Option<&'a str> {
        if self.peek()? != b'"' {
            return None;
        }
        let start = self.at + 1;
        let length = self.text[start..].iter().position(|&byte| byte == b'"')?;
        self.at = start + length + 1;
        std::str::from_utf8(&self.text[start..start + length]).ok()
    }

    fn array(&mut self) -> Parsed<Vec<f64>> {
        self.expect(b'{', "{")?;
        let mut out = Vec::new();
        while !self.symbol(b'}') {
            out.push(self.require_number()?);
            self.symbol(b',');
        }
        Ok(out)
    }

    fn fixed<const N: usize>(&mut self) -> Parsed<[f32; N]> {
        let values = if self.peek() == Some(b'{') { self.array()? } else { vec![self.require_number()?] };
        if values.len() != N {
            return self.fail("a vector of the right length");
        }
        Ok(std::array::from_fn(|i| values[i] as f32))
    }

    fn skip_block(&mut self) -> Parsed<()> {
        self.expect(b'{', "{")?;
        let mut depth = 1;
        while depth > 0 {
            match self.peek() {
                Some(b'{') => depth += 1,
                Some(b'}') => depth -= 1,
                Some(b'"') => {
                    if self.string().is_none() {
                        return self.fail("a closing quote");
                    }
                    continue;
                }
                Some(_) => {}
                None => return self.fail("}"),
            }
            self.at += 1;
        }
        Ok(())
    }

    fn skip_member(&mut self) -> Parsed<()> {
        loop {
            match self.peek() {
                Some(b',') => {
                    self.at += 1;
                    return Ok(());
                }
                Some(b'{') => {
                    self.skip_block()?;
                    self.symbol(b',');
                    return Ok(());
                }
                Some(b'}') | None => return Ok(()),
                Some(b'"') => {
                    self.string();
                }
                Some(_) => self.at += 1,
            }
        }
    }

    fn track<const N: usize>(&mut self) -> Parsed<Track<N>> {
        self.require_number()?;
        self.expect(b'{', "{")?;
        let line = match self.keyword() {
            Some("DontInterp") => LineType::DontInterp,
            Some("Linear") => LineType::Linear,
            Some("Hermite") => LineType::Hermite,
            Some("Bezier") => LineType::Bezier,
            _ => return self.fail("an interpolation name"),
        };
        self.expect(b',', ",")?;
        let mut track = Track::new(line);
        while !self.symbol(b'}') {
            if self.keyword() == Some("GlobalSeqId") {
                track.global_sequence = Some(self.require_number()? as usize);
                self.expect(b',', ",")?;
                continue;
            }
            let frame = self.require_number()? as i32;
            self.expect(b':', ":")?;
            let value = self.fixed()?;
            self.expect(b',', ",")?;
            let mut key = Key { frame, value, in_tan: [0.0; N], out_tan: [0.0; N] };
            if line.has_tangents() {
                self.keyword();
                key.in_tan = self.fixed()?;
                self.expect(b',', ",")?;
                self.keyword();
                key.out_tan = self.fixed()?;
                self.expect(b',', ",")?;
            }
            track.keys.push(key);
        }
        Ok(track)
    }

    fn node(&mut self) -> Parsed<Node> {
        let name = self.string().unwrap_or_default().to_owned();
        self.expect(b'{', "{")?;
        let mut node = Node { name, ..Node::default() };
        let mut has_id = false;
        while !self.symbol(b'}') {
            let Some(keyword) = self.keyword() else { return self.fail("a node member") };
            match keyword {
                "ObjectId" => {
                    node.object_id = self.require_number()? as usize;
                    has_id = true;
                }
                "Parent" => node.parent = Some(self.require_number()? as usize),
                "Translation" => node.translation = Some(self.track()?),
                "Rotation" => node.rotation = Some(self.track()?),
                "Scaling" => node.scaling = Some(self.track()?),
                "DontInherit" => {
                    for inherited in self.array_words()? {
                        node.flags |= DONT_INHERIT.iter().find(|(word, _)| *word == inherited).map_or(0, |(_, bit)| *bit);
                    }
                }
                flag if NODE_FLAGS.iter().any(|(word, _)| *word == flag) => node.flags |= NODE_FLAGS.iter().find(|(word, _)| *word == flag).map_or(0, |(_, bit)| *bit),
                _ => {
                    self.skip_member()?;
                    continue;
                }
            }
            self.symbol(b',');
        }
        if has_id { Ok(node) } else { self.fail("an ObjectId") }
    }

    fn array_words(&mut self) -> Parsed<Vec<&'a str>> {
        self.expect(b'{', "{")?;
        let mut words = Vec::new();
        while !self.symbol(b'}') {
            let Some(word) = self.keyword() else { return self.fail("a word") };
            words.push(word);
            self.symbol(b',');
        }
        Ok(words)
    }

    fn sequences(&mut self, model: &mut Model) -> Parsed<()> {
        self.require_number()?;
        self.expect(b'{', "{")?;
        while !self.symbol(b'}') {
            if self.keyword() != Some("Anim") {
                return self.fail("Anim");
            }
            let name = self.string().unwrap_or_default().to_owned();
            self.expect(b'{', "{")?;
            let mut sequence = Sequence { name, interval: [0; 2], non_looping: false, move_speed: 0.0, rarity: 0.0 };
            while !self.symbol(b'}') {
                match self.keyword() {
                    Some("Interval") => {
                        let edges = self.array()?;
                        sequence.interval = [edges.first().copied().unwrap_or(0.0) as u32, edges.get(1).copied().unwrap_or(0.0) as u32];
                    }
                    Some("NonLooping") => sequence.non_looping = true,
                    Some("MoveSpeed") => sequence.move_speed = self.require_number()? as f32,
                    Some("Rarity") => sequence.rarity = self.require_number()? as f32,
                    Some(_) => {
                        self.skip_member()?;
                        continue;
                    }
                    None => return self.fail("an Anim member"),
                }
                self.symbol(b',');
            }
            model.sequences.push(sequence);
        }
        Ok(())
    }

    fn global_sequences(&mut self, model: &mut Model) -> Parsed<()> {
        self.require_number()?;
        self.expect(b'{', "{")?;
        while !self.symbol(b'}') {
            if self.keyword() == Some("Duration") {
                model.global_sequences.push(self.require_number()? as u32);
            }
            self.symbol(b',');
        }
        Ok(())
    }

    fn rows(&mut self) -> Parsed<Vec<Vec<f64>>> {
        self.require_number()?;
        self.expect(b'{', "{")?;
        let mut rows = Vec::new();
        while !self.symbol(b'}') {
            rows.push(self.array()?);
            self.symbol(b',');
        }
        Ok(rows)
    }

    fn geoset(&mut self) -> Parsed<Geoset> {
        self.expect(b'{', "{")?;
        let mut geoset = Geoset::default();
        while !self.symbol(b'}') {
            let Some(keyword) = self.keyword() else { return self.fail("a geoset member") };
            match keyword {
                "Vertices" => geoset.vertices = self.rows()?.iter().map(|row| std::array::from_fn(|i| row.get(i).copied().unwrap_or(0.0) as f32)).collect(),
                "VertexGroup" => geoset.vertex_group = self.array()?.into_iter().map(|id| id as u8).collect(),
                "Groups" => {
                    self.require_number()?;
                    self.require_number()?;
                    self.expect(b'{', "{")?;
                    while !self.symbol(b'}') {
                        self.keyword();
                        geoset.groups.push(self.array()?.into_iter().map(|id| id as u32).collect());
                        self.symbol(b',');
                    }
                }
                "SkinWeights" => {
                    for row in self.rows()? {
                        geoset.skin_weights.push(std::array::from_fn(|i| row.get(i).copied().unwrap_or(0.0) as u8));
                    }
                }
                _ => {
                    self.skip_member()?;
                    continue;
                }
            }
            self.symbol(b',');
        }
        Ok(geoset)
    }
}

pub(super) fn parse(text: &str) -> Result<Model, ModelError> {
    let mut parser = Parser { text: text.as_bytes(), at: 0 };
    let mut model = Model { version: 800, ..Model::default() };
    let mut pivots = Vec::new();
    while let Some(keyword) = parser.keyword() {
        match keyword {
            "Version" => {
                parser.expect(b'{', "{")?;
                while !parser.symbol(b'}') {
                    if parser.keyword() == Some("FormatVersion") {
                        model.version = parser.require_number()? as u32;
                    }
                    parser.symbol(b',');
                }
            }
            "Sequences" => parser.sequences(&mut model)?,
            "GlobalSequences" => parser.global_sequences(&mut model)?,
            "Geoset" => model.geosets.push(parser.geoset()?),
            "PivotPoints" => pivots = parser.rows()?.iter().map(|row| std::array::from_fn(|i| row.get(i).copied().unwrap_or(0.0) as f32)).collect(),
            block if NODE_BLOCKS.contains(&block) => model.insert_node(parser.node()?),
            _ => {
                while !matches!(parser.peek(), Some(b'{') | None) {
                    if parser.string().is_none() {
                        parser.at += 1;
                    }
                }
                parser.skip_block()?;
            }
        }
    }
    model.finish(&pivots)
}
