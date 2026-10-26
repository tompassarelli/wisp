use relay_proto::cadence::Cadence;
use relay_proto::relay::Relay;
use relay_proto::rng::Rng;
use relay_proto::sim::{run, AgentSpec, Loss, Path, Scenario};
use relay_proto::trace::{arrival, Replay, Trace};
use relay_proto::wire::{decode, encode, Packet, Up};
use relay_proto::Micros;

const PERIOD_US: Micros = 8_000;
const SECOND: Micros = 1_000_000;

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

fn replaying(down: Option<Replay>) -> AgentSpec {
    let path = Path {
        one_way_us: 20_000,
        jitter_mean_us: 2_000.0,
        loss: Loss::None,
    };
    AgentSpec {
        down: path,
        up: path,
        drift_ppb: 0,
        clock_offset_us: 0,
        actions_hz: 4.0,
        action_bytes: (4, 24),
        releases: 0.5,
        udp_blocked: false,
        down_replay: down,
        up_replay: None,
        fixed_depth_us: None,
        raise_headroom_us: None,
        max_total_depth_us: None,
    }
}

#[test]
fn a_replayed_trace_arrives_with_its_delays_and_losses() {
    for seed in 0..4 {
        let mut rng = Rng::new(seed);
        let n = 3_000;
        let trace = Trace {
            period_us: PERIOD_US,
            rtt_us: 40_000,
            delays_us: (0..n)
                .map(|i| match i % 100 {
                    0 | 99 => Some(0),
                    _ if rng.chance(0.05) => None,
                    _ => Some(rng.range(0, 150_000)),
                })
                .collect(),
        };
        let lobby_us = 2 * SECOND;
        let s = Scenario {
            seed,
            cadence: Cadence::default(),
            agents: vec![replaying(Some(Replay::new(&trace, lobby_us))), replaying(None)],
            lobby_us,
            match_us: n as Micros * PERIOD_US + SECOND,
            tail_us: SECOND,
            outages: Vec::new(),
            keep_turns: true,
            margin_quantile: None,
            cover: false,
            max_depth_us: None,
        };
        let first = (lobby_us / PERIOD_US) as u32;
        let arrivals: Vec<(u32, Micros)> = run(&s).agents[0]
            .down_arrivals
            .iter()
            .copied()
            .filter(|&(seq, _)| seq >= first && seq < first + n as u32)
            .collect();

        assert_eq!(Trace::from_arrivals(PERIOD_US, 40_000, &arrivals), trace, "seed {seed}");
    }
}

#[test]
fn a_stream_with_cover_packets_records_one_slot_per_turn() {
    let token = 0x5eed_7e57;
    let mut relay = Relay::new(Cadence::default(), &[token], 0);
    relay.start(0);
    let mut arrivals = Vec::new();
    let (mut covers, mut checksums, mut now) = (0, 0, 0);
    for seq in 0.. {
        if relay.turns_emitted() >= 3_000 {
            break;
        }
        for (_, bytes) in relay.poll(now) {
            match decode(&bytes).unwrap() {
                Packet::Down(d) => arrivals.extend(arrival(&d, 3_000 + now)),
                Packet::Cover(_) => covers += 1,
                other => panic!("{other:?}"),
            }
        }
        let emitted = relay.turns_emitted();
        let up = Up {
            token,
            seq,
            sent_us: now as u64,
            turn_ack: emitted.saturating_sub(2),
            cover: 2,
            cover_turns: 4,
            checksum_from: checksums,
            checksums: vec![0; (emitted - checksums) as usize],
            action_from: 0,
            actions: vec![],
        };
        checksums = emitted;
        relay.on_packet(&encode(&Packet::Up(up)).unwrap()).unwrap();
        now += 1_000;
    }

    let trace = Trace::from_arrivals(PERIOD_US, 30_000, &arrivals);

    assert!(covers >= 2 * 2_900, "{covers} covers");
    assert_eq!(trace.delays_us.len(), relay.turns_emitted() as usize);
    assert!(trace.delays_us.iter().all(Option::is_some));
}
