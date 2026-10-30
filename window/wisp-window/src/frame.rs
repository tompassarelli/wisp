use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use crate::input::Input;
use crate::metrics::{ms, Metrics, Series};
use crate::sync::lock;

pub const QUEUE_CAPACITY: usize = 8;
const DEADLINE_BEFORE_NEXT_ACQUIRE_NS: u64 = 4_000_000;
const NOMINAL_PERIOD_MS: f64 = 1000.0 / 60.0;
const PERIOD_WINDOW: usize = 120;
const PERIOD_MINIMUM: usize = 5;
const MISSED_PERIODS: f64 = 1.5;
const SAMPLE_MEMORY: usize = 64;

pub trait Clock {
    fn now_ns(&self) -> u64;
}

/// What the frame loop draws on: `acquire` blocks until the display hands back an image, and `None` means nothing is showing right now.
pub trait Surface {
    type Image;
    fn acquire(&mut self) -> Option<Self::Image>;
    fn draw(&self, image: &Self::Image, step: u64);
    fn present(&self, image: Self::Image);
}

/// How the loop reads input.
pub trait Seam {
    fn input(&self) -> Input;
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub struct Sample {
    pub frame: u32,
    pub sampled_ns: u64,
    pub input: Input,
}

pub struct Submission {
    pub bytes: Vec<u8>,
    pub step: u64,
    pub frame: u32,
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Mode {
    Loading,
    Game,
    Baseline,
}

/// What ended the stream of samples: the player closing the window, the library failing, or `stop`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum End {
    Closed,
    Failed,
    Stopped,
}

/// What a consumer blocked in `next_event` gets back.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Event {
    Timeout,
    Frame(Sample),
    Ended(End),
}

#[derive(Default)]
struct Samples {
    queue: VecDeque<Sample>,
    end: Option<End>,
}

#[derive(Default)]
pub struct Mailbox {
    samples: Mutex<Samples>,
    sample_ready: Condvar,
    scene: Mutex<Option<Submission>>,
    scene_ready: Condvar,
    stopping: AtomicBool,
}

impl Mailbox {
    fn push_sample(&self, sample: Sample) -> bool {
        let mut samples = lock(&self.samples);
        if samples.queue.len() >= QUEUE_CAPACITY {
            return false;
        }
        samples.queue.push_back(sample);
        self.sample_ready.notify_one();
        true
    }

    /// The oldest queued sample, waiting up to `timeout` for one; a zero timeout never waits. A stop outranks every queued sample, and a close or failure follows the samples taken before it.
    pub fn next_event(&self, timeout: Duration) -> Event {
        let guard = lock(&self.samples);
        let (mut guard, _) = self
            .sample_ready
            .wait_timeout_while(guard, timeout, |samples| samples.queue.is_empty() && samples.end.is_none())
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if guard.end == Some(End::Stopped) {
            return Event::Ended(End::Stopped);
        }
        match (guard.queue.pop_front(), guard.end) {
            (Some(sample), _) => Event::Frame(sample),
            (None, Some(end)) => Event::Ended(end),
            (None, None) => Event::Timeout,
        }
    }

    /// Ends the stream for its consumer; the first end stays, except that a stop replaces a close or failure.
    pub fn end(&self, end: End) {
        let mut samples = lock(&self.samples);
        if samples.end.is_none() || end == End::Stopped {
            samples.end = Some(end);
        }
        self.sample_ready.notify_all();
    }

    /// Keeps the scene for the newest sample answered, so a scene that arrives after a newer one is dropped; after a stop it keeps nothing.
    pub fn submit(&self, submission: Submission) {
        let mut scene = lock(&self.scene);
        if self.is_stopping() {
            return;
        }
        if scene.as_ref().is_none_or(|held| held.frame <= submission.frame) {
            *scene = Some(submission);
        }
        self.scene_ready.notify_one();
    }

    fn wait_for_scene(&self, frame: u32, timeout: Duration) -> bool {
        let guard = lock(&self.scene);
        let (guard, _) = self
            .scene_ready
            .wait_timeout_while(guard, timeout, |scene| !scene.as_ref().is_some_and(|held| held.frame >= frame) && !self.is_stopping())
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        guard.as_ref().is_some_and(|held| held.frame >= frame)
    }

    fn take_scene(&self) -> Option<Submission> {
        lock(&self.scene).take()
    }

    pub fn is_stopping(&self) -> bool {
        self.stopping.load(Ordering::Acquire)
    }

    /// Wakes every waiter and ends the stream with `End::Stopped`; a scene submitted after this returns is ignored.
    pub fn stop(&self) {
        self.stopping.store(true, Ordering::Release);
        self.end(End::Stopped);
        lock(&self.scene).take();
        self.scene_ready.notify_all();
    }
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
    pub problem: Option<String>,
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
            problem: None,
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
        let asked = self.clock.now_ns();
        let Some(image) = self.surface.acquire() else {
            self.previous_acquire = None;
            return false;
        };
        let acquired = self.clock.now_ns();
        let interval = self.previous_acquire.map(|before| ms(before, acquired));
        if let Some(interval) = interval {
            self.periods.push_back(interval);
            if self.periods.len() > PERIOD_WINDOW {
                self.periods.pop_front();
            }
        }
        let period_ms = self.period_ms();
        let outcome = if mode == Mode::Loading { Outcome::default() } else { self.sample_and_wait(mode, seam, acquired, period_ms) };
        let drawing = self.clock.now_ns();
        self.surface.draw(&image, self.drawn_step);
        let drawn = self.clock.now_ns();
        self.surface.present(image);
        let presented = self.clock.now_ns();
        let missed = mode != Mode::Loading && interval.is_some_and(|interval| interval > MISSED_PERIODS * period_ms);
        let mut metrics = lock(&self.metrics);
        if mode != Mode::Loading {
            if let Some(interval) = interval {
                metrics.push(Series::Presented, interval);
            }
            metrics.push(Series::Acquire, ms(asked, acquired));
            metrics.push(Series::Draw, ms(drawing, drawn));
            if let Some(parse) = outcome.parse_ms {
                metrics.push(Series::Parse, parse);
            }
            if let Some(sampled) = self.drawn_sample_ns() {
                metrics.push(Series::InputToPresent, ms(sampled, presented));
            }
            metrics.flag(Series::MissedPresents, missed);
            metrics.flag(Series::MissedPresentsAfterLateScene, missed && self.previous_frame_late);
            metrics.flag(Series::LateScenes, outcome.late);
            metrics.flag(Series::DroppedSamples, outcome.dropped);
        }
        self.previous_frame_late = outcome.late;
        self.previous_acquire = Some(acquired);
        true
    }

    fn sample_and_wait(&mut self, mode: Mode, seam: &impl Seam, acquired: u64, period_ms: f64) -> Outcome {
        let sample = Sample { frame: self.frame, sampled_ns: self.clock.now_ns(), input: seam.input() };
        self.frame = self.frame.wrapping_add(1);
        self.sample_times[sample.frame as usize % SAMPLE_MEMORY] = Some((sample.frame, sample.sampled_ns));
        let mut outcome = Outcome::default();
        if mode == Mode::Baseline {
            self.mailbox.submit(Submission { bytes: b"{}".to_vec(), step: sample.frame as u64, frame: sample.frame });
        } else if !self.mailbox.push_sample(sample) {
            outcome.dropped = true;
        }
        let deadline = acquired + (period_ms * 1e6) as u64 - DEADLINE_BEFORE_NEXT_ACQUIRE_NS;
        let wait = Duration::from_nanos(deadline.saturating_sub(self.clock.now_ns()));
        outcome.late = !self.mailbox.wait_for_scene(sample.frame, wait) && !self.mailbox.is_stopping();
        if let Some(submission) = self.mailbox.take_scene() {
            let began = self.clock.now_ns();
            if serde_json::from_slice::<serde_json::Value>(&submission.bytes).is_ok() {
                self.drawn_step = submission.step;
                self.drawn_frame = Some(submission.frame);
            } else {
                self.problem = Some("the scene was not JSON".into());
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

#[derive(Default)]
struct Outcome {
    dropped: bool,
    late: bool,
    parse_ms: Option<f64>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU32;
    use std::thread;
    use std::time::Instant;

    const PERIOD: Duration = Duration::from_micros(16_667);
    const FRAMES: u32 = 60;
    const LATE_SAMPLE: u32 = 20;

    struct TestClock(Instant);

    impl Clock for TestClock {
        fn now_ns(&self) -> u64 {
            self.0.elapsed().as_nanos() as u64
        }
    }

    struct FakeSurface {
        origin: Instant,
        acquires: u32,
        presented: Arc<Mutex<Vec<(u64, Instant)>>>,
        drawing: AtomicU32,
    }

    impl Surface for FakeSurface {
        type Image = Instant;

        fn acquire(&mut self) -> Option<Instant> {
            self.acquires += 1;
            let vblank = self.origin + PERIOD * self.acquires;
            thread::sleep(vblank.saturating_duration_since(Instant::now()));
            Some(vblank)
        }

        fn draw(&self, _: &Instant, step: u64) {
            self.drawing.store(step as u32, Ordering::Release);
        }

        fn present(&self, image: Instant) {
            let step = self.drawing.load(Ordering::Acquire) as u64;
            lock(&self.presented).push((step, image));
            assert!(image.elapsed() < PERIOD, "a present landed after its vblank's frame");
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
        let surface = FakeSurface { origin: Instant::now(), acquires: 0, presented: presented.clone(), drawing: AtomicU32::new(0) };
        let mut frames = FrameLoop::new(surface, TestClock(Instant::now()), mailbox.clone(), metrics.clone());
        let consumer = {
            let mailbox = mailbox.clone();
            thread::spawn(move || {
                let mut seen = Vec::new();
                while seen.len() < FRAMES as usize {
                    let Event::Frame(sample) = mailbox.next_event(Duration::from_millis(500)) else { break };
                    if sample.frame == LATE_SAMPLE {
                        thread::sleep(Duration::from_millis(50));
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
        let count = |which: u32| metrics.series(which).iter().sum::<f64>() as u32;
        assert_eq!(count(5), 0, "no present missed");
        assert_eq!(count(8), 0, "no sample dropped");
        assert!((1..=4).contains(&count(7)), "the 50 ms sample's scenes were late");

        let steps: Vec<u64> = lock(&presented).iter().map(|(step, _)| *step).collect();
        let stuck = steps.iter().position(|step| *step == LATE_SAMPLE as u64).expect("the last scene before the late one");
        assert_eq!(steps[stuck + 1], LATE_SAMPLE as u64, "the late frame redraws the previous scene");
        assert!(steps.iter().any(|step| *step > LATE_SAMPLE as u64 + 1), "the late scene reached a later frame");
        assert!(steps.windows(2).all(|pair| pair[0] <= pair[1]), "scenes never go backwards");
    }
}
