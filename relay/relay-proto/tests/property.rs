use relay_proto::cadence::Cadence;
use relay_proto::rng::Rng;
use relay_proto::sim::{run, AgentOutcome, AgentSpec, Loss, Outcome, Path, Scenario};
use relay_proto::transport::{self, Transport};
use relay_proto::wire::{self, Action, Down, Packet, Turn, Up, UpAction};
use relay_proto::Micros;

const SECOND: Micros = 1_000_000;

fn path(rng: &mut Rng) -> Path {
    let loss = match rng.below(3) {
        0 => Loss::None,
        1 => Loss::Independent(rng.unit() * 0.3),
        _ => Loss::Burst {
            loss: rng.unit() * 0.2,
            mean_burst: 1.0 + rng.unit() * 7.0,
        },
    };
    Path {
        one_way_us: rng.range(0, 150_000),
        jitter_mean_us: rng.unit() * 40_000.0,
        loss,
    }
}

fn scenario(seed: u64) -> Scenario {
    let mut rng = Rng::new(seed);
    let players = rng.range(2, 4) as usize;
    let lobby_us = rng.range(2, 5) * SECOND;
    let match_us = rng.range(10, 20) * SECOND;
    let agents = (0..players)
        .map(|_| AgentSpec {
            down: path(&mut rng),
            up: path(&mut rng),
            drift_ppb: rng.range(-500_000, 500_000),
            clock_offset_us: rng.range(-100 * SECOND, 100 * SECOND),
            actions_hz: if rng.chance(0.1) {
                0.0
            } else {
                rng.unit() * 40.0
            },
            action_bytes: (0, rng.range(0, 300) as usize),
            releases: rng.unit(),
            udp_blocked: false,
        })
        .collect();
    let outages = (0..rng.below(4))
        .map(|_| {
            let start = lobby_us + rng.range(0, match_us);
            (start, start + rng.range(10_000, 3 * SECOND))
        })
        .collect();
    let steps: &[u8] = match rng.below(3) {
        0 => &[8],
        1 => &[17, 17, 16],
        _ => &[25],
    };
    Scenario {
        seed,
        cadence: Cadence::new(steps),
        agents,
        lobby_us,
        match_us,
        tail_us: 15 * SECOND,
        outages,
        keep_turns: true,
        margin_quantile: if rng.chance(0.5) { Some(0.95) } else { None },
    }
}

fn check(seed: u64, s: &Scenario, o: &Outcome) {
    assert_eq!(o.desync, None, "seed {seed}: relay saw a desync");
    assert!(
        o.checksums_compared > 0,
        "seed {seed}: no checksums compared"
    );
    let longest = o.agents.iter().max_by_key(|a| a.fed.len()).unwrap();
    for (i, a) in o.agents.iter().enumerate() {
        for (n, f) in a.fed.iter().enumerate() {
            assert_eq!(
                f.index as usize, n,
                "seed {seed}: agent {i} fed out of order"
            );
            assert_eq!(
                f.turn, longest.fed[n].turn,
                "seed {seed}: agent {i} turn {n} differs"
            );
            assert_eq!(
                f.turn.step_ms,
                s.cadence.step_ms(f.index),
                "seed {seed}: step of turn {n}"
            );
        }
        assert_eq!(
            a.unacked_at_end, 0,
            "seed {seed}: agent {i} still holds unacknowledged actions"
        );
    }
    for (i, a) in o.agents.iter().enumerate() {
        let actions: Vec<(u32, &Action)> = a
            .fed
            .iter()
            .flat_map(|f| f.turn.actions.iter().map(|x| (f.index, x)))
            .collect();
        for (sender, spec) in o.agents.iter().enumerate() {
            let (turns, got): (Vec<u32>, Vec<&Action>) = actions
                .iter()
                .copied()
                .filter(|(_, x)| x.player as usize == sender)
                .unzip();
            assert_eq!(
                got.len(),
                spec.sent.len(),
                "seed {seed}: agent {i} fed {} of agent {sender}'s {} actions",
                got.len(),
                spec.sent.len()
            );
            for (n, (x, sent)) in got.iter().zip(&spec.sent).enumerate() {
                assert_eq!(x.seq as usize, n, "seed {seed}: action order");
                assert_eq!(
                    &x.data, &sent.data,
                    "seed {seed}: action {n} of agent {sender}"
                );
                if sent.release && n > 0 {
                    assert!(
                        turns[n] > turns[n - 1],
                        "seed {seed}: release {n} of agent {sender} shares turn {} with the action before it",
                        turns[n]
                    );
                }
            }
        }
    }
}

#[test]
fn every_agent_feeds_the_same_turns_and_every_action_once() {
    for seed in 0..128u64 {
        let s = scenario(seed);
        let o = run(&s);
        check(seed, &s, &o);
    }
}

fn fed_bytes(a: &AgentOutcome) -> Vec<u8> {
    let head = Down {
        token: 0,
        seq: 0,
        sent_us: 0,
        base_us: 0,
        action_ack: 0,
        checksum_ack: 0,
        turn_from: 0,
        turns: Vec::new(),
    };
    let mut out = Vec::new();
    for f in &a.fed {
        let (bytes, n) = wire::encode_down(&head, std::slice::from_ref(&f.turn), wire::MAX_PACKET);
        assert_eq!(n, 1);
        out.extend_from_slice(&bytes[wire::DOWN_HEADER..]);
    }
    out
}

fn with_udp_blocked(mut s: Scenario, blocked: impl Fn(usize) -> bool) -> Scenario {
    let shift = transport::FALLBACK_US + SECOND;
    s.lobby_us += shift;
    for o in &mut s.outages {
        *o = (o.0 + shift, o.1 + shift);
    }
    for (i, a) in s.agents.iter_mut().enumerate() {
        a.udp_blocked = blocked(i);
    }
    s
}

fn check_transports(seed: u64, s: &Scenario, o: &Outcome) {
    for (i, (spec, a)) in s.agents.iter().zip(&o.agents).enumerate() {
        let want = if spec.udp_blocked {
            Transport::Tcp
        } else {
            Transport::Udp
        };
        assert_eq!(a.transport, want, "seed {seed}: agent {i} transport");
    }
    let longest = o.agents.iter().max_by_key(|a| a.fed.len()).unwrap();
    let reference = fed_bytes(longest);
    for (i, a) in o.agents.iter().enumerate() {
        let bytes = fed_bytes(a);
        assert_eq!(
            bytes,
            reference[..bytes.len()],
            "seed {seed}: agent {i} fed different bytes"
        );
    }
}

#[test]
fn with_udp_dropped_every_agent_feeds_the_same_turn_bytes_over_tcp() {
    for seed in 0..48u64 {
        let s = with_udp_blocked(scenario(seed), |_| true);
        let o = run(&s);
        check(seed, &s, &o);
        check_transports(seed, &s, &o);
    }
}

#[test]
fn one_room_carries_udp_and_tcp_agents_together() {
    for seed in 0..16u64 {
        let s = with_udp_blocked(scenario(seed), |i| i % 2 == 1);
        let o = run(&s);
        check(seed, &s, &o);
        check_transports(seed, &s, &o);
    }
}

#[test]
fn turns_over_the_packet_ceiling_split_across_turns() {
    let path = Path {
        one_way_us: 30_000,
        jitter_mean_us: 5_000.0,
        loss: Loss::Independent(0.1),
    };
    let spec = AgentSpec {
        down: path,
        up: path,
        drift_ppb: 0,
        clock_offset_us: 0,
        actions_hz: 400.0,
        action_bytes: (200, 500),
        releases: 0.5,
        udp_blocked: false,
    };
    let s = Scenario {
        seed: 99,
        cadence: Cadence::default(),
        agents: vec![spec.clone(), spec.clone(), spec],
        lobby_us: 2 * SECOND,
        match_us: 3 * SECOND,
        tail_us: 30 * SECOND,
        outages: vec![(3 * SECOND, 4 * SECOND)],
        keep_turns: true,
        margin_quantile: None,
    };
    let o = run(&s);
    check(99, &s, &o);
    assert!(o.agents[0]
        .fed
        .iter()
        .all(|f| f.turn.wire_len() <= wire::MAX_TURN));
    assert!(o.agents[0].sent.len() > 1000);
}

fn random_packet(rng: &mut Rng) -> Packet {
    let bytes = |rng: &mut Rng, max: u64| {
        (0..rng.below(max))
            .map(|_| rng.next_u64() as u8)
            .collect::<Vec<u8>>()
    };
    if rng.chance(0.5) {
        let turns = (0..rng.below(6))
            .map(|_| Turn {
                step_ms: rng.next_u64() as u8,
                actions: (0..rng.below(4))
                    .map(|_| Action {
                        player: rng.next_u64() as u8,
                        seq: rng.next_u64() as u32,
                        data: bytes(rng, 40),
                    })
                    .collect(),
            })
            .collect();
        Packet::Down(Down {
            token: rng.next_u64(),
            seq: rng.next_u64() as u32,
            sent_us: rng.next_u64(),
            base_us: rng.next_u64(),
            action_ack: rng.next_u64() as u32,
            checksum_ack: rng.next_u64() as u32,
            turn_from: rng.next_u64() as u32,
            turns,
        })
    } else {
        Packet::Up(Up {
            token: rng.next_u64(),
            seq: rng.next_u64() as u32,
            sent_us: rng.next_u64(),
            turn_ack: rng.next_u64() as u32,
            checksum_from: rng.next_u64() as u32,
            checksums: (0..rng.below(10)).map(|_| rng.next_u64() as u32).collect(),
            action_from: rng.next_u64() as u32,
            actions: (0..rng.below(8))
                .map(|_| UpAction {
                    release: rng.chance(0.5),
                    data: bytes(rng, 60),
                })
                .collect(),
        })
    }
}

#[test]
fn packets_round_trip_and_damaged_bytes_never_panic() {
    let mut rng = Rng::new(7);
    for _ in 0..5000 {
        let p = random_packet(&mut rng);
        let bytes = wire::encode(&p).unwrap();
        assert!(bytes.len() <= wire::MAX_PACKET);
        assert_eq!(wire::decode(&bytes), Ok(p));
        let mut damaged = bytes.clone();
        for _ in 0..1 + rng.below(4) {
            let i = rng.below(damaged.len() as u64) as usize;
            damaged[i] = rng.next_u64() as u8;
        }
        damaged.truncate(rng.below(damaged.len() as u64 + 1) as usize);
        let _ = wire::decode(&damaged);
        let noise: Vec<u8> = (0..rng.below(1300)).map(|_| rng.next_u64() as u8).collect();
        let _ = wire::decode(&noise);
    }
}
