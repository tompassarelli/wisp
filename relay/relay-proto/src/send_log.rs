use std::collections::HashMap;
use std::fmt;

use crate::trace::Trace;
use crate::wire::{self, Packet};
use crate::Micros;

pub const FORMAT: &str = "relay send log v1";
pub const LOSS_RUN_US: Micros = 100_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Sent {
    Down,
    Cover,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Line {
    Packet {
        sent: Sent,
        room: u64,
        slot: usize,
        seq: u32,
        newest: Option<u32>,
        at_us: Micros,
    },
    Stop {
        room: u64,
        at_us: Micros,
        slot: usize,
        behind_us: Micros,
    },
}

impl Line {
    pub fn packet(room: u64, slot: usize, bytes: &[u8], at_us: Micros) -> Option<Line> {
        let (sent, seq, turn_from, turns) = match wire::decode(bytes).ok()? {
            Packet::Down(d) => (Sent::Down, d.seq, d.turn_from, d.turns.len()),
            Packet::Cover(c) => (Sent::Cover, c.seq, c.turn_from, c.turns.len()),
            Packet::Up(_) => return None,
        };
        let newest = (turns as u32).checked_sub(1).map(|n| turn_from + n);
        Some(Line::Packet { sent, room, slot, seq, newest, at_us })
    }

    pub fn room(&self) -> u64 {
        match *self {
            Line::Packet { room, .. } | Line::Stop { room, .. } => room,
        }
    }
}

impl fmt::Display for Line {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match *self {
            Line::Packet { sent, room, slot, seq, newest, at_us } => {
                let kind = match sent {
                    Sent::Down => "down",
                    Sent::Cover => "cover",
                };
                let newest = newest.map_or("-".to_string(), |n| n.to_string());
                write!(f, "{kind} {room:016x} {slot} {seq} {newest} {at_us}")
            }
            Line::Stop { room, at_us, slot, behind_us } => {
                write!(f, "stop {room:016x} {at_us} lag {slot} {behind_us}")
            }
        }
    }
}

fn parse_line(line: &str) -> Result<Line, String> {
    let bad = || format!("bad send log line {line:?}");
    let fields: Vec<&str> = line.split(' ').collect();
    let room = |s: &str| u64::from_str_radix(s, 16).map_err(|_| bad());
    let int = |s: &str| s.parse::<i64>().map_err(|_| bad());
    match fields.as_slice() {
        [kind @ ("down" | "cover"), r, slot, seq, newest, at] => Ok(Line::Packet {
            sent: if *kind == "down" { Sent::Down } else { Sent::Cover },
            room: room(r)?,
            slot: int(slot)? as usize,
            seq: int(seq)? as u32,
            newest: match *newest {
                "-" => None,
                n => Some(int(n)? as u32),
            },
            at_us: int(at)?,
        }),
        ["stop", r, at, "lag", slot, behind] => Ok(Line::Stop {
            room: room(r)?,
            at_us: int(at)?,
            slot: int(slot)? as usize,
            behind_us: int(behind)?,
        }),
        _ => Err(bad()),
    }
}

pub fn parse(text: &str) -> Result<Vec<Line>, String> {
    text.lines().filter(|l| *l != FORMAT && !l.is_empty()).map(parse_line).collect()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    Route,
    Pause,
    Mixed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LossRun {
    pub first_turn: u32,
    pub turns: u32,
    pub length_us: Micros,
    pub due_us: Micros,
    pub sent: u32,
    pub on_time: u32,
    pub gap_us: Micros,
    pub verdict: Verdict,
}

struct Sends {
    downs: Vec<(Option<u32>, Micros)>,
    first_sent: HashMap<u32, Micros>,
}

impl Sends {
    fn new(lines: &[Line], room: u64, slot: usize) -> Sends {
        let downs: Vec<(Option<u32>, Micros)> = lines
            .iter()
            .filter_map(|l| match *l {
                Line::Packet { sent: Sent::Down, room: r, slot: s, newest, at_us, .. } if r == room && s == slot => {
                    Some((newest, at_us))
                }
                _ => None,
            })
            .collect();
        let mut first_sent = HashMap::new();
        for &(newest, at) in &downs {
            if let Some(n) = newest {
                first_sent.entry(n).or_insert(at);
            }
        }
        Sends { downs, first_sent }
    }

    fn anchor(&self, turn: u32) -> Option<(u32, Micros)> {
        self.first_sent.iter().filter(|(&n, _)| n < turn).max_by_key(|(&n, _)| n).map(|(&n, &t)| (n, t))
    }

    fn judge(&self, first_turn: u32, turns: u32, period: Micros) -> Option<LossRun> {
        let last = first_turn + turns - 1;
        let (anchor, anchor_at) = self.anchor(first_turn)?;
        let due = |t: u32| anchor_at + (t - anchor) as Micros * period;
        let late: Vec<Micros> = (first_turn..=last).filter_map(|t| self.first_sent.get(&t).map(|&at| at - due(t))).collect();
        let on_time = late.iter().filter(|&&l| l <= period).count() as u32;
        let until = self
            .downs
            .iter()
            .find(|(n, at)| *at >= anchor_at && n.is_some_and(|n| n > last))
            .map_or(Micros::MAX, |d| d.1);
        let times: Vec<Micros> = self.downs.iter().map(|d| d.1).filter(|&at| at >= anchor_at && at <= until).collect();
        let verdict = match on_time {
            n if n == turns => Verdict::Route,
            0 => Verdict::Pause,
            _ => Verdict::Mixed,
        };
        Some(LossRun {
            first_turn,
            turns,
            length_us: turns as Micros * period,
            due_us: due(first_turn),
            sent: late.len() as u32,
            on_time,
            gap_us: times.windows(2).map(|w| w[1] - w[0]).max().unwrap_or(0),
            verdict,
        })
    }
}

fn lost_spans(delays: &[Option<Micros>]) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut start = None;
    for (i, d) in delays.iter().chain([&Some(0)]).enumerate() {
        match (d, start) {
            (None, None) => start = Some(i),
            (Some(_), Some(s)) => {
                spans.push((s, i - s));
                start = None;
            }
            _ => {}
        }
    }
    spans
}

pub fn loss_runs(trace: &Trace, lines: &[Line], room: u64, slot: usize) -> Vec<LossRun> {
    let sends = Sends::new(lines, room, slot);
    let Some(&base) = sends.first_sent.keys().min() else {
        return Vec::new();
    };
    lost_spans(&trace.delays_us)
        .into_iter()
        .filter(|&(_, n)| n as Micros * trace.period_us >= LOSS_RUN_US)
        .filter_map(|(start, n)| sends.judge(base + start as u32, n as u32, trace.period_us))
        .collect()
}
