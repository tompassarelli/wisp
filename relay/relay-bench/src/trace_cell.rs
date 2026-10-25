use std::path::Path as FsPath;
use std::thread;

use relay_proto::sim::{self, Scenario};
use relay_proto::trace::{Replay, Trace};
use relay_proto::Micros;

use crate::{rate, render, scenario, Cell, Kind, Options, Row, SECOND};

const RESCAN_PEAK_US: Micros = 80_000;
const RESCAN_GAP_US: Micros = 500_000;
const RESCAN_PEAKS: usize = 15;
const CLIPPED_PEAKS: usize = 3;
const RAMP_FLOOR_US: Micros = 10_000;
const INDEPENDENT: [f64; 4] = [0.005, 0.01, 0.02, 0.05];

fn load(name: &str) -> Result<Trace, String> {
    let given = FsPath::new(name);
    let path = if given.exists() {
        given.to_path_buf()
    } else {
        FsPath::new(env!("CARGO_MANIFEST_DIR")).join(name)
    };
    let text = std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    Trace::parse(&text)
}

fn above(d: Option<Micros>, bar: Micros) -> bool {
    d.is_some_and(|d| d >= bar)
}

pub fn rescans(trace: &Trace) -> Vec<(usize, usize)> {
    let d = &trace.delays_us;
    let gap = (RESCAN_GAP_US / trace.period_us) as usize;
    let mut groups: Vec<Vec<usize>> = Vec::new();
    for p in (1..d.len()).filter(|&i| above(d[i], RESCAN_PEAK_US) && !above(d[i - 1], RESCAN_PEAK_US)) {
        match groups.last_mut() {
            Some(g) if p - g[g.len() - 1] <= gap => g.push(p),
            _ => groups.push(vec![p]),
        }
    }
    groups
        .into_iter()
        .filter(|g| {
            let clipped = g[0] <= gap || d.len() - g[g.len() - 1] <= gap;
            g.len() >= if clipped { CLIPPED_PEAKS } else { RESCAN_PEAKS }
        })
        .map(|g| {
            let mut end = g[g.len() - 1];
            while end < d.len() && above(d[end], RAMP_FLOOR_US) {
                end += 1;
            }
            (g[0], end)
        })
        .collect()
}

pub fn cut(trace: &Trace, windows: &[(usize, usize)]) -> Trace {
    Trace {
        delays_us: (0..trace.delays_us.len())
            .filter(|&i| !windows.iter().any(|&(a, b)| i >= a && i < b))
            .map(|i| trace.delays_us[i])
            .collect(),
        ..trace.clone()
    }
}

fn trace_scenario(cell: &Cell, o: &Options, trace: &Trace) -> Scenario {
    let replay_us = trace.delays_us.len() as Micros * trace.period_us;
    let (mut s, _) = scenario(cell, o, replay_us);
    let laptop = &mut s.agents[0];
    laptop.down.one_way_us = trace.rtt_us / 2;
    laptop.up.one_way_us = trace.rtt_us - trace.rtt_us / 2;
    laptop.down_replay = Some(Replay::new(trace, s.lobby_us));
    laptop.up_replay = Some(Replay::new(trace, s.lobby_us));
    laptop.fixed_depth_us = o.depth_us;
    laptop.raise_headroom_us = o.raise_headroom_us;
    s
}

fn run_rows(cells: Vec<(Cell, Scenario)>, period_us: Micros) -> Vec<Row> {
    thread::scope(|scope| {
        let handles: Vec<_> = cells
            .iter()
            .map(|(cell, s)| {
                scope.spawn(move || Row {
                    rtt_ms: cell.rtt_ms,
                    kind: cell.kind,
                    minutes: s.match_us as f64 / (60 * SECOND) as f64,
                    period_us,
                    outcome: sim::run(s),
                    blackouts: Vec::new(),
                    fixed_depth_us: s.agents[0].fixed_depth_us,
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap()).collect()
    })
}

fn describe(trace: &Trace, windows: &[(usize, usize)]) -> String {
    if windows.is_empty() {
        return "rescan windows: none\n".into();
    }
    let s = |i: usize| i as f64 * trace.period_us as f64 / SECOND as f64;
    let starts: Vec<String> = windows.iter().map(|w| format!("{:.1}", s(w.0))).collect();
    let lens: Vec<f64> = windows.iter().map(|w| s(w.1 - w.0)).collect();
    let mut gaps: Vec<usize> = windows.windows(2).map(|w| w[1].0 - w[0].0).collect();
    gaps.sort();
    let every = gaps.get(gaps.len() / 2).map_or(0.0, |&g| s(g));
    format!(
        "rescan windows: {} starting at {} s, median start to start {every:.2} s, {:.1}–{:.1} s long; {} of {} packets cut\n",
        windows.len(),
        starts.join(", "),
        lens.iter().cloned().fold(f64::INFINITY, f64::min),
        lens.iter().cloned().fold(0.0, f64::max),
        windows.iter().map(|w| w.1 - w.0).sum::<usize>(),
        trace.delays_us.len(),
    )
}

fn bytes_line(rows: &[Row]) -> String {
    let (traced, independent): (Vec<&Row>, Vec<&Row>) =
        rows.iter().partition(|r| matches!(r.kind, Kind::Trace(_)));
    let most = |f: fn(&sim::AgentOutcome) -> u64| {
        independent.iter().map(|r| rate(r, f)).max().unwrap_or(1).max(1) as f64
    };
    let (down, up) = (most(|a| a.bytes_down), most(|a| a.bytes_up));
    let ratios: Vec<String> = traced
        .iter()
        .map(|r| {
            format!(
                "{} {:.2}/{:.2}",
                r.kind.label(),
                rate(r, |a| a.bytes_down) as f64 / down,
                rate(r, |a| a.bytes_up) as f64 / up
            )
        })
        .collect();
    format!(
        "bytes/s down/up against the largest independent-loss cell at this RTT ({down}/{up}): {}\n",
        ratios.join("; ")
    )
}

pub fn main(o: &Options, name: &str, period_us: Micros) {
    let trace = load(name).unwrap_or_else(|e| {
        eprintln!("relay-bench: {e}");
        std::process::exit(2);
    });
    let windows = rescans(&trace);
    let rtt_ms = (trace.rtt_us as f64 / 1000.0).round() as i64;
    let cell = |kind, k: u64| Cell {
        rtt_ms,
        kind,
        seed: 0x5eed_7000 + k,
    };
    let mut cells = vec![(cell(Kind::Trace(false), 0), trace_scenario(&cell(Kind::Trace(false), 0), o, &trace))];
    if !windows.is_empty() {
        let c = cell(Kind::Trace(true), 1);
        let s = trace_scenario(&c, o, &cut(&trace, &windows));
        cells.push((c, s));
    }
    let match_us = trace.delays_us.len() as Micros * trace.period_us;
    for (k, p) in INDEPENDENT.into_iter().enumerate() {
        let c = cell(Kind::Independent(p), 2 + k as u64);
        let (s, _) = scenario(&c, o, match_us);
        cells.push((c, s));
    }
    let rows = run_rows(cells, period_us);
    print!("{}{}{}", render(&rows, true), describe(&trace, &windows), bytes_line(&rows));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_recorded_trace_has_a_rescan_every_40_s_and_nothing_else_cut() {
        let trace = load("traces/laptop-wifi-to-nexus-2026-10-25.trace").unwrap();
        let windows = rescans(&trace);
        let d = &trace.delays_us;
        let slot = |s: f64| (s * SECOND as f64 / trace.period_us as f64) as usize;

        assert_eq!(windows.len(), 16);
        assert_eq!(windows[0].0, slot(0.016));
        for w in windows.windows(2).skip(1) {
            assert!((slot(39.5)..slot(40.2)).contains(&(w[1].0 - w[0].0)), "{w:?}");
        }
        for &(start, end) in &windows {
            assert!(above(d[start], RESCAN_PEAK_US) && !above(d[end], RAMP_FLOOR_US));
            assert!(above(d[end - 1], RAMP_FLOOR_US));
        }
        let kept = cut(&trace, &windows);
        assert_eq!(kept.delays_us.len(), d.len() - 14_407);
        assert_eq!(kept.delays_us.iter().flatten().max(), Some(&254_797));
    }

    fn args(extra: &[&str]) -> Options {
        let mut a = vec!["--trace".to_string(), "t".to_string()];
        a.extend(extra.iter().map(|x| x.to_string()));
        crate::options(&a).unwrap()
    }

    #[test]
    fn depth_ms_fixes_the_laptop_only_in_microseconds() {
        assert_eq!(args(&[]).depth_us, None);
        let o = args(&["--depth-ms", "30"]);
        assert_eq!(o.depth_us, Some(30_000));
        let trace = load("traces/laptop-wifi-to-nexus-2026-10-25.trace").unwrap();
        let c = Cell { rtt_ms: 44, kind: Kind::Trace(false), seed: 1 };
        let s = trace_scenario(&c, &o, &trace);
        assert_eq!(s.agents[0].fixed_depth_us, Some(30_000));
        assert_eq!(s.agents[1].fixed_depth_us, None);
    }

    #[test]
    fn raise_headroom_ms_reaches_only_the_laptop_in_microseconds() {
        assert_eq!(args(&[]).raise_headroom_us, None);
        let o = args(&["--raise-headroom-ms", "32"]);
        assert_eq!(o.raise_headroom_us, Some(32_000));
        let trace = load("traces/laptop-wifi-to-nexus-2026-10-25.trace").unwrap();
        let c = Cell { rtt_ms: 44, kind: Kind::Trace(false), seed: 1 };
        let s = trace_scenario(&c, &o, &trace);
        assert_eq!(s.agents[0].raise_headroom_us, Some(32_000));
        assert_eq!(s.agents[1].raise_headroom_us, None);
    }

    #[test]
    fn a_fixed_row_says_so_and_only_trace_tables_get_frame_columns() {
        let o = args(&[]);
        let c = Cell { rtt_ms: 44, kind: Kind::Clean, seed: 1 };
        let (mut s, _) = scenario(&c, &o, 10 * SECOND);
        s.agents[0].fixed_depth_us = Some(30_000);
        let rows = run_rows(vec![(c, s)], 8_000);
        let row = render(&rows, true).lines().nth(2).unwrap().to_string();
        assert!(row.contains("| 4 fixed (30.0 ms rounded to 32.0 ms)/3, 32.0 ms |"), "{row}");
        assert_eq!(row.matches('|').count(), 22, "{row}");
        assert!(row.ends_with("| 0.00/0.00 | 0.00/0.00 |"), "{row}");
        let grid = render(&rows, false);
        assert!(grid.lines().all(|l| l.matches('|').count() == 13), "{grid}");
    }
}
