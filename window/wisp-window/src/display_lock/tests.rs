use super::*;

const PERIOD_NS: u64 = 16_666_667;
const PERIOD_MS: f64 = PERIOD_NS as f64 / 1e6;

/// A display that latches `latch_ns` before each vblank of a grid starting at `phase_ns`: a present made by the latch shows at that vblank, one made after it at the next.
struct Display {
    phase_ns: u64,
    period_ns: u64,
    latch_ns: u64,
    msc0: u64,
}

impl Display {
    fn shown(&self, presented_ns: u64, latch_ns: u64) -> Shown {
        let reach = presented_ns + latch_ns;
        let k = (reach.saturating_sub(self.phase_ns)).div_ceil(self.period_ns);
        Shown { shown_ns: self.phase_ns + k * self.period_ns, msc: self.msc0 + k, skipped: false }
    }
}

/// Runs a loop that presents at each latch the lock predicts and feeds the display's reports back a frame later, `frames` times, each frame `cost_ns(frame)` adding to the display's latch and reported as its cost; returns the lock, each present's lag from present to shown, and its lead.
fn run(display: &Display, frames: usize, cost_ns: impl Fn(usize) -> u64) -> (DisplayLock, Vec<u64>, Vec<f64>) {
    let mut lock = DisplayLock::default();
    let mut now = display.phase_ns + PERIOD_NS / 3;
    let (mut lags, mut leads) = (Vec::new(), Vec::new());
    let mut pending = None;
    for frame in 0..frames {
        let period = lock.period_ms().unwrap_or(PERIOD_MS);
        let latch = lock.next_vblank_ns(now + 1, period).unwrap_or(now + PERIOD_NS);
        let present = latch.max(now);
        leads.push(lock.lead_ms(period));
        lock.presented(present, period);
        lock.cost(cost_ns(frame) as f64 / 1e6);
        let shown = display.shown(present, display.latch_ns + cost_ns(frame));
        lags.push(shown.shown_ns - present);
        if let Some(previous) = pending.replace(shown) {
            lock.observe(previous, PERIOD_MS);
        }
        now = present + PERIOD_NS / 2;
    }
    (lock, lags, leads)
}

#[test]
fn the_lead_settles_just_past_the_display_latch_and_only_ever_moves_later_while_searching() {
    let display = Display { phase_ns: 1_000_000_000, period_ns: PERIOD_NS, latch_ns: 4_000_000, msc0: 50 };
    let (lock, lags, leads) = run(&display, 3000, |_| 0);
    assert!(lock.locked());
    assert!((4.0..=4.0 + BASE_MARGIN_MS + 2.0 * SEARCH_CREEP_MS).contains(&lock.lead_ms(PERIOD_MS)), "lead {} ms against a 4 ms latch", lock.lead_ms(PERIOD_MS));
    let searching = leads.iter().position(|lead| *lead == lock.lead_ms(PERIOD_MS)).unwrap();
    assert!(leads[..searching].windows(2).all(|pair| pair[1] <= pair[0]), "the search moves the latch later until it locks");
    let late = lags[searching..].iter().filter(|lag| **lag > PERIOD_NS).count();
    assert_eq!(late, 0, "no present after the lock showed a display frame late");
}

#[test]
fn the_margin_covers_the_dearest_frame_seen_while_searching() {
    let display = Display { phase_ns: 1_000_000_000, period_ns: PERIOD_NS, latch_ns: 4_000_000, msc0: 0 };
    let press = |frame: usize| if frame.is_multiple_of(24) { 2_000_000 } else { 0 };
    let (lock, lags, _) = run(&display, 3000, press);
    assert!(lock.lead_ms(PERIOD_MS) >= 6.0, "lead {} ms leaves room for a frame 2 ms dearer than a 4 ms latch", lock.lead_ms(PERIOD_MS));
    let late = lags[600..].iter().enumerate().filter(|(frame, lag)| press(frame + 600) > 0 && **lag > PERIOD_NS).count();
    assert_eq!(late, 0, "no dear frame showed late once locked");
}

#[test]
fn the_period_comes_from_the_display_counter_not_the_nominal_rate() {
    let display = Display { phase_ns: 2_000_000_000, period_ns: 16_920_000, latch_ns: 1_000_000, msc0: 7 };
    let (lock, _, _) = run(&display, 200, |_| 0);
    let period = lock.period_ms().expect("a period after 200 reports");
    assert!((period - 16.92).abs() < 1e-6, "period {period} ms");
}

#[test]
fn the_grid_follows_the_display_and_not_the_loops_first_frame() {
    let display = Display { phase_ns: 3_000_000_000 + 7_300_000, period_ns: PERIOD_NS, latch_ns: 2_000_000, msc0: 0 };
    let (lock, _, _) = run(&display, 120, |_| 0);
    let next = lock.next_vblank_ns(3_500_000_000, PERIOD_MS).unwrap();
    let vblank = next + (lock.lead_ms(PERIOD_MS) * 1e6) as u64;
    let off = (vblank - display.phase_ns) % PERIOD_NS;
    assert!(off <= 1 || off >= PERIOD_NS - 1, "the latch {next} sits its lead before a vblank of the display");
}

#[test]
fn dropped_presents_count_as_misses() {
    let display = Display { phase_ns: 1_000_000_000, period_ns: PERIOD_NS, latch_ns: 1_000_000, msc0: 0 };
    let (mut lock, _, _) = run(&display, 40, |_| 0);
    lock.presents.clear();
    let crossings = lock.crossings();
    let vblank = display.phase_ns + 100 * PERIOD_NS;
    for k in 0..2 {
        lock.presented(vblank + k * PERIOD_NS - PERIOD_NS / 2, PERIOD_MS);
        assert!(lock.observe(Shown { shown_ns: vblank + k * PERIOD_NS, msc: 100 + k, skipped: true }, PERIOD_MS));
    }
    assert_eq!(lock.crossings(), crossings + 2, "two dropped presents in a row lock the search");
    assert!(lock.locked());
}

#[test]
fn a_present_the_loop_made_late_is_aimed_at_the_vblank_it_could_still_make() {
    let display = Display { phase_ns: 1_000_000_000, period_ns: PERIOD_NS, latch_ns: 1_000_000, msc0: 0 };
    let (mut lock, _, _) = run(&display, 40, |_| 0);
    lock.presents.clear();
    let lead_ns = (lock.lead_ms(PERIOD_MS) * 1e6) as u64;
    let vblank = display.phase_ns + 100 * PERIOD_NS;
    lock.presented(vblank - lead_ns + 1_000_000, PERIOD_MS);
    assert!(!lock.observe(Shown { shown_ns: vblank + PERIOD_NS, msc: 101, skipped: false }, PERIOD_MS), "a present after its latch aims at the vblank after");
    assert!(!lock.locked());
}

#[test]
fn three_misses_at_the_locked_lead_widen_it_once() {
    let display = Display { phase_ns: 1_000_000_000, period_ns: PERIOD_NS, latch_ns: 4_000_000, msc0: 0 };
    let (mut lock, _, _) = run(&display, 600, |_| 0);
    lock.presents.clear();
    let locked = lock.lead_ms(PERIOD_MS);
    let lead_ns = (locked * 1e6) as u64;
    let first = lock.counted.back().expect("the run reported its presents").1 + 2;
    for k in first..first + 3 {
        let vblank = display.phase_ns + k * PERIOD_NS;
        lock.presented(vblank - lead_ns, PERIOD_MS);
        assert!(lock.observe(Shown { shown_ns: vblank + PERIOD_NS, msc: k + 1, skipped: false }, PERIOD_MS), "a present shown a vblank after its aim is a miss");
    }
    assert!((lock.lead_ms(PERIOD_MS) - (locked + WIDEN_MS)).abs() < 1e-9, "lead {} ms after three misses at {locked} ms", lock.lead_ms(PERIOD_MS));
}

