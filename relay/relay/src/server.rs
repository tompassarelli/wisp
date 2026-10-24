use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::hash::{BuildHasher, Hash, Hasher};
use std::net::{IpAddr, SocketAddr};

use relay_proto::cadence::Cadence;
use relay_proto::control::{self, Control, Refusal};
use relay_proto::relay::Relay;
use relay_proto::lobby::{LobbyTiming, HOST_TIMING};
use relay_proto::stream::KIND_STREAM;
use relay_proto::transport::Transport;
use relay_proto::wire::{KIND_UP, KIND_UP_COVER};
use relay_proto::Micros;

use crate::game_room::GameRoom;
use crate::path::{send_down, Delivery, Path};
use crate::room::{Room, Slot};

pub use crate::path::{Out, Peer, AMPLIFICATION};
pub use crate::room::REPORT_US;

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
    pub max_rooms: usize,
    pub slot_bytes: u64,
    pub game_timing: LobbyTiming,
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
            max_rooms: 128,
            slot_bytes: 256 << 20,
            game_timing: HOST_TIMING,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Stats {
    pub rooms_created: u64,
    pub rooms_closed: u64,
    pub rate_limited: u64,
    pub busy: u64,
    pub spent: u64,
    pub challenges: u64,
    pub rebinds: u64,
    pub verified: u64,
    pub trimmed: u64,
    pub withheld: u64,
    pub desyncs: u64,
    pub stops: u64,
}

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
    log: Vec<String>,
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
            log: Vec::new(),
        }
    }

    pub fn stats(&self) -> &Stats {
        &self.stats
    }

    pub fn rooms(&self) -> usize {
        self.rooms.len()
    }

    pub fn holds(&self, peer: Peer) -> bool {
        self.rooms
            .values()
            .flat_map(|r| &r.slots)
            .any(|s| !s.left && s.path.as_ref().is_some_and(|p| p.addr == peer))
    }

    pub fn take_log(&mut self) -> Vec<String> {
        std::mem::take(&mut self.log)
    }

    pub fn cookie(&self, peer: impl Into<Peer>, now: Micros) -> u64 {
        self.cookie_at(peer.into(), now.div_euclid(self.cfg.cookie_epoch_us))
    }

    fn cookie_at(&self, peer: Peer, epoch: Micros) -> u64 {
        let mut h = self.key.build_hasher();
        epoch.hash(&mut h);
        peer.addr.hash(&mut h);
        (peer.via == Transport::Tcp).hash(&mut h);
        h.finish() | 1
    }

    fn cookie_ok(&self, addr: Peer, cookie: u64, now: Micros) -> bool {
        let epoch = now.div_euclid(self.cfg.cookie_epoch_us);
        cookie != 0
            && (cookie == self.cookie_at(addr, epoch) || cookie == self.cookie_at(addr, epoch - 1))
    }

    fn challenge(&mut self, addr: Peer, now: Micros) -> Vec<u8> {
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
            .zip(self.rooms.values().map(|r| r.game.next_wake()))
            .map(|(a, b)| a.min(b))
            .min()
    }

    pub fn on_datagram(&mut self, now: Micros, from: SocketAddr, bytes: &[u8], out: &mut Out) {
        self.on_packet(now, from.into(), bytes, out);
    }

    pub fn on_packet(&mut self, now: Micros, from: Peer, bytes: &[u8], out: &mut Out) {
        match control::kind(bytes) {
            Some(KIND_UP | KIND_UP_COVER) => self.on_up(now, from, bytes, out),
            Some(KIND_STREAM) => self.on_stream(now, from, bytes),
            Some(k) if k > KIND_UP => {
                if let Ok(c) = control::decode(bytes) {
                    self.on_control(now, from, c, out);
                }
            }
            _ => {}
        }
    }

    fn on_control(&mut self, now: Micros, from: Peer, c: Control, out: &mut Out) {
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
                    self.close(id, now);
                }
            }
            _ => {}
        }
    }

    fn refuse(&mut self, request: u64, reason: Refusal) -> Vec<u8> {
        match reason {
            Refusal::RateLimited => self.stats.rate_limited += 1,
            Refusal::Busy => self.stats.busy += 1,
            _ => {}
        }
        control::encode(&Control::Refused { request, reason })
    }

    fn create(&mut self, now: Micros, from: Peer, request: u64, players: u8) -> Vec<u8> {
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
        if self.rooms.len() >= self.cfg.max_rooms {
            return self.refuse(request, Refusal::Busy);
        }
        let window = self.cfg.rate_window_us;
        let entry = self.creations.entry(from.addr.ip()).or_insert((now, 0));
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
        let seed = self.fresh_id() as u32 & 0x7fff_ffff;
        let room = Room {
            relay: Relay::new(self.cadence.clone(), &tokens, now),
            game: GameRoom::new(seed, &tokens, self.cfg.game_timing),
            next_report: 0,
            full_at: (players == 1).then_some(now),
            slots,
            started: false,
            heard: now,
            relayed: 0,
        };
        let reply = room.reply(id, 0, request, &steps);
        self.rooms.insert(id, room);
        self.stats.rooms_created += 1;
        self.log.push(format!("room {id:016x} opened at {now} us"));
        reply
    }

    fn join(&mut self, now: Micros, from: Peer, request: u64, id: u64) -> Vec<u8> {
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

    fn on_stream(&mut self, now: Micros, from: Peer, bytes: &[u8]) {
        let Some(&(id, index)) = control::token(bytes).and_then(|t| self.tokens.get(&t)) else {
            return;
        };
        let room = self.rooms.get_mut(&id).unwrap();
        if room.slots[index].path.as_ref().is_none_or(|p| p.addr != from) || room.slots[index].left {
            return;
        }
        room.heard = now;
        room.game.on_stream(now, index, bytes);
    }

    fn on_up(&mut self, now: Micros, from: Peer, bytes: &[u8], out: &mut Out) {
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
        let _ = room.relay.on_packet_via(bytes, from.via);
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
            let mark = out.len();
            room.poll_game(id, now, self.cfg.lobby_us, &self.cadence, out, &mut self.log);
            if room.relay.next_wake() <= now {
                for (index, bytes) in room.relay.poll(now) {
                    let slot = &mut room.slots[index];
                    if slot.left {
                        continue;
                    }
                    if let Some(path) = &mut slot.path {
                        match send_down(path, bytes, out) {
                            Delivery::Sent | Delivery::Undecodable => {}
                            Delivery::Trimmed => self.stats.trimmed += 1,
                            Delivery::Withheld => self.stats.withheld += 1,
                        }
                    }
                }
            }
            room.relayed += out[mark..].iter().map(|(_, b)| b.len() as u64).sum::<u64>();
            let budget = self.cfg.slot_bytes * room.slots.len() as u64;
            if room.relayed > budget {
                self.stats.spent += 1;
                self.log.push(format!("room {id:016x} closed: relayed {} bytes, over its {budget}-byte budget", room.relayed));
                closing.push(id);
            } else if now - room.heard >= self.cfg.idle_us {
                closing.push(id);
            }
        }
        for id in closing {
            self.close(id, now);
        }
        let window = self.cfg.rate_window_us;
        self.creations
            .retain(|_, &mut (start, _)| now - start < window);
    }

    fn close(&mut self, id: u64, now: Micros) {
        let Some(room) = self.rooms.remove(&id) else {
            return;
        };
        for slot in &room.slots {
            self.tokens.remove(&slot.token);
        }
        if room.started {
            self.log.push(room.report(id, now, &self.cadence));
        }
        self.stats.rooms_closed += 1;
        self.stats.stops += room.relay.stops() as u64;
        if room.relay.desync().is_some() {
            self.stats.desyncs += 1;
        }
    }
}

