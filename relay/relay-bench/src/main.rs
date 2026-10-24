use std::thread;

use relay_proto::cadence::Cadence;
use relay_proto::sim::{self, AgentSpec, Loss, Outcome, Path, Scenario};
use relay_proto::Micros;

const SECOND: Micros = 1_000_000;
const JITTER_MEAN_US: f64 = 2_000.0;
const BLACKOUT_EVERY: Micros = 300 * SECOND;
const BLACKOUT_LEN: Micros = SECOND;

#[derive(Clone, Copy)]
enum Kind {
    Clean,
    Independent(f64),
    Burst(f64, f64),
    Blackout(f64),
}

impl Kind {
    fn label(self) -> String {
        match self {
            Kind::Clean => "no loss".into(),
            Kind::Independent(p) => format!("{}% independent", p * 100.0),
            Kind::Burst(p, b) => format!("{}% bursts of {b}", p * 100.0),
            Kind::Blackout(p) => format!("{}% + 1 s blackout / 5 min", p * 100.0),
        }
    }

    fn loss(self) -> Loss {
        match self {
            Kind::Clean => Loss::None,
            Kind::Independent(p) | Kind::Blackout(p) => Loss::Independent(p),
            Kind::Burst(loss, mean_burst) => Loss::Burst { loss, mean_burst },
        }
    }

    fn judged(self) -> bool {
        !matches!(self, Kind::Burst(..))
    }
}

struct Cell {
    rtt_ms: i64,
    kind: Kind,
    margin: Option<f64>,
    seed: u64,
}

struct Row {
    margin: Option<f64>,
    rtt_ms: i64,
    kind: Kind,
    minutes: f64,
    outcome: Outcome,
    blackouts: Vec<(Micros, Micros)>,
}

fn scenario(cell: &Cell, match_us: Micros) -> (Scenario, Vec<(Micros, Micros)>) {
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
        cadence: Cadence::standard(),
        agents: vec![agent(100_000, 7 * SECOND), agent(-100_000, -3 * SECOND)],
        lobby_us,
        match_us,
        tail_us: 5 * SECOND,
        outages: blackouts.clone(),
        keep_turns: false,
        margin_quantile: cell.margin,
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
    if !row.kind.judged() {
        return "measured".to_string();
    }
    let agents = &row.outcome.agents;
    let checks = [
        (per10.iter().all(|&u| u <= 1.0), "underruns"),
        (
            agents
                .iter()
                .all(|a| a.choice.turns <= 3 && !a.choice.too_poor),
            "D > 3",
        ),
        (
            drains.iter().all(|d| d.is_some_and(|d| d <= 2 * SECOND)),
            "drain",
        ),
        (row.outcome.desync.is_none(), "desync"),
    ];
    let why: Vec<&str> = checks.iter().filter(|c| !c.0).map(|c| c.1).collect();
    if why.is_empty() {
        "pass".to_string()
    } else {
        format!("fail ({})", why.join(", "))
    }
}

fn worst(row: &Row, f: impl Fn(&sim::AgentOutcome) -> f64) -> f64 {
    row.outcome.agents.iter().map(f).fold(0.0, f64::max)
}

fn render_row(row: &Row) -> String {
    let agents = &row.outcome.agents;
    let per10: Vec<f64> = (0..agents.len())
        .map(|i| counted_underruns(row, i) as f64 * 10.0 / row.minutes)
        .collect();
    let depths: Vec<String> = agents
        .iter()
        .map(|a| {
            format!(
                "{}{}",
                a.choice.turns,
                if a.choice.too_poor { "!" } else { "" }
            )
        })
        .collect();
    let drains: Vec<Option<Micros>> = agents
        .iter()
        .flat_map(|a| a.drains.iter().copied())
        .collect();
    let arm = row.margin.map_or("D turns".to_string(), |q| {
        format!("D turns + p{:.0}−p5 margin", q * 100.0)
    });
    let per10_text: Vec<String> = per10.iter().map(|u| format!("{u:.2}")).collect();
    format!(
        "| {} | {} ms | {} | {} | {:.1e} | {} | {:.1} ms | {:.3}% | {} | {} | {} |\n",
        arm,
        row.rtt_ms,
        row.kind.label(),
        depths.join("/"),
        worst(row, |a| a.choice.predicted_late),
        per10_text.join("/"),
        worst(row, |a| a.stats.buffer_sum_us as f64
            / a.stats.fed.max(1) as f64
            / 1000.0),
        worst(row, |a| a.uneven_feeds as f64 / a.fed_count.max(1) as f64) * 100.0,
        worst_drain(&drains),
        row.outcome
            .desync
            .map_or("none".to_string(), |t| format!("turn {t}")),
        verdict(row, &per10, &drains),
    )
}

fn render(rows: &[Row]) -> String {
    let mut out = String::from(
        "| Depth | RTT | Loss | D (A/B) | Predicted late/turn | Underruns per 10 min (A/B) | Mean buffer | Uneven feeds | Worst drain | Desync | Bar |\n|---|---|---|---|---|---|---|---|---|---|---|\n",
    );
    for row in rows {
        out.push_str(&render_row(row));
    }
    out
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let minutes: f64 = args
        .iter()
        .position(|a| a == "--minutes")
        .and_then(|i| args.get(i + 1))
        .and_then(|m| m.parse().ok())
        .unwrap_or(60.0);
    if !args.iter().any(|a| a == "--grid") {
        eprintln!("usage: relay-bench --grid [--minutes N]");
        std::process::exit(2);
    }
    let kinds = [
        Kind::Clean,
        Kind::Independent(0.01),
        Kind::Independent(0.05),
        Kind::Burst(0.01, 2.0),
        Kind::Burst(0.05, 3.0),
        Kind::Blackout(0.01),
    ];
    let mut cells = Vec::new();
    for margin in [None, Some(0.95)] {
        for (r, rtt_ms) in [20, 100, 200].into_iter().enumerate() {
            for (k, kind) in kinds.into_iter().enumerate() {
                cells.push(Cell {
                    rtt_ms,
                    kind,
                    margin,
                    seed: 0x5eed_0000 + (r * 16 + k) as u64,
                });
            }
        }
    }
    let match_us = (minutes * 60.0 * SECOND as f64) as Micros;
    let handles: Vec<_> = cells
        .into_iter()
        .map(|cell| {
            thread::spawn(move || {
                let (s, blackouts) = scenario(&cell, match_us);
                Row {
                    margin: cell.margin,
                    rtt_ms: cell.rtt_ms,
                    kind: cell.kind,
                    minutes,
                    outcome: sim::run(&s),
                    blackouts,
                }
            })
        })
        .collect();
    let rows: Vec<Row> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    print!("{}", render(&rows));
}
