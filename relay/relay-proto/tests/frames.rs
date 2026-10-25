use relay_proto::cadence::Cadence;
use relay_proto::depth;
use relay_proto::sim::{run, AgentSpec, Frames, Loss, Path, Scenario};
use relay_proto::Micros;

const SECOND: Micros = 1_000_000;
const STEP: Micros = 8_000;

const ONE: Micros = 16_667;

fn callbacks_every(gaps: &[Micros]) -> Frames {
    let mut f = Frames::new(0, 10 * SECOND);
    let mut at = 0;
    for &g in gaps {
        at += g;
        f.feed(at, ONE, 0, 0, false);
    }
    f
}

#[test]
fn steady_eight_ms_turns_give_callback_gaps_of_one_frame_or_less_than_two() {
    let mut f = Frames::new(0, SECOND);
    for k in 0..120 {
        f.feed(k * STEP, STEP, 0, 0, false);
    }
    assert_eq!((f.stalls, f.callbackless, f.double_callbacks), (0, 0, 0), "{f:?}");
}

#[test]
fn a_callback_gap_of_a_frame_and_a_half_is_a_stall_and_of_two_and_a_half_a_long_one() {
    assert_eq!(callbacks_every(&[0, ONE, 24_999, ONE]).stalls, 0);
    let f = callbacks_every(&[0, ONE, 25_000, ONE]);
    assert_eq!((f.stalls, f.long_stalls, f.callbackless), (1, 0, 1), "{f:?}");
    let f = callbacks_every(&[0, ONE, 41_666, ONE]);
    assert_eq!((f.stalls, f.long_stalls), (1, 0), "{f:?}");
    let f = callbacks_every(&[0, ONE, 41_667, ONE]);
    assert_eq!((f.stalls, f.long_stalls, f.callbackless), (1, 1, 2), "{f:?}");
}

#[test]
fn consecutive_long_gaps_are_one_stall() {
    let f = callbacks_every(&[0, 30_000, 30_000, 50_000, ONE, 30_000, ONE]);
    assert_eq!((f.stalls, f.long_stalls), (2, 1), "{f:?}");
    assert_eq!(f.callbackless, 1 + 1 + 2 + 1);
}

#[test]
fn callback_less_frames_round_each_gap_to_whole_frames() {
    assert_eq!(callbacks_every(&[0, 58_333]).callbackless, 2);
    assert_eq!(callbacks_every(&[0, 58_334]).callbackless, 3);
}

#[test]
fn callbacks_closer_than_half_a_frame_share_a_frame() {
    assert_eq!(callbacks_every(&[0, 8_333]).double_callbacks, 1);
    assert_eq!(callbacks_every(&[0, 8_334]).double_callbacks, 0);
    let mut f = Frames::new(0, SECOND);
    f.feed(0, 2 * ONE, 0, 0, false);
    assert_eq!(f.double_callbacks, 1);
}

#[test]
fn turns_fed_at_one_instant_and_catch_up_feeds_are_counted() {
    let mut f = Frames::new(0, SECOND);
    for at in [0, 0, 0, 4_000, 8_000, 8_000, 30_000] {
        f.feed(at, STEP, 0, 0, at == 4_000 || at == 30_000);
    }
    assert_eq!(f.max_per_poll, 3);
    assert_eq!(f.catch_up_us, 4_000 + 22_000);
}

#[test]
fn lag_events_are_counted_once_per_episode_above_a_frame() {
    let mut f = Frames::new(0, SECOND);
    for (k, late) in [0, 20_000, 40_000, 70_000, 30_000, 10_000, 40_000, 20_000].into_iter().enumerate() {
        f.feed(k as Micros * STEP, STEP, late + 32_000, late, false);
    }
    assert_eq!((f.lag_events, f.long_lag_events), (2, 1), "{f:?}");
    assert_eq!(f.peak_lag_us, 102_000);
}

#[test]
fn feeds_outside_the_match_are_not_counted() {
    let mut f = Frames::new(SECOND, 2 * SECOND);
    f.feed(0, ONE, 90_000, 90_000, true);
    f.feed(SECOND / 2, ONE, 90_000, 90_000, true);
    f.feed(2 * SECOND, ONE, 90_000, 90_000, true);
    assert_eq!(f, Frames::new(SECOND, 2 * SECOND));
}

#[test]
fn whole_turns_rounds_to_the_nearest_turn() {
    assert_eq!(depth::whole_turns(30_000, STEP), 4);
    assert_eq!(depth::whole_turns(27_999, STEP), 3);
    assert_eq!(depth::whole_turns(1_000, STEP), 1);
}

fn clean(fixed_depth_us: Option<Micros>) -> AgentSpec {
    let path = Path {
        one_way_us: 20_000,
        jitter_mean_us: 2_000.0,
        loss: Loss::None,
    };
    AgentSpec {
        down: path,
        up: path,
        drift_ppb: 100_000,
        clock_offset_us: 7 * SECOND,
        actions_hz: 4.0,
        action_bytes: (4, 24),
        releases: 0.5,
        udp_blocked: false,
        down_replay: None,
        up_replay: None,
        fixed_depth_us,
        raise_headroom_us: None,
    }
}

fn room(outages: Vec<(Micros, Micros)>) -> Scenario {
    Scenario {
        seed: 9,
        cadence: Cadence::default(),
        agents: vec![clean(Some(64_000)), clean(None)],
        lobby_us: 20 * SECOND,
        match_us: 20 * SECOND,
        tail_us: 5 * SECOND,
        outages,
        keep_turns: false,
        margin_quantile: None,
        max_depth_us: None,
        cover: true,
    }
}

#[test]
fn a_fixed_depth_sets_only_its_agent_and_overrides_the_rule() {
    let out = run(&room(Vec::new()));
    assert_eq!(out.agents[0].choice.turns, 8);
    assert!(out.agents[1].choice.turns < 8);
}

#[test]
fn a_one_second_outage_loses_about_a_second_of_callbacks() {
    let quiet = run(&room(Vec::new()));
    let cut = run(&room(vec![(25 * SECOND, 26 * SECOND)]));
    for (q, c) in quiet.agents.iter().zip(&cut.agents) {
        assert!(q.frames.callbackless <= 2, "{:?}", q.frames);
        assert_eq!(q.frames.long_stalls, 0, "{:?}", q.frames);
        assert!((55..=70).contains(&(c.frames.callbackless - q.frames.callbackless)), "{:?}", c.frames);
        assert_eq!(c.frames.long_stalls, 1, "{:?}", c.frames);
        assert!(c.frames.peak_lag_us >= SECOND, "{:?}", c.frames);
        assert!(c.frames.catch_up_us > 0 && c.frames.double_callbacks > 0, "{:?}", c.frames);
    }
}

