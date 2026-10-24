
use relay_proto::cadence::Cadence;
use relay_proto::control::{self, Control};
use relay_proto::relay::Relay;
use relay_proto::Micros;

use crate::game_room::GameRoom;
use crate::path::{Out, Path, Peer};

pub const REPORT_US: Micros = 5_000_000;

#[derive(Debug)]
pub(crate) struct Slot {
    pub(crate) token: u64,
    pub(crate) path: Option<Path>,
    pub(crate) joined_by: Option<(Peer, u64)>,
    pub(crate) left: bool,
}

#[derive(Debug)]
pub(crate) struct Room {
    pub(crate) relay: Relay,
    pub(crate) slots: Vec<Slot>,
    pub(crate) full_at: Option<Micros>,
    pub(crate) started: bool,
    pub(crate) game: GameRoom,
    pub(crate) next_report: Micros,
    pub(crate) heard: Micros,
    pub(crate) relayed: u64,
}

impl Room {
    pub(crate) fn reply(&self, room: u64, slot: usize, request: u64, steps: &[u8]) -> Vec<u8> {
        control::encode(&Control::Room {
            request,
            room,
            token: self.slots[slot].token,
            players: self.slots.len() as u8,
            slot: slot as u8,
            steps: steps.to_vec(),
        })
    }

    pub(crate) fn done(&self) -> bool {
        self.slots.iter().all(|s| s.left)
    }

    pub(crate) fn poll_game(&mut self, id: u64, now: Micros, lobby_us: Micros, cadence: &Cadence, out: &mut Out, log: &mut Vec<String>) {
        let ready = if self.game.hosted() { self.game.playing() } else { self.full_at.is_some_and(|t| now >= t + lobby_us) };
        if !self.started && ready {
            self.relay.start(now);
            self.started = true;
            log.push(format!("room {id:016x} playing"));
        }
        for (index, bytes) in self.game.poll(now) {
            if let Some(path) = &mut self.slots[index].path {
                path.send(bytes, out);
            }
        }
        log.extend(self.game.take_log().into_iter().map(|line| format!("room {id:016x} {line}")));
        if self.started && now >= self.next_report {
            self.next_report = now + REPORT_US;
            log.push(self.report(id, now, cadence));
        }
    }

    pub(crate) fn report(&self, id: u64, now: Micros, cadence: &Cadence) -> String {
        let turns = self.relay.turns_emitted();
        let game_us = cadence.relay_time(turns);
        let wall_us = self.relay.running_since().map_or(0, |since| now - since);
        let pace = if wall_us > 0 { game_us as f64 / wall_us as f64 } else { 0.0 };
        format!(
            "room {id:016x} summary: turns {turns} game {:.3} s wall {:.3} s pace {pace:.4} checksums compared {} desyncs {} stops {}",
            game_us as f64 / 1e6,
            wall_us as f64 / 1e6,
            self.relay.checksums_compared(),
            u32::from(self.relay.desync().is_some()),
            self.relay.stops(),
        )
    }
}
