/// What the render thread measured, one sample per frame (or per submitted scene), read back by Bun at the end of a run.
#[derive(Default)]
pub struct Metrics {
    pub presented_ms: Vec<f64>,
    pub acquire_ms: Vec<f64>,
    pub parse_ms: Vec<f64>,
    pub draw_ms: Vec<f64>,
    pub sample_to_present_ms: Vec<f64>,
    pub missed_scenes: u64,
}

/// The metric series `wisp_window_metric` serves, by the number Bun asks for.
pub const SERIES: [&str; 5] = ["presentedMs", "acquireMs", "parseMs", "drawMs", "sampleToPresentMs"];

impl Metrics {
    pub fn series(&self, which: u32) -> &[f64] {
        match which {
            0 => &self.presented_ms,
            1 => &self.acquire_ms,
            2 => &self.parse_ms,
            3 => &self.draw_ms,
            4 => &self.sample_to_present_ms,
            _ => &[],
        }
    }
}

pub fn ms(from_ns: u64, to_ns: u64) -> f64 {
    to_ns.saturating_sub(from_ns) as f64 / 1e6
}
