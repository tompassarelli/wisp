use std::fs;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::io::{BufRead, BufReader, Read};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::process::{Child, Command, ExitCode, ExitStatus, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant};

use relay_agent::Link;
use relay_proto::cadence::Cadence;
use relay_proto::rng::Rng;
use relay_proto::sim::Histogram;
use relay_proto::wire::{self, Packet, Turn, UpAction};
use relay_proto::Micros;

const USAGE: &str =
    "usage: relay-native --relay PATH --port N --match-s S --out DIR [--seed N] [--label TEXT]";
const CLOCK_TICKS: u64 = 100;
const SLICE: Duration = Duration::from_millis(4);
const LOBBY: Duration = Duration::from_secs(20);
const TAIL: Duration = Duration::from_secs(3);
const ACTIONS_HZ: f64 = 4.0;
const ACTION_EXTRA: (i64, i64) = (4, 24);

struct Options {
    relay: PathBuf,
    port: u16,
    match_s: u64,
    out: PathBuf,
    seed: u64,
    label: String,
}

fn options(args: &[String]) -> Result<Options, String> {
    let value = |flag: &str| {
        args.iter()
            .position(|a| a == flag)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };
    let need = |flag: &str| value(flag).ok_or(format!("{flag} is required"));
    let number = |flag: &str, text: String| text.parse::<u64>().map_err(|e| format!("{flag}: {e}"));
    Ok(Options {
        relay: need("--relay")?.into(),
        port: number("--port", need("--port")?)? as u16,
        match_s: number("--match-s", need("--match-s")?)?,
        out: need("--out")?.into(),
        seed: value("--seed").map_or(Ok(36), |s| number("--seed", s))?,
        label: value("--label").unwrap_or_default(),
    })
}

fn digest(turn: &Turn) -> u32 {
    let mut h = DefaultHasher::new();
    turn.step_ms.hash(&mut h);
    for a in &turn.actions {
        (a.player, a.seq, &a.data).hash(&mut h);
    }
    h.finish() as u32
}

fn cpu_ticks(pid: u32) -> Option<u64> {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let fields: Vec<&str> = stat.rsplit_once(')')?.1.split_whitespace().collect();
    Some(fields.get(11)?.parse::<u64>().ok()? + fields.get(12)?.parse::<u64>().ok()?)
}

fn micros_between(later: Instant, earlier: Instant) -> Micros {
    match later.checked_duration_since(earlier) {
        Some(d) => d.as_micros() as Micros,
        None => -(earlier.duration_since(later).as_micros() as Micros),
    }
}

struct Outcome {
    slot: u8,
    depth_turns: u32,
    too_poor: bool,
    depth_us: Micros,
    max_depth_us: Micros,
    underruns: usize,
    underrun_at_s: Vec<f64>,
    fed: u64,
    delivery: Histogram,
    delivered: u64,
    missing: u64,
    min_one_way_us: Micros,
    actions: u64,
}

struct Agent {
    link: Link,
    shift: Micros,
    rng: Rng,
    arrived: Vec<Micros>,
    base_us: u64,
    min_one_way_us: Micros,
    next_action: Option<Instant>,
    actions: u64,
}

impl Agent {
    fn new(link: Link, seed: u64) -> Self {
        Agent {
            link,
            shift: 0,
            rng: Rng::new(seed),
            arrived: Vec::new(),
            base_us: u64::MAX,
            min_one_way_us: Micros::MAX,
            next_action: None,
            actions: 0,
        }
    }

    fn gap(&mut self) -> Duration {
        Duration::from_micros(self.rng.exp(1e6 / ACTIONS_HZ) as u64)
    }

    fn act(&mut self) {
        let mut data = vec![self.link.slot()];
        data.extend_from_slice(&(self.actions as u32).to_le_bytes());
        let extra = self.rng.range(ACTION_EXTRA.0, ACTION_EXTRA.1) as usize;
        data.extend((0..extra).map(|_| self.rng.next_u64() as u8));
        let release = self.rng.chance(0.5);
        if self.link.send_action(UpAction { release, data }).is_ok() {
            self.actions += 1;
        }
    }

    fn run(&mut self, room_origin: Instant, until: Instant, actions_end: Instant) {
        let shift = micros_between(self.link.origin(), room_origin);
        self.shift = shift;
        while Instant::now() < until {
            let arrived = &mut self.arrived;
            let base = &mut self.base_us;
            let min_one_way = &mut self.min_one_way_us;
            let fed = self
                .link
                .step_tapped(Instant::now() + SLICE, |at, bytes| {
                    let Ok(Packet::Down(d)) = wire::decode(bytes) else {
                        return;
                    };
                    *min_one_way = (*min_one_way).min(at + shift - d.sent_us as Micros);
                    if d.base_us != u64::MAX {
                        *base = d.base_us;
                    }
                    let end = d.turn_from as usize + d.turns.len();
                    if end > arrived.len() {
                        arrived.resize(end, Micros::MIN);
                    }
                    for got in &mut arrived[d.turn_from as usize..end] {
                        if *got == Micros::MIN {
                            *got = at + shift;
                        }
                    }
                })
                .expect("agent socket");
            for f in fed {
                self.link.record_checksum(digest(&f.turn));
            }
            let now = Instant::now();
            if self.link.agent().started() && now < actions_end {
                let next = match self.next_action {
                    Some(t) => t,
                    None => {
                        let t = now + self.gap();
                        self.next_action = Some(t);
                        t
                    }
                };
                if now >= next {
                    self.act();
                    self.next_action = Some(now + self.gap());
                }
            }
        }
    }

    fn outcome(&self, cadence: &Cadence, match_end_relay_us: Micros) -> Outcome {
        let agent = self.link.agent();
        let choice = agent.choice().cloned();
        let period = agent.period_us();
        let (depth_turns, too_poor, depth_us) = choice.as_ref().map_or((0, false, 0), |c| {
            (
                c.turns,
                c.too_poor,
                c.turns as Micros * period + c.link.margin_us,
            )
        });
        let stats = agent.stats();
        let mut delivery = Histogram::default();
        let (mut delivered, mut missing) = (0, 0);
        if self.base_us != u64::MAX {
            let base = self.base_us as Micros;
            let mut k = 0u32;
            loop {
                let emitted = base + cadence.relay_time(k);
                if emitted >= match_end_relay_us {
                    break;
                }
                match self.arrived.get(k as usize) {
                    Some(&got) if got != Micros::MIN => {
                        delivery.add(got - emitted);
                        delivered += 1;
                    }
                    _ => missing += 1,
                }
                k += 1;
            }
        }
        Outcome {
            slot: self.link.slot(),
            depth_turns,
            too_poor,
            depth_us,
            max_depth_us: depth_us + stats.max_extra_us,
            underruns: stats.underrun_at.len(),
            underrun_at_s: stats
                .underrun_at
                .iter()
                .map(|&t| (t + self.shift) as f64 / 1e6)
                .collect(),
            fed: stats.fed,
            delivery,
            delivered,
            missing,
            min_one_way_us: self.min_one_way_us,
            actions: self.actions,
        }
    }
}

fn ms(us: Micros) -> String {
    format!("{:.1}", us as f64 / 1000.0)
}

struct Relay {
    child: Child,
    pid: u32,
    origin: Instant,
    cpu_start: u64,
    first: String,
    rest: thread::JoinHandle<String>,
    opened: Receiver<Micros>,
}

impl Relay {
    fn start(o: &Options) -> Result<Relay, String> {
        let mut child = Command::new(&o.relay)
            .args(["--bind", &format!("127.0.0.1:{}", o.port), "--once"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("{}: {e}", o.relay.display()))?;
        let pid = child.id();
        let mut stdout = BufReader::new(child.stdout.take().unwrap());
        let mut first = String::new();
        let _ = stdout.read_line(&mut first);
        let origin = Instant::now();
        let cpu_start = cpu_ticks(pid).unwrap_or(0);
        if !first.starts_with("listening") {
            let _ = child.kill();
            return Err(format!("relay did not listen: {first}"));
        }
        let (tx, opened) = mpsc::channel();
        let rest = thread::spawn(move || {
            let mut s = String::new();
            for line in stdout.lines().map_while(Result::ok) {
                if let Some(t) = line
                    .split_once(" opened at ")
                    .map(|(_, t)| t)
                    .and_then(|r| r.strip_suffix(" us"))
                    .and_then(|t| t.parse().ok())
                {
                    let _ = tx.send(t);
                }
                s.push_str(&line);
                s.push('\n');
            }
            s
        });
        Ok(Relay {
            child,
            pid,
            origin,
            cpu_start,
            first,
            rest,
            opened,
        })
    }

    fn finish(mut self) -> (Option<ExitStatus>, String, String) {
        let deadline = Instant::now() + Duration::from_secs(15);
        let status = loop {
            if let Ok(Some(s)) = self.child.try_wait() {
                break Some(s);
            }
            if Instant::now() >= deadline {
                let _ = self.child.kill();
                break self.child.wait().ok();
            }
            thread::sleep(Duration::from_millis(50));
        };
        let out = format!("{}{}", self.first, self.rest.join().unwrap_or_default());
        let mut err = String::new();
        if let Some(mut e) = self.child.stderr.take() {
            let _ = e.read_to_string(&mut err);
        }
        (status, out, err)
    }
}

struct Cpu {
    match_pct: f64,
    total_pct: f64,
}

struct Played {
    agents: Vec<Agent>,
    actions_end: Instant,
    room_origin: Instant,
    cpu: Cpu,
}

fn core_pct(ticks: u64, wall: Duration) -> f64 {
    ticks as f64 / CLOCK_TICKS as f64 / wall.as_secs_f64() * 100.0
}

fn play(o: &Options, relay: &Relay) -> Played {
    let server: SocketAddr = ([127, 0, 0, 1], o.port).into();
    let host = Link::create(server, 2).expect("create room");
    let opened_us = relay
        .opened
        .recv_timeout(Duration::from_secs(2))
        .expect("room opened line");
    let room_origin = relay.origin + Duration::from_micros(opened_us as u64);
    let guest = Link::join(server, host.room()).expect("join room");
    let lobby_end = Instant::now() + LOBBY;
    let actions_end = lobby_end + Duration::from_secs(o.match_s);
    let until = actions_end + TAIL;
    let threads: Vec<_> = [host, guest]
        .into_iter()
        .enumerate()
        .map(|(i, link)| {
            let seed = o.seed * 16 + i as u64;
            thread::spawn(move || {
                let mut agent = Agent::new(link, seed);
                agent.run(room_origin, until, actions_end);
                agent
            })
        })
        .collect();
    thread::sleep(lobby_end.saturating_duration_since(Instant::now()));
    let start = (Instant::now(), cpu_ticks(relay.pid).unwrap_or(0));
    thread::sleep(actions_end.saturating_duration_since(Instant::now()));
    let end = (Instant::now(), cpu_ticks(relay.pid).unwrap_or(0));
    let agents: Vec<Agent> = threads.into_iter().map(|t| t.join().unwrap()).collect();
    for a in &agents {
        let _ = a.link.leave();
    }
    let cpu = Cpu {
        match_pct: core_pct(end.1 - start.1, end.0 - start.0),
        total_pct: core_pct(end.1 - relay.cpu_start, end.0 - relay.origin),
    };
    Played {
        agents,
        actions_end,
        room_origin,
        cpu,
    }
}

fn joined(outcomes: &[Outcome], f: impl Fn(&Outcome) -> String) -> String {
    outcomes.iter().map(f).collect::<Vec<_>>().join("/")
}

fn worst(outcomes: &[Outcome], f: impl Fn(&Outcome) -> Micros) -> Micros {
    outcomes.iter().map(f).max().unwrap_or(0)
}

fn row(label: &str, minutes: f64, outcomes: &[Outcome], cpu: &Cpu) -> String {
    let q = |p: f64| ms(worst(outcomes, |a| a.delivery.quantile(p)));
    format!(
        "| {label} | {}, {} ms | {} ms | {} ({}/10 min) | {}/{}/{} ms | {:.1}% |",
        joined(outcomes, |a| format!(
            "{}{}",
            a.depth_turns,
            if a.too_poor { "!" } else { "" }
        )),
        ms(worst(outcomes, |a| a.depth_us)),
        ms(worst(outcomes, |a| a.max_depth_us)),
        joined(outcomes, |a| a.underruns.to_string()),
        joined(outcomes, |a| format!(
            "{:.2}",
            a.underruns as f64 * 10.0 / minutes
        )),
        q(0.5),
        q(0.99),
        q(0.999),
        cpu.match_pct,
    )
}

fn agent_line(a: &Outcome) -> String {
    format!(
        "agent {} depth {}{} depth_ms {} max_depth_ms {} underruns {} fed {} delivered {} missing {} p50 {} p99 {} p999 {} min_one_way_ms {} actions {} underrun_at_s {:.3?}\n",
        a.slot,
        a.depth_turns,
        if a.too_poor { "!" } else { "" },
        ms(a.depth_us),
        ms(a.max_depth_us),
        a.underruns,
        a.fed,
        a.delivered,
        a.missing,
        ms(a.delivery.quantile(0.5)),
        ms(a.delivery.quantile(0.99)),
        ms(a.delivery.quantile(0.999)),
        ms(a.min_one_way_us),
        a.actions,
        a.underrun_at_s,
    )
}

fn run(o: &Options) -> Result<String, String> {
    fs::create_dir_all(&o.out).map_err(|e| format!("{}: {e}", o.out.display()))?;
    let relay = Relay::start(o)?;
    let pid = relay.pid;
    let played = play(o, &relay);
    let (status, relay_out, relay_err) = relay.finish();
    let match_end_relay_us = micros_between(played.actions_end, played.room_origin);
    let cadence = Cadence::new(&[8]);
    let outcomes: Vec<Outcome> = played
        .agents
        .iter()
        .map(|a| a.outcome(&cadence, match_end_relay_us))
        .collect();
    let stats = relay_out.lines().last().unwrap_or("");
    let mut summary = format!(
        "label {}\nmatch_s {}\nrelay_pid {pid}\nrelay_exit {status:?}\nrelay_stats {stats}\nrelay_cpu_match_pct {:.2}\nrelay_cpu_total_pct {:.2}\n",
        o.label, o.match_s, played.cpu.match_pct, played.cpu.total_pct
    );
    outcomes
        .iter()
        .for_each(|a| summary.push_str(&agent_line(a)));
    let minutes = o.match_s as f64 / 60.0;
    summary.push_str(&format!(
        "row {}\n",
        row(&o.label, minutes, &outcomes, &played.cpu)
    ));
    let write = |name: &str, text: &str| {
        fs::write(o.out.join(name), text).map_err(|e| format!("{name}: {e}"))
    };
    write("summary.txt", &summary)?;
    write("relay.out", &relay_out)?;
    write("relay.err", &relay_err)?;
    Ok(summary)
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let o = match options(&args) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("{e}\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    match run(&o) {
        Ok(summary) => {
            print!("{summary}");
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}
