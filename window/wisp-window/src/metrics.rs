#[derive(Clone, Copy)]
pub enum Series {
    Presented,
    Acquire,
    Parse,
    Draw,
    InputToPresent,
    MissedPresents,
    MissedPresentsAfterLateScene,
    LateScenes,
    DroppedSamples,
}

/// The metric series `wisp_window_metric` serves, by the number Bun asks for, in `Series` order. The last four hold a 1 for each frame that counted and a 0 for each that did not.
pub const SERIES: [&str; 9] =
    ["presentedMs", "acquireMs", "parseMs", "drawMs", "inputToPresentMs", "missedPresents", "missedPresentsAfterLateScene", "lateScenes", "droppedSamples"];

/// What the render thread measured, one sample per frame, read back by Bun at the end of a run.
#[derive(Default)]
pub struct Metrics {
    series: [Vec<f64>; 9],
}

impl Metrics {
    pub fn push(&mut self, which: Series, value: f64) {
        self.series[which as usize].push(value);
    }

    pub fn flag(&mut self, which: Series, set: bool) {
        self.push(which, if set { 1.0 } else { 0.0 });
    }

    pub fn series(&self, which: u32) -> &[f64] {
        self.series.get(which as usize).map_or(&[], Vec::as_slice)
    }
}

pub fn ms(from_ns: u64, to_ns: u64) -> f64 {
    to_ns.saturating_sub(from_ns) as f64 / 1e6
}
