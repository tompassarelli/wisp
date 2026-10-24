use crate::Micros;

pub const FORMAT: &str = "relay path trace v1";
pub const FLOOR_WINDOW: usize = 1250;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Trace {
    pub period_us: Micros,
    pub rtt_us: Micros,
    pub delays_us: Vec<Option<Micros>>,
}

fn slope(points: &[(f64, f64)]) -> f64 {
    let n = points.len() as f64;
    if points.len() < 2 {
        return 0.0;
    }
    let mean_x = points.iter().map(|p| p.0).sum::<f64>() / n;
    let mean_y = points.iter().map(|p| p.1).sum::<f64>() / n;
    let num: f64 = points.iter().map(|p| (p.0 - mean_x) * (p.1 - mean_y)).sum();
    let den: f64 = points.iter().map(|p| (p.0 - mean_x).powi(2)).sum();
    if den == 0.0 {
        0.0
    } else {
        num / den
    }
}

impl Trace {
    pub fn from_arrivals(period_us: Micros, rtt_us: Micros, arrivals: &[(u32, Micros)]) -> Trace {
        let (Some(first), Some(last)) = (
            arrivals.iter().map(|a| a.0).min(),
            arrivals.iter().map(|a| a.0).max(),
        ) else {
            return Trace {
                period_us,
                rtt_us,
                delays_us: Vec::new(),
            };
        };
        let mut offsets: Vec<Option<Micros>> = vec![None; (last - first) as usize + 1];
        for &(seq, offset) in arrivals {
            let slot = &mut offsets[(seq - first) as usize];
            *slot = Some(slot.map_or(offset, |o| o.min(offset)));
        }
        let floor: Vec<(f64, f64)> = offsets
            .chunks(FLOOR_WINDOW)
            .enumerate()
            .filter_map(|(w, chunk)| {
                chunk
                    .iter()
                    .enumerate()
                    .filter_map(|(i, o)| o.map(|o| (w * FLOOR_WINDOW + i, o)))
                    .min_by_key(|&(_, o)| o)
                    .map(|(i, o)| (i as f64, o as f64))
            })
            .collect();
        let drift = slope(&floor);
        let level: Vec<Option<f64>> = offsets
            .iter()
            .enumerate()
            .map(|(i, o)| o.map(|o| o as f64 - drift * i as f64))
            .collect();
        let base = level.iter().flatten().fold(f64::INFINITY, |a, &b| a.min(b));
        Trace {
            period_us,
            rtt_us,
            delays_us: level
                .iter()
                .map(|l| l.map(|l| (l - base).round() as Micros))
                .collect(),
        }
    }

    pub fn render(&self) -> String {
        let mut out = format!(
            "{FORMAT}\nperiod_us {}\nrtt_us {}\ndelays_us\n",
            self.period_us, self.rtt_us
        );
        for d in &self.delays_us {
            match d {
                Some(us) => out.push_str(&format!("{us}\n")),
                None => out.push_str("-\n"),
            }
        }
        out
    }

    pub fn parse(text: &str) -> Result<Trace, String> {
        let mut lines = text.lines();
        if lines.next() != Some(FORMAT) {
            return Err(format!("first line is not {FORMAT:?}"));
        }
        let mut field = |name: &str| -> Result<Micros, String> {
            let line = lines.next().unwrap_or_default();
            line.strip_prefix(name)
                .and_then(|v| v.strip_prefix(' '))
                .and_then(|v| v.parse().ok())
                .ok_or(format!("expected {name} N, got {line:?}"))
        };
        let period_us = field("period_us")?;
        let rtt_us = field("rtt_us")?;
        if lines.next() != Some("delays_us") {
            return Err("expected delays_us".into());
        }
        let delays_us = lines
            .map(|l| match l {
                "-" => Ok(None),
                _ => l.parse().map(Some).map_err(|e| format!("delay {l:?}: {e}")),
            })
            .collect::<Result<_, _>>()?;
        Ok(Trace {
            period_us,
            rtt_us,
            delays_us,
        })
    }
}
