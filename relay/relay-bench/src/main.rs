mod trace_cell;

use std::thread;

use relay_proto::cadence::Cadence;
use relay_proto::sim::{self, AgentSpec, Loss, Outcome, Path, Scenario};
use relay_proto::Micros;

const SECOND: Micros = 1_000_000;
const JITTER_MEAN_US: f64 = 2_000.0;
const BLACKOUT_EVERY: Micros = 300 * SECOND;
const BLACKOUT_LEN: Micros = SECOND;
const RTTS_MS: [i64; 3] = [100, 150, 200];
const UDP_BLOCKED: (i64, Kind) = (100, Kind::UdpBlocked(0.01));
const KINDS: [Kind; 10] = [
    Kind::Clean,
    Kind::Independent(0.005),
    Kind::Independent(0.01),
    Kind::Independent(0.02),
    Kind::Independent(0.05),
    Kind::Burst(0.01, 2.0),
    Kind::Burst(0.01, 4.0),
    Kind::Burst(0.03, 2.0),
    Kind::Burst(0.03, 4.0),
    Kind::Blackout(0.01),
];

#[derive(Clone, Copy)]
enum Kind {
    Clean,
    Independent(f64),
    Burst(f64, f64),
    Blackout(f64),
    UdpBlocked(f64),
    Trace(bool),
}

impl Kind {
    fn label(self) -> String {
        match self {
            Kind::Clean => "no loss".into(),
            Kind::Independent(p) => format!("{}% independent", p * 100.0),
            Kind::Burst(p, b) => format!("{}% bursts of {b}", p * 100.0),
            Kind::Blackout(p) => format!("{}% + 1 s blackout / 5 min", p * 100.0),
            Kind::UdpBlocked(p) => format!("UDP blocked, {}% over TCP", p * 100.0),
            Kind::Trace(false) => "trace, whole".into(),
            Kind::Trace(true) => "trace, rescans cut".into(),
        }
    }

    fn loss(self) -> Loss {
        match self {
            Kind::Clean | Kind::Trace(_) => Loss::None,
            Kind::Independent(p) | Kind::Blackout(p) | Kind::UdpBlocked(p) => Loss::Independent(p),
            Kind::Burst(loss, mean_burst) => Loss::Burst { loss, mean_burst },
        }
    }

    fn depth_bar_us(self) -> Option<Micros> {
        match self {
            Kind::Clean => Some(50_000),
            Kind::Independent(p) | Kind::Blackout(p) if p <= 0.01 => Some(50_000),
            Kind::Independent(_) | Kind::Blackout(_) | Kind::Burst(..) | Kind::Trace(_) => {
                Some(66_667)
            }
            Kind::UdpBlocked(_) => None,
        }
    }
}

struct Options {
    minutes: f64,
    rtts_ms: Vec<i64>,
    steps: Vec<u8>,
    margin: Option<f64>,
    cover: bool,
    max_depth_us: Option<Micros>,
    depth_us: Option<Micros>,
    raise_headroom_us: Option<Micros>,
    trace: Option<String>,
}

struct Cell {
    rtt_ms: i64,
    kind: Kind,
    seed: u64,
}

struct Row {
    rtt_ms: i64,
    kind: Kind,
    minutes: f64,
    period_us: Micros,
    outcome: Outcome,
    blackouts: Vec<(Micros, Micros)>,
    fixed_depth_us: Option<Micros>,
}

fn scenario(cell: &Cell, o: &Options, match_us: Micros) -> (Scenario, Vec<(Micros, Micros)>) {
    let lobby_us = 20 * SECOND;
    let path = Path {
        one_way_us: cell.rtt_ms * 500,
        jitter_mean_us: JITTER_MEAN_US,
        loss: cell.kind.loss(),
    };
    let agent = |drift_ppb, clock_offset_us| AgentSpec {
        down: path,
        up: path,
        drift_ppb,
        clock_offset_us,
        actions_hz: 4.0,
        action_bytes: (4, 24),
        releases: 0.5,
        udp_blocked: matches!(cell.kind, Kind::UdpBlocked(_)),
        down_replay: None,
        up_replay: None,
        fixed_depth_us: None,
        raise_headroom_us: None,
    };
    let blackouts: Vec<(Micros, Micros)> = match cell.kind {
        Kind::Blackout(_) => (1..)
            .map(|i| lobby_us + i * BLACKOUT_EVERY)
            .take_while(|&t| t + BLACKOUT_LEN < lobby_us + match_us)
            .map(|t| (t, t + BLACKOUT_LEN))
            .collect(),
        _ => Vec::new(),
    };
    let s = Scenario {
        seed: cell.seed,
        cadence: Cadence::new(&o.steps),
        agents: vec![agent(100_000, 7 * SECOND), agent(-100_000, -3 * SECOND)],
        lobby_us,
        match_us,
        tail_us: 5 * SECOND,
        outages: blackouts.clone(),
        keep_turns: false,
        margin_quantile: o.margin,
        cover: o.cover,
        max_depth_us: o.max_depth_us,
    };
    (s, blackouts)
}

fn counted_underruns(row: &Row, agent: usize) -> usize {
    let a = &row.outcome.agents[agent];
    a.underruns
        .iter()
        .filter(|&&t| {
            !row.blackouts
                .iter()
                .zip(&a.drains)
                .any(|(&(start, end), drain)| {
                    t >= start && t <= end + drain.unwrap_or(Micros::MAX / 4) + SECOND
                })
        })
        .count()
}

fn worst_drain(drains: &[Option<Micros>]) -> String {
    if drains.is_empty() {
        "–".to_string()
    } else if drains.iter().any(Option::is_none) {
        "never".to_string()
    } else {
        format!("{} ms", drains.iter().flatten().max().unwrap() / 1000)
    }
}

fn verdict(row: &Row, per10: &[f64], drains: &[Option<Micros>]) -> String {
    let Some(bar) = row.kind.depth_bar_us() else {
        return "measured".to_string();
    };
    let agents = &row.outcome.agents;
    let checks = [
        (per10.iter().all(|&u| u <= 1.0), "underruns".to_string()),
        (
            agents
                .iter()
                .all(|a| chosen_depth(row, a) <= bar && !a.choice.too_poor),
            format!("depth > {} ms", ms(bar)),
        ),
        (
            drains.iter().all(|d| d.is_some_and(|d| d <= 2 * SECOND)),
            "drain".to_string(),
        ),
        (row.outcome.desync.is_none(), "desync".to_string()),
    ];
    let why: Vec<&str> = checks
        .iter()
        .filter(|c| !c.0)
        .map(|c| c.1.as_str())
        .collect();
    if why.is_empty() {
        format!("pass (≤ {} ms)", ms(bar))
    } else {
        format!("fail ({})", why.join(", "))
    }
}

fn chosen_depth(row: &Row, a: &sim::AgentOutcome) -> Micros {
    a.choice.turns as Micros * row.period_us + a.choice.link.margin_us
}

fn worst(row: &Row, f: impl Fn(&sim::AgentOutcome) -> Micros) -> Micros {
    row.outcome.agents.iter().map(f).max().unwrap_or(0)
}

fn ms(us: Micros) -> String {
    format!("{:.1}", us as f64 / 1000.0)
}

fn delivery(row: &Row) -> String {
    let q = |q: f64| ms(worst(row, |a| a.delivery.quantile(q)));
    format!("{}/{}/{} ms", q(0.5), q(0.99), q(0.999))
}

fn echo(row: &Row) -> String {
    let q = |q: f64| ms(worst(row, |a| a.echo.quantile(q)));
    format!("{}/{} ms", q(0.5), q(0.99))
}

fn rate(row: &Row, f: impl Fn(&sim::AgentOutcome) -> u64) -> u64 {
    let seconds = row.minutes * 60.0;
    row.outcome
        .agents
        .iter()
        .map(|a| (f(a) as f64 / seconds).round() as u64)
        .max()
        .unwrap_or(0)
}

fn depth_label(row: &Row, i: usize, a: &sim::AgentOutcome) -> String {
    let fixed = match row.fixed_depth_us {
        Some(asked) if i == 0 => {
            let got = a.choice.turns as Micros * row.period_us;
            if got == asked {
                " fixed".to_string()
            } else {
                format!(" fixed ({} ms rounded to {} ms)", ms(asked), ms(got))
            }
        }
        _ => String::new(),
    };
    let raised = if a.stats.raise_us > 0 {
        format!(" raised {} ms", ms(a.stats.raise_us))
    } else {
        String::new()
    };
    format!(
        "{}{}{}{fixed}{raised}",
        a.choice.turns,
        if a.cover > 0 {
            format!("+{}", a.cover)
        } else {
            String::new()
        },
        if a.choice.too_poor { "!" } else { "" }
    )
}

fn frame_columns(row: &Row) -> String {
    let each = |f: &dyn Fn(&sim::Frames) -> String| {
        let v: Vec<String> = row.outcome.agents.iter().map(|a| f(&a.frames)).collect();
        v.join("/")
    };
    let per10 = |f: fn(&sim::Frames) -> f64| {
        each(&|fr: &sim::Frames| format!("{:.2}", f(fr) * 10.0 / row.minutes))
    };
    format!(
        " {} | {} | {} | {} | {} | {} | {} | {} | {} |",
        per10(|f| f.callbackless as f64),
        per10(|f| f.stalls as f64),
        per10(|f| f.long_stalls as f64),
        per10(|f| f.catch_up_us as f64 / SECOND as f64),
        per10(|f| f.double_callbacks as f64),
        each(&|f: &sim::Frames| f.max_per_poll.to_string()),
        each(&|f: &sim::Frames| ms(f.peak_lag_us)),
        per10(|f| f.lag_events as f64),
        per10(|f| f.long_lag_events as f64),
    )
}

fn render_row(row: &Row, frames: bool) -> String {
    let agents = &row.outcome.agents;
    let per10: Vec<f64> = (0..agents.len())
        .map(|i| counted_underruns(row, i) as f64 * 10.0 / row.minutes)
        .collect();
    let depths: Vec<String> = agents
        .iter()
        .enumerate()
        .map(|(i, a)| depth_label(row, i, a))
        .collect();
    let drains: Vec<Option<Micros>> = agents
        .iter()
        .flat_map(|a| a.drains.iter().copied())
        .collect();
    let depth = worst(row, |a| chosen_depth(row, a));
    let max_depth = worst(row, |a| chosen_depth(row, a) + a.stats.max_extra_us);
    let per10_text: Vec<String> = per10.iter().map(|u| format!("{u:.2}")).collect();
    format!(
        "| {} ms | {} | {}, {} ms | {} ms | {} | {} | {} | {} | {}/{} | {} | {} | {} |{}\n",
        row.rtt_ms,
        row.kind.label(),
        depths.join("/"),
        ms(depth),
        ms(max_depth),
        per10_text.join("/"),
        worst_drain(&drains),
        delivery(row),
        echo(row),
        rate(row, |a| a.bytes_down),
        rate(row, |a| a.bytes_up),
        row.outcome.stops,
        row.outcome
            .desync
            .map_or("none".to_string(), |t| format!("turn {t}")),
        verdict(row, &per10, &drains),
        if frames { frame_columns(row) } else { String::new() },
    )
}

fn render(rows: &[Row], frames: bool) -> String {
    let (head, rule) = if frames {
        (
            concat!(
                " Callback-less frames per 10 min (A/B) | Visible stalls ≥ 1 frame per 10 min (A/B) |",
                " Visible stalls ≥ 2 frames per 10 min (A/B) | 2× catch-up s per 10 min (A/B) |",
                " Double-callback frames per 10 min (A/B) | Max turns per poll (A/B) | Peak lag ms (A/B) |",
                " Lag events ≥ 2 frames per 10 min (A/B) | Lag events ≥ 4 frames per 10 min (A/B) |",
            ),
            "---|---|---|---|---|---|---|---|---|",
        )
    } else {
        ("", "")
    };
    let mut out = format!(
        "| RTT | Loss | D (A/B), depth | Max depth | Underruns per 10 min (A/B) | Catch-up after blackout | Delivery p50/p99/p99.9 | Own echo p50/p99 | Bytes/s down/up | Clock stops | Desync | Bar |{head}\n|---|---|---|---|---|---|---|---|---|---|---|---|{rule}\n",
    );
    for row in rows {
        out.push_str(&render_row(row, frames));
    }
    out
}

fn value<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .map(String::as_str)
}

fn millis(args: &[String], flag: &str, min_ms: Micros) -> Option<Option<Micros>> {
    match value(args, flag) {
        Some(ms) => Some(Some(ms.parse::<Micros>().ok().filter(|&ms| ms >= min_ms)? * 1000)),
        None => Some(None),
    }
}

fn options(args: &[String]) -> Option<Options> {
    let trace = value(args, "--trace").map(str::to_string);
    if trace.is_none() && !args.iter().any(|a| a == "--grid") {
        return None;
    }
    let minutes = match value(args, "--minutes") {
        Some(m) => m.parse().ok()?,
        None => 60.0,
    };
    let rtts_ms = match value(args, "--rtts") {
        Some(s) => s
            .split(',')
            .map(|x| x.parse().ok().filter(|&ms: &i64| ms >= 0))
            .collect::<Option<Vec<i64>>>()?,
        None => RTTS_MS.to_vec(),
    };
    let steps = match value(args, "--steps") {
        Some(s) => s
            .split(',')
            .map(|x| x.parse().ok().filter(|&ms: &u8| ms > 0))
            .collect::<Option<Vec<u8>>>()?,
        None => vec![8],
    };
    let margin = match value(args, "--margin") {
        Some(q) => Some(q.parse().ok().filter(|q: &f64| (0.05..1.0).contains(q))?),
        None => None,
    };
    let cover = !args.iter().any(|a| a == "--no-cover");
    let max_depth_us = millis(args, "--max-depth-ms", 1)?;
    let depth_us = millis(args, "--depth-ms", 1)?;
    let raise_headroom_us = millis(args, "--raise-headroom-ms", 0)?;
    Some(Options {
        minutes,
        rtts_ms,
        steps,
        margin,
        cover,
        max_depth_us,
        depth_us,
        raise_headroom_us,
        trace,
    })
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(o) = options(&args) else {
        eprintln!(
            "usage: relay-bench --grid|--trace FILE [--minutes N] [--rtts MS,...] [--steps 8|17,17,16] [--margin QUANTILE] [--no-cover] [--max-depth-ms MS] [--depth-ms MS] [--raise-headroom-ms MS]"
        );
        std::process::exit(2);
    };
    let period_us = Cadence::new(&o.steps).period_us();
    if let Some(name) = &o.trace {
        trace_cell::main(&o, name, period_us);
        return;
    }
    let mut cells = Vec::new();
    for (r, &rtt_ms) in o.rtts_ms.iter().enumerate() {
        for (k, kind) in KINDS.into_iter().enumerate() {
            cells.push(Cell {
                rtt_ms,
                kind,
                seed: 0x5eed_0000 + (r * 16 + k) as u64,
            });
        }
    }
    cells.push(Cell {
        rtt_ms: UDP_BLOCKED.0,
        kind: UDP_BLOCKED.1,
        seed: 0x5eed_0000 + KINDS.len() as u64,
    });
    let match_us = (o.minutes * 60.0 * SECOND as f64) as Micros;
    let rows: Vec<Row> = thread::scope(|scope| {
        let handles: Vec<_> = cells
            .iter()
            .map(|cell| {
                let o = &o;
                scope.spawn(move || {
                    let (s, blackouts) = scenario(cell, o, match_us);
                    Row {
                        rtt_ms: cell.rtt_ms,
                        kind: cell.kind,
                        minutes: o.minutes,
                        period_us,
                        outcome: sim::run(&s),
                        blackouts,
                        fixed_depth_us: None,
                    }
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap()).collect()
    });
    print!("{}", render(&rows, false));
}
