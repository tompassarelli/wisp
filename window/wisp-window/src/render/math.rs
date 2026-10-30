//! Column-major 4x4 matrices, laid out as host/browser/matrix.ts so a pose's placement crosses the seam unchanged.

pub type Mat4 = [f32; 16];

pub const IDENTITY: Mat4 = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0];

pub fn multiply(a: &Mat4, b: &Mat4) -> Mat4 {
    let mut out = [0.0; 16];
    for column in 0..4 {
        for row in 0..4 {
            out[column * 4 + row] = (0..4).map(|k| a[k * 4 + row] * b[column * 4 + k]).sum();
        }
    }
    out
}

/// WebGL clip space spans z in [-1, 1]; wgpu's spans [0, 1]. Left-multiplying a GL projection maps one to the other.
const GL_TO_WGPU: Mat4 = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.5, 0.0, 0.0, 0.0, 0.5, 1.0];

/// `perspective` of host/browser/matrix.ts with `nativeProjection`'s rise, in wgpu's depth range.
pub fn projection(tangent: f32, near: f32, far: f32, aspect: f32, rise: f32) -> Mat4 {
    let mut out = [0.0; 16];
    out[0] = 1.0 / tangent;
    out[5] = aspect / tangent;
    out[9] = -rise;
    out[10] = (far + near) / (near - far);
    out[11] = -1.0;
    out[14] = 2.0 * far * near / (near - far);
    multiply(&GL_TO_WGPU, &out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn near_plane_maps_to_zero_and_far_to_one() {
        let p = projection(1.0, 10.0, 1000.0, 1.0, 0.0);
        let depth = |z: f32| (p[10] * z + p[14]) / (p[11] * z);
        assert!(depth(-10.0).abs() < 1e-5);
        assert!((depth(-1000.0) - 1.0).abs() < 1e-5);
    }

    #[test]
    fn multiply_applies_its_right_matrix_first() {
        let mut translate = IDENTITY;
        translate[12] = 5.0;
        let mut scale = IDENTITY;
        scale[0] = 2.0;
        scale[5] = 2.0;
        scale[10] = 2.0;
        assert_eq!(multiply(&translate, &scale)[12], 5.0);
        assert_eq!(multiply(&scale, &translate)[12], 10.0);
    }
}
