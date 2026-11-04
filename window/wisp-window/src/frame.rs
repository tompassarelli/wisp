use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use crate::clock::Clock;
use crate::metrics::{ms, Beat, Metrics, Pulse, Series, Timings};
pub use crate::mailbox::{End, Event, Mailbox, Sample, Submission};
use crate::pacing::{Pacer, Phase};
use crate::stepper::{Aim, Mode, Stepper, STEP_NS};
use crate::sync::lock;
use crate::timer::TimerResolution;

const NOMINAL_PERIOD_MS: f64 = 1000.0 / 60.0;
const SHORTEST_PERIOD_MS: f64 = 1.0;
const MISSED_PERIODS: f64 = 1.5;
const SAMPLE_MEMORY: usize = 64;
const UNMEASURED_LIMIT: usize = 8;
const AIM_TOLERANCE_NS: u64 = 1_000_000;

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
    /// The present mode the surface granted, which the pulse line names.
    fn present_mode(&self) -> &'static str {
        "Fifo"
    }
    /// The display's frame in milliseconds as the display reports its rate, or none, which the loop takes as 60 Hz. The loop never measures it from its own frames: they include its own waits, and a window the compositor held to one frame a second would keep pacing to that second.
    fn refresh_ms(&self) -> Option<f64> {
        None
    }
}

/// The render thread's frame: acquire, aim the step clock, wait for the scene aimed at this frame's vblank until its deadline, draw the newest scene that has arrived, present. The game steps on the step clock's thread whether or not a frame comes.
pub struct FrameLoop<S: Surface, C: Clock> {
    surface: S,
    clock: C,
    mailbox: Arc<Mailbox>,
    metrics: Arc<Mutex<Metrics>>,
    stepper: Arc<Stepper>,
    previous_acquire: Option<u64>,
    drawn_step: u64,
    drawn_frame: Option<u32>,
    sample_times: [Option<(u32, u64)>; SAMPLE_MEMORY],
    previous_frame_late: bool,
    pending: VecDeque<Aimed>,
    unmeasured: VecDeque<Aimed>,
    waited: Option<u32>,
    pacer: Pacer,
    phase: Phase,
    pulse: Pulse,
    pub problem: Option<String>,
    pub pulse_line: Option<String>,
    scene_failing: bool,
    _timer: TimerResolution,
}

impl<S: Surface, C: Clock> FrameLoop<S, C> {
    pub fn new(surface: S, clock: C, mailbox: Arc<Mailbox>, metrics: Arc<Mutex<Metrics>>, stepper: Arc<Stepper>) -> Self {
        Self {
            surface,
            clock,
            mailbox,
            metrics,
            stepper,
            previous_acquire: None,
            drawn_step: 0,
            drawn_frame: None,
            sample_times: [None; SAMPLE_MEMORY],
            previous_frame_late: false,
            pending: VecDeque::new(),
            unmeasured: VecDeque::new(),
            waited: None,
            pacer: Pacer::default(),
            phase: Phase::default(),
            pulse: Pulse::default(),
            problem: None,
            pulse_line: None,
            scene_failing: false,
            _timer: TimerResolution::raise(),
        }
    }

    pub fn period_ms(&self) -> f64 {
        self.surface.refresh_ms().filter(|period| *period >= SHORTEST_PERIOD_MS).unwrap_or(NOMINAL_PERIOD_MS)
    }

    /// Runs one frame and returns whether it presented; false means the surface had no image.
    pub fn frame(&mut self, mode: Mode) -> bool {
        let blocking = self.surface.blocks_on_display();
        let period_ms = self.period_ms();
        let predicted = if blocking { None } else { self.phase.next_vblank_ns(self.clock.now_ns(), period_ms) };
        if let Some(vblank) = predicted {
            self.clock.sleep_until(vblank);
        }
        let asked = self.clock.now_ns();
        let Some(image) = self.surface.acquire() else {
            self.previous_acquire = None;
            return false;
        };
        let acquired = self.clock.now_ns();
        let (anchor, stamp) = self.anchor(blocking, predicted, acquired, period_ms);
        let interval = self.previous_acquire.map(|before| ms(before, stamp));
        let lead_ns = (self.pacer.lead_ms() * 1e6) as u64;
        self.stepper.aim(Aim::for_display(anchor, (period_ms * 1e6) as u64, lead_ns, acquired));
        let outcome = if mode == Mode::Loading {
            self.stepper.take();
            self.pending.clear();
            self.unmeasured.clear();
            self.surface.idle();
            Outcome::default()
        } else {
            self.wait_and_load(anchor, period_ms, lead_ns)
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
            let beat = Beat { presented_ns: presented, interval_ms: interval, step: self.stepper.next(presented).0 as u64, late: outcome.late, dropped: outcome.dropped, acquire_ms: ms(asked, acquired), draw_ms: ms(drawing, drawn), gpu_ms: timings.gpu.iter().map(|frame| frame.span_ms).collect(), render_scale: timings.render_scale, present: self.surface.present_mode() };
            self.pulse_line = self.pulse.beat(beat);
        }
        self.previous_frame_late = outcome.late;
        self.previous_acquire = Some(stamp);
        true
    }

    /// The frame's anchor, which deadlines count from, and its stamp, which the frame's interval is measured between: a blocking acquire is locked to the display's phase so its wake lateness leaves the anchor alone, and any other mode counts from the extrapolated vblank.
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
        if let Some(percent) = timings.render_scale {
            metrics.push(Series::RenderScale, f64::from(percent));
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
        metrics.flag(Series::DroppedSamples, outcome.dropped > 0);
    }

    /// Waits until the pacer's deadline for the scene of the newest step aimed at the vblank this frame presents at, whether the step clock has taken it or has it still due, then loads the newest scene that has arrived, so a late scene costs one frame of latency and never the present.
    fn wait_and_load(&mut self, anchor: u64, period_ms: f64, lead_ns: u64) -> Outcome {
        let mut outcome = Outcome::default();
        self.collect(&mut outcome, lead_ns, period_ms);
        let period_ns = (period_ms * 1e6) as u64;
        let ends_by = anchor + period_ns + period_ns / 2;
        if let Some(target) = self.target(ends_by, lead_ns, period_ms) {
            let deadline = anchor + (self.pacer.scene_deadline_ms(period_ms) * 1e6) as u64;
            outcome.late = !self.clock.wait_for_scene(&self.mailbox, target, deadline) && !self.mailbox.is_stopping();
            self.waited = Some(target);
            self.collect(&mut outcome, lead_ns, period_ms);
            let (due, later): (Vec<Aimed>, Vec<Aimed>) = self.pending.drain(..).partition(|aimed| aimed.frame <= target);
            self.pending = later.into();
            self.unmeasured.extend(due.into_iter().filter(|aimed| aimed.frame == target));
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

    /// Takes the steps the clock took since the last look, each aimed at the vblank its lead reaches; one a frame already waited for is only measured.
    fn collect(&mut self, outcome: &mut Outcome, lead_ns: u64, period_ms: f64) {
        let steps = self.stepper.take();
        outcome.dropped += steps.dropped;
        for taken in steps.taken {
            self.sample_times[taken.frame as usize % SAMPLE_MEMORY] = Some((taken.frame, taken.sampled_ns));
            self.pacer.record_wake(taken.late_ns as f64 / 1e6);
            let aimed = Aimed { frame: taken.frame, sampled_ns: taken.sampled_ns, vblank_ns: self.vblank_of(taken.sampled_ns, lead_ns, period_ms) };
            match self.waited {
                Some(waited) if taken.frame < waited => {}
                Some(waited) if taken.frame == waited => self.unmeasured.push_back(aimed),
                _ => self.pending.push_back(aimed),
            }
        }
    }

    /// The newest step aimed at a vblank by `ends_by`: one taken and not yet waited for, or one the clock has still due.
    fn target(&self, ends_by: u64, lead_ns: u64, period_ms: f64) -> Option<u32> {
        let mut target = self.pending.iter().filter(|aimed| aimed.vblank_ns <= ends_by).map(|aimed| aimed.frame).max();
        let (mut frame, mut due) = self.stepper.next(self.clock.now_ns());
        while self.vblank_of(due, lead_ns, period_ms) <= ends_by {
            target = Some(frame);
            frame = frame.wrapping_add(1);
            due += STEP_NS;
        }
        target
    }

    /// The first vblank a step sampled at `sampled_ns` can show at, given the lead; a sample read up to 1 ms after its aimed time still counts toward that vblank.
    fn vblank_of(&self, sampled_ns: u64, lead_ns: u64, period_ms: f64) -> u64 {
        let reach = (sampled_ns + lead_ns).saturating_sub(AIM_TOLERANCE_NS);
        self.phase.next_vblank_ns(reach, period_ms).map_or(reach, |vblank| vblank.max(reach))
    }

    /// Gives the pacer each awaited step's time from its sample to its scene's arrival, whether the scene came in time or after its frame drew without it, so the lead learns the step's whole tail.
    fn measure_arrivals(&mut self) {
        let mailbox = &self.mailbox;
        let pacer = &mut self.pacer;
        self.unmeasured.retain(|aimed| match mailbox.arrived_ns(aimed.frame) {
            Some(arrived) => {
                pacer.record_work(ms(aimed.sampled_ns, arrived));
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

/// A step whose scene is aimed at the vblank `vblank_ns`.
#[derive(Clone, Copy)]
struct Aimed {
    frame: u32,
    sampled_ns: u64,
    vblank_ns: u64,
}

#[derive(Default)]
struct Outcome {
    dropped: u32,
    late: bool,
    ready_ns: Option<u64>,
    parse_ms: Option<f64>,
}

#[cfg(test)]
mod tests;
