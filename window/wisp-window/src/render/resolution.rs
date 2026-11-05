//! Dynamic resolution: the scene's scale under `RenderScale::Auto`, moved in whole steps from the GPU's own frame times so the
//! slowest frames fit the display's budget.
//!
//! Each window of frames gives a p99 of the GPU span. Above the upper mark the scale drops at once to the step whose pixels,
//! at the window's cost per pixel, bring the p99 to the target; below the lower mark for two windows running it rises one step.
//! A step changes the pixels by at most 1.21 times, which the gap between the marks absorbs, so a cost that scales with the
//! pixels settles instead of rising into the upper mark and falling back.

use crate::settings::RenderScale;

/// Percent of the window's width and height between one scale and the next.
pub const STEP: u8 = 5;
/// Frames one decision reads.
const WINDOW: usize = 120;
/// Frames ignored after a change, whose timings were drawn at the scale before it.
const SETTLE: usize = 8;
/// The fraction of the budget the scale aims the p99 at when it drops.
const TARGET: f64 = 0.80;
/// A p99 above this fraction of the budget drops the scale.
const UPPER: f64 = 0.90;
/// A p99 below this fraction of the budget, two windows running, raises the scale one step.
const LOWER: f64 = 0.65;
/// The game steps 60 times a second, so a display faster than that still shows a new scene only every sixtieth of a second.
pub const STEP_PERIOD_MS: f64 = 1000.0 / 60.0;

/// The GPU time a frame may take: the display's period, or the game's step period on a display faster than 60 Hz.
pub fn budget_ms(display_period_ms: Option<f64>) -> f64 {
    display_period_ms.unwrap_or(STEP_PERIOD_MS).max(STEP_PERIOD_MS)
}

pub struct Resolution {
    setting: RenderScale,
    percent: u8,
    spans: Vec<f64>,
    skip: usize,
    quiet_windows: u32,
}

impl Resolution {
    pub fn new(setting: RenderScale) -> Self {
        Self { setting, percent: setting.ceiling(), spans: Vec::with_capacity(WINDOW), skip: 0, quiet_windows: 0 }
    }

    /// The scene's scale now, in percent of the window's sides.
    pub fn percent(&self) -> u8 {
        self.percent
    }

    /// Follows a new setting; a fixed scale applies at once and an automatic one starts again from the window's resolution.
    pub fn set(&mut self, setting: RenderScale) {
        if setting != self.setting {
            *self = Self::new(setting);
        }
    }

    /// Takes one frame's GPU span and returns the new scale when this frame's window moved it.
    pub fn observe(&mut self, span_ms: f64, budget_ms: f64) -> Option<u8> {
        let RenderScale::Auto { floor } = self.setting else { return None };
        if self.skip > 0 {
            self.skip -= 1;
            return None;
        }
        self.spans.push(span_ms);
        if self.spans.len() < WINDOW {
            return None;
        }
        self.spans.sort_by(f64::total_cmp);
        let p99 = self.spans[(self.spans.len() * 99).div_ceil(100) - 1];
        self.spans.clear();
        let next = if p99 > UPPER * budget_ms {
            self.quiet_windows = 0;
            let fitted = f64::from(self.percent) * (TARGET * budget_ms / p99).sqrt();
            let stepped = ((fitted / f64::from(STEP)).floor() as u8 * STEP).min(self.percent.saturating_sub(STEP));
            stepped.max(floor)
        } else if p99 < LOWER * budget_ms {
            self.quiet_windows += 1;
            if self.quiet_windows < 2 {
                return None;
            }
            self.quiet_windows = 0;
            (self.percent + STEP).min(100)
        } else {
            self.quiet_windows = 0;
            return None;
        };
        if next == self.percent {
            return None;
        }
        self.percent = next;
        self.skip = SETTLE;
        Some(next)
    }
}
