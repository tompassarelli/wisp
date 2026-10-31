//! How a frame's poses are batched into instanced draws: one group per model and opacity, so a faded pose never shares a draw with a solid one.

/// A run of contiguous instances of one model, drawn together.
pub(super) struct Group {
    pub model: usize,
    /// Its poses are below full alpha, so its solid layers blend and it draws among the translucent groups.
    pub faded: bool,
    pub first: u32,
    pub count: u32,
}

/// Where a pose of model `id` at `alpha` is counted: two keys per model, the solid poses' and the faded poses'.
pub(super) fn key(id: usize, alpha: f32) -> usize {
    id * 2 + usize::from(alpha < 1.0)
}

/// The model and whether the poses are faded, for a `key`.
pub(super) fn split(key: usize) -> (usize, bool) {
    (key / 2, key % 2 == 1)
}
