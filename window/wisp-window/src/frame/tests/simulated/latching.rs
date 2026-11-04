use super::*;

/// A display that shows a present at the first of its own vblanks, `period_ns` apart from `phase_ns`, whose latch `latch_ns` before it the image was ready by, and reports each present once it is shown, as X's Present extension does.
pub(super) struct Latching {
    phase_ns: u64,
    period_ns: u64,
    latch_ns: u64,
    pub(super) reports: bool,
    pub(super) queued: VecDeque<Shown>,
    shown: Vec<(u64, u64)>,
    presents: Vec<(u64, bool)>,
}

impl Latching {
    /// Takes a present whose image is ready at `ready_ns`, of a scene sampled at `sampled_ns` that carries a press or not: shows it at the first vblank its latch makes, and drops the one queued for that vblank before it.
    pub(super) fn present(&mut self, ready_ns: u64, sampled_ns: Option<u64>, pressed: bool) {
        let k = (ready_ns + self.latch_ns).saturating_sub(self.phase_ns).div_ceil(self.period_ns);
        let shown_ns = self.phase_ns + k * self.period_ns;
        if let Some(replaced) = self.queued.back_mut().filter(|queued| queued.msc == k) {
            replaced.skipped = true;
            self.shown.retain(|(_, shown)| *shown != shown_ns);
        }
        self.queued.push_back(Shown { shown_ns, msc: k, skipped: false });
        self.presents.push((shown_ns, pressed));
        if let Some(sampled) = sampled_ns {
            self.shown.push((sampled, shown_ns));
        }
    }
}

/// The shortest a scene can take from its sample to the screen in `latched`: a 2 ms step, a 2 ms draw, 3 ms on the GPU and the display's 2 ms latch.
const FLOOR_MS: f64 = 9.0;

/// What one run of `latched` showed after its first five seconds: each shown scene's time from its sample to the vblank that showed it, and how many presents of frames that carry a press and of the rest left a vblank without a new image.
struct Latched {
    sample_to_shown: Vec<f64>,
    press_misses: (usize, usize),
    other_misses: (usize, usize),
    sim: Sim,
}

/// Twenty seconds under `Mailbox` on a display whose vblanks fall `phase_ns` into the loop's first frame, `period_ns` apart, while the window is told 60 Hz; every `press_every`th step's scene costs the GPU `press_gpu_ns` more, as a press's does.
fn latched(reports: bool, phase_ns: u64, period_ns: u64, press_every: u64, press_gpu_ns: u64) -> Latched {
    const SECONDS: u64 = 20;
    let mut sim = Sim::new(PERIOD_NS, quick_step_ms);
    {
        let mut world = sim.world();
        world.mailbox = true;
        world.gpu_ns = 3_000_000;
        world.press_every = press_every;
        world.press_gpu_ns = press_gpu_ns;
        world.display = Some(Latching { phase_ns: PERIOD_NS + phase_ns, period_ns, latch_ns: 2_000_000, reports, queued: VecDeque::new(), shown: Vec::new(), presents: Vec::new() });
    }
    sim.run_until(SECONDS * SECOND_NS);
    let world = sim.world();
    let display = world.display.as_ref().unwrap();
    let sample_to_shown = display.shown.iter().filter(|(sampled, _)| *sampled > 5 * SECOND_NS).map(|(sampled, shown)| (shown - sampled) as f64 / 1e6).collect();
    let (mut press_misses, mut other_misses) = ((0, 0), (0, 0));
    for pair in display.presents.windows(2).filter(|pair| pair[0].0 > 5 * SECOND_NS) {
        let missed = pair[1].0 - pair[0].0 > period_ns + period_ns / 2;
        let tally = if pair[1].1 { &mut press_misses } else { &mut other_misses };
        tally.0 += usize::from(missed);
        tally.1 += 1;
    }
    drop(world);
    Latched { sample_to_shown, press_misses, other_misses, sim }
}

fn assert_paced(sim: &Sim, period_ns: u64) {
    let seconds = (sim.now_ns() - PERIOD_NS) as f64 / 1e9;
    let rate = 1e9 / period_ns as f64;
    assert!((sim.stepped() as f64 - seconds * rate).abs() <= seconds * rate * 0.003, "{} steps in {seconds:.2} s", sim.stepped());
    let late = sim.late();
    assert!(late.iter().filter(|late| **late).count() * WINDOW_FRAMES < 3 * late.len(), "late scenes stay under 3 in {WINDOW_FRAMES}");
}

#[test]
fn reports_from_the_display_settle_the_sample_near_the_floor_from_every_startup_phase() {
    for phase_ms in 0..17u64 {
        let run = latched(true, phase_ms * 1_000_000 + 300_000, PERIOD_NS, 0, 0);
        let (p50, p99) = (quantile(&run.sample_to_shown, 0.5), quantile(&run.sample_to_shown, 0.99));
        assert!(p50 <= FLOOR_MS + 2.0 && p99 < FLOOR_MS + 5.0, "at phase {phase_ms}.3 ms a sample shows in p50 {p50:.1} ms, p99 {p99:.1} ms against a {FLOOR_MS} ms floor");
        assert!(run.other_misses.0 * 100 <= run.other_misses.1, "at phase {phase_ms}.3 ms {} of {} presents left a vblank empty", run.other_misses.0, run.other_misses.1);
        assert_paced(&run.sim, PERIOD_NS);
    }
}

#[test]
fn the_display_lock_holds_a_display_off_its_reported_rate_near_the_floor() {
    let period_ns = 16_683_350;
    for phase_ms in [0, 4, 7, 11, 15] {
        let own = latched(false, phase_ms * 1_000_000, period_ns, 0, 0);
        let locked = latched(true, phase_ms * 1_000_000, period_ns, 0, 0);
        let spread = |values: &[f64]| quantile(values, 0.95) - quantile(values, 0.05);
        let p50 = quantile(&locked.sample_to_shown, 0.5);
        assert!(p50 <= FLOOR_MS + 2.0 && spread(&locked.sample_to_shown) < 3.0, "a 59.94 Hz display reported as 60 Hz at phase {phase_ms} ms shows in p50 {p50:.1} ms, spread {:.1} ms", spread(&locked.sample_to_shown));
        assert!(spread(&locked.sample_to_shown) < spread(&own.sample_to_shown), "the lock {:.1} ms against {:.1} ms without it", spread(&locked.sample_to_shown), spread(&own.sample_to_shown));
        assert_paced(&locked.sim, period_ns);
    }
}

#[test]
fn a_frame_that_carries_a_press_makes_its_vblank_under_the_lock() {
    const PRESS_GPU_NS: u64 = 1_500_000;
    for phase_ms in [1, 6, 12] {
        let run = latched(true, phase_ms * 1_000_000, PERIOD_NS, 24, PRESS_GPU_NS);
        let p50 = quantile(&run.sample_to_shown, 0.5);
        let (missed, presses) = run.press_misses;
        assert!(presses > 30 && missed * 50 <= presses, "at phase {phase_ms} ms {missed} of {presses} press frames left a vblank empty");
        assert!(p50 <= FLOOR_MS + 2.0 + PRESS_GPU_NS as f64 / 1e6, "at phase {phase_ms} ms a sample shows in p50 {p50:.1} ms");
        assert_paced(&run.sim, PERIOD_NS);
    }
}
