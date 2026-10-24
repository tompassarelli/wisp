use relay_proto::rng::Rng;
use relay_proto::trace::Trace;
use relay_proto::Micros;

const PERIOD_US: Micros = 8_000;

#[test]
fn arrivals_become_delays_above_the_drift_corrected_floor() {
    for seed in 0..40 {
        let mut rng = Rng::new(seed);
        let n = rng.range(3_000, 12_000) as usize;
        let drift_ppm = rng.range(-100, 100) as f64;
        let clock_us = rng.range(-5_000_000, 5_000_000);
        let first_seq = rng.below(1_000) as u32;
        let jitter: Vec<Micros> = (0..n)
            .map(|i| match i % 50 {
                0 => 0,
                _ => 2_000 + rng.exp(3_000.0) as Micros,
            })
            .collect();
        let lost: Vec<bool> = (0..n)
            .map(|i| i % 50 != 0 && i != n - 1 && rng.chance(0.05))
            .collect();
        let offset = |i: usize| clock_us + (i as f64 * PERIOD_US as f64 * drift_ppm / 1e6) as Micros + jitter[i];
        let mut arrivals: Vec<(u32, Micros)> = (0..n)
            .filter(|&i| !lost[i])
            .flat_map(|i| {
                let copies = if rng.chance(0.01) { 2 } else { 1 };
                (0..copies).map(move |c| (first_seq + i as u32, offset(i) + c * 40_000))
            })
            .collect();
        for i in (1..arrivals.len()).rev() {
            if rng.chance(0.02) {
                arrivals.swap(i, i - 1);
            }
        }

        let trace = Trace::from_arrivals(PERIOD_US, 30_000, &arrivals);

        assert_eq!(trace.delays_us.len(), n, "seed {seed}");
        for (i, d) in trace.delays_us.iter().enumerate() {
            match d {
                None => assert!(lost[i], "seed {seed} packet {i} lost"),
                Some(d) => {
                    assert!(!lost[i], "seed {seed} packet {i} invented");
                    assert!((d - jitter[i]).abs() <= 2, "seed {seed} packet {i}: {d} vs {}", jitter[i]);
                }
            }
        }
    }
}

#[test]
fn a_trace_renders_and_parses_back() {
    for seed in 0..40 {
        let mut rng = Rng::new(seed);
        let trace = Trace {
            period_us: rng.range(1_000, 20_000),
            rtt_us: rng.range(0, 300_000),
            delays_us: (0..rng.below(500))
                .map(|_| (!rng.chance(0.1)).then(|| rng.range(0, 200_000)))
                .collect(),
        };
        assert_eq!(Trace::parse(&trace.render()), Ok(trace), "seed {seed}");
    }
    assert!(Trace::parse("relay path trace v2\n").is_err());
}
