//! How a frame's poses are batched into instanced draws: one group per model, opacity and kind, so a faded pose never shares a draw with a solid one and a unit never shares one with the stage.

/// A run of contiguous instances of one model, drawn together.
pub(super) struct Group {
    pub model: usize,
    /// Its poses are below full alpha, so its solid layers blend and it draws among the translucent groups.
    pub faded: bool,
    /// Its poses are units, which mark their pixels for the final-image pass and cast into the fighters' map.
    pub unit: bool,
    pub first: u32,
    pub count: u32,
}

/// The keys a model's poses are counted under: solid or faded, stage or unit.
pub(super) const KEYS_PER_MODEL: usize = 4;

/// Where a pose of model `id` at `alpha` is counted.
pub(super) fn key(id: usize, alpha: f32, unit: bool) -> usize {
    id * KEYS_PER_MODEL + usize::from(alpha < 1.0) + 2 * usize::from(unit)
}

/// The model, whether the poses are faded and whether they are units, for a `key`.
pub(super) fn split(key: usize) -> (usize, bool, bool) {
    (key / KEYS_PER_MODEL, key % 2 == 1, key % KEYS_PER_MODEL >= 2)
}
