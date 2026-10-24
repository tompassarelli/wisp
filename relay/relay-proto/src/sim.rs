use std::cmp::Reverse;
use std::collections::BinaryHeap;

use crate::agent::{Agent, AgentConfig, AgentStats, Fed};
use crate::cadence::Cadence;
use crate::depth::{DepthChoice, LinkSample};
pub use crate::histogram::Histogram;
use crate::relay::Relay;
use crate::net::{Clock, Link, Stream};
pub use crate::net::{Loss, Path};
use crate::rng::Rng;
use crate::transport::Transport;
use crate::wire::{self, Packet, Turn, UpAction};
use crate::Micros;

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
    pub echo: Histogram,
    pub bytes_down: u64,
    pub bytes_up: u64,
    pub transport: Transport,
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
                Event::ToAgent(i, bytes, Transport::Udp) => self.nodes[i].receive(self.now, &bytes),
                Event::ToAgent(i, bytes, Transport::Tcp) => {
                    for f in self.nodes[i].tcp_down.frames(&bytes) {
                        self.nodes[i].receive(self.now, &f);
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
                    n.out.stats = n.agent.stats().clone();
                    n.out.unacked_at_end = n.agent.unacked_actions();
                    n.out.transport = n.agent.transport();
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
    fn receive(&mut self, now: Micros, bytes: &[u8]) {
        self.note_arrivals(now, bytes);
        let local = self.clock.local(now);
        let _ = self.agent.on_packet(local, bytes);
    }

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
        self.sent_at.push(now);
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
        for a in &f.turn.actions {
            if a.player as usize == self.index && a.data.len() >= 5 {
                let count = u32::from_le_bytes([a.data[1], a.data[2], a.data[3], a.data[4]]);
                if let Some(&sent) = self.sent_at.get(count as usize) {
                    self.out.echo.add(now - sent);
                }
            }
        }
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
