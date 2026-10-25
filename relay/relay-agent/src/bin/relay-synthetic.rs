use std::collections::VecDeque;
use std::net::ToSocketAddrs;
use std::process::ExitCode;
use std::time::{Duration, Instant};

use relay_agent::{Link, Tuning};
use relay_proto::rng::Rng;
use relay_proto::trace::Trace;
use relay_proto::wire::{Turn, UpAction};
use relay_proto::Micros;

const USAGE: &str = "relay-synthetic --relay HOST:PORT --seconds N (--create PLAYERS | --join ROOM) [--rebind-at SECONDS] [--trace FILE] [--raise-headroom-ms N] [--max-total-depth-ms N]";
const SLICE: Duration = Duration::from_millis(1);
const LATE_WAKE: Duration = Duration::from_millis(4);
const SCHEDULING_US: Micros = 100_000;
const ACTION_EVERY: u32 = 31;
const REPORT_EVERY_US: Micros = 30_000_000;

struct Options {
    relay: String,
    seconds: u64,
    create: Option<u8>,
    join: Option<u64>,
    rebind_at: Option<u64>,
    trace: Option<String>,
    tuning: Tuning,
}

fn flag<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).map(String::as_str)
}

fn millis(args: &[String], name: &str) -> Result<Option<Micros>, String> {
    flag(args, name).map(|n| n.parse::<u32>().map(|ms| Micros::from(ms) * 1000).map_err(|e| format!("{name}: {e}"))).transpose()
}

fn options(args: &[String]) -> Result<Options, String> {
    let number = |name: &str| flag(args, name).map(|v| v.parse::<u64>().map_err(|e| format!("{name}: {e}"))).transpose();
    let o = Options {
        relay: flag(args, "--relay").ok_or(USAGE)?.to_string(),
        seconds: number("--seconds")?.ok_or(USAGE)?,
        create: flag(args, "--create").map(|n| n.parse().map_err(|e| format!("--create: {e}"))).transpose()?,
        join: flag(args, "--join").map(|r| u64::from_str_radix(r, 16).map_err(|e| format!("--join: {e}"))).transpose()?,
        rebind_at: number("--rebind-at")?,
        trace: flag(args, "--trace").map(str::to_string),
        tuning: Tuning { raise_headroom_us: millis(args, "--raise-headroom-ms")?, max_total_depth_us: millis(args, "--max-total-depth-ms")? },
    };
    if o.create.is_some() == o.join.is_some() {
        return Err(USAGE.into());
    }
    Ok(o)
}

fn digest(turn: &Turn) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    let mut eat = |bytes: &[u8]| {
        for &b in bytes {
            h = (h ^ u32::from(b)).wrapping_mul(0x0100_0193);
        }
    };
    eat(&[turn.step_ms]);
    for a in &turn.actions {
        eat(&[a.player]);
        eat(&a.seq.to_le_bytes());
        eat(&(a.data.len() as u32).to_le_bytes());
        eat(&a.data);
    }
    h
}

fn ms(us: Micros) -> f64 {
    us as f64 / 1000.0
}

fn quantile(sorted: &[Micros], q: f64) -> Micros {
    if sorted.is_empty() {
        return 0;
    }
    sorted[((sorted.len() as f64 * q).ceil() as usize).clamp(1, sorted.len()) - 1]
}

fn spread(samples: &[Micros]) -> String {
    let mut s = samples.to_vec();
    s.sort_unstable();
    format!(
        "p50 {:.1} p90 {:.1} p99 {:.1} max {:.1} ms (n {})",
        ms(quantile(&s, 0.5)),
        ms(quantile(&s, 0.9)),
        ms(quantile(&s, 0.99)),
        ms(quantile(&s, 1.0)),
        s.len()
    )
}

fn summarize_trace(trace: &Trace) -> String {
    let delays: Vec<Micros> = trace.delays_us.iter().flatten().copied().collect();
    let lost = trace.delays_us.len() - delays.len();
    let mut longest = 0;
    let mut run = 0;
    for d in &trace.delays_us {
        run = if d.is_none() { run + 1 } else { 0 };
        longest = longest.max(run);
    }
    format!(
        "trace: packets {} lost {} ({:.3}%) longest loss run {} delay above floor {}",
        trace.delays_us.len(),
        lost,
        lost as f64 * 100.0 / trace.delays_us.len().max(1) as f64,
        longest,
        spread(&delays)
    )
}

fn connect(o: &Options) -> std::io::Result<Link> {
    let server = o
        .relay
        .to_socket_addrs()?
        .next()
        .ok_or_else(|| std::io::Error::other(format!("{} has no address", o.relay)))?;
    match (o.create, o.join) {
        (Some(players), _) => Link::create_tuned(server, players, o.tuning),
        (_, Some(room)) => Link::join_tuned(server, room, o.tuning),
        _ => unreachable!(),
    }
}

struct Run {
    link: Link,
    rng: Rng,
    started: Option<Micros>,
    sent: u64,
    pending: VecDeque<(u64, Micros)>,
    rtts: Vec<Micros>,
    window_rtts: Vec<Micros>,
    late_wakes: Vec<Micros>,
    max_late: Duration,
    fed_count: u64,
    rebound: bool,
    arrivals: Vec<(u32, Micros)>,
    next_report: Micros,
}

impl Run {
    fn new(link: Link) -> Run {
        Run {
            rng: Rng::new(link.token()),
            link,
            started: None,
            sent: 0,
            pending: VecDeque::new(),
            rtts: Vec::new(),
            window_rtts: Vec::new(),
            late_wakes: Vec::new(),
            max_late: Duration::ZERO,
            fed_count: 0,
            rebound: false,
            arrivals: Vec::new(),
            next_report: 0,
        }
    }

    fn tick(&mut self, o: &Options) -> std::io::Result<bool> {
        let until = Instant::now() + SLICE;
        let fed = self.link.step(until)?;
        let late = Instant::now().saturating_duration_since(until);
        let now = self.link.now();
        if self.started.is_some() && late > LATE_WAKE {
            self.late_wakes.push(now);
            self.max_late = self.max_late.max(late);
        }
        for f in &fed {
            self.feed(f.index, &f.turn, now, o)?;
        }
        let acked = self.sent - self.link.agent().unacked_actions() as u64;
        while self.pending.front().is_some_and(|p| p.0 < acked) {
            let (_, at) = self.pending.pop_front().unwrap();
            self.rtts.push(now - at);
            self.window_rtts.push(now - at);
        }
        self.arrivals.extend(self.link.take_arrivals());
        let Some(start) = self.started else {
            return Ok(false);
        };
        if o.rebind_at.is_some_and(|at| !self.rebound && now - start >= at as Micros * 1_000_000) {
            self.rebind(now - start)?;
        }
        if now >= self.next_report {
            self.report(now - start);
        }
        Ok(now - start >= o.seconds as Micros * 1_000_000)
    }

    fn feed(&mut self, index: u32, turn: &Turn, now: Micros, o: &Options) -> std::io::Result<()> {
        self.link.record_checksum(digest(turn));
        self.fed_count += 1;
        if self.started.is_none() {
            self.started = Some(now);
            self.next_report = now + REPORT_EVERY_US;
            if o.trace.is_some() {
                self.link.record_arrivals();
            }
            println!("playing: depth {} turns", self.link.agent().choice().map_or(0, |c| c.turns));
        }
        let slot = self.link.slot();
        if (index + u32::from(slot) * 15).is_multiple_of(ACTION_EVERY) {
            let mut data = vec![slot];
            data.extend((0..self.rng.range(3, 23)).map(|_| self.rng.below(256) as u8));
            let release = self.rng.chance(0.5);
            self.link
                .send_action(UpAction { release, data })
                .map_err(|e| std::io::Error::other(format!("{e:?}")))?;
            self.pending.push_back((self.sent, now));
            self.sent += 1;
        }
        Ok(())
    }

    fn rebind(&mut self, elapsed: Micros) -> std::io::Result<()> {
        let old = self.link.local_addr()?.port();
        self.link.rebind()?;
        self.rebound = true;
        println!(
            "rebind at {:.3} s: local port {old} -> {}, underruns so far {}",
            ms(elapsed) / 1000.0,
            self.link.local_addr()?.port(),
            self.link.agent().stats().underrun_at.len()
        );
        Ok(())
    }

    fn report(&mut self, elapsed: Micros) {
        println!(
            "{:.0} s fed {} underruns {} late wakes {} ack rtt {}",
            ms(elapsed) / 1000.0,
            self.fed_count,
            self.link.agent().stats().underrun_at.len(),
            self.late_wakes.len(),
            spread(&self.window_rtts)
        );
        self.window_rtts.clear();
        self.next_report += REPORT_EVERY_US;
    }

    fn finish(mut self, o: &Options, handshake: Duration) -> std::io::Result<()> {
        self.link.leave()?;
        let start = self.started.unwrap_or_default();
        let agent = self.link.agent();
        let underruns = &agent.stats().underrun_at;
        let scheduling = underruns
            .iter()
            .filter(|&&u| self.late_wakes.iter().any(|&w| (u - w).abs() <= SCHEDULING_US))
            .count();
        let at: Vec<String> = underruns.iter().map(|&u| format!("{:.3}", ms(u - start) / 1000.0)).collect();
        println!("underruns at s: [{}]", at.join(", "));
        println!(
            "summary: fed {} underruns {} (within {} ms of the agent's own late wake: {scheduling}) late wakes over {} ms {} (max {:.1} ms) depth {} turns max extra {:.1} ms challenges {} rebound {}",
            self.fed_count,
            underruns.len(),
            SCHEDULING_US / 1000,
            LATE_WAKE.as_millis(),
            self.late_wakes.len(),
            self.max_late.as_secs_f64() * 1000.0,
            agent.choice().map_or(0, |c| c.turns),
            ms(agent.stats().max_extra_us),
            self.link.challenges(),
            self.rebound,
        );
        println!("rtt: handshake {:.1} ms per round trip; action ack {}", handshake.as_secs_f64() * 500.0, spread(&self.rtts));
        if let Some(path) = &o.trace {
            self.rtts.sort_unstable();
            let trace = Trace::from_arrivals(agent.period_us(), quantile(&self.rtts, 0.5), &self.arrivals);
            std::fs::write(path, trace.render())?;
            println!("{}", summarize_trace(&trace));
        }
        Ok(())
    }
}

fn play(o: &Options) -> std::io::Result<()> {
    let begun = Instant::now();
    let link = connect(o)?;
    let handshake = begun.elapsed();
    println!(
        "room {:016x} slot {} players {} local port {} handshake {:.1} ms (two round trips)",
        link.room(),
        link.slot(),
        link.players(),
        link.local_addr()?.port(),
        handshake.as_secs_f64() * 1000.0
    );
    let mut run = Run::new(link);
    while !run.tick(o)? {}
    run.finish(o, handshake)
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let o = match options(&args) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::from(2);
        }
    };
    match play(&o) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("relay-synthetic: {}: {e}", o.relay);
            ExitCode::FAILURE
        }
    }
}
