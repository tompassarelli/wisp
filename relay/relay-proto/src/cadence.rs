use crate::Micros;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Cadence {
    steps_ms: Vec<u8>,
    prefix_us: Vec<Micros>,
    cycle_us: Micros,
}

impl Cadence {
    pub fn new(steps_ms: &[u8]) -> Self {
        assert!(!steps_ms.is_empty() && steps_ms.iter().all(|&s| s > 0));
        let mut prefix_us = Vec::with_capacity(steps_ms.len());
        let mut total = 0;
        for &s in steps_ms {
            prefix_us.push(total);
            total += s as Micros * 1000;
        }
        Cadence {
            steps_ms: steps_ms.to_vec(),
            prefix_us,
            cycle_us: total,
        }
    }

    pub fn standard() -> Self {
        Cadence::new(&[17, 17, 16])
    }

    pub fn step_ms(&self, turn: u32) -> u8 {
        self.steps_ms[turn as usize % self.steps_ms.len()]
    }

    pub fn relay_time(&self, turn: u32) -> Micros {
        let n = self.steps_ms.len() as u64;
        let t = turn as u64;
        (t / n) as Micros * self.cycle_us + self.prefix_us[(t % n) as usize]
    }

    pub fn period_us(&self) -> Micros {
        self.cycle_us / self.steps_ms.len() as Micros
    }
}
