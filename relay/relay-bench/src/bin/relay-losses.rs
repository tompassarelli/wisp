use std::process::ExitCode;

use relay_proto::send_log::{self, Line, LossRun, Verdict, LOSS_RUN_US};
use relay_proto::trace::Trace;

const USAGE: &str = "relay-losses --send-log FILE --trace FILE [--room ID] [--slot N]";

fn flag<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).map(String::as_str)
}

fn ms(us: i64) -> f64 {
    us as f64 / 1e3
}

fn describe(run: &LossRun) -> String {
    let side = match run.verdict {
        Verdict::Route => "route: the relay sent every turn on time",
        Verdict::Pause => "relay pause: the relay sent none of them on time",
        Verdict::Mixed => "mixed: the relay sent some on time",
    };
    format!(
        "loss run turns {}-{} ({} turns, {:.0} ms) due at {:.3} s: {side} ({} of {} sent, {} on time; longest send gap {:.1} ms)",
        run.first_turn,
        run.first_turn + run.turns - 1,
        run.turns,
        ms(run.length_us),
        run.due_us as f64 / 1e6,
        run.sent,
        run.turns,
        run.on_time,
        ms(run.gap_us),
    )
}

fn run(args: &[String]) -> Result<(), String> {
    let read = |name: &str| {
        let path = flag(args, name).ok_or(format!("{name} is required"))?;
        std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))
    };
    let lines = send_log::parse(&read("--send-log")?)?;
    let trace = Trace::parse(&read("--trace")?)?;
    let mut rooms: Vec<u64> = lines.iter().map(Line::room).collect();
    rooms.dedup();
    let room = match flag(args, "--room") {
        Some(id) => u64::from_str_radix(id, 16).map_err(|e| format!("--room: {e}"))?,
        None if rooms.len() == 1 => rooms[0],
        None => return Err(format!("the send log holds {} rooms; pass --room", rooms.len())),
    };
    let slot = flag(args, "--slot").map_or(Ok(0), str::parse).map_err(|e| format!("--slot: {e}"))?;
    let runs = send_log::loss_runs(&trace, &lines, room, slot);
    println!("room {room:016x} slot {slot}: {} loss runs of {} ms or more", runs.len(), LOSS_RUN_US / 1_000);
    for r in &runs {
        println!("{}", describe(r));
    }
    let stops: Vec<&Line> = lines.iter().filter(|l| matches!(l, Line::Stop { room: r, .. } if *r == room)).collect();
    println!("stops {}", stops.len());
    for s in stops {
        if let Line::Stop { at_us, slot, behind_us, .. } = s {
            println!("stop at {:.3} s: slot {slot} {:.1} ms behind on checksums", *at_us as f64 / 1e6, ms(*behind_us));
        }
    }
    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("{e}\n{USAGE}");
            ExitCode::from(2)
        }
    }
}
