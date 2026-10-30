use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::hash::{BuildHasher, Hash, Hasher};
use std::net::{IpAddr, SocketAddr};

use relay_proto::cadence::Cadence;
use relay_proto::control::{self, Control, Refusal, KIND_PEER, MAX_PEERS, MIN_PEERS};
use relay_proto::relay::Relay;
use relay_proto::send_log::Line;
use relay_proto::lobby::{LobbyTiming, HOST_TIMING};
use relay_proto::stream::KIND_STREAM;
use relay_proto::transport::Transport;
use relay_proto::wire::{KIND_UP, KIND_UP_COVER};
use relay_proto::Micros;

use crate::game_room::GameRoom;
use crate::path::{bind, Path};
use crate::results::{self, Report};
use crate::room::{Body, Clocked, Room, Slot};

mod members;
mod turns;

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
    pub region: String,
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
            region: "unknown".to_string(),
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
    pub forwarded: u64,
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
    results: Vec<String>,
    sends: Option<Vec<Line>>,
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
            results: Vec::new(),
            sends: None,
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

    pub fn take_results(&mut self) -> Vec<String> {
        std::mem::take(&mut self.results)
    }

    pub fn record_sends(&mut self) {
        self.sends.get_or_insert_with(Vec::new);
    }

    pub fn take_sends(&mut self) -> Vec<Line> {
        self.sends.as_mut().map(std::mem::take).unwrap_or_default()
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
            .filter_map(|r| match &r.body {
                Body::Clocked(c) => Some(c),
                Body::Peer(_) => None,
            })
            .map(|c| {
                let turns = match (c.started, c.full_at) {
                    (false, Some(full)) => c.relay.next_wake().min(full + self.cfg.lobby_us),
                    _ => c.relay.next_wake(),
                };
                turns.min(c.game.next_wake())
            })
            .min()
    }

    pub fn on_datagram(&mut self, now: Micros, from: SocketAddr, bytes: &[u8], out: &mut Out) {
        self.on_packet(now, from.into(), bytes, out);
    }

    pub fn on_packet(&mut self, now: Micros, from: Peer, bytes: &[u8], out: &mut Out) {
        match control::kind(bytes) {
            Some(KIND_UP | KIND_UP_COVER) => self.on_up(now, from, bytes, out),
            Some(KIND_STREAM) => self.on_stream(now, from, bytes),
            Some(KIND_PEER) => self.on_peer(now, from, bytes, out),
            Some(k) if k > KIND_UP => {
                if let Ok(c) = control::decode(bytes) {
                    self.on_control(now, from, c, bytes.len() as u64, out);
                }
            }
            _ => {}
        }
    }

    fn on_control(&mut self, now: Micros, from: Peer, c: Control, bytes_len: u64, out: &mut Out) {
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
                let reply = self.create(now, from, request, players, false);
                out.push((from, reply));
            }
            Control::CreatePeer {
                cookie,
                request,
                players,
            } => {
                if !self.cookie_ok(from, cookie, now) {
                    let challenge = self.challenge(from, now);
                    out.push((from, challenge));
                    return;
                }
                let reply = self.create(now, from, request, players, true);
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
            Control::Verify { token, cookie } => self.on_verify(now, from, token, cookie),
            Control::Leave { token } => self.on_leave(now, token),
            Control::Result { token, winner, checksum, rtt_ms } => self.on_result(now, from, token, Report { winner, checksum, rtt_ms }, bytes_len, out),
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

    fn create(&mut self, now: Micros, from: Peer, request: u64, players: u8, peer: bool) -> Vec<u8> {
        let steps = if peer { Vec::new() } else { self.cfg.steps_ms.clone() };
        if let Some((&id, room)) = self
            .rooms
            .iter()
            .find(|(_, r)| r.slots[0].joined_by == Some((from, request)))
        {
            return room.reply(id, 0, request, &steps);
        }
        let allowed = if peer { MIN_PEERS..=MAX_PEERS } else { 1..=self.cfg.max_players };
        if !allowed.contains(&players) {
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
        let body = if peer {
            Body::Peer(vec![None; players as usize])
        } else {
            Body::Clocked(Clocked {
                relay: Relay::new(self.cadence.clone(), &tokens, now),
                game: GameRoom::new(seed, &tokens, self.cfg.game_timing),
                next_report: 0,
                full_at: (players == 1).then_some(now),
                started: false,
            })
        };
        let room = Room {
            body,
            slots,
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
        let Some(room) = self.rooms.get_mut(&id) else {
            return self.refuse(request, Refusal::NoRoom);
        };
        let steps = match room.body {
            Body::Clocked(_) => self.cfg.steps_ms.clone(),
            Body::Peer(_) => Vec::new(),
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
            room.full(now);
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
        if let Body::Clocked(c) = &mut room.body {
            c.game.on_stream(now, index, bytes);
        }
    }

    fn on_up(&mut self, now: Micros, from: Peer, bytes: &[u8], out: &mut Out) {
        let Some(&(id, index)) = control::token(bytes).and_then(|t| self.tokens.get(&t)) else {
            return;
        };
        let cookie = self.cookie(from, now);
        let room = self.rooms.get_mut(&id).unwrap();
        let slot = &mut room.slots[index];
        let Body::Clocked(clocked) = &mut room.body else {
            return;
        };
        if slot.left || slot.joined_by.is_none() {
            return;
        }
        room.heard = now;
        let path = bind(&mut slot.path, from, &mut self.stats.rebinds);
        if !path.verified {
            path.received += bytes.len() as u64;
        }
        let _ = clocked.relay.on_packet_via(bytes, from.via);
        if path.challenge(cookie, now, self.cfg.challenge_gap_us, out) {
            self.stats.challenges += 1;
        }
    }

    pub fn poll(&mut self, now: Micros, out: &mut Out) {
        let mut closing = Vec::new();
        for (&id, room) in &mut self.rooms {
            let mark = out.len();
            room.poll_game(id, now, self.cfg.lobby_us, &self.cadence, out, &mut self.log);
            if matches!(&room.body, Body::Clocked(c) if c.relay.next_wake() <= now) {
                turns::send_turns(room, id, now, out, &mut self.stats, self.sends.as_mut());
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
        self.stats.rooms_closed += 1;
        if let Body::Peer(reports) = &room.body {
            self.results.extend(results::line(id, &self.cfg.region, reports));
        }
        if let Body::Clocked(c) = &room.body {
            if c.started {
                self.log.push(c.report(id, now, &self.cadence));
            }
            self.stats.stops += c.relay.stops() as u64;
            if c.relay.desync().is_some() {
                self.stats.desyncs += 1;
            }
        }
    }
}
