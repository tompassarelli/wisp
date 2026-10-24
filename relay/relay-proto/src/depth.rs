use crate::Micros;

pub const UNDERRUN_EVERY_US: Micros = 600_000_000;
pub const MAX_DEPTH_US: Micros = 100_000;

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

    pub fn estimate_with_margin(&self, margin_quantile: Option<f64>) -> LinkEstimate {
        let total = self.received.len();
        let lost = self.received.iter().filter(|r| !**r).count();
        let loss = (lost as f64 + 1.0 + 2.0 * (lost as f64 + 1.0).sqrt()) / (total as f64 + 2.0);
        let mut pairs = 0usize;
        let mut both = 0usize;
        for w in self.received.windows(2) {
            if !w[0] {
                pairs += 1;
                both += usize::from(!w[1]);
            }
        }
        let loss_after_loss = ((both as f64 + 2.0 * loss) / (pairs as f64 + 2.0)).max(loss);
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
        let link = self.estimate_with_margin(margin_quantile);
        let mut sorted = self.offsets.clone();
        sorted.sort_unstable();
        let mut best = None;
        for d in 1..=max_turns {
            let late = predicted_late(&link, &sorted, period_us, d);
            if late <= bar {
                return DepthChoice {
                    turns: d,
                    predicted_late: late,
                    too_poor: false,
                    link,
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
    (0..=depth)
        .map(|i| {
            let lost = if i == 0 {
                link.loss
            } else {
                link.loss_after_loss
            };
            let slack = link.anchor_us + link.margin_us + (depth - i) as Micros * period_us;
            1.0 - (1.0 - lost) * fraction_within(sorted, slack)
        })
        .product()
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
