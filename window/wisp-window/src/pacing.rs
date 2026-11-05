use std::collections::VecDeque;

const WORK_WINDOW: usize = 120;
const WORK_MINIMUM: usize = 10;
const MARGIN_START_MS: f64 = 1.0;
const MARGIN_GROWTH_MS: f64 = 0.5;
const CLEAN_FRAMES_TO_SHRINK: u32 = 600;
const MARGIN_LIMIT_MS: f64 = 6.0;
const SIM_HZ: f64 = 60.0;
const FALLBACK_FINISH_MS: f64 = 2.0;
const WAKE_LIMIT_MS: f64 = 2.0;
const PHASE_CREEP_NS: u64 = 50_000;
const MAX_WORK_MS: f64 = 2000.0 / SIM_HZ;

/// Where in a display frame the sample is taken: late enough that the step, the encode and the draw finish just before the present, early enough to leave the measured p99 and a margin.
pub struct Pacer {
    work: VecDeque<f64>,
    finish: VecDeque<f64>,
    wake: VecDeque<f64>,
    margin_ms: f64,
    clean: u32,
}

impl Default for Pacer {
    fn default() -> Self {
        Self { work: VecDeque::new(), finish: VecDeque::new(), wake: VecDeque::new(), margin_ms: MARGIN_START_MS, clean: 0 }
    }
}

fn push(window: &mut VecDeque<f64>, value: f64) {
    window.push_back(value);
    if window.len() > WORK_WINDOW {
        window.pop_front();
    }
}

fn p99(window: &VecDeque<f64>) -> Option<f64> {
    if window.len() < WORK_MINIMUM {
        return None;
    }
    let mut sorted: Vec<f64> = window.iter().copied().collect();
    sorted.sort_by(f64::total_cmp);
    Some(sorted[((sorted.len() as f64 * 0.99).ceil() as usize).clamp(1, sorted.len()) - 1])
}

impl Pacer {
    /// Records one step's time from its sample to its scene's arrival.
    pub fn record_work(&mut self, work_ms: f64) {
        push(&mut self.work, work_ms);
    }

    /// Records one frame's time from the end of its scene wait to the present call.
    pub fn record_finish(&mut self, finish_ms: f64) {
        push(&mut self.finish, finish_ms);
    }

    /// How late the render thread woke from a sleep it timed to a point in the frame: the scheduler's lateness, which the deadline's own wake will add to the present.
    pub fn record_wake(&mut self, late_ms: f64) {
        push(&mut self.wake, late_ms);
    }

    /// A frame that presented on time grows the clean run; after 600 the margin gives back what a miss took.
    pub fn clean_frame(&mut self) {
        self.clean += 1;
        if self.clean >= CLEAN_FRAMES_TO_SHRINK {
            self.clean = 0;
            self.margin_ms = (self.margin_ms - MARGIN_GROWTH_MS).max(MARGIN_START_MS);
        }
    }

    /// A late scene or a missed present: the next samples move earlier.
    pub fn missed(&mut self) {
        self.clean = 0;
        self.margin_ms = (self.margin_ms + MARGIN_GROWTH_MS).min(MARGIN_LIMIT_MS);
    }

    fn finish_ms(&self) -> f64 {
        p99(&self.finish).unwrap_or(FALLBACK_FINISH_MS) + p99(&self.wake).unwrap_or(0.0).min(WAKE_LIMIT_MS) + self.margin_ms
    }

    /// The time the game takes from the sample to its scene's arrival, measured when a late scene arrives as well, and the margin, which a miss grows. Before ten steps are measured the game gets a whole sim period.
    fn work_ms(&self) -> f64 {
        p99(&self.work).unwrap_or(1000.0 / SIM_HZ) + self.margin_ms
    }

    /// How long before the vblank a scene shows at its step's input is read: the game's measured p99 from the sample to the scene's arrival and the draw's own, each with the margin a miss grows. The game never gets more than two sim periods, so one stall cannot hold every later sample that far back.
    pub fn lead_ms(&self) -> f64 {
        self.work_ms().min(MAX_WORK_MS) + self.finish_ms()
    }

    /// Milliseconds after the acquire by which the scene must have arrived to be drawn and presented before the next vblank.
    pub fn scene_deadline_ms(&self, period_ms: f64) -> f64 {
        (period_ms - self.finish_ms()).max(0.0)
    }
}

/// The vblank phase learned while a `Fifo` acquire blocked on the display, used to time a mode whose acquire returns at once.
#[derive(Default)]
pub struct Phase {
    anchor_ns: Option<u64>,
}

impl Phase {
    /// Takes one blocking acquire and returns the vblank it stands for. A wake is never early, so an acquire before the extrapolated vblank moves the phase to it, and one after leaves the phase where it was but for a creep of 50 us that follows a display slightly off its nominal rate; a wake latency therefore never moves the frame's anchor.
    pub fn lock(&mut self, acquired_ns: u64, period_ms: f64) -> u64 {
        let period = (period_ms * 1e6) as u64;
        let locked = match self.anchor_ns {
            Some(anchor) if period > 0 && acquired_ns > anchor => {
                let predicted = anchor + ((acquired_ns - anchor + period / 2) / period) * period;
                if acquired_ns < predicted { acquired_ns } else { predicted + (acquired_ns - predicted).min(PHASE_CREEP_NS) }
            }
            _ => acquired_ns,
        };
        self.anchor_ns = Some(locked);
        locked
    }

    /// The first vblank at or after `now_ns`, extrapolated from the learned anchor; none before one is learned.
    pub fn next_vblank_ns(&self, now_ns: u64, period_ms: f64) -> Option<u64> {
        let anchor = self.anchor_ns?;
        let period = (period_ms * 1e6) as u64;
        if period == 0 || now_ns <= anchor {
            return Some(anchor);
        }
        Some(anchor + (now_ns - anchor).div_ceil(period) * period)
    }
}
