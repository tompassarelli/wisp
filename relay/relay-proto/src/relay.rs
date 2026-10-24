use std::collections::VecDeque;

use crate::cadence::Cadence;
use crate::transport::{Route, Transport};
use crate::wire::{
    self, Action, Down, Packet, Turn, WireError, MAX_PACKET, MAX_PACKETS_PER_TICK, MAX_TURN,
    NOT_STARTED, TURN_HEADER,
};
use crate::Micros;

pub const LAG_LIMIT_US: Micros = 1_000_000;
pub const MAX_COVER: u8 = 4;

#[derive(Debug)]
struct Player {
    token: u64,
    turn_ack: u32,
    next_action: u32,
    checksums: VecDeque<u32>,
    checksum_count: u32,
    packet_seq: u32,
    last_turn: Option<u32>,
    route: Route,
    cover: u8,
    cover_turns: u8,
    covers_sent: u8,
}

#[derive(Debug)]
struct Pending {
    action: Action,
    release: bool,
}

#[derive(Debug)]
pub struct Relay {
    cadence: Cadence,
    players: Vec<Player>,
    origin: Micros,
    base: Option<Micros>,
    next_probe: u64,
    next_turn: u32,
    log: VecDeque<Turn>,
    log_from: u32,
    pending: VecDeque<Pending>,
    stopped: Option<Micros>,
    stops: u32,
    running_since: Option<Micros>,
    compared: u32,
    desync: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RelayError {
    Wire(WireError),
    NotUp,
    UnknownToken,
}

impl Relay {
    pub fn new(cadence: Cadence, tokens: &[u64], origin: Micros) -> Self {
        assert!(!tokens.is_empty() && tokens.len() <= u8::MAX as usize);
        Relay {
            cadence,
            players: tokens
                .iter()
                .map(|&token| Player {
                    token,
                    turn_ack: 0,
                    next_action: 0,
                    checksums: VecDeque::new(),
                    checksum_count: 0,
                    packet_seq: 0,
                    last_turn: None,
                    route: Route::default(),
                    cover: 0,
                    cover_turns: 0,
                    covers_sent: 0,
                })
                .collect(),
            origin,
            base: None,
            next_probe: 0,
            next_turn: 0,
            log: VecDeque::new(),
            log_from: 0,
            pending: VecDeque::new(),
            stopped: None,
            stops: 0,
            running_since: None,
            compared: 0,
            desync: None,
        }
    }

    pub fn start(&mut self, now: Micros) {
        if self.base.is_none() {
            self.base = Some(now);
        }
    }

    pub fn turns_emitted(&self) -> u32 {
        self.next_turn
    }

    pub fn stops(&self) -> u32 {
        self.stops
    }

    pub fn running_since(&self) -> Option<Micros> {
        self.running_since
    }

    pub fn stopped(&self) -> bool {
        self.stopped.is_some()
    }

    pub fn desync(&self) -> Option<u32> {
        self.desync
    }

    pub fn checksums_compared(&self) -> u32 {
        self.compared
    }

    pub fn next_wake(&self) -> Micros {
        let main = self.main_wake();
        self.players
            .iter()
            .filter_map(|p| self.cover_due(p))
            .fold(main, Micros::min)
    }

    fn cover_due(&self, p: &Player) -> Option<Micros> {
        let base = self.base?;
        if self.stopped.is_some()
            || self.next_turn == 0
            || p.covers_sent >= p.cover
            || p.route.transport() == Transport::Tcp
        {
            return None;
        }
        let last = self.next_turn - 1;
        let step = self.cadence.step_ms(last) as Micros * 1000;
        let slots = p.cover as Micros + 1;
        Some(base + self.cadence.relay_time(last) + step * (p.covers_sent as Micros + 1) / slots)
    }

    fn main_wake(&self) -> Micros {
        let period = self.cadence.period_us();
        match (self.base, self.stopped) {
            (Some(_), Some(at)) => at + self.next_probe as Micros * period,
            (Some(base), None) => base + self.cadence.relay_time(self.next_turn),
            (None, _) => self.origin + self.next_probe as Micros * period,
        }
    }

    pub fn transport(&self, player: usize) -> Transport {
        self.players[player].route.transport()
    }

    pub fn on_packet(&mut self, bytes: &[u8]) -> Result<usize, RelayError> {
        self.on_packet_via(bytes, Transport::Udp)
    }

    pub fn on_packet_via(&mut self, bytes: &[u8], via: Transport) -> Result<usize, RelayError> {
        let up = match wire::decode(bytes).map_err(RelayError::Wire)? {
            Packet::Up(up) => up,
            _ => return Err(RelayError::NotUp),
        };
        let index = self
            .players
            .iter()
            .position(|p| p.token == up.token)
            .ok_or(RelayError::UnknownToken)?;
        let emitted = self.next_turn;
        let player = &mut self.players[index];
        player.route.hear(via, player.turn_ack);
        player.turn_ack = player.turn_ack.max(up.turn_ack.min(emitted));
        player.cover = up.cover.min(MAX_COVER);
        player.cover_turns = up.cover_turns;
        for (i, sent) in up.actions.into_iter().enumerate() {
            if up.action_from.wrapping_add(i as u32) == player.next_action
                && sent.data.len() <= wire::MAX_ACTION
            {
                self.pending.push_back(Pending {
                    action: Action {
                        player: index as u8,
                        seq: player.next_action,
                        data: sent.data,
                    },
                    release: sent.release,
                });
                player.next_action += 1;
            }
        }
        for (i, sum) in up.checksums.into_iter().enumerate() {
            if up.checksum_from.wrapping_add(i as u32) == player.checksum_count
                && player.checksum_count < emitted
            {
                player.checksums.push_back(sum);
                player.checksum_count += 1;
            }
        }
        self.compare_checksums();
        self.trim_log();
        Ok(index)
    }

    pub fn poll(&mut self, now: Micros) -> Vec<(usize, Vec<u8>)> {
        let mut out = Vec::new();
        for i in 0..self.players.len() {
            while self.cover_due(&self.players[i]).is_some_and(|t| t <= now) {
                self.players[i].covers_sent += 1;
                out.extend(self.cover_for(i).map(|b| (i, b)));
            }
        }
        if self.main_wake() > now {
            return out;
        }
        if self.stopped.is_some() && !self.lagging() && !self.awaiting_first_turn() {
            self.stopped = None;
            self.base = Some(now - self.cadence.relay_time(self.next_turn));
        }
        while self.base.is_some() && self.stopped.is_none() && self.main_wake() <= now {
            if self.awaiting_first_turn() {
                self.stopped = Some(now);
                self.next_probe = 0;
            } else if self.lagging() {
                self.stopped = Some(now);
                self.next_probe = 0;
                self.stops += 1;
            } else {
                if self.next_turn == 1 {
                    self.running_since = self.base;
                }
                self.emit_turn();
            }
        }
        while self.main_wake() <= now {
            self.next_probe += 1;
        }
        for i in 0..self.players.len() {
            out.extend(self.packets_for(i, now).into_iter().map(|b| (i, b)));
        }
        out
    }

    fn emit_turn(&mut self) {
        let mut turn = Turn {
            step_ms: self.cadence.step_ms(self.next_turn),
            actions: Vec::new(),
        };
        let index = self.next_turn;
        let mut size = TURN_HEADER;
        let mut held = vec![false; self.players.len()];
        let mut i = 0;
        while let Some(p) = self.pending.get(i) {
            let player = p.action.player as usize;
            if held[player] || (p.release && self.players[player].last_turn == Some(index)) {
                held[player] = true;
                i += 1;
                continue;
            }
            if size + p.action.wire_len() > MAX_TURN {
                break;
            }
            size += p.action.wire_len();
            self.players[player].last_turn = Some(index);
            turn.actions.push(self.pending.remove(i).unwrap().action);
        }
        self.log.push_back(turn);
        self.next_turn += 1;
        for p in &mut self.players {
            p.covers_sent = 0;
        }
    }

    fn cover_for(&mut self, index: usize) -> Option<Vec<u8>> {
        let p = &self.players[index];
        let from = p
            .turn_ack
            .max(self.log_from)
            .max(self.next_turn.saturating_sub(p.cover_turns as u32));
        if from >= self.next_turn {
            return None;
        }
        let (a, b) = self.log.as_slices();
        let turns: Vec<Turn> = a
            .iter()
            .chain(b)
            .skip((from - self.log_from) as usize)
            .cloned()
            .collect();
        let (bytes, _) = wire::encode_cover(p.token, p.packet_seq, from, &turns, MAX_PACKET);
        self.players[index].packet_seq = p.packet_seq.wrapping_add(1);
        Some(bytes)
    }

    fn awaiting_first_turn(&self) -> bool {
        self.next_turn > 0 && self.players.iter().any(|p| p.checksum_count == 0)
    }

    fn lagging(&self) -> bool {
        let emitted = self.cadence.relay_time(self.next_turn);
        self.players
            .iter()
            .any(|p| emitted - self.cadence.relay_time(p.checksum_count) > LAG_LIMIT_US)
    }

    fn packets_for(&mut self, index: usize, now: Micros) -> Vec<Vec<u8>> {
        let base_us = self.base.map_or(NOT_STARTED, |b| (b - self.origin) as u64);
        let log_from = self.log_from;
        let turns = self.log.make_contiguous();
        let p = &mut self.players[index];
        let mut from = p.route.floor(p.turn_ack.max(log_from));
        let mut out = Vec::new();
        loop {
            let head = Down {
                token: p.token,
                seq: p.packet_seq,
                sent_us: (now - self.origin) as u64,
                base_us,
                action_ack: p.next_action,
                checksum_ack: p.checksum_count,
                turn_from: from,
                turns: Vec::new(),
            };
            p.packet_seq = p.packet_seq.wrapping_add(1);
            let rest = &turns[(from - log_from) as usize..];
            let (bytes, n) = wire::encode_down(&head, rest, MAX_PACKET);
            out.push(bytes);
            from += n as u32;
            p.route.sent_to(from);
            if n == 0 || n == rest.len() || out.len() == MAX_PACKETS_PER_TICK {
                return out;
            }
        }
    }

    fn compare_checksums(&mut self) {
        while self
            .players
            .iter()
            .all(|p| p.checksum_count > self.compared)
        {
            let first = self.players[0].checksums.pop_front().unwrap();
            let mut same = true;
            for p in &mut self.players[1..] {
                same &= p.checksums.pop_front().unwrap() == first;
            }
            if !same && self.desync.is_none() {
                self.desync = Some(self.compared);
            }
            self.compared += 1;
        }
    }

    fn trim_log(&mut self) {
        let floor = self.players.iter().map(|p| p.turn_ack).min().unwrap_or(0);
        while self.log_from < floor {
            self.log.pop_front();
            self.log_from += 1;
        }
    }
}

#[cfg(test)]
mod tests;
