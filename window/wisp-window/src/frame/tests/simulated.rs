mod latching;

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::time::Duration;
use super::super::*;
use super::{Quiet, PERIOD_NS};
use crate::display_lock::Shown;
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
    display: Option<latching::Latching>,
    sampled: HashMap<u32, u64>,
    press_every: u64,
    press_gpu_ns: u64,
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
            world.sampled.insert(sample.frame, sample.sampled_ns);
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
        let pressed = world.press_every > 0 && step.is_multiple_of(world.press_every);
        world.frame_gpu_ns = world.gpu_ns + if pressed { world.press_gpu_ns } else { 0 };
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
        let ready = world.now_ns.max(world.gpu_free_ns);
        let sampled = world.shown.last().and_then(|step| world.sampled.get(&(step.saturating_sub(1) as u32))).copied();
        let pressed = world.press_every > 0 && world.shown.last().is_some_and(|step| step.is_multiple_of(world.press_every));
        if let Some(display) = world.display.as_mut() {
            display.present(ready, sampled, pressed);
        }
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

    fn shown(&mut self) -> Vec<Shown> {
        let mut world = self.0.world.borrow_mut();
        let now = world.now_ns;
        let Some(display) = world.display.as_mut().filter(|display| display.reports) else { return Vec::new() };
        let ready = display.queued.iter().take_while(|shown| shown.shown_ns <= now).count();
        display.queued.drain(..ready).collect()
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
        let world = World { now_ns: period_ns, refresh_ns: period_ns, image_every_ns: period_ns, unshown: false, held_in_present: false, mailbox: false, ready: false, answered: Vec::new(), gpu_ns: 0, gpu_free_ns: 0, step_ms, worker_free_ns: 0, in_flight: VecDeque::new(), presented_ns: None, acquires: Vec::new(), shown: Vec::new(), drawn_at: Vec::new(), began: Vec::new(), display: None, sampled: HashMap::new(), press_every: 0, press_gpu_ns: 0, frame_gpu_ns: 0 };
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

/// The most steps the game began in any one second of `began`, a sorted list of times.
fn most_in_a_second(began: &[u64]) -> usize {
    began.iter().enumerate().map(|(first, at)| began[first..].partition_point(|later| *later < at + SECOND_NS)).max().unwrap_or(0)
}

#[test]
fn a_window_hidden_then_shown_never_gives_the_game_more_than_sixty_steps_in_any_second() {
    let period_ns = (1e9 / 120.0) as u64;
    let mut sim = Sim::new(period_ns, quick_step_ms);
    sim.run_until(5 * SECOND_NS);
    sim.world().image_every_ns = SECOND_NS;
    sim.run_until(15 * SECOND_NS);
    sim.world().image_every_ns = period_ns;
    sim.run_until(20 * SECOND_NS);
    let began = sim.world().began.clone();
    assert_eq!(most_in_a_second(&began), 60, "the game began at most 60 steps in any second, shown, hidden or shown again");
    let seconds = (sim.now_ns() - period_ns) as f64 / 1e9;
    assert!((began.len() as f64 - seconds * 60.0).abs() <= 2.0, "{} steps in {seconds:.2} s", began.len());
}

fn one_stall(frame: u32) -> f64 {
    if frame == 60 { 300.0 } else { 2.0 }
}

#[test]
fn a_stalled_game_drops_the_steps_it_could_not_take_instead_of_running_them_at_once() {
    let mut sim = Sim::new(PERIOD_NS, one_stall);
    sim.run_until(4 * SECOND_NS);
    let began = sim.world().began.clone();
    assert!(most_in_a_second(&began) <= 60, "{} steps began in one second", most_in_a_second(&began));
    assert!(began.windows(3).all(|three| three[2] - three[0] >= PERIOD_NS), "after the stall the game runs the one sample it holds and then one a step, never a backlog");
    let seconds = (sim.now_ns() - PERIOD_NS) as f64 / 1e9;
    let lost = seconds * 60.0 - began.len() as f64;
    assert!((15.0..=19.0).contains(&lost), "the 300 ms stall dropped about 17 steps, it lost {lost:.0}");
}

fn ticks_per_second(line: &str) -> f64 {
    line.split_once(" ticks/s").and_then(|(before, _)| before.rsplit(' ').next()).and_then(|rate| rate.parse().ok()).unwrap_or(f64::NAN)
}

#[test]
fn a_window_held_in_present_while_hidden_never_shows_or_reports_more_than_sixty_ticks_a_second() {
    const SHOWN_SECONDS: u64 = 12;
    const HIDDEN_SECONDS: u64 = 30;
    let period_ns = (1e9 / 120.0) as u64;
    let mut sim = Sim::new(period_ns, quick_step_ms);
    sim.world().held_in_present = true;
    sim.run_until(SHOWN_SECONDS * SECOND_NS);
    sim.world().image_every_ns = SECOND_NS;
    sim.run_until((SHOWN_SECONDS + HIDDEN_SECONDS) * SECOND_NS);
    sim.world().image_every_ns = period_ns;
    sim.run_until((2 * SHOWN_SECONDS + HIDDEN_SECONDS) * SECOND_NS);
    let rates: Vec<f64> = sim.pulse_lines.iter().map(|line| ticks_per_second(line)).collect();
    assert!(rates.len() >= 9 && rates.iter().all(|rate| (59.0..=60.5).contains(rate)), "every five-second line reports 60 ticks a second, hidden, shown or in between: {rates:?}");
    let seconds = (sim.now_ns() - period_ns) as f64 / 1e9;
    assert!((sim.stepped() as f64 - seconds * 60.0).abs() <= 2.0, "{} steps in {seconds:.2} s, so none was lost while hidden", sim.stepped());
    let world = sim.world();
    for (first, at) in world.drawn_at.iter().enumerate() {
        let last = world.drawn_at.partition_point(|drawn| *drawn < at + SECOND_NS) - 1;
        let advanced = world.shown[last] - world.shown[first];
        assert!(advanced <= 60, "the scenes drawn within a second of {:.3} s advance {advanced} steps", *at as f64 / 1e9);
    }
}

#[test]
fn a_window_that_starts_under_mailbox_draws_one_frame_a_vblank_and_steps_sixty_times_a_second() {
    let quick = starts_under_mailbox(quick_step_ms);
    let seconds = (quick.now_ns() - PERIOD_NS) as f64 / 1e9;
    assert!((quick.stepped() as f64 - seconds * 60.0).abs() <= 2.0, "{} steps in {seconds:.2} s", quick.stepped());
    starts_under_mailbox(scripted_step_ms);
}

fn starts_under_mailbox(step_ms: fn(u32) -> f64) -> Sim {
    const SECONDS: u64 = 20;
    let mut sim = Sim::new(PERIOD_NS, step_ms);
    sim.world().mailbox = true;
    sim.run_until(SECONDS * SECOND_NS);
    let acquires = sim.world().acquires.clone();
    let seconds = (sim.now_ns() - PERIOD_NS) as f64 / 1e9;
    let rate = acquires.len() as f64 / seconds;
    assert!((rate - 1e9 / PERIOD_NS as f64).abs() <= 1.0, "an acquire that never waits still draws at the display's rate, not unthrottled: {rate:.1} frames/s");
    assert!(acquires.windows(2).skip(1).all(|pair| pair[1] - pair[0] >= PERIOD_NS), "no two frames share a vblank");
    let late = sim.late();
    let total = late.iter().filter(|late| **late).count();
    assert!(total * WINDOW_FRAMES < 3 * late.len(), "{total} of {} frames were late, the oracle allows under 3 in {WINDOW_FRAMES}", late.len());
    assert!(sim.pulse_lines.iter().all(|line| line.ends_with("present Mailbox")), "{:?}", sim.pulse_lines);
    sim
}

fn presents_on_ready(hz: f64, step_ms: fn(u32) -> f64) -> Sim {
    const SECONDS: u64 = 20;
    let period_ns = (1e9 / hz) as u64;
    let mut sim = Sim::new(period_ns, step_ms);
    sim.world().ready = true;
    sim.run_until(SECONDS * SECOND_NS);
    let seconds = (sim.now_ns() - period_ns) as f64 / 1e9;
    assert!((sim.stepped() as f64 - seconds * 60.0).abs() <= 2.0, "at {hz} Hz {} steps in {seconds:.2} s", sim.stepped());
    let world = sim.world();
    let rate = world.acquires.len() as f64 / seconds;
    assert!(rate <= 60.5, "at {hz} Hz the window draws one frame a step, not one a vblank or unthrottled: {rate:.1} frames/s");
    let arrivals: std::collections::HashMap<u64, u64> = world.answered.iter().map(|(frame, arrival)| (*frame as u64 + 1, *arrival)).collect();
    let waits: Vec<f64> = world.shown.iter().zip(&world.drawn_at).filter_map(|(step, drawn)| arrivals.get(step).map(|arrival| drawn.saturating_sub(*arrival) as f64 / 1e6)).collect();
    assert!(waits.len() as f64 >= rate * seconds * 0.9 && quantile(&waits, 0.5) < 0.01, "at {hz} Hz a scene is drawn the moment it arrives, not at a vblank: p50 {:.2} ms after its arrival", quantile(&waits, 0.5));
    drop(world);
    let late = sim.late();
    let total = late.iter().filter(|late| **late).count();
    assert!(total * WINDOW_FRAMES < 3 * late.len(), "at {hz} Hz {total} of {} frames were late, the oracle allows under 3 in {WINDOW_FRAMES}", late.len());
    assert!(sim.pulse_lines.iter().all(|line| line.ends_with("present Immediate")), "{:?}", sim.pulse_lines);
    sim
}

#[test]
fn presenting_on_ready_draws_each_scene_as_it_arrives_once_a_step_at_60_and_120_hz() {
    presents_on_ready(60.0, scripted_step_ms);
    presents_on_ready(120.0, scripted_step_ms);
    presents_on_ready(120.0, quick_step_ms);
}

#[test]
fn presenting_on_ready_redraws_a_stalled_game_at_most_once_in_three_steps() {
    let mut sim = Sim::new(PERIOD_NS, one_stall);
    sim.world().ready = true;
    sim.run_until(4 * SECOND_NS);
    let world = sim.world();
    let stalled: Vec<u64> = world.drawn_at.windows(2).map(|pair| pair[1] - pair[0]).filter(|gap| *gap > 2 * PERIOD_NS).collect();
    assert!(!stalled.is_empty() && stalled.iter().all(|gap| *gap >= 3 * STEP_NS - DRAW_NS), "the 300 ms stall is redrawn at most every three steps: {stalled:?}");
    let frames: Vec<(u64, u64)> = world.drawn_at.iter().copied().zip(world.shown.iter().copied()).collect();
    assert!(frames.windows(2).all(|pair| pair[1].1 > pair[0].1 || pair[1].0 - pair[0].0 >= 3 * STEP_NS - DRAW_NS), "every frame draws a newer step, or redraws one only after three steps without a scene");
}
