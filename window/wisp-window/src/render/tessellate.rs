//! Rounds a model's silhouette by midpoint subdivision with PN-triangle edge points (Vlachos et al., "Curved PN Triangles", 2001), done once on the CPU when the model is built so the skinned bind pose and the GPU skinning stay as they were. A midpoint moves to where the cubic Bezier edge through its two corners passes, which depends only on the edge's endpoint positions and normals; corners never move. An edge keeps its straight midpoint where the shape must not change: on the mesh's open border, where more than two triangles meet, and along a seam where the two sides disagree about the normals (a crease or a UV split), so no crack opens and no outline the artist cut sharp is softened. A midpoint also moves at most `MAX_SHIFT` of its edge's length.

use std::collections::HashMap;

use super::model::{ModelData, Part, Vertex};

const MAX_SHIFT: f32 = 0.08;
const QUANTUM: f32 = 1e-4;
const AGREE: f32 = 1e-3;

type Key = [i64; 3];

fn key(position: [f32; 3]) -> Key {
    position.map(|value| (value / QUANTUM).round() as i64)
}

fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn length(a: [f32; 3]) -> f32 {
    dot(a, a).sqrt()
}

fn normalized(a: [f32; 3]) -> [f32; 3] {
    let size = length(a);
    if size < 1e-9 {
        [0.0, 0.0, 1.0]
    } else {
        a.map(|value| value / size)
    }
}

/// The offset of an edge's PN midpoint from its straight midpoint, limited to `MAX_SHIFT` of the edge.
fn shift(a: &Vertex, b: &Vertex) -> [f32; 3] {
    let along = sub(b.position, a.position);
    let (from_a, from_b) = (dot(along, a.normal), -dot(along, b.normal));
    let mut shifted = [0, 1, 2].map(|axis| -(from_a * a.normal[axis] + from_b * b.normal[axis]) / 8.0);
    let (size, limit) = (length(shifted), length(along) * MAX_SHIFT);
    if size > limit {
        shifted = shifted.map(|value| value * limit / size);
    }
    shifted
}

fn merged_skin(a: &Vertex, b: &Vertex) -> ([u16; 4], [f32; 4]) {
    let mut pairs: Vec<(u16, f32)> = Vec::with_capacity(8);
    for (bones, weights) in [(a.bones, a.weights), (b.bones, b.weights)] {
        for (bone, weight) in bones.into_iter().zip(weights) {
            match pairs.iter_mut().find(|(existing, _)| *existing == bone) {
                Some((_, total)) => *total += weight * 0.5,
                None if weight > 0.0 => pairs.push((bone, weight * 0.5)),
                None => {}
            }
        }
    }
    pairs.sort_by(|x, y| y.1.total_cmp(&x.1));
    pairs.truncate(4);
    let total: f32 = pairs.iter().map(|pair| pair.1).sum();
    let (mut bones, mut weights) = ([0u16; 4], [0.0f32; 4]);
    for (slot, (bone, weight)) in pairs.into_iter().enumerate() {
        bones[slot] = bone;
        weights[slot] = if total > 0.0 { weight / total } else { 0.0 };
    }
    if total <= 0.0 {
        (bones, weights) = (a.bones, a.weights);
    }
    (bones, weights)
}

struct Edge {
    uses: u32,
    shift: [f32; 3],
    agrees: bool,
}

fn edge_pair(a: u32, b: u32) -> (u32, u32) {
    (a.min(b), a.max(b))
}

fn position_edge(vertices: &[Vertex], a: u32, b: u32) -> (Key, Key) {
    let (ka, kb) = (key(vertices[a as usize].position), key(vertices[b as usize].position));
    if ka <= kb { (ka, kb) } else { (kb, ka) }
}

/// Where each shared edge stands: how many triangles use it and whether they all compute the same shift.
fn survey(vertices: &[Vertex], indices: &[u32]) -> HashMap<(Key, Key), Edge> {
    let mut edges: HashMap<(Key, Key), Edge> = HashMap::new();
    for triangle in indices.chunks_exact(3) {
        for (a, b) in [(triangle[0], triangle[1]), (triangle[1], triangle[2]), (triangle[2], triangle[0])] {
            let (low, high) = edge_pair(a, b);
            let moved = shift(&vertices[low as usize], &vertices[high as usize]);
            let entry = edges.entry(position_edge(vertices, a, b)).or_insert(Edge { uses: 0, shift: moved, agrees: true });
            entry.agrees &= length(sub(entry.shift, moved)) <= AGREE * length(sub(vertices[a as usize].position, vertices[b as usize].position)).max(QUANTUM);
            entry.uses += 1;
        }
    }
    edges
}

fn subdivide(vertices: &mut Vec<Vertex>, indices: &[u32]) -> Vec<u32> {
    let edges = survey(vertices, indices);
    let mut midpoints: HashMap<(u32, u32), u32> = HashMap::new();
    let mut midpoint = |vertices: &mut Vec<Vertex>, a: u32, b: u32| -> u32 {
        let pair = edge_pair(a, b);
        if let Some(&found) = midpoints.get(&pair) {
            return found;
        }
        let (va, vb) = (vertices[pair.0 as usize], vertices[pair.1 as usize]);
        let edge = &edges[&position_edge(vertices, a, b)];
        let offset = if edge.uses == 2 && edge.agrees { edge.shift } else { [0.0; 3] };
        let (bones, weights) = merged_skin(&va, &vb);
        let added = Vertex {
            position: [0, 1, 2].map(|axis| (va.position[axis] + vb.position[axis]) * 0.5 + offset[axis]),
            normal: normalized([0, 1, 2].map(|axis| va.normal[axis] + vb.normal[axis])),
            uv: [(va.uv[0] + vb.uv[0]) * 0.5, (va.uv[1] + vb.uv[1]) * 0.5],
            bones,
            weights,
        };
        vertices.push(added);
        let index = vertices.len() as u32 - 1;
        midpoints.insert(pair, index);
        index
    };
    let mut out = Vec::with_capacity(indices.len() * 4);
    for triangle in indices.chunks_exact(3) {
        let (a, b, c) = (triangle[0], triangle[1], triangle[2]);
        let (ab, bc, ca) = (midpoint(vertices, a, b), midpoint(vertices, b, c), midpoint(vertices, c, a));
        out.extend([a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca]);
    }
    out
}

/// Subdivides every triangle of every part `levels` times; part boundaries and layers carry over.
pub fn tessellate(data: &mut ModelData, levels: u32) {
    if levels == 0 {
        return;
    }
    let mut indices = Vec::new();
    let mut parts = Vec::with_capacity(data.parts.len());
    for part in std::mem::take(&mut data.parts) {
        let first = part.first_index as usize;
        let mut triangles = data.indices[first..first + part.index_count as usize].to_vec();
        for _ in 0..levels {
            triangles = subdivide(&mut data.vertices, &triangles);
        }
        parts.push(Part { color_slot: part.color_slot, first_index: indices.len() as u32, index_count: triangles.len() as u32, layers: part.layers });
        indices.extend(triangles);
    }
    data.indices = indices;
    data.parts = parts;
}
