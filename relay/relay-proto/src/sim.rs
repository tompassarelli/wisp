use std::cmp::Reverse;
use std::collections::BinaryHeap;

use crate::agent::{Agent, AgentConfig, AgentStats, Fed};
use crate::cadence::Cadence;
use crate::depth::{DepthChoice, LinkSample};
use crate::relay::Relay;
use crate::rng::Rng;
use crate::wire::{self, Packet, Turn, UpAction};
use crate::Micros;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Loss {
    None,
    Independent(f64),
    Burst { loss: f64, mean_burst: f64 },
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Path {
    pub one_way_us: Micros,
    pub jitter_mean_us: f64,
    pub loss: Loss,
}

#[derive(Clone, Debug)]
pub struct AgentSpec {
    pub down: Path,
    pub up: Path,
    pub drift_ppb: i64,
    pub clock_offset_us: Micros,
    pub actions_hz: f64,
    pub action_bytes: (usize, usize),
    pub releases: f64,
}

#[derive(Clone, Debug)]
pub struct Scenario {
    pub seed: u64,
    pub cadence: Cadence,
    pub agents: Vec<AgentSpec>,
    pub lobby_us: Micros,
    pub match_us: Micros,
    pub tail_us: Micros,
    pub outages: Vec<(Micros, Micros)>,
    pub keep_turns: bool,
    pub margin_quantile: Option<f64>,
}

#[derive(Clone, Debug)]
pub struct AgentOutcome {
    pub choice: DepthChoice,
    pub fed_count: u64,
    pub fed_digest: u64,
    pub fed: Vec<Fed>,
    pub sent: Vec<UpAction>,
    pub stats: AgentStats,
    pub underruns: Vec<Micros>,
    pub drains: Vec<Option<Micros>>,
    pub uneven_feeds: u64,
    pub unacked_at_end: usize,
    pub delivery: Histogram,
    pub bytes_down: u64,
    pub bytes_up: u64,
}

#[derive(Clone, Debug, Default)]
pub struct Histogram {
    buckets: Vec<u64>,
    count: u64,
}

impl Histogram {
    pub const BUCKET_US: Micros = 100;
    const BUCKETS: usize = 50_000;

    pub fn add(&mut self, us: Micros) {
        if self.buckets.is_empty() {
            self.buckets = vec![0; Self::BUCKETS];
        }
        let i = (us.max(0) / Self::BUCKET_US) as usize;
        self.buckets[i.min(Self::BUCKETS - 1)] += 1;
        self.count += 1;
    }

    pub fn quantile(&self, q: f64) -> Micros {
        let rank = ((self.count as f64 * q).ceil() as u64).clamp(1, self.count.max(1));
        let mut seen = 0;
        for (i, &n) in self.buckets.iter().enumerate() {
            seen += n;
            if seen >= rank {
                return (i as Micros + 1) * Self::BUCKET_US;
            }
        }
        0
    }
}

#[derive(Clone, Debug)]
pub struct Outcome {
    pub agents: Vec<AgentOutcome>,
    pub turns_emitted: u32,
    pub desync: Option<u32>,
    pub stops: u32,
    pub checksums_compared: u32,
    pub match_start: Micros,
}

struct Link {
    path: Path,
    rng: Rng,
    bad: bool,
}

impl Link {
    fn new(path: Path, rng: Rng) -> Self {
        Link {
            path,
            rng,
            bad: false,
        }
    }

    fn send(&mut self, now: Micros, quiet: bool, outages: &[(Micros, Micros)]) -> Option<Micros> {
        let lost = match self.path.loss {
            Loss::None => false,
            Loss::Independent(p) => self.rng.chance(p),
            Loss::Burst { loss, mean_burst } => {
                let leave = 1.0 / mean_burst.max(1.0);
                let enter = loss * leave / (1.0 - loss).max(1e-9);
                self.bad = if self.bad {
                    !self.rng.chance(leave)
                } else {
                    self.rng.chance(enter)
                };
                self.bad
            }
        };
        let jitter = self.rng.exp(self.path.jitter_mean_us) as Micros;
        if quiet {
            return Some(now + self.path.one_way_us + jitter);
        }
        if lost || outages.iter().any(|&(a, b)| now >= a && now < b) {
            return None;
        }
        Some(now + self.path.one_way_us + jitter)
    }
}

#[derive(Clone, Copy)]
struct Clock {
    offset: Micros,
    ppb: i64,
}

impl Clock {
    fn local(self, t: Micros) -> Micros {
        self.offset + t + ((t as i128 * self.ppb as i128).div_euclid(1_000_000_000)) as Micros
    }

    fn true_time(self, local: Micros) -> Micros {
        let mut t = (((local - self.offset) as i128 * 1_000_000_000)
            / (1_000_000_000 + self.ppb as i128)) as Micros;
        while self.local(t) < local {
            t += 1;
        }
        while self.local(t - 1) >= local {
            t -= 1;
        }
        t
    }
}

enum Event {
    ToRelay(Vec<u8>),
    ToAgent(usize, Vec<u8>),
}

struct Node {
    index: usize,
    agent: Agent,
    clock: Clock,
    down: Link,
    up: Link,
    rng: Rng,
    next_action: Micros,
    action_count: u32,
    last_feed: Option<Micros>,
    arrived: Vec<Micros>,
    out: AgentOutcome,
}

pub fn digest_turn(prev: u64, index: u32, turn: &Turn) -> u64 {
    let mut h = prev ^ 0xcbf2_9ce4_8422_2325;
    let mut mix = |b: u8| {
        h ^= b as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
    };
    index.to_le_bytes().into_iter().for_each(&mut mix);
    mix(turn.step_ms);
    for a in &turn.actions {
        mix(a.player);
        a.seq.to_le_bytes().into_iter().for_each(&mut mix);
        a.data.iter().copied().for_each(&mut mix);
        mix(0xff);
    }
    h
}

struct Sim<'a> {
    s: &'a Scenario,
    relay: Relay,
    nodes: Vec<Node>,
    heap: BinaryHeap<Reverse<(Micros, u64, usize)>>,
    events: Vec<Option<Event>>,
    free: Vec<usize>,
    pushed: u64,
    emitted_at: Vec<Micros>,
    started: bool,
    now: Micros,
}

fn node(s: &Scenario, index: usize, token: u64, rng: &mut Rng) -> Node {
    let spec = &s.agents[index];
    let clock = Clock {
        offset: spec.clock_offset_us,
        ppb: spec.drift_ppb,
    };
    let mut rng = rng.fork();
    let first = s.lobby_us + rng.exp(1e6 / spec.actions_hz.max(1e-9)) as Micros;
    let cfg = AgentConfig {
        margin_quantile: s.margin_quantile,
        ..AgentConfig::new(token, s.cadence.clone())
    };
    Node {
        index,
        agent: Agent::new(cfg, clock.local(0)),
        clock,
        down: Link::new(spec.down, rng.fork()),
        up: Link::new(spec.up, rng.fork()),
        rng,
        next_action: if spec.actions_hz > 0.0 {
            first
        } else {
            Micros::MAX
        },
        action_count: 0,
        last_feed: None,
        arrived: Vec::new(),
        out: AgentOutcome {
            choice: LinkSample::default().choose(1, 0.0, 0),
            fed_count: 0,
            fed_digest: 0,
            fed: Vec::new(),
            sent: Vec::new(),
            stats: AgentStats::default(),
            underruns: Vec::new(),
            drains: vec![None; s.outages.len()],
            uneven_feeds: 0,
            unacked_at_end: 0,
            delivery: Histogram::default(),
            bytes_down: 0,
            bytes_up: 0,
        },
    }
}

pub fn run(s: &Scenario) -> Outcome {
    let mut rng = Rng::new(s.seed);
    let tokens: Vec<u64> = s.agents.iter().map(|_| rng.next_u64()).collect();
    let nodes = (0..s.agents.len())
        .map(|i| node(s, i, tokens[i], &mut rng))
        .collect();
    let mut sim = Sim {
        s,
        relay: Relay::new(s.cadence.clone(), &tokens, 0),
        nodes,
        heap: BinaryHeap::new(),
        events: Vec::new(),
        free: Vec::new(),
        pushed: 0,
        emitted_at: Vec::new(),
        started: false,
        now: 0,
    };
    let end = s.lobby_us + s.match_us + s.tail_us;
    loop {
        sim.now = sim.next_time(end).max(sim.now);
        if sim.now >= end {
            break;
        }
        sim.step();
    }
    sim.finish()
}

impl Sim<'_> {
    fn next_time(&self, end: Micros) -> Micros {
        let mut next = end.min(self.relay.next_wake());
        if !self.started {
            next = next.min(self.s.lobby_us);
        }
        if let Some(Reverse((t, _, _))) = self.heap.peek() {
            next = next.min(*t);
        }
        for n in &self.nodes {
            next = next
                .min(n.clock.true_time(n.agent.next_wake()))
                .min(n.next_action);
        }
        next
    }

    fn push(&mut self, at: Micros, event: Event) {
        let slot = self.free.pop().unwrap_or_else(|| {
            self.events.push(None);
            self.events.len() - 1
        });
        self.events[slot] = Some(event);
        self.heap.push(Reverse((at, self.pushed, slot)));
        self.pushed += 1;
    }

    fn step(&mut self) {
        let now = self.now;
        let quiet = now >= self.s.lobby_us + self.s.match_us;
        if !self.started && now >= self.s.lobby_us {
            for n in &mut self.nodes {
                n.out.choice = n.agent.choose_depth();
            }
            self.relay.start(now);
            self.started = true;
        }
        self.deliver();
        let playing = self.started && !quiet;
        let emitted = self.relay.turns_emitted();
        let packets = self.relay.poll(now);
        self.emitted_at
            .extend((emitted..self.relay.turns_emitted()).map(|_| {
                if playing {
                    now
                } else {
                    Micros::MIN
                }
            }));
        for (i, bytes) in packets {
            if playing {
                self.nodes[i].out.bytes_down += bytes.len() as u64;
            }
            if let Some(at) = self.nodes[i].down.send(now, quiet, &self.s.outages) {
                self.push(at, Event::ToAgent(i, bytes));
            }
        }
        for i in 0..self.nodes.len() {
            for bytes in self.nodes[i].step(now, self.s) {
                if playing {
                    self.nodes[i].out.bytes_up += bytes.len() as u64;
                }
                if let Some(at) = self.nodes[i].up.send(now, quiet, &self.s.outages) {
                    self.push(at, Event::ToRelay(bytes));
                }
            }
        }
    }

    fn deliver(&mut self) {
        while let Some(Reverse((t, _, slot))) = self.heap.peek().copied() {
            if t > self.now {
                break;
            }
            self.heap.pop();
            self.free.push(slot);
            match self.events[slot].take().unwrap() {
                Event::ToRelay(bytes) => {
                    let _ = self.relay.on_packet(&bytes);
                }
                Event::ToAgent(i, bytes) => {
                    self.nodes[i].note_arrivals(self.now, &bytes);
                    let local = self.nodes[i].clock.local(self.now);
                    let _ = self.nodes[i].agent.on_packet(local, &bytes);
                }
            }
        }
    }

    fn finish(self) -> Outcome {
        Outcome {
            turns_emitted: self.relay.turns_emitted(),
            desync: self.relay.desync(),
            stops: self.relay.stops(),
            checksums_compared: self.relay.checksums_compared(),
            match_start: self.s.lobby_us,
            agents: self
                .nodes
                .into_iter()
                .map(|mut n| {
                    n.out.stats = n.agent.stats().clone();
                    n.out.unacked_at_end = n.agent.unacked_actions();
                    for (&sent, &got) in self.emitted_at.iter().zip(&n.arrived) {
                        if sent != Micros::MIN && got != Micros::MIN {
                            n.out.delivery.add(got - sent);
                        }
                    }
                    n.out
                })
                .collect(),
        }
    }
}

impl Node {
    fn note_arrivals(&mut self, now: Micros, bytes: &[u8]) {
        let Ok(Packet::Down(d)) = wire::decode(bytes) else {
            return;
        };
        let end = d.turn_from as usize + d.turns.len();
        if end > self.arrived.len() {
            self.arrived.resize(end, Micros::MIN);
        }
        for got in &mut self.arrived[d.turn_from as usize..end] {
            if *got == Micros::MIN {
                *got = now;
            }
        }
    }

    fn step(&mut self, now: Micros, s: &Scenario) -> Vec<Vec<u8>> {
        if now >= self.next_action {
            self.act(now, s);
        }
        let before = self.agent.stats().underrun_at.len();
        let (fed, packets) = self.agent.poll(self.clock.local(now));
        for _ in before..self.agent.stats().underrun_at.len() {
            self.out.underruns.push(now);
        }
        for f in fed {
            self.record_feed(now, f, s, s.lobby_us);
        }
        packets
    }

    fn act(&mut self, now: Micros, s: &Scenario) {
        let spec = &s.agents[self.index];
        let mut data = vec![self.index as u8];
        data.extend_from_slice(&self.action_count.to_le_bytes());
        let extra =
            self.rng
                .range(spec.action_bytes.0 as i64, spec.action_bytes.1 as i64) as usize;
        data.extend((0..extra).map(|_| self.rng.next_u64() as u8));
        self.action_count += 1;
        let action = UpAction {
            release: self.rng.chance(spec.releases),
            data,
        };
        if s.keep_turns {
            self.out.sent.push(action.clone());
        }
        let _ = self.agent.send_action(self.clock.local(now), action);
        let gap = self.rng.exp(1e6 / spec.actions_hz) as Micros;
        let actions_end = s.lobby_us + s.match_us;
        self.next_action = if now + gap < actions_end {
            now + gap
        } else {
            Micros::MAX
        };
    }

    fn record_feed(&mut self, now: Micros, f: Fed, s: &Scenario, match_start: Micros) {
        self.out.fed_digest = digest_turn(self.out.fed_digest, f.index, &f.turn);
        self.out.fed_count += 1;
        self.agent.record_checksum(self.out.fed_digest as u32);
        if let Some(last) = self.last_feed {
            let step = s.cadence.step_ms(f.index.wrapping_sub(1)) as Micros * 1000;
            if ((now - last) - step).abs() > 2_000 {
                self.out.uneven_feeds += 1;
            }
        }
        self.last_feed = Some(now);
        let period = self.agent.period_us();
        for (k, &(_, outage_end)) in s.outages.iter().enumerate() {
            if self.out.drains[k].is_none()
                && now >= outage_end
                && outage_end > match_start
                && !self.agent.catching_up()
                && self.agent.extra_us() <= period
            {
                self.out.drains[k] = Some(now - outage_end);
            }
        }
        if s.keep_turns {
            self.out.fed.push(f);
        }
    }
}
