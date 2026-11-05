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

fn jitter_free(_: u64) -> u64 {
    0
}

