use std::cmp::Reverse;
use std::collections::BinaryHeap;

use crate::agent::{Agent, AgentConfig, AgentStats, Fed};
use crate::cadence::Cadence;
use crate::depth::{self, DepthChoice, LinkSample};
pub use crate::histogram::Histogram;
use crate::relay::Relay;
use crate::net::{Clock, Link, Stream};
pub use crate::net::{Loss, Path};
use crate::rng::Rng;
use crate::trace::Replay;
use crate::transport::Transport;
use crate::wire::{self, UpAction};
use crate::Micros;

mod frames;
mod node;

pub use frames::Frames;

#[derive(Clone, Debug)]
pub struct AgentSpec {
    pub down: Path,
    pub up: Path,
    pub drift_ppb: i64,
    pub clock_offset_us: Micros,
    pub actions_hz: f64,
    pub action_bytes: (usize, usize),
    pub releases: f64,
    pub udp_blocked: bool,
    pub down_replay: Option<Replay>,
    pub up_replay: Option<Replay>,
    pub fixed_depth_us: Option<Micros>,
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
    pub cover: bool,
    pub max_depth_us: Option<Micros>,
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
    pub echo: Histogram,
    pub bytes_down: u64,
    pub bytes_up: u64,
    pub transport: Transport,
    pub cover: u8,
    pub down_arrivals: Vec<(u32, Micros)>,
    pub frames: Frames,
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

enum Event {
    ToRelay(usize, Vec<u8>, Transport),
    ToAgent(usize, Vec<u8>, Transport),
}

struct Node {
    index: usize,
    agent: Agent,
    clock: Clock,
    down: Link,
    up: Link,
    tcp_down: Stream,
    tcp_up: Stream,
    rtt_us: Micros,
    udp_blocked: bool,
    rng: Rng,
    next_action: Micros,
    action_count: u32,
    last_feed: Option<Micros>,
    arrived: Vec<Micros>,
    sent_at: Vec<Micros>,
    out: AgentOutcome,
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
    let defaults = AgentConfig::new(token, s.cadence.clone());
    let cfg = AgentConfig {
        margin_quantile: s.margin_quantile,
        max_cover: if s.cover { defaults.max_cover } else { 0 },
        max_depth: s.max_depth_us.map_or(depth::max_turns(s.cadence.period_us()), |d| {
            (d / s.cadence.period_us()).max(1) as u32
        }),
        fixed_turns: spec.fixed_depth_us.map(|d| depth::whole_turns(d, s.cadence.period_us())),
        ..defaults
    };
    Node {
        index,
        agent: Agent::new(cfg, clock.local(0)),
        clock,
        down: Link::new(spec.down, spec.down_replay.clone(), rng.fork()),
        up: Link::new(spec.up, spec.up_replay.clone(), rng.fork()),
        tcp_down: Stream::default(),
        tcp_up: Stream::default(),
        rtt_us: spec.down.one_way_us + spec.up.one_way_us,
        udp_blocked: spec.udp_blocked,
        rng,
        next_action: if spec.actions_hz > 0.0 {
            first
        } else {
            Micros::MAX
        },
        action_count: 0,
        last_feed: None,
        arrived: Vec::new(),
        sent_at: Vec::new(),
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
            echo: Histogram::default(),
            bytes_down: 0,
            bytes_up: 0,
            transport: Transport::Udp,
            cover: 0,
            down_arrivals: Vec::new(),
            frames: Frames::new(clock.local(s.lobby_us), clock.local(s.lobby_us + s.match_us)),
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
                n.agent.choose_depth();
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
        let dupack_us = 3 * self.s.cadence.period_us();
        self.send_down(now, quiet, playing, dupack_us, packets);
        self.send_up(now, quiet, playing, dupack_us);
    }


    fn send_down(
        &mut self,
        now: Micros,
        quiet: bool,
        playing: bool,
        dupack_us: Micros,
        packets: Vec<(usize, Vec<u8>)>,
    ) {
        for (i, bytes) in packets {
            let via = self.relay.transport(i);
            let n = &mut self.nodes[i];
            let (at, bytes) = match via {
                Transport::Udp if n.udp_blocked => (None, bytes),
                Transport::Udp => (n.down.send(now, quiet, &self.s.outages), bytes),
                Transport::Tcp => {
                    let at = n.down.stream(
                        now,
                        quiet,
                        &self.s.outages,
                        n.rtt_us,
                        dupack_us,
                        &mut n.tcp_down.resume,
                    );
                    (Some(n.tcp_down.arrival(at)), wire::frame(&bytes))
                }
            };
            if playing {
                n.out.bytes_down += bytes.len() as u64;
            }
            if let Some(at) = at {
                self.push(at, Event::ToAgent(i, bytes, via));
            }
        }
    }

    fn send_up(&mut self, now: Micros, quiet: bool, playing: bool, dupack_us: Micros) {
        for i in 0..self.nodes.len() {
            let packets = self.nodes[i].step(now, self.s);
            let via = self.nodes[i].agent.transport();
            for bytes in packets {
                let n = &mut self.nodes[i];
                let (at, bytes) = match via {
                    Transport::Udp if n.udp_blocked => (None, bytes),
                    Transport::Udp => (n.up.send(now, quiet, &self.s.outages), bytes),
                    Transport::Tcp => {
                        let sent = now.max(*n.tcp_up.open_at.get_or_insert(now + n.rtt_us));
                        let at = n.up.stream(
                            sent,
                            quiet,
                            &self.s.outages,
                            n.rtt_us,
                            dupack_us,
                            &mut n.tcp_up.resume,
                        );
                        (Some(n.tcp_up.arrival(at)), wire::frame(&bytes))
                    }
                };
                if playing {
                    n.out.bytes_up += bytes.len() as u64;
                }
                if let Some(at) = at {
                    self.push(at, Event::ToRelay(i, bytes, via));
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
                Event::ToRelay(_, bytes, Transport::Udp) => {
                    let _ = self.relay.on_packet(&bytes);
                }
                Event::ToRelay(i, bytes, Transport::Tcp) => {
                    for f in self.nodes[i].tcp_up.frames(&bytes) {
                        let _ = self.relay.on_packet_via(&f, Transport::Tcp);
                    }
                }
                Event::ToAgent(i, bytes, Transport::Udp) => {
                    self.nodes[i].receive(self.now, &bytes, self.s.keep_turns)
                }
                Event::ToAgent(i, bytes, Transport::Tcp) => {
                    for f in self.nodes[i].tcp_down.frames(&bytes) {
                        self.nodes[i].receive(self.now, &f, self.s.keep_turns);
                    }
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
                    if let Some(c) = n.agent.choice() {
                        n.out.choice = c.clone();
                    }
                    n.out.stats = n.agent.stats().clone();
                    n.out.unacked_at_end = n.agent.unacked_actions();
                    n.out.transport = n.agent.transport();
                    n.out.cover = n.agent.cover();
                    n.out.frames.close();
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
