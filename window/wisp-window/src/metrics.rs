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

const PULSE_NS: u64 = 5_000_000_000;

/// One presented frame as the pulse counts it.
pub struct Beat {
    pub presented_ns: u64,
    pub interval_ms: Option<f64>,
    pub step: u64,
    pub late: bool,
    pub dropped: bool,
    pub acquire_ms: f64,
    pub draw_ms: f64,
}

/// The rates a player's window prints every five seconds, so a slow window says whether it lacks presents, ticks or scenes without a scripted run.
#[derive(Default)]
pub struct Pulse {
    began: Option<(u64, u64)>,
    intervals: Vec<f64>,
    acquires: Vec<f64>,
    draws: Vec<f64>,
    late: u32,
    dropped: u32,
}

fn percentile(values: &mut [f64], at: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values.sort_by(f64::total_cmp);
    values[((values.len() as f64 * at).ceil() as usize).clamp(1, values.len()) - 1]
}

impl Pulse {
    /// Counts one presented frame and returns the line for the five seconds it closes.
    pub fn beat(&mut self, beat: Beat) -> Option<String> {
        let (began_ns, began_step) = *self.began.get_or_insert((beat.presented_ns, beat.step));
        if let Some(interval) = beat.interval_ms {
            self.intervals.push(interval);
        }
        self.acquires.push(beat.acquire_ms);
        self.draws.push(beat.draw_ms);
        self.late += beat.late as u32;
        self.dropped += beat.dropped as u32;
        let elapsed_ns = beat.presented_ns.saturating_sub(began_ns);
        if elapsed_ns < PULSE_NS {
            return None;
        }
        let seconds = elapsed_ns as f64 / 1e9;
        let line = format!(
            "wisp-window: {:.1} frames/s (frame p50 {:.1} ms, p99 {:.1} ms), {:.1} ticks/s, acquire p99 {:.1} ms, draw p99 {:.1} ms, {} late scenes, {} dropped samples over {seconds:.1} s",
            self.intervals.len() as f64 / seconds,
            percentile(&mut self.intervals, 0.5),
            percentile(&mut self.intervals, 0.99),
            beat.step.saturating_sub(began_step) as f64 / seconds,
            percentile(&mut self.acquires, 0.99),
            percentile(&mut self.draws, 0.99),
            self.late,
            self.dropped,
        );
        *self = Self { began: Some((beat.presented_ns, beat.step)), ..Self::default() };
        Some(line)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pulse_reports_frames_and_ticks_per_second_every_five_seconds() {
        let mut pulse = Pulse::default();
        let mut lines = Vec::new();
        for frame in 0..=600u64 {
            let beat = Beat { presented_ns: frame * 8_333_334, interval_ms: (frame > 0).then_some(8.333), step: frame / 2, late: false, dropped: false, acquire_ms: 0.1, draw_ms: 2.0 };
            lines.extend(pulse.beat(beat));
        }
        assert_eq!(lines.len(), 1, "{lines:?}");
        assert!(lines[0].starts_with("wisp-window: 120.0 frames/s (frame p50 8.3 ms, p99 8.3 ms), 60.0 ticks/s"), "{}", lines[0]);
    }
}
