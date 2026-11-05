//! Falling water: a water layer whose faces stand on end, as a waterfall's sheet does, is not drawn as the sea stood up but as its own thing: streaks running down,
//! a body lightened by air and a band of foam and mist where it meets the surface below. The water pass draws it with its own fragment entry and the same images and uniform.

use crate::render::model::{ModelData, Paint, Part, Vertex};

/// The most vertical share of a face's normal a falling face has; a water face lying flatter than this is standing water, so it takes the sea's look.
pub const FALL_NORMAL_Z: f32 = 0.5;

/// Rows of the uniform a fall fills.
pub const ROWS: usize = 2;

/// World units to a metre, taken from a fighter standing about 1.8 m tall.
const UNITS_PER_METRE: f32 = 70.0;

/// How falling water looks; the same for every fall, since a fall is told by its geometry and not by a name.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Fall {
    /// How fast the streaks run down, in world units a second.
    pub speed: f32,
    /// How wide the finest streak is, in world units.
    pub width: f32,
    /// How much air whitens the body, 0 to 1.
    pub aeration: f32,
    /// How high the foam and mist stand above the surface the fall meets, in world units.
    pub mist: f32,
}

impl Fall {
    /// Streaks run down at 4 m/s: a sheet that has dropped about 0.8 m is going that fast (v = sqrt(2 g h)), the slowest speed at which water reads as falling at all;
    /// the surface of a taller fall is faster, but a streak that crosses a fighter's height in under half a second smears into noise at 60 frames a second.
    pub const WATERFALL: Self = Self { speed: 4.0 * UNITS_PER_METRE, width: 11.0, aeration: 0.7, mist: 150.0 };

    /// The uniform rows the water shader reads: the look, then the height of the surface below the fall (the lowest float when the scene has none). A fall takes the colours of the liquid it falls into.
    pub fn rows(&self, plane: Option<f32>) -> [[f32; 4]; ROWS] {
        [[self.speed, self.width, self.aeration, self.mist], [plane.unwrap_or(f32::MIN), 0.0, 0.0, 0.0]]
    }
}

/// For each part of `model`, whether it is falling water: a part with a water layer whose faces stand on end.
pub fn of_parts(model: &ModelData) -> Vec<bool> {
    let falls = |part: &Part| {
        let faces = model.indices.get(part.first_index as usize..(part.first_index + part.index_count) as usize).unwrap_or(&[]);
        part.layers.iter().any(|layer| layer.paint == Paint::Water) && is_falling(&model.vertices, faces)
    };
    model.parts.iter().map(falls).collect()
}

/// Whether the water faces of `indices` (triangles into `vertices`), taken by area, are mostly falling water: a sheet built standing on end, not a surface lying flat.
pub fn is_falling(vertices: &[Vertex], indices: &[u32]) -> bool {
    let (mut steep, mut flat) = (0.0f32, 0.0f32);
    for triangle in indices.chunks_exact(3) {
        let [a, b, c] = [0, 1, 2].map(|corner| vertices.get(triangle[corner] as usize).map_or([0.0; 3], |vertex| vertex.position));
        let edge = |to: [f32; 3], from: [f32; 3]| [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
        let (u, v) = (edge(b, a), edge(c, a));
        let normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        let area = (normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]).sqrt();
        if area <= f32::EPSILON {
            continue;
        }
        if normal[2].abs() / area < FALL_NORMAL_Z {
            steep += area;
        } else {
            flat += area;
        }
    }
    steep > flat
}
