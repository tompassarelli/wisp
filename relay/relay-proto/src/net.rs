use crate::rng::Rng;
use crate::transport::Deframer;
use crate::Micros;

const RTO_MIN_US: Micros = 200_000;
const RTO_MAX_US: Micros = 120_000_000;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Loss {
    None,
    Independent(f64),
    Burst { loss: f64, mean_burst: f64 },
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Path {
    pub one_way_us: Micros,
    pub jitter_mean_us: f64,
    pub loss: Loss,
}


pub(crate) struct Link {
    path: Path,
    rng: Rng,
    bad: bool,
}

impl Link {
    pub(crate) fn new(path: Path, rng: Rng) -> Self {
        Link {
            path,
            rng,
            bad: false,
        }
    }

    pub(crate) fn send(&mut self, now: Micros, quiet: bool, outages: &[(Micros, Micros)]) -> Option<Micros> {
        let (lost, jitter) = self.draw();
        if quiet {
            return Some(now + self.path.one_way_us + jitter);
        }
        if lost || outages.iter().any(|&(a, b)| now >= a && now < b) {
            return None;
        }
        Some(now + self.path.one_way_us + jitter)
    }

    pub(crate) fn stream(
        &mut self,
        now: Micros,
        quiet: bool,
        outages: &[(Micros, Micros)],
        rtt_us: Micros,
        dupack_us: Micros,
        resume: &mut Vec<Option<Micros>>,
    ) -> Micros {
        let mean_loss = match self.path.loss {
            Loss::None => 0.0,
            Loss::Independent(p) => p,
            Loss::Burst { loss, .. } => loss,
        };
        resume.resize(outages.len(), None);
        let (mut lost, mut jitter) = self.draw();
        let mut t = now;
        loop {
            if quiet {
                return t + self.path.one_way_us + jitter;
            }
            if let Some(k) = outages.iter().position(|&(a, b)| t >= a && t < b) {
                t = *resume[k]
                    .get_or_insert_with(|| self.resume_after(outages[k], rtt_us, mean_loss));
            } else if !lost {
                return t + self.path.one_way_us + jitter;
            } else {
                t += rtt_us + dupack_us;
            }
            lost = self.rng.chance(mean_loss);
            jitter = self.rng.exp(self.path.jitter_mean_us) as Micros;
        }
    }

    fn resume_after(
        &mut self,
        (start, end): (Micros, Micros),
        rtt_us: Micros,
        loss: f64,
    ) -> Micros {
        let mut rto = rtt_us + RTO_MIN_US;
        let mut t = start + rto;
        while t < end || self.rng.chance(loss) {
            rto = (2 * rto).min(RTO_MAX_US);
            t += rto;
        }
        t
    }

    fn draw(&mut self) -> (bool, Micros) {
        let lost = match self.path.loss {
            Loss::None => false,
            Loss::Independent(p) => self.rng.chance(p),
            Loss::Burst { loss, mean_burst } => {
                let leave = 1.0 / mean_burst.max(1.0);
                let enter = loss * leave / (1.0 - loss).max(1e-9);
                self.bad = if self.bad {
                    !self.rng.chance(leave)
                } else {
                    self.rng.chance(enter)
                };
                self.bad
            }
        };
        let jitter = self.rng.exp(self.path.jitter_mean_us) as Micros;
        (lost, jitter)
    }
}

#[derive(Default)]
pub(crate) struct Stream {
    pub(crate) open_at: Option<Micros>,
    pub(crate) resume: Vec<Option<Micros>>,
    pub(crate) last: Micros,
    pub(crate) rx: Deframer,
}

impl Stream {
    pub(crate) fn arrival(&mut self, at: Micros) -> Micros {
        self.last = self.last.max(at);
        self.last
    }

    pub(crate) fn frames(&mut self, bytes: &[u8]) -> Vec<Vec<u8>> {
        self.rx.push(bytes);
        let mut out = Vec::new();
        while let Ok(Some(f)) = self.rx.next_frame() {
            out.push(f.to_vec());
        }
        out
    }
}

#[derive(Clone, Copy)]
pub(crate) struct Clock {
    pub(crate) offset: Micros,
    pub(crate) ppb: i64,
}

impl Clock {
    pub(crate) fn local(self, t: Micros) -> Micros {
        self.offset + t + ((t as i128 * self.ppb as i128).div_euclid(1_000_000_000)) as Micros
    }

    pub(crate) fn true_time(self, local: Micros) -> Micros {
        let mut t = (((local - self.offset) as i128 * 1_000_000_000)
            / (1_000_000_000 + self.ppb as i128)) as Micros;
        while self.local(t) < local {
            t += 1;
        }
        while self.local(t - 1) >= local {
            t -= 1;
        }
        t
    }
}
