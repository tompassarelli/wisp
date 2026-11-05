use relay_proto::cadence::Cadence;
use relay_proto::rng::Rng;
use relay_proto::sim::{run, AgentSpec, Loss, Outcome, Path, Scenario};
use relay_proto::wire::Action;
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
