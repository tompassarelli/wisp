use relay_proto::cadence::Cadence;
use relay_proto::relay::Relay;
use relay_proto::rng::Rng;
use relay_proto::trace::{arrival, Trace};
use relay_proto::wire::{decode, encode, Packet, Up};
use relay_proto::Micros;

const PERIOD_US: Micros = 8_000;

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
