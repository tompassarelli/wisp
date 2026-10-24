use std::collections::VecDeque;

use crate::cadence::Cadence;
use crate::transport::{Route, Transport};
use crate::wire::{
    self, Action, Down, Packet, Turn, WireError, MAX_PACKET, MAX_PACKETS_PER_TICK, MAX_TURN,
    NOT_STARTED, TURN_HEADER,
};
use crate::Micros;

pub const LAG_LIMIT_US: Micros = 1_000_000;

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
            Packet::Down(_) => return Err(RelayError::NotUp),
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
        if self.next_wake() > now {
            return Vec::new();
        }
        if self.stopped.is_some() && !self.lagging() {
            self.stopped = None;
            self.base = Some(now - self.cadence.relay_time(self.next_turn));
        }
        while self.base.is_some() && self.stopped.is_none() && self.next_wake() <= now {
            if self.lagging() {
                self.stopped = Some(now);
                self.next_probe = 0;
                self.stops += 1;
            } else {
                self.emit_turn();
            }
        }
        while self.next_wake() <= now {
            self.next_probe += 1;
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
mod tests {
    use super::*;
    use crate::wire::{decode, encode, Up, UpAction};

    fn up(
        token: u64,
        turn_ack: u32,
        checksum_from: u32,
        checksums: Vec<u32>,
        action_from: u32,
        actions: Vec<UpAction>,
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

    fn acts(data: &[u8]) -> Vec<UpAction> {
        data.iter()
            .map(|&b| UpAction {
                release: false,
                data: vec![b],
            })
            .collect()
    }

    fn turn_of(r: &Relay, player: u8, data: u8) -> usize {
        r.log
            .iter()
            .position(|t| {
                t.actions
                    .iter()
                    .any(|a| a.player == player && a.data == [data])
            })
            .unwrap()
    }

    fn started() -> Relay {
        let mut r = Relay::new(Cadence::default(), &[1, 2], 0);
        r.start(0);
        r.poll(Cadence::default().relay_time(9));
        r
    }

    #[test]
    fn a_player_heard_over_tcp_is_answered_over_tcp_in_the_same_room() {
        let mut r = started();
        r.on_packet(&up(1, 0, 0, vec![], 0, acts(&[1]))).unwrap();
        r.on_packet_via(&up(2, 0, 0, vec![], 0, acts(&[2])), Transport::Tcp)
            .unwrap();
        r.on_packet_via(&up(2, 0, 0, vec![], 1, vec![]), Transport::Udp)
            .unwrap();
        assert_eq!(r.transport(0), Transport::Udp);
        assert_eq!(r.transport(1), Transport::Tcp);
        r.poll(Cadence::default().relay_time(10));
        assert_eq!(turn_of(&r, 0, 1), turn_of(&r, 1, 2));
    }

    #[test]
    fn turns_are_due_on_absolute_deadlines() {
        let mut r = Relay::new(Cadence::new(&[17, 17, 16]), &[1], 0);
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
        r.on_packet(&up(1, 0, 0, vec![], 1, acts(&[9]))).unwrap();
        r.on_packet(&up(1, 0, 0, vec![], 0, acts(&[8, 9]))).unwrap();
        r.on_packet(&up(1, 0, 0, vec![], 0, acts(&[8, 9]))).unwrap();
        r.poll(Cadence::default().relay_time(10));
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

    #[test]
    fn a_marked_release_lands_a_turn_after_its_press_without_holding_others() {
        let mut r = started();
        let press_release = vec![
            UpAction {
                release: false,
                data: vec![1],
            },
            UpAction {
                release: true,
                data: vec![2],
            },
            UpAction {
                release: false,
                data: vec![3],
            },
        ];
        r.on_packet(&up(1, 0, 0, vec![], 0, press_release)).unwrap();
        r.on_packet(&up(2, 0, 0, vec![], 0, acts(&[4]))).unwrap();
        r.poll(Cadence::default().relay_time(11));
        let press = turn_of(&r, 0, 1);
        assert_eq!(turn_of(&r, 1, 4), press);
        assert_eq!(turn_of(&r, 0, 2), press + 1);
        assert_eq!(turn_of(&r, 0, 3), press + 1);

        r.on_packet(&up(
            1,
            0,
            0,
            vec![],
            3,
            vec![UpAction {
                release: true,
                data: vec![5],
            }],
        ))
        .unwrap();
        r.poll(Cadence::default().relay_time(12));
        assert_eq!(turn_of(&r, 0, 5), press + 2);
    }

    #[test]
    fn a_player_a_second_behind_stops_the_clock_and_the_restart_is_rebased() {
        let cadence = Cadence::default();
        let mut r = Relay::new(cadence.clone(), &[1], 0);
        r.start(0);
        let stop_at = cadence.relay_time(126);
        r.poll(stop_at);
        assert_eq!((r.turns_emitted(), r.stops()), (126, 1));
        let probes = r.poll(stop_at + 500_000);
        assert_eq!(r.turns_emitted(), 126);
        assert!(!probes.is_empty());

        let restart = r.next_wake();
        r.on_packet(&up(1, 126, 0, vec![0; 64], 0, vec![])).unwrap();
        r.on_packet(&up(1, 126, 64, vec![0; 62], 0, vec![]))
            .unwrap();
        let resumed = r.poll(restart);
        assert_eq!(r.turns_emitted(), 127);
        assert_eq!(r.next_wake(), restart + cadence.period_us());
        let base = restart - cadence.relay_time(126);
        match decode(&resumed[0].1).unwrap() {
            Packet::Down(d) => assert_eq!(d.base_us, base as u64),
            other => panic!("{other:?}"),
        }
        r.poll(restart + 10 * cadence.period_us());
        assert_eq!((r.turns_emitted(), r.stops()), (137, 1));
    }
}
