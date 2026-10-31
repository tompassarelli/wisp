use super::super::{Light, Model, ModelError};
use super::Reader;

pub(super) fn parse(chunk: &mut Reader, model: &mut Model) -> Result<(), ModelError> {
    while chunk.at < chunk.bytes.len() {
        let start = chunk.at;
        let size = chunk.count()?;
        let node = chunk.node()?;
        let id = node.object_id;
        let kind = chunk.i32()?;
        let (near, far) = (chunk.f32()?, chunk.f32()?);
        let (color, intensity) = (chunk.floats::<3>()?, chunk.f32()?);
        chunk.at = start + size;
        model.insert_node(node);
        model.lights.push(Light { node: id, kind, start: near, end: far, color, intensity, pivot: [0.0; 3] });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::NAME_LENGTH;
    use super::*;

    fn int(out: &mut Vec<u8>, value: i32) {
        out.extend_from_slice(&value.to_le_bytes());
    }

    fn float(out: &mut Vec<u8>, value: f32) {
        out.extend_from_slice(&value.to_le_bytes());
    }

    #[test]
    fn a_light_node_reads_its_kind_attenuation_colour_and_intensity() {
        let mut node = Vec::new();
        int(&mut node, 96);
        node.extend_from_slice(b"torch");
        node.resize(4 + NAME_LENGTH, 0);
        for value in [3, -1, 0] {
            int(&mut node, value);
        }
        let mut body = Vec::new();
        int(&mut body, 0);
        for value in [80.0, 600.0, 1.0, 0.5, 0.25, 2.0, 0.0, 0.0, 0.0, 0.0] {
            float(&mut body, value);
        }
        let mut chunk = Vec::new();
        int(&mut chunk, (4 + node.len() + body.len()) as i32);
        chunk.extend_from_slice(&node);
        chunk.extend_from_slice(&body);
        let mut model = Model::default();
        parse(&mut Reader { bytes: &chunk, at: 0 }, &mut model).unwrap();
        assert_eq!(model.lights, vec![Light { node: 3, kind: 0, start: 80.0, end: 600.0, color: [1.0, 0.5, 0.25], intensity: 2.0, pivot: [0.0; 3] }]);
        assert!(model.nodes[3].is_some());
    }
}
