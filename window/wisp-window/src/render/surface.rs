//! Where a liquid model's surface lies once placed: the water pass mirrors the scene in one plane, the height of the widest liquid surface in view.

use super::math::Mat4;
use super::model::{ModelData, Paint};

/// A liquid model's water layers in its own space: the middle of their top and their half extent across.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Surface {
    pub centre: [f32; 3],
    pub half: [f32; 2],
}

impl Surface {
    pub fn of(points: impl IntoIterator<Item = [f32; 3]>) -> Option<Self> {
        let (mut low, mut high) = ([f32::MAX; 3], [f32::MIN; 3]);
        for point in points {
            for axis in 0..3 {
                low[axis] = low[axis].min(point[axis]);
                high[axis] = high[axis].max(point[axis]);
            }
        }
        (low[0] <= high[0]).then(|| Self { centre: [(low[0] + high[0]) * 0.5, (low[1] + high[1]) * 0.5, high[2]], half: [(high[0] - low[0]) * 0.5, (high[1] - low[1]) * 0.5] })
    }

    /// The surface of the parts of `model` that have a water layer and are not `falling` (water/falls.rs), if any.
    pub fn of_water(model: &ModelData, falling: &[bool]) -> Option<Self> {
        let wet = model.parts.iter().zip(falling).filter(|(part, &falling)| !falling && part.layers.iter().any(|layer| layer.paint == Paint::Water));
        let corners = wet.flat_map(|(part, _)| model.indices.get(part.first_index as usize..(part.first_index + part.index_count) as usize).unwrap_or_default());
        Self::of(corners.filter_map(|&vertex| model.vertices.get(vertex as usize)).map(|vertex| vertex.position))
    }

    /// The world height of the surface placed by `matrix`, and the world area it covers across.
    pub fn placed(&self, matrix: &Mat4) -> (f32, f32) {
        let [x, y, z] = self.centre;
        let height = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
        let area = 4.0 * self.half[0] * self.half[1] * (matrix[0] * matrix[5] - matrix[1] * matrix[4]).abs();
        (height, area)
    }
}
