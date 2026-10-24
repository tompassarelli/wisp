use super::*;
use crate::rng::Rng;

const PERIOD: Micros = 16_666;

impl LinkSample {
    fn pick(&self, margin: Option<f64>) -> DepthChoice {
        self.choose_with_margin(PERIOD, underrun_bar(PERIOD), max_turns(PERIOD), margin)
    }
}

fn sample(n: u32, loss: f64, jitter_mean: f64, seed: u64) -> LinkSample {
    let mut rng = Rng::new(seed);
    let mut s = LinkSample::default();
    for seq in 0..n {
        if !rng.chance(loss) {
            s.record(seq, 40_000 + rng.exp(jitter_mean) as Micros);
        }
    }
    s
}

#[test]
fn clean_link_takes_two_turns() {
    let c = sample(1200, 0.0, 2000.0, 1).pick(None);
    assert_eq!((c.turns, c.too_poor), (2, false));
}

#[test]
fn more_loss_never_takes_less_depth() {
    let mut last = 0;
    for loss in [0.0, 0.01, 0.03, 0.05, 0.10] {
        let c = sample(1200, loss, 2000.0, 2).pick(None);
        assert!(
            c.turns >= last,
            "loss {loss} chose {} after {last}",
            c.turns
        );
        last = c.turns;
    }
}

#[test]
fn a_jitter_margin_lets_the_newest_copy_count() {
    let s = sample(1200, 0.05, 2000.0, 4);
    let plain = s.pick(None);
    let margin = s.pick(Some(0.95));
    assert!(margin.link.margin_us > 0 && margin.link.margin_us < PERIOD);
    assert_eq!(margin.turns + 1, plain.turns);
}

fn bursty(n: u32, every: u32, burst: u32) -> LinkSample {
    let mut s = LinkSample::default();
    for seq in 0..n {
        if seq % every >= burst {
            s.record(seq, 40_000 + (seq % 7) as Micros * 500);
        }
    }
    s
}

#[test]
fn cover_packets_shorten_the_depth_a_burst_needs() {
    let period = 8_000;
    let s = bursty(2500, 100, 4);
    let bar = underrun_bar(period);
    let plain = s.choose(period, bar, max_turns(period));
    let covered = s.choose_with_cover(period, bar, max_turns(period), None, 4);
    assert!(plain.too_poor || plain.turns > 8, "{plain:?}");
    assert!(!covered.too_poor && covered.turns <= 8, "{covered:?}");
    assert_eq!(covered.cover, 4);
    let e = s.estimate();
    let sorted = s.sorted_offsets();
    assert_eq!(
        predicted_late(&e, &sorted, period, 5),
        predicted_late_with_cover(&e, &sorted, period, 5, 0)
    );
}

#[test]
fn the_counter_forgives_reordering_and_counts_runs_once_they_age_out() {
    let mut c = LossCounter::default();
    for seq in [0, 2, 1, 4, 3, 5, 9, 10] {
        c.record(seq);
    }
    for seq in 11..200 {
        c.record(seq);
    }
    let n = c.counts();
    assert_eq!((n.lost, n.pairs, n.both), (3, 3, 2));
    assert_eq!(n.total, 200 - 64);
    for seq in 300..400 {
        c.record(seq);
    }
    assert_eq!(c.counts().lost, 3);
}

#[test]
fn hopeless_link_reports_too_poor_at_the_ceiling() {
    let c = sample(1200, 0.5, 2000.0, 3).pick(None);
    assert!(c.too_poor);
    assert_eq!(c.turns, max_turns(PERIOD));
}

fn tcp_sample(n: u32, loss: f64, hold_us: Micros, seed: u64) -> LinkSample {
    let mut rng = Rng::new(seed);
    let mut s = LinkSample::default();
    let mut last = 0;
    for seq in 0..n {
        let sent = seq as Micros * PERIOD;
        let mut at = sent + 40_000 + rng.exp(2000.0) as Micros;
        while rng.chance(loss) {
            at += hold_us;
        }
        last = at.max(last);
        s.record(seq, last - sent);
    }
    s
}

impl LinkSample {
    fn pick_tcp(&self, max_turns: u32) -> DepthChoice {
        self.choose_tcp(PERIOD, underrun_bar(PERIOD), max_turns, None)
    }
}

#[test]
fn tcp_depth_outlasts_a_lost_retransmission_when_single_holds_are_too_common() {
    let hold = 100_000 + 3 * PERIOD;
    let s = tcp_sample(1200, 0.01, hold, 5);
    assert!(s.pick_tcp(max_turns(PERIOD)).too_poor);
    let c = s.pick_tcp(60);
    assert!(!c.too_poor);
    assert!(c.turns as Micros * PERIOD > 2 * hold, "{c:?}");
}

#[test]
fn tcp_depth_covers_one_hold_when_lost_retransmissions_meet_the_bar() {
    let hold = 20_000 + 3 * PERIOD;
    let s = tcp_sample(2500, 0.002, hold, 6);
    let stalls = s.stalls(s.estimate().anchor_us, PERIOD);
    assert!(!stalls.holds_us.is_empty());
    let c = s.pick_tcp(60);
    let depth = c.turns as Micros * PERIOD;
    assert!(!c.too_poor);
    assert!(
        depth > *stalls.holds_us.iter().max().unwrap() && depth < 2 * hold,
        "{c:?}"
    );
}

#[test]
fn duplicates_and_stale_sequence_numbers_are_ignored() {
    let mut s = LinkSample::default();
    s.record(10, 5);
    s.record(10, 1);
    s.record(9, 1);
    s.record(12, 7);
    let e = s.estimate();
    assert_eq!(e.packets, 3);
    assert_eq!(e.anchor_us, 5);
}
