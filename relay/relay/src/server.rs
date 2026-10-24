use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::hash::{BuildHasher, Hash, Hasher};
use std::net::{IpAddr, SocketAddr};

use relay_proto::cadence::Cadence;
use relay_proto::control::{self, Control, Refusal};
use relay_proto::relay::Relay;
use relay_proto::wire::{self, Down, Packet, DOWN_HEADER, KIND_UP, MAX_PACKET};
use relay_proto::Micros;

pub const AMPLIFICATION: u64 = 3;

#[derive(Clone, Debug)]
pub struct Config {
    pub steps_ms: Vec<u8>,
    pub lobby_us: Micros,
    pub idle_us: Micros,
    pub rooms_per_window: u32,
    pub rate_window_us: Micros,
    pub cookie_epoch_us: Micros,
    pub challenge_gap_us: Micros,
    pub max_players: u8,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            steps_ms: vec![8],
            lobby_us: 20_000_000,
            idle_us: 600_000_000,
            rooms_per_window: 6,
            rate_window_us: 60_000_000,
            cookie_epoch_us: 10_000_000,
            challenge_gap_us: 20_000,
            max_players: 24,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Stats {
    pub rooms_created: u64,
    pub rooms_closed: u64,
    pub rate_limited: u64,
    pub challenges: u64,
    pub rebinds: u64,
    pub verified: u64,
    pub trimmed: u64,
    pub withheld: u64,
    pub desyncs: u64,
    pub stops: u64,
}

#[derive(Debug)]
struct Path {
    addr: SocketAddr,
    verified: bool,
    received: u64,
    sent: u64,
    last_challenge: Option<Micros>,
}

impl Path {
    fn verified(addr: SocketAddr) -> Self {
        Path {
            addr,
            verified: true,
            received: 0,
            sent: 0,
            last_challenge: None,
        }
    }

    fn budget(&self) -> u64 {
        (AMPLIFICATION * self.received).saturating_sub(self.sent)
    }

    fn send(&mut self, bytes: Vec<u8>, out: &mut Vec<(SocketAddr, Vec<u8>)>) -> bool {
        if !self.verified {
            if bytes.len() as u64 > self.budget() {
                return false;
            }
            self.sent += bytes.len() as u64;
        }
        out.push((self.addr, bytes));
        true
    }
}

#[derive(Debug)]
struct Slot {
    token: u64,
    path: Option<Path>,
    joined_by: Option<(SocketAddr, u64)>,
    left: bool,
}

#[derive(Debug)]
struct Room {
    relay: Relay,
    slots: Vec<Slot>,
    full_at: Option<Micros>,
    started: bool,
    heard: Micros,
}

impl Room {
    fn reply(&self, room: u64, slot: usize, request: u64, steps: &[u8]) -> Vec<u8> {
        control::encode(&Control::Room {
            request,
            room,
            token: self.slots[slot].token,
            players: self.slots.len() as u8,
            slot: slot as u8,
            steps: steps.to_vec(),
        })
    }

    fn done(&self) -> bool {
        self.slots.iter().all(|s| s.left)
    }
}

pub type Out = Vec<(SocketAddr, Vec<u8>)>;

#[derive(Debug)]
pub struct Server {
    cfg: Config,
    cadence: Cadence,
    key: RandomState,
    fresh: u64,
    rooms: HashMap<u64, Room>,
    tokens: HashMap<u64, (u64, usize)>,
    creations: HashMap<IpAddr, (Micros, u32)>,
    stats: Stats,
}

impl Server {
    pub fn new(cfg: Config) -> Self {
        Server {
            cadence: Cadence::new(&cfg.steps_ms),
            cfg,
            key: RandomState::new(),
            fresh: 0,
            rooms: HashMap::new(),
            tokens: HashMap::new(),
            creations: HashMap::new(),
            stats: Stats::default(),
        }
    }

    pub fn stats(&self) -> &Stats {
        &self.stats
    }

    pub fn rooms(&self) -> usize {
        self.rooms.len()
    }

    pub fn cookie(&self, addr: SocketAddr, now: Micros) -> u64 {
        self.cookie_at(addr, now.div_euclid(self.cfg.cookie_epoch_us))
    }

    fn cookie_at(&self, addr: SocketAddr, epoch: Micros) -> u64 {
        let mut h = self.key.build_hasher();
        epoch.hash(&mut h);
        addr.hash(&mut h);
        h.finish() | 1
    }

    fn cookie_ok(&self, addr: SocketAddr, cookie: u64, now: Micros) -> bool {
        let epoch = now.div_euclid(self.cfg.cookie_epoch_us);
        cookie != 0
            && (cookie == self.cookie_at(addr, epoch) || cookie == self.cookie_at(addr, epoch - 1))
    }

    fn challenge(&mut self, addr: SocketAddr, now: Micros) -> Vec<u8> {
        self.stats.challenges += 1;
        control::encode(&Control::Challenge {
            cookie: self.cookie(addr, now),
        })
    }

    fn fresh_id(&mut self) -> u64 {
        loop {
            self.fresh += 1;
            let mut h = self.key.build_hasher();
            u64::MAX.hash(&mut h);
            self.fresh.hash(&mut h);
            let id = h.finish();
            if id != 0 && !self.rooms.contains_key(&id) && !self.tokens.contains_key(&id) {
                return id;
            }
        }
    }

    pub fn next_wake(&self) -> Option<Micros> {
        self.rooms
            .values()
            .map(|r| match (r.started, r.full_at) {
                (false, Some(full)) => r.relay.next_wake().min(full + self.cfg.lobby_us),
                _ => r.relay.next_wake(),
            })
            .min()
    }

    pub fn on_datagram(&mut self, now: Micros, from: SocketAddr, bytes: &[u8], out: &mut Out) {
        match control::kind(bytes) {
            Some(KIND_UP) => self.on_up(now, from, bytes, out),
            Some(k) if k > KIND_UP => {
                if let Ok(c) = control::decode(bytes) {
                    self.on_control(now, from, c, out);
                }
            }
            _ => {}
        }
    }

    fn on_control(&mut self, now: Micros, from: SocketAddr, c: Control, out: &mut Out) {
        match c {
            Control::Create {
                cookie,
                request,
                players,
            } => {
                if !self.cookie_ok(from, cookie, now) {
                    let challenge = self.challenge(from, now);
                    out.push((from, challenge));
                    return;
                }
                let reply = self.create(now, from, request, players);
                out.push((from, reply));
            }
            Control::Join {
                cookie,
                request,
                room,
            } => {
                if !self.cookie_ok(from, cookie, now) {
                    let challenge = self.challenge(from, now);
                    out.push((from, challenge));
                    return;
                }
                let reply = self.join(now, from, request, room);
                out.push((from, reply));
            }
            Control::Verify { token, cookie } => {
                if !self.cookie_ok(from, cookie, now) {
                    return;
                }
                let Some(&(room, slot)) = self.tokens.get(&token) else {
                    return;
                };
                let room = self.rooms.get_mut(&room).unwrap();
                room.heard = now;
                let slot = &mut room.slots[slot];
                match &mut slot.path {
                    Some(p) if p.addr == from && p.verified => {}
                    Some(p) if p.addr == from => {
                        p.verified = true;
                        self.stats.verified += 1;
                    }
                    _ => {
                        slot.path = Some(Path::verified(from));
                        self.stats.rebinds += 1;
                        self.stats.verified += 1;
                    }
                }
            }
            Control::Leave { token } => {
                let Some(&(id, slot)) = self.tokens.get(&token) else {
                    return;
                };
                let room = self.rooms.get_mut(&id).unwrap();
                room.slots[slot].left = true;
                if room.done() {
                    self.close(id);
                }
            }
            _ => {}
        }
    }

    fn refuse(&mut self, request: u64, reason: Refusal) -> Vec<u8> {
        if reason == Refusal::RateLimited {
            self.stats.rate_limited += 1;
        }
        control::encode(&Control::Refused { request, reason })
    }

    fn create(&mut self, now: Micros, from: SocketAddr, request: u64, players: u8) -> Vec<u8> {
        let steps = self.cfg.steps_ms.clone();
        if let Some((&id, room)) = self
            .rooms
            .iter()
            .find(|(_, r)| r.slots[0].joined_by == Some((from, request)))
        {
            return room.reply(id, 0, request, &steps);
        }
        if players == 0 || players > self.cfg.max_players {
            return self.refuse(request, Refusal::Players);
        }
        let window = self.cfg.rate_window_us;
        let entry = self.creations.entry(from.ip()).or_insert((now, 0));
        if now - entry.0 >= window {
            *entry = (now, 0);
        }
        if entry.1 >= self.cfg.rooms_per_window {
            return self.refuse(request, Refusal::RateLimited);
        }
        entry.1 += 1;
        let id = self.fresh_id();
        let mut slots = Vec::new();
        for i in 0..players as usize {
            let token = self.fresh_id();
            self.tokens.insert(token, (id, i));
            slots.push(Slot {
                token,
                path: None,
                joined_by: None,
                left: false,
            });
        }
        let tokens: Vec<u64> = slots.iter().map(|s| s.token).collect();
        slots[0].path = Some(Path::verified(from));
        slots[0].joined_by = Some((from, request));
        let room = Room {
            relay: Relay::new(self.cadence.clone(), &tokens, now),
            full_at: (players == 1).then_some(now),
            slots,
            started: false,
            heard: now,
        };
        let reply = room.reply(id, 0, request, &steps);
        self.rooms.insert(id, room);
        self.stats.rooms_created += 1;
        reply
    }

    fn join(&mut self, now: Micros, from: SocketAddr, request: u64, id: u64) -> Vec<u8> {
        let steps = self.cfg.steps_ms.clone();
        let Some(room) = self.rooms.get_mut(&id) else {
            return self.refuse(request, Refusal::NoRoom);
        };
        if let Some(i) = room
            .slots
            .iter()
            .position(|s| s.joined_by == Some((from, request)))
        {
            return room.reply(id, i, request, &steps);
        }
        let Some(i) = room.slots.iter().position(|s| s.joined_by.is_none()) else {
            return self.refuse(request, Refusal::Full);
        };
        room.slots[i].path = Some(Path::verified(from));
        room.slots[i].joined_by = Some((from, request));
        room.heard = now;
        if room.slots.iter().all(|s| s.joined_by.is_some()) {
            room.full_at = Some(now);
        }
        room.reply(id, i, request, &steps)
    }

    fn on_up(&mut self, now: Micros, from: SocketAddr, bytes: &[u8], out: &mut Out) {
        let Some(&(id, index)) = control::token(bytes).and_then(|t| self.tokens.get(&t)) else {
            return;
        };
        let cookie = self.cookie(from, now);
        let room = self.rooms.get_mut(&id).unwrap();
        let slot = &mut room.slots[index];
        if slot.left || slot.joined_by.is_none() {
            return;
        }
        room.heard = now;
        let path = match &mut slot.path {
            Some(p) if p.addr == from => p,
            _ => {
                self.stats.rebinds += 1;
                slot.path.insert(Path {
                    addr: from,
                    verified: false,
                    received: 0,
                    sent: 0,
                    last_challenge: None,
                })
            }
        };
        if !path.verified {
            path.received += bytes.len() as u64;
        }
        let _ = room.relay.on_packet(bytes);
        if !path.verified
            && path
                .last_challenge
                .is_none_or(|t| now - t >= self.cfg.challenge_gap_us)
        {
            let challenge = control::encode(&Control::Challenge { cookie });
            if path.send(challenge, out) {
                path.last_challenge = Some(now);
                self.stats.challenges += 1;
            }
        }
    }

    pub fn poll(&mut self, now: Micros, out: &mut Out) {
        let mut closing = Vec::new();
        for (&id, room) in &mut self.rooms {
            if !room.started && room.full_at.is_some_and(|t| now >= t + self.cfg.lobby_us) {
                room.relay.start(now);
                room.started = true;
            }
            if room.relay.next_wake() <= now {
                for (index, bytes) in room.relay.poll(now) {
                    let slot = &mut room.slots[index];
                    if slot.left {
                        continue;
                    }
                    if let Some(path) = &mut slot.path {
                        send_down(path, bytes, out, &mut self.stats);
                    }
                }
            }
            if now - room.heard >= self.cfg.idle_us {
                closing.push(id);
            }
        }
        for id in closing {
            self.close(id);
        }
        let window = self.cfg.rate_window_us;
        self.creations
            .retain(|_, &mut (start, _)| now - start < window);
    }

    fn close(&mut self, id: u64) {
        let Some(room) = self.rooms.remove(&id) else {
            return;
        };
        for slot in &room.slots {
            self.tokens.remove(&slot.token);
        }
        self.stats.rooms_closed += 1;
        self.stats.stops += room.relay.stops() as u64;
        if room.relay.desync().is_some() {
            self.stats.desyncs += 1;
        }
    }
}

fn send_down(path: &mut Path, bytes: Vec<u8>, out: &mut Out, stats: &mut Stats) {
    if path.verified || bytes.len() as u64 <= path.budget() {
        path.send(bytes, out);
        return;
    }
    let budget = path.budget().min(MAX_PACKET as u64) as usize;
    let Ok(Packet::Down(down)) = wire::decode(&bytes) else {
        return;
    };
    if budget < DOWN_HEADER {
        stats.withheld += 1;
        return;
    }
    let head = Down {
        turns: Vec::new(),
        ..down.clone()
    };
    let (trimmed, _) = wire::encode_down(&head, &down.turns, budget);
    stats.trimmed += 1;
    path.send(trimmed, out);
}
