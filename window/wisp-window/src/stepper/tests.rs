use super::*;

const SECOND_NS: u64 = 1_000_000_000;

/// Runs the cadence for `seconds` as its thread would, waking `late_ns(k)` after the k-th due time, with the aim `aim` asks for at each wake; returns when each step was taken.
fn steps(seconds: u64, late_ns: impl Fn(u64) -> u64, aim: impl Fn(u64) -> Option<Aim>) -> Vec<u64> {
    let mut cadence = Cadence::default();
    let mut taken = Vec::new();
    let mut now = SECOND_NS;
    loop {
        now = cadence.due_ns(now) + late_ns(taken.len() as u64);
        if now >= (seconds + 1) * SECOND_NS {
            return taken;
        }
        taken.push(now);
        cadence.advance(now, aim(now));
    }
}

fn jitter(k: u64) -> u64 {
    (k.wrapping_mul(0x9E37_79B9_7F4A_7C15) >> 40) % 5_000_000
}

#[test]
fn the_clock_takes_sixty_steps_a_second_however_late_it_wakes() {
    for late in [jitter_free as fn(u64) -> u64, jitter] {
        let taken = steps(10, late, |_| None);
        assert!((600..=601).contains(&taken.len()), "{} steps in ten seconds", taken.len());
    }
}

#[test]
fn a_clock_that_wakes_late_drops_the_steps_it_missed() {
    let mut cadence = Cadence::default();
    cadence.advance(SECOND_NS, None);
    let woke = cadence.due_ns(0) + 2 * SECOND_NS;
    assert_eq!(cadence.advance(woke, None), 119, "a two second stall drops the 119 steps that fell due in it");
    let due = cadence.due_ns(0);
    assert!(due > woke && due - woke <= STEP_NS, "the next step is the next due time still ahead");
    let woke = due + 5 * STEP_NS + 1;
    assert_eq!(cadence.advance(woke, None), 5, "five steps behind drops five, it never runs them late");
    assert_eq!(cadence.due_ns(0), due + 6 * STEP_NS);
}

fn display(hz: f64, lead_ns: u64) -> impl Fn(u64) -> Option<Aim> {
    let period_ns = (1e9 / hz) as u64;
    move |now| Aim::for_display(now - now % period_ns, period_ns, lead_ns, now)
}

#[test]
fn the_clock_settles_on_the_phase_a_display_at_or_under_sixty_hertz_asks_for() {
    const LEAD_NS: u64 = 6_000_000;
    for hz in [60.0, 59.94, 120.0, 119.88, 30.0] {
        let period_ns = (1e9 / hz) as u64;
        let every = if period_ns < STEP_NS + STEP_NS / 2 { period_ns } else { STEP_NS } as i64;
        let taken = steps(10, jitter_free, display(hz, LEAD_NS));
        let settled = &taken[taken.len() / 2..];
        for at in settled {
            let phase = ((at + LEAD_NS) as i64).rem_euclid(every);
            let off = if phase > every / 2 { phase - every } else { phase };
            assert!((-EARLY_TOLERANCE_NS..=300_000).contains(&off), "at {hz} Hz a step {:.3} ms off its aimed phase", off as f64 / 1e6);
        }
        let rate = (settled.len() - 1) as f64 * 1e9 / (settled[settled.len() - 1] - settled[0]) as f64;
        let expected = if hz < 45.0 { 60.0 } else { hz / (hz / 60.0).round() };
        assert!((rate - expected).abs() < 0.01, "at {hz} Hz the settled clock stepped {rate:.3} a second");
    }
}

fn jitter_free(_: u64) -> u64 {
    0
}

#[test]
fn the_clock_moves_toward_an_aim_only_later_and_at_most_a_quarter_millisecond_a_step() {
    for ahead in [STEP_NS / 2, STEP_NS - 2_000_000] {
        let taken = steps(2, jitter_free, |now| Some(Aim { at_ns: now + ahead, every_ns: STEP_NS, asked_ns: now }));
        for pair in taken.windows(2) {
            let interval = pair[1] - pair[0];
            assert!((STEP_NS..=STEP_NS + SLEW_NS as u64).contains(&interval), "two steps {} ms apart", interval as f64 / 1e6);
        }
    }
}

#[test]
fn a_display_faster_than_sixty_hertz_never_makes_the_clock_step_faster() {
    for hz in [60.05, 120.1, 61.0] {
        let taken = steps(20, jitter_free, display(hz, 6_000_000));
        assert!(taken.windows(2).all(|pair| pair[1] - pair[0] >= STEP_NS), "at {hz} Hz no two steps fall closer than a 60th of a second");
        let most = taken.iter().enumerate().map(|(first, at)| taken[first..].partition_point(|later| *later < at + SECOND_NS)).max().unwrap_or(0);
        assert_eq!(most, 60, "at {hz} Hz at most 60 steps in any second");
    }
}

#[test]
fn only_a_display_whose_rate_divides_or_is_divided_by_sixty_hertz_asks_for_a_phase() {
    for hz in [60.0, 59.94, 120.0, 119.88, 240.0, 30.0] {
        assert!(Aim::for_display(0, (1e9 / hz) as u64, 0, 0).is_some(), "{hz} Hz");
    }
    for hz in [144.0, 165.0, 75.0, 90.0, 100.0, 50.0, 48.0] {
        assert!(Aim::for_display(0, (1e9 / hz) as u64, 0, 0).is_none(), "{hz} Hz");
    }
}

#[test]
fn a_stale_aim_leaves_the_clock_to_run_free() {
    let stale = |now: u64| Some(Aim { at_ns: now / 2 + 3_000_000, every_ns: STEP_NS, asked_ns: now.saturating_sub(AIM_LIFETIME_NS + 1) });
    let taken = steps(1, jitter_free, stale);
    assert!(taken.windows(2).all(|pair| pair[1] - pair[0] == STEP_NS));
}
