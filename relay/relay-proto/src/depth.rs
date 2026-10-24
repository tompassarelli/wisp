use crate::Micros;

pub const UNDERRUN_EVERY_US: Micros = 600_000_000;
pub const MAX_DEPTH_US: Micros = 100_000;
pub const OUTAGE_PACKETS: u64 = 64;

pub fn underrun_bar(period_us: Micros) -> f64 {
    period_us as f64 / UNDERRUN_EVERY_US as f64
}

pub fn max_turns(period_us: Micros) -> u32 {
    (MAX_DEPTH_US / period_us).max(1) as u32
}

#[derive(Clone, Debug, Default)]
pub struct LinkSample {
    first_seq: Option<u32>,
    received: Vec<bool>,
    offsets: Vec<Micros>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct LossCounts {
    pub total: u64,
    pub lost: u64,
    pub pairs: u64,
    pub both: u64,
}

impl LossCounts {
    pub fn rates(&self) -> (f64, f64) {
        let lost = self.lost as f64;
        let loss = (lost + 1.0 + 2.0 * (lost + 1.0).sqrt()) / (self.total as f64 + 2.0);
        let loss_after_loss =
            ((self.both as f64 + 2.0 * loss) / (self.pairs as f64 + 2.0)).max(loss);
        (loss, loss_after_loss)
    }

    pub fn add(&self, other: &LossCounts) -> LossCounts {
        LossCounts {
            total: self.total + other.total,
            lost: self.lost + other.lost,
            pairs: self.pairs + other.pairs,
            both: self.both + other.both,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct LossCounter {
    high: Option<u32>,
    seen: u64,
    filled: u32,
    run: u64,
    counts: LossCounts,
}

impl LossCounter {
    pub fn counts(&self) -> LossCounts {
        self.counts
    }

    pub fn record(&mut self, seq: u32) {
        let Some(high) = self.high else {
            self.high = Some(seq);
            self.seen = 1;
            self.filled = 1;
            return;
        };
        if seq <= high {
            if high - seq < 64 {
                self.seen |= 1 << (high - seq);
            }
            return;
        }
        let d = seq - high;
        for i in (64u32.saturating_sub(d)..64).rev() {
            if i < self.filled {
                self.finalize(self.seen >> i & 1 == 1);
            }
        }
        if d >= 64 {
            for _ in 0..d - 64 {
                self.finalize(false);
            }
            self.seen = 1;
            self.filled = 64;
        } else {
            self.seen = self.seen << d | 1;
            self.filled = (self.filled + d).min(64);
        }
        self.high = Some(seq);
    }

    fn finalize(&mut self, received: bool) {
        let c = &mut self.counts;
        c.total += 1;
        c.lost += u64::from(!received);
        if self.run > 0 {
            c.pairs += 1;
            c.both += u64::from(!received);
        }
        if !received {
            self.run += 1;
            return;
        }
        if self.run > OUTAGE_PACKETS {
            c.total -= self.run;
            c.lost -= self.run;
            c.pairs -= self.run;
            c.both -= self.run - 1;
        }
        self.run = 0;
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct LinkEstimate {
    pub packets: usize,
    pub loss: f64,
    pub loss_after_loss: f64,
    pub anchor_us: Micros,
    pub margin_us: Micros,
    pub spread_p99_us: Micros,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DepthChoice {
    pub turns: u32,
    pub predicted_late: f64,
    pub too_poor: bool,
    pub link: LinkEstimate,
    pub cover: u8,
}

impl LinkSample {
    pub fn record(&mut self, seq: u32, offset_us: Micros) {
        let first = *self.first_seq.get_or_insert(seq);
        let Some(i) = seq.checked_sub(first) else {
            return;
        };
        let i = i as usize;
        if i >= self.received.len() {
            self.received.resize(i + 1, false);
        }
        if !self.received[i] {
            self.received[i] = true;
            self.offsets.push(offset_us);
        }
    }

    pub fn estimate(&self) -> LinkEstimate {
        self.estimate_with_margin(None)
    }

    pub fn counts(&self) -> LossCounts {
        let mut c = LossCounts {
            total: self.received.len() as u64,
            lost: self.received.iter().filter(|r| !**r).count() as u64,
            ..LossCounts::default()
        };
        for w in self.received.windows(2) {
            if !w[0] {
                c.pairs += 1;
                c.both += u64::from(!w[1]);
            }
        }
        c
    }

    pub fn sorted_offsets(&self) -> Vec<Micros> {
        let mut sorted = self.offsets.clone();
        sorted.sort_unstable();
        sorted
    }

    pub fn estimate_with_margin(&self, margin_quantile: Option<f64>) -> LinkEstimate {
        let (loss, loss_after_loss) = self.counts().rates();
        let total = self.received.len();
        let mut sorted = self.offsets.clone();
        sorted.sort_unstable();
        let anchor_us = percentile(&sorted, 0.05);
        let margin_us = margin_quantile.map_or(0, |q| percentile(&sorted, q) - anchor_us);
        LinkEstimate {
            packets: total,
            loss,
            loss_after_loss,
            anchor_us,
            margin_us,
            spread_p99_us: percentile(&sorted, 0.99) - anchor_us,
        }
    }

    pub fn choose(&self, period_us: Micros, bar: f64, max_turns: u32) -> DepthChoice {
        self.choose_with_margin(period_us, bar, max_turns, None)
    }

    pub fn choose_with_margin(
        &self,
        period_us: Micros,
        bar: f64,
        max_turns: u32,
        margin_quantile: Option<f64>,
    ) -> DepthChoice {
        self.choose_with_cover(period_us, bar, max_turns, margin_quantile, 0)
    }

    pub fn choose_with_cover(
        &self,
        period_us: Micros,
        bar: f64,
        max_turns: u32,
        margin_quantile: Option<f64>,
        cover: u8,
    ) -> DepthChoice {
        let mut link = self.estimate_with_margin(margin_quantile);
        if cover > 0 {
            let pairs = self.counts().pairs as f64;
            let lal = link.loss_after_loss;
            link.loss_after_loss = (lal + (lal * (1.0 - lal) / (pairs + 2.0)).sqrt()).min(1.0);
        }
        let mut sorted = self.offsets.clone();
        sorted.sort_unstable();
        let mut best = None;
        for d in 1..=max_turns {
            let late = predicted_late_with_cover(&link, &sorted, period_us, d, cover);
            if late <= bar {
                return DepthChoice {
                    turns: d,
                    predicted_late: late,
                    too_poor: false,
                    link,
                    cover,
                };
            }
            best = Some((d, late));
        }
        let (turns, predicted_late) = best.unwrap_or((max_turns, 1.0));
        DepthChoice {
            turns,
            predicted_late,
            too_poor: true,
            link,
            cover,
        }
    }
}

pub fn percentile(sorted: &[Micros], q: f64) -> Micros {
    if sorted.is_empty() {
        return 0;
    }
    let i = ((sorted.len() - 1) as f64 * q).round() as usize;
    sorted[i.min(sorted.len() - 1)]
}

fn fraction_within(sorted: &[Micros], x: Micros) -> f64 {
    sorted.partition_point(|&o| o <= x) as f64 / (sorted.len() as f64 + 1.0)
}

pub fn predicted_late(
    link: &LinkEstimate,
    sorted: &[Micros],
    period_us: Micros,
    depth: u32,
) -> f64 {
    predicted_late_with_cover(link, sorted, period_us, depth, 0)
}

pub fn predicted_late_with_cover(
    link: &LinkEstimate,
    sorted: &[Micros],
    period_us: Micros,
    depth: u32,
    cover: u8,
) -> f64 {
    let slots = cover as u32 + 1;
    let mut late = 1.0;
    for j in 0..=depth * slots {
        let lost = if j == 0 {
            link.loss
        } else {
            link.loss_after_loss
        };
        let slack = link.anchor_us + link.margin_us + depth as Micros * period_us
            - j as Micros * period_us / slots as Micros;
        late *= 1.0 - (1.0 - lost) * fraction_within(sorted, slack);
    }
    late
}

#[cfg(test)]
mod tests {
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
}
