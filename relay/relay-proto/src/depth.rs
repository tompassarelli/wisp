use crate::Micros;

pub const UNDERRUN_EVERY_US: Micros = 600_000_000;
pub const MAX_DEPTH_US: Micros = 100_000;
pub const OUTAGE_PACKETS: u64 = 64;
pub const MEASURE_US: Micros = 1_000_000;
const MAX_CHAIN: i32 = 8;

pub fn underrun_bar(period_us: Micros) -> f64 {
    period_us as f64 / UNDERRUN_EVERY_US as f64
}

pub fn max_turns(period_us: Micros) -> u32 {
    (MAX_DEPTH_US / period_us).max(1) as u32
}

pub fn min_packets(period_us: Micros) -> usize {
    (MEASURE_US / period_us).max(1) as usize
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
pub struct TcpStalls {
    pub packets: usize,
    pub holds_us: Vec<Micros>,
    pub jitter_mean_us: f64,
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

    pub fn packets(&self) -> usize {
        self.offsets.len()
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
        smallest(link, bar, max_turns, cover, |link, d| {
            predicted_late_with_cover(link, &sorted, period_us, d, cover)
        })
    }

    pub fn stalls(&self, anchor_us: Micros, period_us: Micros) -> TcpStalls {
        let jump = 2 * period_us;
        let mut holds_us = Vec::new();
        let mut prev = 0;
        let (mut quiet_sum, mut quiet) = (0i128, 0usize);
        for &o in &self.offsets {
            let excess = o - anchor_us;
            if excess - prev > jump {
                holds_us.push(excess);
            }
            if excess <= jump {
                quiet_sum += excess.max(0) as i128;
                quiet += 1;
            }
            prev = excess;
        }
        TcpStalls {
            packets: self.offsets.len(),
            holds_us,
            jitter_mean_us: quiet_sum as f64 / quiet.max(1) as f64,
        }
    }

    pub fn choose_tcp(
        &self,
        period_us: Micros,
        bar: f64,
        max_turns: u32,
        margin_quantile: Option<f64>,
    ) -> DepthChoice {
        let link = self.estimate_with_margin(margin_quantile);
        let stalls = self.stalls(link.anchor_us, period_us);
        smallest(link, bar, max_turns, 0, |link, d| {
            stalls.predicted_late(link.margin_us + d as Micros * period_us)
        })
    }
}

impl TcpStalls {
    pub fn stall_rate(&self) -> f64 {
        let m = self.holds_us.len() as f64;
        (m + 1.0 + 2.0 * (m + 1.0).sqrt()) / (self.packets as f64 + 2.0)
    }

    pub fn predicted_late(&self, slack_us: Micros) -> f64 {
        let q = self.stall_rate();
        let mut late = if self.jitter_mean_us > 0.0 {
            (-(slack_us as f64) / self.jitter_mean_us).exp()
        } else {
            f64::from(slack_us <= 0)
        };
        for k in 1..=MAX_CHAIN {
            let over = if self.holds_us.is_empty() {
                1.0
            } else {
                let n = self
                    .holds_us
                    .iter()
                    .filter(|&&h| k as Micros * h > slack_us)
                    .count();
                n as f64 / self.holds_us.len() as f64
            };
            late += q.powi(k) * over;
        }
        late.min(1.0)
    }
}

fn smallest(
    link: LinkEstimate,
    bar: f64,
    max_turns: u32,
    cover: u8,
    late_at: impl Fn(&LinkEstimate, u32) -> f64,
) -> DepthChoice {
    let mut best = None;
    for d in 1..=max_turns {
        let late = late_at(&link, d);
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
mod tests;
