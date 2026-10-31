use super::*;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::time::Instant;

const PERIOD_NS: u64 = 16_666_667;
/// How long the test's clock lets a consumer answer in real time before the scene counts as late: far more than any host's scheduling
/// delay, so only the samples the script holds back are late.
const ANSWER_GRACE: Duration = Duration::from_secs(1);
const WARMUP: u32 = PERIOD_MINIMUM as u32 + 1;
const FRAMES: u32 = 22;
/// After the pacer has measured ten on-time steps, so it aims each sample at the frame that takes it.
const LATE_SAMPLE: u32 = 15;
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
                mailbox.submit(Submission { bytes: vec![0; 4096], step: 1, frame, arrived_ns: 0 });
                frame += 1;
            }
            mailbox.submit(Submission { bytes: b"{}".to_vec(), step: 2, frame, arrived_ns: 0 });
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
                mailbox.submit(Submission { bytes: b"{}".to_vec(), step: sample.frame as u64 + 1, frame: sample.frame, arrived_ns: sample.sampled_ns });
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
    let flags = |which: Series| metrics.series(which.index() as u32).iter().map(|flag| *flag as u32).collect::<Vec<_>>();
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

mod simulated {
    use super::super::*;
    use std::cell::RefCell;
    use std::rc::Rc;

    const DRAW_NS: u64 = 2_000_000;
    const SECONDS: f64 = 60.0;
    const WINDOW_FRAMES: usize = 300;
    /// The step's measured quantiles in wisp#145 (p50 4.5 ms, p95 14.5 ms) and a tail past one sim period, so some steps miss any deadline the pacer could choose.
    const STEP_QUANTILES: [(f64, f64); 6] = [(0.0, 2.0), (0.5, 4.5), (0.95, 14.5), (0.99, 18.0), (0.999, 24.0), (1.0, 30.0)];

    fn step_ms(frame: u32) -> f64 {
        let mut x = (frame as u64 + 1).wrapping_mul(0x9E37_79B9_7F4A_7C15);
        x ^= x >> 31;
        x = x.wrapping_mul(0xBF58_476D_1CE4_E5B9);
        x ^= x >> 29;
        let u = (x >> 11) as f64 / (1u64 << 53) as f64;
        let at = STEP_QUANTILES.windows(2).find(|pair| u <= pair[1].0).unwrap_or(&STEP_QUANTILES[4..6]);
        let ((u0, ms0), (u1, ms1)) = (at[0], at[1]);
        ms0 + (ms1 - ms0) * (u - u0) / (u1 - u0)
    }

    /// The game's thread and the display on one fake timeline: the worker takes each sample once it is queued and free, answers after the scripted step, and the display shows a presented image at the first vblank after the present.
    struct World {
        now_ns: u64,
        period_ns: u64,
        worker_free_ns: u64,
        in_flight: VecDeque<(u64, u32)>,
        presented_ns: Option<u64>,
        acquires: Vec<u64>,
    }

    #[derive(Clone)]
    struct SimClock {
        world: Rc<RefCell<World>>,
        mailbox: Arc<Mailbox>,
    }

    impl SimClock {
        fn advance(&self, to_ns: u64) {
            let mut world = self.world.borrow_mut();
            while let Event::Frame(sample) = self.mailbox.next_event(Duration::ZERO) {
                let began = sample.sampled_ns.max(world.worker_free_ns);
                let arrival = began + (step_ms(sample.frame) * 1e6) as u64;
                world.worker_free_ns = arrival;
                world.in_flight.push_back((arrival, sample.frame));
            }
            world.now_ns = world.now_ns.max(to_ns);
            while let Some(&(arrival, frame)) = world.in_flight.front().filter(|(arrival, _)| *arrival <= world.now_ns) {
                world.in_flight.pop_front();
                self.mailbox.submit(Submission { bytes: b"{}".to_vec(), step: frame as u64 + 1, frame, arrived_ns: arrival });
            }
        }

        fn arrival_of(&self, frame: u32) -> Option<u64> {
            self.world.borrow().in_flight.iter().find(|(_, answered)| *answered >= frame).map(|(arrival, _)| *arrival)
        }
    }

    impl Clock for SimClock {
        fn now_ns(&self) -> u64 {
            self.world.borrow().now_ns
        }

        fn sleep_until(&self, target_ns: u64) {
            self.advance(target_ns);
        }

        fn wait_for_scene(&self, mailbox: &Mailbox, frame: u32, deadline_ns: u64) -> bool {
            self.advance(0);
            if mailbox.wait_for_scene(frame, Duration::ZERO) {
                return true;
            }
            match self.arrival_of(frame) {
                Some(arrival) if arrival <= deadline_ns => {
                    self.advance(arrival);
                    true
                }
                _ => {
                    self.advance(deadline_ns);
                    false
                }
            }
        }
    }

    struct SimDisplay(SimClock);

    impl Surface for SimDisplay {
        type Image = ();

        fn acquire(&mut self) -> Option<()> {
            let (now, period, presented) = {
                let world = self.0.world.borrow();
                (world.now_ns, world.period_ns, world.presented_ns)
            };
            let vblank = presented.unwrap_or(now).max(now).div_ceil(period) * period;
            self.0.advance(vblank);
            self.0.world.borrow_mut().acquires.push(vblank);
            Some(())
        }

        fn draw(&mut self, _: &(), _: u64) {
            let now = self.0.now_ns();
            self.0.advance(now + DRAW_NS);
        }

        fn present(&self, _: ()) {
            let mut world = self.0.world.borrow_mut();
            world.presented_ns = Some(world.now_ns);
        }
    }

    struct Run {
        intervals_ns: Vec<u64>,
        late: Vec<bool>,
        steps_ms: Vec<f64>,
    }

    fn run(hz: f64) -> Run {
        let period_ns = (1e9 / hz) as u64;
        let mailbox = Arc::new(Mailbox::default());
        let world = World { now_ns: period_ns, period_ns, worker_free_ns: 0, in_flight: VecDeque::new(), presented_ns: None, acquires: Vec::new() };
        let clock = SimClock { world: Rc::new(RefCell::new(world)), mailbox: mailbox.clone() };
        let metrics = Arc::new(Mutex::new(Metrics::default()));
        let mut frames = FrameLoop::new(SimDisplay(clock.clone()), clock.clone(), mailbox, metrics.clone());
        for _ in 0..super::WARMUP {
            frames.frame(Mode::Loading, &super::Quiet);
        }
        let count = (hz * SECONDS) as usize;
        for _ in 0..count {
            frames.frame(Mode::Game, &super::Quiet);
        }
        let acquires = clock.world.borrow().acquires.clone();
        let late = lock(&metrics).series(Series::LateScenes.index() as u32).iter().map(|flag| *flag > 0.0).collect();
        let steps_ms = (0..frames.frame).map(step_ms).collect();
        Run { intervals_ns: acquires[super::WARMUP as usize..].windows(2).map(|pair| pair[1] - pair[0]).collect(), late, steps_ms }
    }

    fn quantile(values: &[f64], at: f64) -> f64 {
        let mut sorted = values.to_vec();
        sorted.sort_by(f64::total_cmp);
        sorted[((sorted.len() as f64 * at).ceil() as usize).clamp(1, sorted.len()) - 1]
    }

    fn a_slow_step_costs_at_most_a_late_scene(hz: f64) {
        let run = run(hz);
        let period_ns = (1e9 / hz) as u64;
        assert!((quantile(&run.steps_ms, 0.5) - 4.5).abs() < 0.3 && (quantile(&run.steps_ms, 0.95) - 14.5).abs() < 0.5, "the script steps at p50 4.5 ms and p95 14.5 ms");
        assert!(run.steps_ms.iter().filter(|step| **step * 1e6 > 1e9 / 60.0).count() > 10, "some steps outlast a sim period");
        let longest = run.intervals_ns.iter().max().copied().unwrap_or(0);
        assert_eq!(longest, period_ns, "at {hz} Hz every present lands on the next vblank");
        let windows: Vec<usize> = run.late.chunks(WINDOW_FRAMES).map(|window| window.iter().filter(|late| **late).count()).collect();
        let late: usize = windows.iter().sum();
        assert!(late * WINDOW_FRAMES < 3 * run.late.len(), "at {hz} Hz {late} of {} frames were late, the oracle allows under 3 in {WINDOW_FRAMES}: {windows:?}", run.late.len());
    }

    #[test]
    fn a_slow_step_costs_at_most_a_late_scene_at_60_hz() {
        a_slow_step_costs_at_most_a_late_scene(60.0);
    }

    #[test]
    fn a_slow_step_costs_at_most_a_late_scene_at_120_hz() {
        a_slow_step_costs_at_most_a_late_scene(120.0);
    }
}
