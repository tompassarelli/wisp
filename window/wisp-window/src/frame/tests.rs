use super::*;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::input::Input;
use crate::stepper::{self, Seam, Stepper};

const PERIOD_NS: u64 = 16_666_667;

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

#[derive(Clone)]
struct RealClock;

impl Clock for RealClock {
    fn now_ns(&self) -> u64 {
        crate::clock::now_ns()
    }
}

/// A window the compositor does not show: no image, after the 4 ms the real surface sleeps for one.
struct Unshown;

impl Surface for Unshown {
    type Image = ();

    fn acquire(&mut self) -> Option<()> {
        thread::sleep(Duration::from_millis(4));
        None
    }

    fn draw(&mut self, _: &(), _: u64) {}

    fn present(&self, _: ()) {}
}

fn answer_every_sample(mailbox: &Arc<Mailbox>) -> JoinHandle<u32> {
    let mailbox = mailbox.clone();
    thread::spawn(move || {
        let mut stepped = 0;
        while let Event::Frame(sample) = mailbox.next_event(Duration::from_secs(10)) {
            stepped += 1;
            mailbox.submit(Submission { bytes: b"{}".to_vec(), step: sample.frame as u64 + 1, frame: sample.frame, arrived_ns: crate::clock::now_ns() });
        }
        stepped
    })
}

#[test]
fn the_step_clock_steps_sixty_times_a_second_on_its_own_thread_while_the_window_has_no_image() {
    const RUN: Duration = Duration::from_secs(2);
    let mailbox = Arc::new(Mailbox::default());
    let steps = Arc::new(Stepper::default());
    let consumer = answer_every_sample(&mailbox);
    let began = Instant::now();
    let clock_thread = {
        let (steps, mailbox) = (steps.clone(), mailbox.clone());
        thread::spawn(move || stepper::run(steps, RealClock, mailbox, || Some(Mode::Game), Quiet))
    };
    let mut frames = FrameLoop::new(Unshown, RealClock, mailbox.clone(), Arc::new(Mutex::new(Metrics::default())), steps);
    while began.elapsed() < RUN {
        assert!(!frames.frame(Mode::Game), "nothing was drawn");
    }
    mailbox.stop();
    let elapsed = began.elapsed().as_secs_f64();
    clock_thread.join().unwrap();
    let stepped = consumer.join().unwrap();
    let expected = elapsed * 60.0;
    assert!((stepped as f64 - expected).abs() <= 2.0, "{stepped} steps in {elapsed:.3} s with no image, {expected:.1} were due");
}

mod simulated {
    use super::super::*;
    use std::time::Duration;
    use crate::stepper::Stepper;
    use std::cell::RefCell;
    use std::rc::Rc;

    use super::{Quiet, PERIOD_NS};

    const DRAW_NS: u64 = 2_000_000;
    const UNSHOWN_TRY_NS: u64 = 4_000_000;
    const SECOND_NS: u64 = 1_000_000_000;
    const WINDOW_FRAMES: usize = 300;
    /// The step's measured quantiles in wisp#145 (p50 4.5 ms, p95 14.5 ms) and a tail past one sim period, so some steps miss any deadline the pacer could choose.
    const STEP_QUANTILES: [(f64, f64); 6] = [(0.0, 2.0), (0.5, 4.5), (0.95, 14.5), (0.99, 18.0), (0.999, 24.0), (1.0, 30.0)];

    fn scripted_step_ms(frame: u32) -> f64 {
        let mut x = (frame as u64 + 1).wrapping_mul(0x9E37_79B9_7F4A_7C15);
        x ^= x >> 31;
        x = x.wrapping_mul(0xBF58_476D_1CE4_E5B9);
        x ^= x >> 29;
        let u = (x >> 11) as f64 / (1u64 << 53) as f64;
        let at = STEP_QUANTILES.windows(2).find(|pair| u <= pair[1].0).unwrap_or(&STEP_QUANTILES[4..6]);
        let ((u0, ms0), (u1, ms1)) = (at[0], at[1]);
        ms0 + (ms1 - ms0) * (u - u0) / (u1 - u0)
    }

    fn quick_step_ms(_: u32) -> f64 {
        2.0
    }

    /// The step clock, the game's thread and the display on one fake timeline: the clock takes each step at its due time, the worker takes each sample once it is queued and free and answers after the scripted step, and the display hands back an image at the first tick of its own grid after the last present, which is the vblank grid while the window is shown and a coarser one while the compositor throttles it, and none at all while it is unshown; under `Mailbox` it hands one back as soon as the GPU has finished the last frame, `gpu_ns` after its draw; it reports its vblank period as the window's monitor does.
    struct World {
        now_ns: u64,
        refresh_ns: u64,
        image_every_ns: u64,
        unshown: bool,
        mailbox: bool,
        gpu_ns: u64,
        gpu_free_ns: u64,
        step_ms: fn(u32) -> f64,
        worker_free_ns: u64,
        in_flight: VecDeque<(u64, u32)>,
        presented_ns: Option<u64>,
        acquires: Vec<u64>,
        shown: Vec<u64>,
    }

    #[derive(Clone)]
    struct SimClock {
        world: Rc<RefCell<World>>,
        mailbox: Arc<Mailbox>,
        stepper: Arc<Stepper>,
    }

    impl SimClock {
        fn serve(&self) {
            let mut world = self.world.borrow_mut();
            while let Event::Frame(sample) = self.mailbox.next_event(Duration::ZERO) {
                let began = sample.sampled_ns.max(world.worker_free_ns);
                let arrival = began + ((world.step_ms)(sample.frame) * 1e6) as u64;
                world.worker_free_ns = arrival;
                world.in_flight.push_back((arrival, sample.frame));
            }
            while let Some(&(arrival, frame)) = world.in_flight.front().filter(|(arrival, _)| *arrival <= world.now_ns) {
                world.in_flight.pop_front();
                self.mailbox.submit(Submission { bytes: b"{}".to_vec(), step: frame as u64 + 1, frame, arrived_ns: arrival });
            }
        }

        /// Moves the timeline to `to_ns`, taking each step that falls due on the way at its due time, as the step clock's thread does.
        fn advance(&self, to_ns: u64) {
            loop {
                let now = self.now_ns();
                let due = self.stepper.due_ns(now).max(now);
                if due > to_ns {
                    break;
                }
                self.world.borrow_mut().now_ns = due;
                self.serve();
                self.stepper.tick(due, Mode::Game, &Quiet, &self.mailbox);
                self.serve();
            }
            let mut world = self.world.borrow_mut();
            world.now_ns = world.now_ns.max(to_ns);
            drop(world);
            self.serve();
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
            loop {
                self.advance(0);
                if mailbox.wait_for_scene(frame, Duration::ZERO) {
                    return true;
                }
                let now = self.now_ns();
                let next_step = self.stepper.due_ns(now).max(now);
                let next = self.arrival_of(frame).map_or(next_step, |arrival| arrival.min(next_step));
                if next > deadline_ns {
                    self.advance(deadline_ns);
                    return mailbox.wait_for_scene(frame, Duration::ZERO);
                }
                self.advance(next);
            }
        }
    }

    struct SimDisplay(SimClock);

    impl Surface for SimDisplay {
        type Image = ();

        fn acquire(&mut self) -> Option<()> {
            let (now, every, presented, unshown, mailbox, gpu_free) = {
                let world = self.0.world.borrow();
                (world.now_ns, world.image_every_ns, world.presented_ns, world.unshown, world.mailbox, world.gpu_free_ns)
            };
            if unshown {
                self.0.advance(now + UNSHOWN_TRY_NS);
                return None;
            }
            let at = if mailbox { now.max(gpu_free) } else { presented.unwrap_or(now).max(now).div_ceil(every) * every };
            self.0.advance(at);
            self.0.world.borrow_mut().acquires.push(at);
            Some(())
        }

        fn draw(&mut self, _: &(), step: u64) {
            let now = self.0.now_ns();
            self.0.advance(now + DRAW_NS);
            let mut world = self.0.world.borrow_mut();
            world.shown.push(step);
            world.gpu_free_ns = world.now_ns + world.gpu_ns;
        }

        fn present(&self, _: ()) {
            let mut world = self.0.world.borrow_mut();
            world.presented_ns = Some(world.now_ns);
        }

        fn refresh_ms(&self) -> Option<f64> {
            Some(self.0.world.borrow().refresh_ns as f64 / 1e6)
        }

        fn blocks_on_display(&self) -> bool {
            !self.0.world.borrow().mailbox
        }
    }

    struct Sim {
        frames: FrameLoop<SimDisplay, SimClock>,
        clock: SimClock,
        metrics: Arc<Mutex<Metrics>>,
    }

    impl Sim {
        fn new(period_ns: u64, step_ms: fn(u32) -> f64) -> Self {
            let mailbox = Arc::new(Mailbox::default());
            let stepper = Arc::new(Stepper::default());
            let world = World { now_ns: period_ns, refresh_ns: period_ns, image_every_ns: period_ns, unshown: false, mailbox: false, gpu_ns: 0, gpu_free_ns: 0, step_ms, worker_free_ns: 0, in_flight: VecDeque::new(), presented_ns: None, acquires: Vec::new(), shown: Vec::new() };
            let clock = SimClock { world: Rc::new(RefCell::new(world)), mailbox: mailbox.clone(), stepper: stepper.clone() };
            let metrics = Arc::new(Mutex::new(Metrics::default()));
            let frames = FrameLoop::new(SimDisplay(clock.clone()), clock.clone(), mailbox, metrics.clone(), stepper);
            Self { frames, clock, metrics }
        }

        fn now_ns(&self) -> u64 {
            self.clock.now_ns()
        }

        fn run_until(&mut self, until_ns: u64) {
            while self.now_ns() < until_ns {
                self.frames.frame(Mode::Game);
            }
        }

        fn stepped(&self) -> u32 {
            self.clock.stepper.next(self.now_ns()).0
        }

        fn world(&self) -> std::cell::RefMut<'_, World> {
            self.clock.world.borrow_mut()
        }

        fn late(&self) -> Vec<bool> {
            lock(&self.metrics).series(Series::LateScenes.index() as u32).iter().map(|flag| *flag > 0.0).collect()
        }
    }

    fn quantile(values: &[f64], at: f64) -> f64 {
        let mut sorted = values.to_vec();
        sorted.sort_by(f64::total_cmp);
        sorted[((sorted.len() as f64 * at).ceil() as usize).clamp(1, sorted.len()) - 1]
    }

    fn a_slow_step_costs_at_most_a_late_scene(hz: f64) {
        const SECONDS: u64 = 60;
        let period_ns = (1e9 / hz) as u64;
        let mut sim = Sim::new(period_ns, scripted_step_ms);
        sim.run_until(SECONDS * SECOND_NS);
        let steps_ms: Vec<f64> = (0..sim.stepped()).map(scripted_step_ms).collect();
        assert!((quantile(&steps_ms, 0.5) - 4.5).abs() < 0.3 && (quantile(&steps_ms, 0.95) - 14.5).abs() < 0.5, "the script steps at p50 4.5 ms and p95 14.5 ms");
        assert!(steps_ms.iter().filter(|step| **step * 1e6 > 1e9 / 60.0).count() > 10, "some steps outlast a sim period");
        let acquires = sim.world().acquires.clone();
        let longest = acquires.windows(2).map(|pair| pair[1] - pair[0]).max().unwrap_or(0);
        assert_eq!(longest, period_ns, "at {hz} Hz every present lands on the next vblank");
        let late = sim.late();
        let windows: Vec<usize> = late.chunks(WINDOW_FRAMES).map(|window| window.iter().filter(|late| **late).count()).collect();
        let total: usize = windows.iter().sum();
        assert!(total * WINDOW_FRAMES < 3 * late.len(), "at {hz} Hz {total} of {} frames were late, the oracle allows under 3 in {WINDOW_FRAMES}: {windows:?}", late.len());
    }

    #[test]
    fn a_slow_step_costs_at_most_a_late_scene_at_60_hz() {
        a_slow_step_costs_at_most_a_late_scene(60.0);
    }

    #[test]
    fn a_slow_step_costs_at_most_a_late_scene_at_120_hz() {
        a_slow_step_costs_at_most_a_late_scene(120.0);
    }

    fn one_slow_step(frame: u32) -> f64 {
        if frame == 30 { 40.0 } else { 2.0 }
    }

    #[test]
    fn a_late_scene_redraws_the_last_one_and_the_frames_after_catch_up() {
        let mut sim = Sim::new(PERIOD_NS, one_slow_step);
        sim.run_until(2 * SECOND_NS);
        let late = sim.late();
        let shown = sim.world().shown.clone();
        let acquires = sim.world().acquires.clone();
        assert!(acquires.windows(2).all(|pair| pair[1] - pair[0] == PERIOD_NS), "every frame presented on the next vblank, the late ones included");
        let late_frames: Vec<usize> = late.iter().enumerate().filter(|(_, late)| **late).map(|(frame, _)| frame).collect();
        assert!((1..=3).contains(&late_frames.len()), "only the frames waiting behind the slow step were late: {late_frames:?}");
        for frame in &late_frames {
            assert_eq!(shown[*frame], shown[frame - 1], "late frame {frame} redraws the scene before it");
        }
        assert!(shown.windows(2).all(|pair| pair[0] <= pair[1]), "scenes never go backwards");
        let after = &shown[late_frames[late_frames.len() - 1] + 3..];
        let repeated = after.windows(2).filter(|pair| pair[1] == pair[0]).count();
        let skipped = after.windows(2).filter(|pair| pair[1] > pair[0] + 1).count();
        assert!(repeated <= 1 && skipped <= 1 && after.windows(2).all(|pair| pair[1] <= pair[0] + 2), "the frames after show one step each but for the one frame the longer lead moves the step across: {after:?}");
        let behind = sim.stepped() as u64 - shown[shown.len() - 1];
        assert!(behind <= 3, "the last frame shows a scene {behind} steps behind the clock");
    }

    #[test]
    fn a_window_throttled_to_one_frame_a_second_paces_to_the_display_again_once_it_is_shown() {
        const THROTTLED_SECONDS: u64 = 30;
        const SHOWN_SECONDS: u64 = 5;
        let mut sim = Sim::new(PERIOD_NS, quick_step_ms);
        sim.world().image_every_ns = SECOND_NS;
        sim.run_until(THROTTLED_SECONDS * SECOND_NS);
        sim.world().image_every_ns = PERIOD_NS;
        sim.run_until((THROTTLED_SECONDS + SHOWN_SECONDS) * SECOND_NS);
        let acquires = sim.world().acquires.clone();
        let settled: Vec<u64> = acquires.windows(2).map(|pair| pair[1] - pair[0]).skip(acquires.len() - 60).collect();
        assert!(settled.iter().all(|interval| *interval == PERIOD_NS), "the last frames come at the display's 60 Hz, not the throttle's: {settled:?}");
        let seconds = (sim.now_ns() - PERIOD_NS) as f64 / 1e9;
        assert!((sim.stepped() as f64 - seconds * 60.0).abs() <= 2.0, "{} steps in {seconds:.2} s", sim.stepped());
    }

    #[test]
    fn a_window_shown_once_a_second_still_steps_sixty_times_a_second() {
        const SECONDS: u64 = 20;
        let mut sim = Sim::new(PERIOD_NS, quick_step_ms);
        sim.world().image_every_ns = SECOND_NS;
        sim.run_until(SECONDS * SECOND_NS);
        let seconds = (sim.now_ns() - PERIOD_NS) as f64 / 1e9;
        assert!((sim.stepped() as f64 - seconds * 60.0).abs() <= 2.0, "{} steps in {seconds:.2} s of one frame a second", sim.stepped());
        let shown = sim.world().shown.clone();
        assert!(shown.windows(2).skip(1).all(|pair| (59..=61).contains(&(pair[1] - pair[0]))), "each frame shows the scene a second on: {shown:?}");
    }

    #[test]
    fn a_window_with_no_image_to_draw_still_steps_sixty_times_a_second() {
        const SECONDS: u64 = 5;
        let mut sim = Sim::new(PERIOD_NS, quick_step_ms);
        sim.world().unshown = true;
        while sim.now_ns() < SECONDS * SECOND_NS {
            assert!(!sim.frames.frame(Mode::Game), "nothing was drawn");
        }
        let seconds = (sim.now_ns() - PERIOD_NS) as f64 / 1e9;
        assert!((sim.stepped() as f64 - seconds * 60.0).abs() <= 1.0, "{} steps in {seconds:.2} s with no image", sim.stepped());
    }

    #[test]
    fn a_mailbox_frame_longer_than_a_vblank_lands_on_the_first_vblank_after_it() {
        const SECONDS: u64 = 20;
        const GPU_NS: u64 = 38_000_000;
        let period_ns = (1e9 / 120.0) as u64;
        let mut sim = Sim::new(period_ns, quick_step_ms);
        {
            let mut world = sim.world();
            world.mailbox = true;
            world.gpu_ns = GPU_NS;
        }
        sim.run_until(SECONDS * SECOND_NS);
        let acquires = sim.world().acquires.clone();
        let intervals: Vec<u64> = acquires.windows(2).map(|pair| pair[1] - pair[0]).skip(acquires.len() / 2).collect();
        let longest = (DRAW_NS + GPU_NS).div_ceil(period_ns) * period_ns + period_ns;
        assert!(intervals.iter().all(|interval| *interval <= longest), "a frame of {} ms of GPU work at 120 Hz takes at most {:.1} ms, not a pacing grid of its own: {:?}", GPU_NS / 1_000_000, longest as f64 / 1e6, intervals.iter().map(|interval| *interval as f64 / 1e6).collect::<Vec<_>>());
        let seconds = (sim.now_ns() - period_ns) as f64 / 1e9;
        assert!((sim.stepped() as f64 - seconds * 60.0).abs() <= 2.0, "{} steps in {seconds:.2} s", sim.stepped());
    }
}
