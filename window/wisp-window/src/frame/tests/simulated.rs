use std::cell::RefCell;
use std::rc::Rc;
use std::time::Duration;
use super::super::*;
use super::{Quiet, PERIOD_NS};
use crate::stepper::Stepper;

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

/// The step clock, the game's thread and the display on one fake timeline: the clock takes each step at its due time, the worker takes the queued sample once it is free and answers after the scripted step, and the display hands back an image at the first tick of its own grid after the last present, which is the vblank grid while the window is shown and a coarser one while the compositor throttles it, and none at all while it is unshown; held in present, it hands back an image at once and its present blocks to that grid instead, as Mesa's Wayland `Fifo` does while niri throttles a hidden window; under `Mailbox` it hands one back as soon as the GPU has finished the last frame, `gpu_ns` after its draw; it reports its vblank period as the window's monitor does.
struct World {
    now_ns: u64,
    refresh_ns: u64,
    image_every_ns: u64,
    unshown: bool,
    held_in_present: bool,
    mailbox: bool,
    ready: bool,
    answered: Vec<(u32, u64)>,
    gpu_ns: u64,
    gpu_free_ns: u64,
    step_ms: fn(u32) -> f64,
    worker_free_ns: u64,
    in_flight: VecDeque<(u64, u32)>,
    presented_ns: Option<u64>,
    acquires: Vec<u64>,
    shown: Vec<u64>,
    drawn_at: Vec<u64>,
    began: Vec<u64>,
    frame_gpu_ns: u64,
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
        while world.worker_free_ns <= world.now_ns {
            let Event::Frame(sample) = self.mailbox.next_event(Duration::ZERO) else { break };
            let began = sample.sampled_ns.max(world.worker_free_ns);
            world.began.push(began);
            let arrival = began + ((world.step_ms)(sample.frame) * 1e6) as u64;
            world.worker_free_ns = arrival;
            world.in_flight.push_back((arrival, sample.frame));
        }
        while let Some(&(arrival, frame)) = world.in_flight.front().filter(|(arrival, _)| *arrival <= world.now_ns) {
            world.in_flight.pop_front();
            world.answered.push((frame, arrival));
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
            self.stepper.tick(due, Mode::Game, &mut Quiet, &self.mailbox);
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
            let free = self.world.borrow().worker_free_ns;
            let next = self.arrival_of(frame).map_or(next_step, |arrival| arrival.min(next_step));
            let next = if free > now { next.min(free) } else { next };
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
        let (now, every, presented, unshown, mailbox, gpu_free, held_in_present) = {
            let world = self.0.world.borrow();
            (world.now_ns, world.image_every_ns, world.presented_ns, world.unshown, world.mailbox || world.ready, world.gpu_free_ns, world.held_in_present)
        };
        if unshown {
            self.0.advance(now + UNSHOWN_TRY_NS);
            return None;
        }
        let at = if mailbox || held_in_present { now.max(gpu_free) } else { presented.unwrap_or(now).max(now).div_ceil(every) * every };
        self.0.advance(at);
        self.0.world.borrow_mut().acquires.push(at);
        Some(())
    }

    fn draw(&mut self, _: &(), step: u64) {
        let now = self.0.now_ns();
        self.0.advance(now + DRAW_NS);
        let mut world = self.0.world.borrow_mut();
        world.shown.push(step);
        world.drawn_at.push(now);
        world.frame_gpu_ns = world.gpu_ns;
        world.gpu_free_ns = world.now_ns + world.frame_gpu_ns;
    }

    fn present(&self, _: ()) {
        let (now, every, presented, held_in_present) = {
            let world = self.0.world.borrow();
            (world.now_ns, world.image_every_ns, world.presented_ns, world.held_in_present)
        };
        if held_in_present {
            self.0.advance(presented.map_or(now, |presented| presented + 1).max(now).div_ceil(every) * every);
        }
        let mut world = self.0.world.borrow_mut();
        world.presented_ns = Some(world.now_ns);
    }

    fn refresh_ms(&self) -> Option<f64> {
        Some(self.0.world.borrow().refresh_ns as f64 / 1e6)
    }

    fn timings(&mut self) -> Timings {
        Timings { gpu: vec![crate::gpu_time::FrameGpu { passes: Vec::new(), span_ms: self.0.world.borrow().frame_gpu_ns as f64 / 1e6 }], ..Timings::default() }
    }

    fn present_setting(&self) -> PresentSetting {
        let world = self.0.world.borrow();
        if world.ready { PresentSetting::Immediate } else if world.mailbox { PresentSetting::Mailbox } else { PresentSetting::Fifo }
    }
}

struct Sim {
    frames: FrameLoop<SimDisplay, SimClock>,
    clock: SimClock,
    metrics: Arc<Mutex<Metrics>>,
    pulse_lines: Vec<String>,
}

impl Sim {
    fn new(period_ns: u64, step_ms: fn(u32) -> f64) -> Self {
        let mailbox = Arc::new(Mailbox::default());
        let stepper = Arc::new(Stepper::default());
        let world = World { now_ns: period_ns, refresh_ns: period_ns, image_every_ns: period_ns, unshown: false, held_in_present: false, mailbox: false, ready: false, answered: Vec::new(), gpu_ns: 0, gpu_free_ns: 0, step_ms, worker_free_ns: 0, in_flight: VecDeque::new(), presented_ns: None, acquires: Vec::new(), shown: Vec::new(), drawn_at: Vec::new(), began: Vec::new(), frame_gpu_ns: 0 };
        let clock = SimClock { world: Rc::new(RefCell::new(world)), mailbox: mailbox.clone(), stepper: stepper.clone() };
        let metrics = Arc::new(Mutex::new(Metrics::default()));
        let frames = FrameLoop::new(SimDisplay(clock.clone()), clock.clone(), mailbox, metrics.clone(), stepper);
        Self { frames, clock, metrics, pulse_lines: Vec::new() }
    }

    fn now_ns(&self) -> u64 {
        self.clock.now_ns()
    }

    fn run_until(&mut self, until_ns: u64) {
        while self.now_ns() < until_ns {
            self.frames.frame(Mode::Game);
            self.pulse_lines.extend(self.frames.pulse_line.take());
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

