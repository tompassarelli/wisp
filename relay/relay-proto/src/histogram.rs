use crate::Micros;

#[derive(Clone, Debug, Default)]
pub struct Histogram {
    buckets: Vec<u64>,
    count: u64,
}

impl Histogram {
    pub const BUCKET_US: Micros = 100;
    const BUCKETS: usize = 50_000;

    pub fn add(&mut self, us: Micros) {
        if self.buckets.is_empty() {
            self.buckets = vec![0; Self::BUCKETS];
        }
        let i = (us.max(0) / Self::BUCKET_US) as usize;
        self.buckets[i.min(Self::BUCKETS - 1)] += 1;
        self.count += 1;
    }

    pub fn quantile(&self, q: f64) -> Micros {
        let rank = ((self.count as f64 * q).ceil() as u64).clamp(1, self.count.max(1));
        let mut seen = 0;
        for (i, &n) in self.buckets.iter().enumerate() {
            seen += n;
            if seen >= rank {
                return (i as Micros + 1) * Self::BUCKET_US;
            }
        }
        0
    }
}
