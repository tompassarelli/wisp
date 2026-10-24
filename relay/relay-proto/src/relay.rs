use std::collections::VecDeque;

use crate::cadence::Cadence;
use crate::wire::{
    self, Action, Down, Packet, Turn, WireError, MAX_PACKET, MAX_PACKETS_PER_TICK, MAX_TURN,
    NOT_STARTED, TURN_HEADER,
};
use crate::Micros;

#[derive(Debug)]
struct Player {
    token: u64,
    turn_ack: u32,
    next_action: u32,
    checksums: VecDeque<u32>,
    checksum_count: u32,
    packet_seq: u32,
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
    pending: VecDeque<Action>,
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
        assert!(tokens.len() <= u8::MAX as usize);
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
                })
                .collect(),
            origin,
            base: None,
            next_probe: 0,
            next_turn: 0,
            log: VecDeque::new(),
            log_from: 0,
            pending: VecDeque::new(),
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

    pub fn desync(&self) -> Option<u32> {
        self.desync
    }

    pub fn checksums_compared(&self) -> u32 {
        self.compared
    }

    pub fn next_wake(&self) -> Micros {
        match self.base {
            Some(base) => base + self.cadence.relay_time(self.next_turn),
            None => self.origin + self.next_probe as Micros * self.cadence.period_us(),
        }
    }

    pub fn on_packet(&mut self, bytes: &[u8]) -> Result<usize, RelayError> {
        let up = match wire::decode(bytes).map_err(RelayError::Wire)? {
            Packet::Up(up) => up,
            Packet::Down(_) => return Err(RelayError::NotUp),
        };
        let index = self
            .players
            .iter()
            .position(|p| p.token == up.token)
            .ok_or(RelayError::UnknownToken)?;
        let emitted = self.next_turn;
        let player = &mut self.players[index];
        player.turn_ack = player.turn_ack.max(up.turn_ack.min(emitted));
        for (i, data) in up.actions.into_iter().enumerate() {
            if up.action_from.wrapping_add(i as u32) == player.next_action
                && data.len() <= wire::MAX_ACTION
            {
                self.pending.push_back(Action {
                    player: index as u8,
                    seq: player.next_action,
                    data,
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
        let mut due = false;
        while self.next_wake() <= now {
            due = true;
            match self.base {
                Some(_) => self.emit_turn(),
                None => self.next_probe += 1,
            }
        }
        if !due {
            return Vec::new();
        }
        let mut out = Vec::new();
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
        let mut size = TURN_HEADER;
        while let Some(a) = self.pending.front() {
            if size + a.wire_len() > MAX_TURN {
                break;
            }
            size += a.wire_len();
            turn.actions.push(self.pending.pop_front().unwrap());
        }
        self.log.push_back(turn);
        self.next_turn += 1;
    }

    fn packets_for(&mut self, index: usize, now: Micros) -> Vec<Vec<u8>> {
        let base_us = self.base.map_or(NOT_STARTED, |b| (b - self.origin) as u64);
        let log_from = self.log_from;
        let turns = self.log.make_contiguous();
        let p = &mut self.players[index];
        let mut from = p.turn_ack.max(log_from);
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
mod tests {
    use super::*;
    use crate::wire::{encode, Up};

    fn up(
        token: u64,
        turn_ack: u32,
        checksum_from: u32,
        checksums: Vec<u32>,
        action_from: u32,
        actions: Vec<Vec<u8>>,
    ) -> Vec<u8> {
        encode(&Packet::Up(Up {
            token,
            seq: 0,
            sent_us: 0,
            turn_ack,
            checksum_from,
            checksums,
            action_from,
            actions,
        }))
        .unwrap()
    }

    fn started() -> Relay {
        let mut r = Relay::new(Cadence::standard(), &[1, 2], 0);
        r.start(0);
        r.poll(Cadence::standard().relay_time(9));
        r
    }

    #[test]
    fn turns_are_due_on_absolute_deadlines() {
        let mut r = Relay::new(Cadence::standard(), &[1], 0);
        r.start(1_000);
        assert_eq!(r.poll(1_000).len(), 1);
        assert!(r.poll(17_999).is_empty());
        r.poll(1_000 + 51_000);
        assert_eq!(r.turns_emitted(), 4);
        assert_eq!(r.next_wake(), 1_000 + 67_000);
    }

    #[test]
    fn repeated_and_early_actions_enter_one_turn_once() {
        let mut r = started();
        r.on_packet(&up(1, 0, 0, vec![], 1, vec![vec![9]])).unwrap();
        r.on_packet(&up(1, 0, 0, vec![], 0, vec![vec![8], vec![9]]))
            .unwrap();
        r.on_packet(&up(1, 0, 0, vec![], 0, vec![vec![8], vec![9]]))
            .unwrap();
        r.poll(Cadence::standard().relay_time(10));
        let actions: Vec<_> = r.log.iter().flat_map(|t| t.actions.clone()).collect();
        assert_eq!(
            actions,
            vec![
                Action {
                    player: 0,
                    seq: 0,
                    data: vec![8]
                },
                Action {
                    player: 0,
                    seq: 1,
                    data: vec![9]
                }
            ]
        );
        assert_eq!(r.log.back().unwrap().actions.len(), 2);
    }

    #[test]
    fn the_first_differing_checksum_is_reported() {
        let mut r = started();
        r.on_packet(&up(1, 0, 0, vec![5, 6, 7], 0, vec![])).unwrap();
        r.on_packet(&up(2, 0, 0, vec![5, 6, 0], 0, vec![])).unwrap();
        assert_eq!(r.desync(), Some(2));
        assert_eq!(r.checksums_compared(), 3);
    }

    #[test]
    fn foreign_and_malformed_packets_are_refused() {
        let mut r = started();
        assert_eq!(
            r.on_packet(&up(3, 0, 0, vec![], 0, vec![])),
            Err(RelayError::UnknownToken)
        );
        assert_eq!(
            r.on_packet(&[0x57]),
            Err(RelayError::Wire(WireError::Short))
        );
    }

    #[test]
    fn acknowledged_turns_leave_the_log() {
        let mut r = started();
        r.on_packet(&up(1, 6, 0, vec![], 0, vec![])).unwrap();
        assert_eq!(r.log_from, 0);
        r.on_packet(&up(2, 4, 0, vec![], 0, vec![])).unwrap();
        assert_eq!(r.log_from, 4);
        r.on_packet(&up(2, 99, 0, vec![], 0, vec![])).unwrap();
        assert_eq!(r.log_from, 6);
    }
}
