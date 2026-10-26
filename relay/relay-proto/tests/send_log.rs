use relay_proto::send_log::{self, Verdict};
use relay_proto::trace::Trace;

const ROOM: u64 = 0x1d90_15b4_d4d6_c236;
const PERIOD_US: i64 = 8_000;
const TURNS: u32 = 60;
const LOST: std::ops::Range<u32> = 20..35;

fn trace_text() -> String {
    let delays: String = (0..TURNS).map(|t| if LOST.contains(&t) { "-\n".to_string() } else { "300\n".to_string() }).collect();
    format!("relay path trace v1\nperiod_us 8000\nrtt_us 180000\ndelays_us\n{delays}")
}

fn send_text(at: impl Fn(u32) -> Option<i64>) -> String {
    let lines: String = (0..TURNS)
        .filter_map(|t| at(t).map(|us| format!("down {ROOM:016x} 0 {t} {t} {us}\ncover {ROOM:016x} 0 {t} {t} {us}\n")))
        .collect();
    format!("relay send log v1\ndown {ROOM:016x} 0 0 - 900000\n{lines}down {ROOM:016x} 1 0 0 1000000\n")
}

fn runs(sends: &str) -> Vec<send_log::LossRun> {
    let trace = Trace::parse(&trace_text()).unwrap();
    send_log::loss_runs(&trace, &send_log::parse(sends).unwrap(), ROOM, 0)
}

#[test]
fn a_loss_run_whose_turns_the_relay_sent_on_schedule_is_put_on_the_route() {
    let found = runs(&send_text(|t| Some(1_000_000 + t as i64 * PERIOD_US + (t as i64 % 3) * 500)));
    assert_eq!(found.len(), 1, "{found:?}");
    let run = found[0];
    assert_eq!((run.first_turn, run.turns, run.length_us), (20, 15, 120_000));
    assert_eq!((run.sent, run.on_time, run.verdict), (15, 15, Verdict::Route));
    assert!(run.gap_us <= PERIOD_US + 1_000, "{run:?}");
}

#[test]
fn a_loss_run_the_relay_sent_nothing_in_and_caught_up_after_is_put_on_the_relay() {
    let resumed = 1_000_000 + 36 * PERIOD_US;
    let found = runs(&send_text(|t| match t {
        t if LOST.contains(&t) && t % 5 != 4 => None,
        t if t < LOST.start => Some(1_000_000 + t as i64 * PERIOD_US),
        t => Some(resumed.max(1_000_000 + t as i64 * PERIOD_US)),
    }));
    assert_eq!(found.len(), 1, "{found:?}");
    let run = found[0];
    assert_eq!((run.first_turn, run.turns), (20, 15));
    assert_eq!((run.sent, run.on_time, run.verdict), (3, 0, Verdict::Pause));
    assert_eq!(run.gap_us, resumed - (1_000_000 + 19 * PERIOD_US));
}
