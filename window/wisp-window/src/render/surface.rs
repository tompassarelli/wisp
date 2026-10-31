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

    /// The surface of the parts of `model` that have a water layer, if any.
    pub fn of_water(model: &ModelData) -> Option<Self> {
        let wet = model.parts.iter().filter(|part| part.layers.iter().any(|layer| layer.paint == Paint::Water));
        let corners = wet.flat_map(|part| model.indices.get(part.first_index as usize..(part.first_index + part.index_count) as usize).unwrap_or_default());
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

#[cfg(test)]
mod tests {
    use super::*;

    fn placed(scale: [f32; 3], at: [f32; 3]) -> Mat4 {
        [scale[0], 0.0, 0.0, 0.0, 0.0, scale[1], 0.0, 0.0, 0.0, 0.0, scale[2], 0.0, at[0], at[1], at[2], 1.0]
    }

    #[test]
    fn a_surface_lies_at_its_top_once_placed_and_covers_its_scaled_extent() {
        let surface = Surface::of([[-50.0, -60.0, 0.0], [50.0, 60.0, 2.0]]).unwrap();
        let (height, area) = surface.placed(&placed([240.0, 140.0, 1.0], [0.0, 2200.0, -360.0]));
        assert_eq!(height, -358.0);
        assert_eq!(area, 100.0 * 240.0 * 120.0 * 140.0);
        assert_eq!(Surface::of([]), None);
    }
}
