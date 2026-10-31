use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::input::Input;
use crate::metrics::{ms, Beat, Metrics, Pulse, Series};
pub use crate::mailbox::{End, Event, Mailbox, Sample, Submission};
use crate::pacing::{Pacer, Phase, StepClock};
use crate::sync::lock;
use crate::timer::TimerResolution;

const NOMINAL_PERIOD_MS: f64 = 1000.0 / 60.0;
const PERIOD_WINDOW: usize = 120;
const PERIOD_MINIMUM: usize = 5;
const MISSED_PERIODS: f64 = 1.5;
const SAMPLE_MEMORY: usize = 64;

/// The frame loop's time: when things happen, and how long it waits for a scene.
pub trait Clock {
    fn now_ns(&self) -> u64;

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
    pacer: Pacer,
    steps: StepClock,
    phase: Phase,
    pulse: Pulse,
    pub problem: Option<String>,
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
            pacer: Pacer::default(),
            steps: StepClock::default(),
            phase: Phase::default(),
            pulse: Pulse::default(),
            problem: None,
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
            self.surface.idle();
            Outcome::default()
        } else {
            self.sample_and_wait(mode, seam, anchor, period_ms)
        };
        let drawing = self.clock.now_ns();
        self.surface.draw(&image, self.drawn_step);
        let drawn = self.clock.now_ns();
        self.surface.present(image);
        let presented = self.clock.now_ns();
        if let Some(arrived) = outcome.arrived_ns {
            self.pacer.record(ms(outcome.sampled_ns, arrived), ms(arrived, drawn));
        }
        let missed = mode != Mode::Loading && interval.is_some_and(|interval| interval > MISSED_PERIODS * period_ms);
        if outcome.late || missed {
            self.pacer.missed();
        } else {
            self.pacer.clean_frame();
        }
        if mode != Mode::Loading {
            let times = Times { asked, acquired, drawing, drawn, presented };
            self.publish(&outcome, &times, interval, missed);
            let beat = Beat { presented_ns: presented, interval_ms: interval, step: self.drawn_step, late: outcome.late, dropped: outcome.dropped, acquire_ms: ms(asked, acquired), draw_ms: ms(drawing, drawn) };
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

    fn publish(&self, outcome: &Outcome, times: &Times, interval: Option<f64>, missed: bool) {
        let mut metrics = lock(&self.metrics);
        if let Some(interval) = interval {
            metrics.push(Series::Presented, interval);
        }
        metrics.push(Series::Acquire, ms(times.asked, times.acquired));
        metrics.push(Series::Draw, ms(times.drawing, times.drawn));
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
        let wait = target_ns.saturating_sub(self.clock.now_ns());
        if wait > 0 {
            thread::sleep(Duration::from_nanos(wait));
        }
        self.clock.now_ns().saturating_sub(target_ns)
    }

    /// On a frame that steps the game, sleeps to the pacer's sample point, samples, queues one sample for each step that came due and waits for the last one's scene until the pacer's deadline; on the frames between steps it redraws the last scene.
    fn sample_and_wait(&mut self, mode: Mode, seam: &impl Seam, anchor: u64, period_ms: f64) -> Outcome {
        let mut outcome = Outcome::default();
        let steps = self.steps.steps_due(anchor, period_ms);
        if steps == 0 {
            return outcome;
        }
        let late = self.sleep_until(anchor + (self.pacer.sample_offset_ms(period_ms) * 1e6) as u64);
        self.pacer.record_wake(late as f64 / 1e6);
        let sampled_ns = self.clock.now_ns();
        let input = seam.input();
        outcome.sampled_ns = sampled_ns;
        let mut last = self.frame;
        for _ in 0..steps {
            let sample = Sample { frame: self.frame, sampled_ns, input };
            last = sample.frame;
            self.frame = self.frame.wrapping_add(1);
            self.sample_times[sample.frame as usize % SAMPLE_MEMORY] = Some((sample.frame, sample.sampled_ns));
            if mode == Mode::Baseline {
                self.mailbox.submit(Submission { bytes: b"{}".to_vec(), step: sample.frame as u64, frame: sample.frame });
            } else if !self.mailbox.push_sample(sample) {
                outcome.dropped = true;
            }
        }
        let deadline = anchor + (self.pacer.scene_deadline_ms(period_ms) * 1e6) as u64;
        outcome.late = !self.clock.wait_for_scene(&self.mailbox, last, deadline) && !self.mailbox.is_stopping();
        outcome.arrived_ns = Some(self.clock.now_ns());
        if let Some(submission) = self.mailbox.take_scene() {
            let began = self.clock.now_ns();
            match self.surface.load_scene(&submission.bytes) {
                Ok(()) => {
                    self.drawn_step = submission.step;
                    self.drawn_frame = Some(submission.frame);
                }
                Err(problem) => self.problem = Some(problem),
            }
            outcome.parse_ms = Some(ms(began, self.clock.now_ns()));
        }
        outcome
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

#[derive(Default)]
struct Outcome {
    dropped: bool,
    late: bool,
    sampled_ns: u64,
    arrived_ns: Option<u64>,
    parse_ms: Option<f64>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
    use std::time::Instant;

    const PERIOD_NS: u64 = 16_666_667;
    /// How long the test's clock lets a consumer answer in real time before the scene counts as late: far more than any host's scheduling
    /// delay, so only the samples the script holds back are late.
    const ANSWER_GRACE: Duration = Duration::from_secs(1);
    const WARMUP: u32 = PERIOD_MINIMUM as u32 + 1;
    const FRAMES: u32 = 12;
    const LATE_SAMPLE: u32 = 5;
    const LATE_FRAMES: u32 = 2;

    /// The library's clock in the test: the fake display moves it to each vblank, so every interval is exactly one period, and a scene
    /// that does not come within the grace moves it to the deadline, so lateness follows the script, not the host's load.
    #[derive(Clone, Default)]
    struct TestClock(Arc<AtomicU64>);

    impl Clock for TestClock {
        fn now_ns(&self) -> u64 {
            self.0.load(Ordering::Acquire)
        }

        fn wait_for_scene(&self, mailbox: &Mailbox, frame: u32, deadline_ns: u64) -> bool {
            let arrived = mailbox.wait_for_scene(frame, ANSWER_GRACE);
            if !arrived {
                self.0.fetch_max(deadline_ns, Ordering::AcqRel);
            }
            arrived
        }
    }

    struct FakeSurface {
        clock: TestClock,
        acquires: Arc<AtomicU32>,
        presented: Arc<Mutex<Vec<u64>>>,
        drawing: AtomicU32,
    }

    impl Surface for FakeSurface {
        type Image = ();

        fn acquire(&mut self) -> Option<()> {
            let acquired = self.acquires.fetch_add(1, Ordering::AcqRel) + 1;
            self.clock.0.store(acquired as u64 * PERIOD_NS, Ordering::Release);
            Some(())
        }

        fn draw(&mut self, _: &(), step: u64) {
            self.drawing.store(step as u32, Ordering::Release);
        }

        fn present(&self, _: ()) {
            lock(&self.presented).push(self.drawing.load(Ordering::Acquire) as u64);
        }
    }

    struct Quiet;

    impl Seam for Quiet {
        fn input(&self) -> Input {
            Input::default()
        }
    }

    #[test]
    fn stop_wakes_a_blocked_consumer() {
        let mailbox = Arc::new(Mailbox::default());
        let consumer = {
            let mailbox = mailbox.clone();
            thread::spawn(move || {
                let began = Instant::now();
                (mailbox.next_event(Duration::from_secs(30)), began.elapsed())
            })
        };
        thread::sleep(Duration::from_millis(50));
        mailbox.stop();
        let (event, waited) = consumer.join().unwrap();
        assert_eq!(event, Event::Ended(End::Stopped), "the blocked consumer is told of the stop");
        assert!(waited < Duration::from_secs(5), "the consumer returned long before its 30 s timeout");
        mailbox.push_sample(Sample { frame: 0, sampled_ns: 0, input: Input::default() });
        assert_eq!(mailbox.next_event(Duration::from_secs(30)), Event::Ended(End::Stopped), "a stop outranks a queued sample");
    }

    #[test]
    fn stop_during_submit_leaves_no_scene_behind() {
        let mailbox = Arc::new(Mailbox::default());
        let submitter = {
            let mailbox = mailbox.clone();
            thread::spawn(move || {
                let mut frame = 0;
                while !mailbox.is_stopping() {
                    mailbox.submit(Submission { bytes: vec![0; 4096], step: 1, frame });
                    frame += 1;
                }
                mailbox.submit(Submission { bytes: b"{}".to_vec(), step: 2, frame });
            })
        };
        thread::sleep(Duration::from_millis(20));
        mailbox.stop();
        submitter.join().unwrap();
        assert!(mailbox.take_scene().is_none(), "no scene survives a stop, however late its submit");
        assert!(!mailbox.wait_for_scene(0, Duration::from_secs(5)), "a stopped mailbox does not wait for a scene");
    }

    #[test]
    fn late_scene_keeps_presents_on_clock() {
        let mailbox = Arc::new(Mailbox::default());
        let metrics = Arc::new(Mutex::new(Metrics::default()));
        let presented = Arc::new(Mutex::new(Vec::new()));
        let acquires = Arc::new(AtomicU32::new(0));
        let clock = TestClock::default();
        let surface = FakeSurface { clock: clock.clone(), acquires: acquires.clone(), presented: presented.clone(), drawing: AtomicU32::new(0) };
        let mut frames = FrameLoop::new(surface, clock, mailbox.clone(), metrics.clone());
        for _ in 0..WARMUP {
            frames.frame(Mode::Loading, &Quiet);
        }
        let consumer = {
            let (mailbox, acquires) = (mailbox.clone(), acquires.clone());
            thread::spawn(move || {
                let mut seen = Vec::new();
                while let Event::Frame(sample) = mailbox.next_event(Duration::from_secs(10)) {
                    if sample.frame == LATE_SAMPLE {
                        while acquires.load(Ordering::Acquire) < WARMUP + LATE_SAMPLE + LATE_FRAMES + 1 {
                            thread::sleep(Duration::from_millis(1));
                        }
                    }
                    seen.push(sample.frame);
                    mailbox.submit(Submission { bytes: b"{}".to_vec(), step: sample.frame as u64 + 1, frame: sample.frame });
                }
                seen
            })
        };
        for _ in 0..FRAMES {
            frames.frame(Mode::Game, &Quiet);
        }
        mailbox.stop();
        let seen = consumer.join().unwrap();

        assert_eq!(seen, (0..FRAMES).collect::<Vec<_>>(), "the consumer got every sample in order");
        let metrics = lock(&metrics);
        let flags = |which: Series| metrics.series(which as u32).iter().map(|flag| *flag as u32).collect::<Vec<_>>();
        let late: Vec<u32> = (0..FRAMES).map(|frame| u32::from((LATE_SAMPLE..LATE_SAMPLE + LATE_FRAMES).contains(&frame))).collect();
        assert_eq!(flags(Series::LateScenes), late, "exactly the frames waiting on the slow sample were late");
        assert_eq!(flags(Series::MissedPresents).iter().sum::<u32>(), 0, "no present missed");
        assert_eq!(flags(Series::DroppedSamples).iter().sum::<u32>(), 0, "no sample dropped");

        let steps = lock(&presented).clone();
        let shown = &steps[WARMUP as usize..];
        assert_eq!(shown.len(), FRAMES as usize, "every frame presented, the late ones included");
        assert_eq!(shown[LATE_SAMPLE as usize], LATE_SAMPLE as u64, "the late frame redraws the previous scene");
        assert_eq!(shown[(LATE_SAMPLE + 1) as usize], LATE_SAMPLE as u64, "so does the next while the slow sample is outstanding");
        assert_eq!(shown[(LATE_SAMPLE + LATE_FRAMES) as usize], (LATE_SAMPLE + LATE_FRAMES) as u64 + 1, "the frame after catches up to its own scene");
        assert!(shown.windows(2).all(|pair| pair[0] <= pair[1]), "scenes never go backwards");
    }
}
