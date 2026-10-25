use relay_proto::agent::{Agent, AgentConfig, AgentStats, Fed};
use relay_proto::cadence::Cadence;
use relay_proto::depth;
use relay_proto::rng::Rng;
use relay_proto::sim::{run, AgentOutcome, AgentSpec, Loss, Outcome, Path, Scenario};
use relay_proto::transport::{self, Transport};
use relay_proto::wire::{self, Action, Down, Turn};
use relay_proto::Micros;

const SECOND: Micros = 1_000_000;
const SPIKY_BASE: Micros = 30 * SECOND;
const SPIKY_TOKEN: u64 = 7;

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
            down_replay: None,
            up_replay: None,
            fixed_depth_us: None,
            raise_headroom_us: None,
            max_total_depth_us: None,
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
        cover: rng.chance(0.5),
        max_depth_us: None,
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

fn spiky_down(seq: usize, sent: Micros, base: u64, from: usize, turns: &[Turn]) -> Vec<u8> {
    let head = Down {
        token: SPIKY_TOKEN,
        seq: seq as u32,
        sent_us: sent as u64,
        base_us: base,
        action_ack: 0,
        checksum_ack: 0,
        turn_from: from as u32,
        turns: vec![],
    };
    wire::encode_down(&head, turns, wire::MAX_PACKET).0
}

fn spiky_stream(seed: u64) -> (Cadence, Vec<(Micros, Vec<u8>)>) {
    let mut rng = Rng::new(seed);
    let steps: &[u8] = [&[8][..], &[17, 17, 16], &[25]][rng.below(3) as usize];
    let cadence = Cadence::new(steps);
    let period = cadence.period_us();
    let delay = rng.range(1_000, 80_000);
    let lobby = 2 * depth::min_packets(period);
    let mut out: Vec<(Micros, Vec<u8>)> = (0..lobby)
        .map(|i| {
            let sent = i as Micros * period;
            (sent + delay, spiky_down(i, sent, wire::NOT_STARTED, 0, &[]))
        })
        .collect();
    let (mut stall_until, spike_p) = (0, rng.unit() * 0.02);
    for k in 0..rng.range(2_000, 6_000) as usize {
        let sent = SPIKY_BASE + cadence.relay_time(k as u32);
        if rng.chance(spike_p) {
            stall_until = sent + rng.range(10_000, 200_000);
        }
        let actions = (0..rng.below(3))
            .map(|n| Action {
                player: rng.below(4) as u8,
                seq: n as u32,
                data: vec![k as u8; rng.below(9) as usize],
            })
            .collect();
        let turn = Turn {
            step_ms: cadence.step_ms(k as u32),
            actions,
        };
        let at = sent.max(stall_until) + delay + rng.exp(2_000.0) as Micros;
        let bytes = spiky_down(lobby + k, sent, SPIKY_BASE as u64, k, &[turn]);
        out.push((at, bytes));
    }
    out.sort_by_key(|p| p.0);
    (cadence, out)
}

fn feed_stream(
    cadence: &Cadence,
    stream: &[(Micros, Vec<u8>)],
    headroom: Option<Micros>,
) -> (Vec<Fed>, AgentStats) {
    let mut cfg = AgentConfig::new(SPIKY_TOKEN, cadence.clone());
    cfg.raise_headroom_us = headroom;
    let mut agent = Agent::new(cfg, 0);
    let (mut fed, mut now) = (Vec::new(), 0);
    let mut run_until = |agent: &mut Agent, t: Micros, now: &mut Micros| loop {
        let wake = agent.next_wake().max(*now);
        if wake > t {
            break;
        }
        *now = wake;
        fed.extend(agent.poll(wake).0);
    };
    for (at, bytes) in stream {
        if *at >= SPIKY_BASE && agent.choice().is_none() {
            agent.choose_depth().unwrap();
        }
        run_until(&mut agent, *at, &mut now);
        now = now.max(*at);
        agent.on_packet(*at, bytes).unwrap();
    }
    run_until(&mut agent, now + 10 * SECOND, &mut now);
    (fed, agent.stats().clone())
}

#[test]
fn the_raise_moves_feed_times_but_never_the_fed_turns() {
    let mut raised = 0;
    for seed in 0..48u64 {
        let (cadence, stream) = spiky_stream(seed);
        let (off, _) = feed_stream(&cadence, &stream, None);
        let (on, stats) = feed_stream(&cadence, &stream, Some(32_000));
        let turns = |fed: &[Fed]| -> Vec<(u32, Turn)> {
            fed.iter().map(|f| (f.index, f.turn.clone())).collect()
        };
        assert_eq!(turns(&off), turns(&on), "seed {seed}: the raise fed other turns");
        let lobby = 2 * depth::min_packets(cadence.period_us());
        assert_eq!(on.len(), stream.len() - lobby, "seed {seed}: turns left unfed");
        assert!(
            on.windows(2).all(|w| w[0].at <= w[1].at),
            "seed {seed}: a feed went back in time"
        );
        raised += (stats.raise_us > 0) as u32;
    }
    assert!(raised >= 16, "only {raised} of 48 streams raised");
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
        down_replay: None,
        up_replay: None,
        fixed_depth_us: None,
        raise_headroom_us: None,
        max_total_depth_us: None,
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
        cover: true,
        max_depth_us: None,
    };
    let o = run(&s);
    check(99, &s, &o);
    assert!(o.agents[0]
        .fed
        .iter()
        .all(|f| f.turn.wire_len() <= wire::MAX_TURN));
    assert!(o.agents[0].sent.len() > 1000);
}

fn steady(one_way_us: Micros, loss: f64, udp_blocked: bool) -> AgentSpec {
    let path = Path {
        one_way_us,
        jitter_mean_us: 2_000.0,
        loss: Loss::Independent(loss),
    };
    AgentSpec {
        down: path,
        up: path,
        drift_ppb: 100_000,
        clock_offset_us: 7 * SECOND,
        actions_hz: 4.0,
        action_bytes: (4, 24),
        releases: 0.5,
        udp_blocked,
        down_replay: None,
        up_replay: None,
        fixed_depth_us: None,
        raise_headroom_us: None,
        max_total_depth_us: None,
    }
}

fn steady_room(lobby_us: Micros, agents: Vec<AgentSpec>) -> Scenario {
    Scenario {
        seed: 5,
        cadence: Cadence::default(),
        agents,
        lobby_us,
        match_us: 20 * SECOND,
        tail_us: 5 * SECOND,
        outages: Vec::new(),
        keep_turns: true,
        margin_quantile: None,
        max_depth_us: None,
        cover: true,
    }
}

fn lobby_before_any_packet() -> Vec<(Scenario, Outcome)> {
    [false, true]
        .into_iter()
        .map(|blocked| {
            let s = steady_room(0, vec![steady(20_000, 0.0, blocked); 2]);
            let o = run(&s);
            check(5, &s, &o);
            check_transports(5, &s, &o);
            (s, o)
        })
        .collect()
}

#[test]
fn an_agent_whose_lobby_ends_before_its_first_packet_measures_before_choosing() {
    for (s, o) in lobby_before_any_packet() {
        let need = depth::min_packets(s.cadence.period_us());
        let blocked = s.agents[0].udp_blocked;
        for (i, a) in o.agents.iter().enumerate() {
            assert!(
                a.choice.link.packets >= need,
                "udp blocked {blocked}: agent {i} chose from {} packets",
                a.choice.link.packets
            );
            assert!(
                a.fed_count > 2000,
                "udp blocked {blocked}: agent {i} fed {} turns",
                a.fed_count
            );
            if !blocked {
                assert!(!a.choice.too_poor, "agent {i} chose {:?}", a.choice);
                assert!(a.underruns.is_empty(), "agent {i} underran");
            }
        }
    }
}

#[test]
fn a_late_depth_choice_drains_the_waiting_turns_instead_of_feeding_them_at_once() {
    for (s, o) in lobby_before_any_packet() {
        for (i, a) in o.agents.iter().enumerate() {
            assert!(
                a.fed.windows(2).all(|w| w[1].at > w[0].at),
                "udp blocked {}: agent {i} fed two turns at once",
                s.agents[0].udp_blocked
            );
        }
    }
}

#[test]
fn over_tcp_the_agent_chooses_depth_from_the_tcp_loss_model() {
    let s = steady_room(
        20 * SECOND,
        vec![steady(50_000, 0.01, false), steady(50_000, 0.01, true)],
    );
    let o = run(&s);
    check(5, &s, &o);
    check_transports(5, &s, &o);
    let ceiling = depth::max_turns(s.cadence.period_us());
    let (udp, tcp) = (&o.agents[0].choice, &o.agents[1].choice);
    assert!(!udp.too_poor && udp.turns < ceiling, "udp chose {udp:?}");
    assert!(tcp.too_poor && tcp.turns == ceiling, "tcp chose {tcp:?}");
}
