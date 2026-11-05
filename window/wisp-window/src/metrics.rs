use crate::gpu_time::{FrameGpu, Pass, PASSES};

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
    CpuEncode,
    GpuFrame,
    RenderScale,
    GpuPass(Pass),
}

const FIXED: usize = 12;

impl Series {
    pub fn index(self) -> usize {
        match self {
            Self::Presented => 0,
            Self::Acquire => 1,
            Self::Parse => 2,
            Self::Draw => 3,
            Self::InputToPresent => 4,
            Self::MissedPresents => 5,
            Self::MissedPresentsAfterLateScene => 6,
            Self::LateScenes => 7,
            Self::DroppedSamples => 8,
            Self::CpuEncode => 9,
            Self::GpuFrame => 10,
            Self::RenderScale => 11,
            Self::GpuPass(pass) => FIXED + pass as usize,
        }
    }
}

/// The metric series `wisp_window_metric` serves, by the number Bun asks for, in `Series` order. The four flag series hold a 1 for each frame that counted and a 0 for each that did not;
/// `cpuEncodeMs` is the render thread's time to record and finish a frame's commands, `renderScalePercent` is the scene's size against the window's for each frame, and the `gpu` series are GPU times that come back a few frames after the frame they time.
pub const SERIES: [&str; FIXED + PASSES.len()] = [
    "presentedMs", "acquireMs", "parseMs", "drawMs", "inputToPresentMs", "missedPresents", "missedPresentsAfterLateScene", "lateScenes", "droppedSamples",
    "cpuEncodeMs",
    "gpuFrameMs",
    "renderScalePercent",
    "gpuShadowMs",
    "gpuFighterShadowMs",
    "gpuReflectionMs",
    "gpuCloudsMs",
    "gpuSkyMs",
    "gpuSceneMs",
    "gpuWaterMs",
    "gpuPostMs",
    "gpuSpritesMs",
    "gpuUiMs",
    "gpuCounterMs",
];

/// What the render thread measured, one sample per frame, read back by Bun at the end of a run.
#[derive(Default)]
pub struct Metrics {
    series: [Vec<f64>; SERIES.len()],
}

impl Metrics {
    pub fn push(&mut self, which: Series, value: f64) {
        self.series[which.index()].push(value);
    }

    pub fn flag(&mut self, which: Series, set: bool) {
        self.push(which, if set { 1.0 } else { 0.0 });
    }

    /// Records one frame's GPU times as they come back: its span, and each kind of pass it ran.
    pub fn gpu(&mut self, frame: &FrameGpu) {
        self.push(Series::GpuFrame, frame.span_ms);
        for &(pass, ms) in &frame.passes {
            self.push(Series::GpuPass(pass), ms);
        }
    }

    pub fn series(&self, which: u32) -> &[f64] {
        self.series.get(which as usize).map_or(&[], Vec::as_slice)
    }
}

pub fn ms(from_ns: u64, to_ns: u64) -> f64 {
    to_ns.saturating_sub(from_ns) as f64 / 1e6
}

/// What a surface measured of the frame it just drew: the time to encode it, and the GPU times of earlier frames that have come back.
#[derive(Default)]
pub struct Timings {
    pub cpu_encode_ms: Option<f64>,
    /// The scene's scale the frame was drawn at, in percent of the window's sides.
    pub render_scale: Option<u8>,
    pub gpu: Vec<FrameGpu>,
}

const PULSE_NS: u64 = 5_000_000_000;

/// One presented frame as the pulse counts it.
pub struct Beat {
    pub presented_ns: u64,
    pub interval_ms: Option<f64>,
    /// How many steps the clock has given the game, so ticks/s is the game's own rate and not the scenes the presents happened to show.
    pub step: u64,
    pub late: bool,
    pub dropped: u32,
    pub acquire_ms: f64,
    pub draw_ms: f64,
    pub gpu_ms: Vec<f64>,
    pub render_scale: Option<u8>,
    pub present: &'static str,
}

/// The rates a player's window prints every five seconds, so a slow window says whether it lacks presents, ticks or scenes without a scripted run.
#[derive(Default)]
pub struct Pulse {
    began: Option<(u64, u64)>,
    intervals: Vec<f64>,
    acquires: Vec<f64>,
    draws: Vec<f64>,
    gpus: Vec<f64>,
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
        self.gpus.extend(beat.gpu_ms);
        self.late += beat.late as u32;
        self.dropped += beat.dropped;
        let elapsed_ns = beat.presented_ns.saturating_sub(began_ns);
        if elapsed_ns < PULSE_NS {
            return None;
        }
        let seconds = elapsed_ns as f64 / 1e9;
        let line = format!(
            "wisp-window: {:.1} frames/s (frame p50 {:.1} ms, p99 {:.1} ms, worst {:.1} ms), {:.1} ticks/s, acquire p99 {:.1} ms, draw p99 {:.1} ms, {}{}, {} late scenes, {} dropped samples over {seconds:.1} s, present {}",
            self.intervals.len() as f64 / seconds,
            percentile(&mut self.intervals, 0.5),
            percentile(&mut self.intervals, 0.99),
            self.intervals.iter().copied().fold(0.0, f64::max),
            beat.step.saturating_sub(began_step) as f64 / seconds,
            percentile(&mut self.acquires, 0.99),
            percentile(&mut self.draws, 0.99),
            if self.gpus.is_empty() { "gpu untimed".to_string() } else { format!("gpu p99 {:.1} ms", percentile(&mut self.gpus, 0.99)) },
            beat.render_scale.map_or(String::new(), |percent| format!(", scene at {percent}%")),
            self.late,
            self.dropped,
            beat.present,
        );
        *self = Self { began: Some((beat.presented_ns, beat.step)), ..Self::default() };
        Some(line)
    }
}
