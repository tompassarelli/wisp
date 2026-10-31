use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::input::Input;
use crate::metrics::{ms, Beat, Metrics, Pulse, Series, Timings};
pub use crate::mailbox::{End, Event, Mailbox, Sample, Submission};
use crate::pacing::{Pacer, Phase, StepClock};
use crate::sync::lock;
use crate::timer::TimerResolution;

const NOMINAL_PERIOD_MS: f64 = 1000.0 / 60.0;
const PERIOD_WINDOW: usize = 120;
const PERIOD_MINIMUM: usize = 5;
const MISSED_PERIODS: f64 = 1.5;
const SAMPLE_MEMORY: usize = 64;
const UNMEASURED_LIMIT: usize = 8;

/// The frame loop's time: when things happen, and how long it waits for a scene.
pub trait Clock {
    fn now_ns(&self) -> u64;

    /// Sleeps until `target_ns` on this clock.
    fn sleep_until(&self, target_ns: u64) {
        let wait = target_ns.saturating_sub(self.now_ns());
        if wait > 0 {
            thread::sleep(Duration::from_nanos(wait));
        }
    }

    /// Waits until the scene for `frame` arrives or `deadline_ns` passes on this clock; true when it arrived.
    fn wait_for_scene(&self, mailbox: &Mailbox, frame: u32, deadline_ns: u64) -> bool {
        mailbox.wait_for_scene(frame, Duration::from_nanos(deadline_ns.saturating_sub(self.now_ns())))
    }
}

/// What the frame loop draws on: `acquire` blocks until the display hands back an image, and `None` means nothing is showing right now.
pub trait Surface {
    type Image;
    fn acquire(&mut self) -> Option<Self::Image>;
    fn draw(&mut self, image: &Self::Image, step: u64);
    /// Takes the scene a submission carried; the surface keeps what it needs to draw it.
    fn load_scene(&mut self, bytes: &[u8]) -> Result<(), String> {
        serde_json::from_slice::<serde_json::Value>(bytes).map(drop).map_err(|_| "the scene was not JSON".to_string())
    }
    /// What the surface measured of the frame it just drew; nothing by default.
    fn timings(&mut self) -> Timings {
        Timings::default()
    }
    fn present(&self, image: Self::Image);
    /// Runs while the window shows its loading state: takes what Bun sent so far.
    fn idle(&mut self) {}
    /// Whether `acquire` waits for the display; a mode that returns at once is timed from the phase learned while one did.
    fn blocks_on_display(&self) -> bool {
        true
    }
}

/// How the loop reads input.
pub trait Seam {
    fn input(&self) -> Input;
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Mode {
    Loading,
    Game,
    Baseline,
}

/// The render thread's frame: acquire, sample, wait for the scene until its deadline, draw the newest scene that has arrived, present.
pub struct FrameLoop<S: Surface, C: Clock> {
    surface: S,
    clock: C,
    mailbox: Arc<Mailbox>,
    metrics: Arc<Mutex<Metrics>>,
    frame: u32,
    previous_acquire: Option<u64>,
    periods: VecDeque<f64>,
    drawn_step: u64,
    drawn_frame: Option<u32>,
    sample_times: [Option<(u32, u64)>; SAMPLE_MEMORY],
    previous_frame_late: bool,
    pending: VecDeque<Aim>,
    unmeasured: VecDeque<Aim>,
    pacer: Pacer,
    steps: StepClock,
    phase: Phase,
    pulse: Pulse,
    pub problem: Option<String>,
    scene_failing: bool,
    _timer: TimerResolution,
}

impl<S: Surface, C: Clock> FrameLoop<S, C> {
    pub fn new(surface: S, clock: C, mailbox: Arc<Mailbox>, metrics: Arc<Mutex<Metrics>>) -> Self {
        Self {
            surface,
            clock,
            mailbox,
            metrics,
            frame: 0,
            previous_acquire: None,
            periods: VecDeque::new(),
            drawn_step: 0,
            drawn_frame: None,
            sample_times: [None; SAMPLE_MEMORY],
            previous_frame_late: false,
            pending: VecDeque::new(),
            unmeasured: VecDeque::new(),
            pacer: Pacer::default(),
            steps: StepClock::default(),
            phase: Phase::default(),
            pulse: Pulse::default(),
            problem: None,
            scene_failing: false,
            _timer: TimerResolution::raise(),
        }
    }

    pub fn period_ms(&self) -> f64 {
        if self.periods.len() < PERIOD_MINIMUM {
            return NOMINAL_PERIOD_MS;
        }
        let mut sorted: Vec<f64> = self.periods.iter().copied().collect();
        sorted.sort_by(f64::total_cmp);
        sorted[sorted.len() / 2]
    }

    /// Runs one frame and returns whether it presented; false means the surface had no image.
    pub fn frame(&mut self, mode: Mode, seam: &impl Seam) -> bool {
        let blocking = self.surface.blocks_on_display();
        let period_ms = self.period_ms();
        let predicted = if blocking { None } else { self.phase.next_vblank_ns(self.clock.now_ns(), period_ms) };
        if let Some(vblank) = predicted {
            self.sleep_until(vblank);
        }
        let asked = self.clock.now_ns();
        let Some(image) = self.surface.acquire() else {
            self.previous_acquire = None;
            return false;
        };
        let acquired = self.clock.now_ns();
        let (anchor, stamp) = self.anchor(blocking, predicted, acquired, period_ms);
        let interval = self.previous_acquire.map(|before| ms(before, stamp));
        if let Some(interval) = interval {
            self.periods.push_back(interval);
            if self.periods.len() > PERIOD_WINDOW {
                self.periods.pop_front();
            }
        }
        let period_ms = self.period_ms();
        let outcome = if mode == Mode::Loading {
            self.pending.clear();
            self.unmeasured.clear();
            self.surface.idle();
            Outcome::default()
        } else {
            self.sample_and_wait(mode, seam, anchor, period_ms)
        };
        let drawing = self.clock.now_ns();
        self.surface.draw(&image, self.drawn_step);
        let drawn = self.clock.now_ns();
        let timings = self.surface.timings();
        self.surface.present(image);
        let presented = self.clock.now_ns();
        if let Some(ready) = outcome.ready_ns {
            self.pacer.record_finish(ms(ready, drawn));
        }
        let missed = mode != Mode::Loading && interval.is_some_and(|interval| interval > MISSED_PERIODS * period_ms);
        if outcome.late || missed {
            self.pacer.missed();
        } else {
            self.pacer.clean_frame();
        }
        if mode != Mode::Loading {
            let times = Times { asked, acquired, drawing, drawn, presented };
            self.publish(&outcome, &times, &timings, interval, missed);
            let beat = Beat { presented_ns: presented, interval_ms: interval, step: self.drawn_step, late: outcome.late, dropped: outcome.dropped, acquire_ms: ms(asked, acquired), draw_ms: ms(drawing, drawn), gpu_ms: timings.gpu.iter().map(|frame| frame.span_ms).collect() };
            if let Some(line) = self.pulse.beat(beat) {
                eprintln!("{line}");
            }
        }
        self.previous_frame_late = outcome.late;
        self.previous_acquire = Some(stamp);
        true
    }

    /// The frame's anchor, which deadlines count from, and its stamp, which the period is measured between: a blocking acquire is locked to the display's phase so its wake lateness leaves the anchor alone, and any other mode counts from the extrapolated vblank.
    fn anchor(&mut self, blocking: bool, predicted: Option<u64>, acquired: u64, period_ms: f64) -> (u64, u64) {
        let extrapolated = predicted.unwrap_or(acquired);
        let anchor = if blocking || predicted.is_none() { self.phase.lock(acquired, period_ms) } else { extrapolated };
        (anchor, if blocking { acquired } else { extrapolated })
    }

    fn publish(&self, outcome: &Outcome, times: &Times, timings: &Timings, interval: Option<f64>, missed: bool) {
        let mut metrics = lock(&self.metrics);
        if let Some(interval) = interval {
            metrics.push(Series::Presented, interval);
        }
        metrics.push(Series::Acquire, ms(times.asked, times.acquired));
        metrics.push(Series::Draw, ms(times.drawing, times.drawn));
        if let Some(encode) = timings.cpu_encode_ms {
            metrics.push(Series::CpuEncode, encode);
        }
        for frame in &timings.gpu {
            metrics.gpu(frame);
        }
        if let Some(parse) = outcome.parse_ms {
            metrics.push(Series::Parse, parse);
            if let Some(sampled) = self.drawn_sample_ns() {
                metrics.push(Series::InputToPresent, ms(sampled, times.presented));
            }
        }
        metrics.flag(Series::MissedPresents, missed);
        metrics.flag(Series::MissedPresentsAfterLateScene, missed && self.previous_frame_late);
        metrics.flag(Series::LateScenes, outcome.late);
        metrics.flag(Series::DroppedSamples, outcome.dropped);
    }

    /// Sleeps to `target_ns` and returns how many nanoseconds after it the thread woke.
    fn sleep_until(&self, target_ns: u64) -> u64 {
        self.clock.sleep_until(target_ns);
        self.clock.now_ns().saturating_sub(target_ns)
    }

    /// On a frame that steps the game, sleeps to the pacer's sample point, samples and queues one sample for each step that came due, the last aimed at the vblank the plan names; then, on whichever frame that vblank ends, waits for the scene aimed at it until the pacer's deadline. Every frame draws the newest scene that has arrived, so a late scene costs one frame of latency and never the present.
    fn sample_and_wait(&mut self, mode: Mode, seam: &impl Seam, anchor: u64, period_ms: f64) -> Outcome {
        let mut outcome = Outcome::default();
        let steps = self.steps.steps_due(anchor, period_ms);
        if steps > 0 {
            self.sample(mode, seam, anchor, period_ms, steps, &mut outcome);
        }
        let period_ns = (period_ms * 1e6) as u64;
        let ends_by = anchor + period_ns + period_ns / 2;
        let target = self.pending.iter().filter(|aim| aim.vblank_ns <= ends_by).map(|aim| aim.frame).max();
        if let Some(target) = target {
            let deadline = anchor + (self.pacer.scene_deadline_ms(period_ms) * 1e6) as u64;
            outcome.late = !self.clock.wait_for_scene(&self.mailbox, target, deadline) && !self.mailbox.is_stopping();
            let (due, later): (Vec<Aim>, Vec<Aim>) = self.pending.drain(..).partition(|aim| aim.frame <= target);
            self.pending = later.into();
            self.unmeasured.extend(due.into_iter().filter(|aim| aim.frame == target));
        }
        self.measure_arrivals();
        outcome.ready_ns = Some(self.clock.now_ns());
        if let Some(submission) = self.mailbox.take_scene() {
            let began = self.clock.now_ns();
            match self.surface.load_scene(&submission.bytes) {
                Ok(()) => {
                    self.drawn_step = submission.step;
                    self.drawn_frame = Some(submission.frame);
                    self.scene_failing = false;
                }
                Err(problem) => {
                    if !self.scene_failing {
                        self.problem = Some(problem);
                    }
                    self.scene_failing = true;
                }
            }
            outcome.parse_ms = Some(ms(began, self.clock.now_ns()));
        }
        outcome
    }

    fn sample(&mut self, mode: Mode, seam: &impl Seam, anchor: u64, period_ms: f64, steps: u32, outcome: &mut Outcome) {
        let plan = self.pacer.plan(period_ms);
        let late = self.sleep_until(anchor + (plan.offset_ms * 1e6) as u64);
        self.pacer.record_wake(late as f64 / 1e6);
        let sampled_ns = self.clock.now_ns();
        let mut input = seam.input();
        let mut last = self.frame;
        for _ in 0..steps {
            let sample = Sample { frame: self.frame, sampled_ns, input };
            input = input.repeated();
            last = sample.frame;
            self.frame = self.frame.wrapping_add(1);
            self.sample_times[sample.frame as usize % SAMPLE_MEMORY] = Some((sample.frame, sample.sampled_ns));
            if mode == Mode::Baseline {
                self.mailbox.submit(Submission { bytes: b"{}".to_vec(), step: sample.frame as u64, frame: sample.frame, arrived_ns: self.clock.now_ns() });
            } else if !self.mailbox.push_sample(sample) {
                outcome.dropped = true;
            }
        }
        let vblank_ns = anchor + plan.vblanks_ahead as u64 * (period_ms * 1e6) as u64;
        self.pending.push_back(Aim { frame: last, sampled_ns, vblank_ns });
    }

    /// Gives the pacer each awaited step's time from its sample to its scene's arrival, whether the scene came in time or after its frame drew without it, so the plan learns the step's whole tail.
    fn measure_arrivals(&mut self) {
        let mailbox = &self.mailbox;
        let pacer = &mut self.pacer;
        self.unmeasured.retain(|aim| match mailbox.arrived_ns(aim.frame) {
            Some(arrived) => {
                pacer.record_work(ms(aim.sampled_ns, arrived));
                false
            }
            None => true,
        });
        while self.unmeasured.len() > UNMEASURED_LIMIT {
            self.unmeasured.pop_front();
        }
    }

    fn drawn_sample_ns(&self) -> Option<u64> {
        let drawn = self.drawn_frame?;
        self.sample_times[drawn as usize % SAMPLE_MEMORY].filter(|(frame, _)| *frame == drawn).map(|(_, sampled)| sampled)
    }
}

struct Times {
    asked: u64,
    acquired: u64,
    drawing: u64,
    drawn: u64,
    presented: u64,
}

/// A sample whose scene is aimed at the vblank `vblank_ns`.
#[derive(Clone, Copy)]
struct Aim {
    frame: u32,
    sampled_ns: u64,
    vblank_ns: u64,
}

#[derive(Default)]
struct Outcome {
    dropped: bool,
    late: bool,
    ready_ns: Option<u64>,
    parse_ms: Option<f64>,
}

#[cfg(test)]
mod tests;
