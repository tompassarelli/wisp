//! The time the water, glow and falls animate on.

use std::time::Instant;

/// The wall clock since the renderer started, or a fixed time a test draws at, so its frames do not depend on how long a draw takes to read the clock.
#[derive(Clone, Copy, Debug)]
pub(crate) enum SceneClock {
    Since(Instant),
    #[cfg(test)]
    At(f32),
}

impl SceneClock {
    pub(crate) fn seconds(&self) -> f32 {
        match self {
            Self::Since(started) => started.elapsed().as_secs_f32(),
            #[cfg(test)]
            Self::At(seconds) => *seconds,
        }
    }
}
