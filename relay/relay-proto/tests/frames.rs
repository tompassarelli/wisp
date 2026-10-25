use relay_proto::cadence::Cadence;
use relay_proto::depth;
use relay_proto::sim::{run, AgentSpec, Frames, Loss, Path, Scenario};
use relay_proto::Micros;

const SECOND: Micros = 1_000_000;
const STEP: Micros = 8_000;

fn fed_every(gaps: &[Micros]) -> Frames {
    let mut f = Frames::new(0, SECOND);
    let mut at = 0;
    for &g in gaps {
        at += g;
        f.feed(at, STEP);
    }
    f.close();
    f
}

#[test]
fn a_feed_wait_of_one_frame_beyond_the_step_is_a_visible_stall() {
    assert_eq!(fed_every(&[0, STEP, STEP + 16_666, STEP]).visible_stalls, 0);
    assert_eq!(fed_every(&[0, STEP, STEP + 16_667, STEP]).visible_stalls, 1);
}

#[test]
fn only_frames_with_no_feed_are_frozen() {
    let steady: Vec<Micros> = (0..125).map(|i| if i == 0 { 0 } else { STEP }).collect();
    assert_eq!(fed_every(&steady).frozen, 0);
    let mut gap = steady.clone();
    gap[60] = STEP + 50_000;
    assert_eq!(fed_every(&gap[..119]).frozen, 2);
}

#[test]
fn frames_after_the_last_feed_and_outside_the_match_count_as_frozen() {
    assert_eq!(fed_every(&[]).frozen, 60);
    assert_eq!(fed_every(&[SECOND + STEP]).frozen, 60);
    assert_eq!(fed_every(&[0]).frozen, 59);
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
fn a_one_second_outage_freezes_about_a_second_of_frames() {
    let quiet = run(&room(Vec::new()));
    let cut = run(&room(vec![(25 * SECOND, 26 * SECOND)]));
    for (q, c) in quiet.agents.iter().zip(&cut.agents) {
        assert!(q.frames.frozen <= 12, "{:?}", q.frames);
        assert_eq!(q.frames.visible_stalls, 1, "{:?}", q.frames);
        assert!((55..=80).contains(&(c.frames.frozen - q.frames.frozen)), "{:?}", c.frames);
        assert!(c.frames.visible_stalls > q.frames.visible_stalls, "{:?}", c.frames);
        assert_eq!(c.frames.stretched_us, 0);
    }
}

