use crate::room::{FromAgent, FromRelay, MapFacts, RoomFacts};
use crate::Micros;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LobbyTiming {
    pub settle_us: Micros,
    pub countdown_us: Micros,
}

pub const HOST_TIMING: LobbyTiming = LobbyTiming { settle_us: 1_500_000, countdown_us: 6_000_000 };

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LobbyPhase {
    Lobby,
    Countdown,
    Loading,
    Playing,
}

#[derive(Clone, Debug, Default)]
struct Seat {
    name: Option<Vec<u8>>,
    ready: bool,
    loaded: bool,
    left: bool,
}

#[derive(Debug)]
pub struct Lobby {
    facts: RoomFacts,
    pids: Vec<u8>,
    seats: Vec<Seat>,
    phase: LobbyPhase,
    last_join: Micros,
    countdown_at: Micros,
    timing: LobbyTiming,
}

impl Lobby {
    pub fn new(map: MapFacts, seed: u32, players: u8, computers: u8, timing: LobbyTiming) -> Self {
        let facts = RoomFacts { map, seed, players, computers, you: 0 };
        let pids = facts.pids();
        assert_eq!(pids.len(), players as usize, "the map has fewer user slots than players");
        Lobby { seats: vec![Seat::default(); pids.len()], pids, facts, phase: LobbyPhase::Lobby, last_join: 0, countdown_at: 0, timing }
    }

    pub fn phase(&self) -> LobbyPhase {
        self.phase
    }

    pub fn pid(&self, player: usize) -> u8 {
        self.pids[player]
    }

    pub fn player_of(&self, pid: u8) -> Option<usize> {
        self.pids.iter().position(|&p| p == pid)
    }

    pub fn players(&self) -> usize {
        self.pids.len()
    }

    pub fn left(&self, player: usize) -> bool {
        self.seats[player].left
    }

    pub fn welcome(&self, player: usize) -> Vec<FromRelay> {
        let mut out = vec![FromRelay::Room(RoomFacts { you: self.pids[player], ..self.facts.clone() })];
        for (i, seat) in self.seats.iter().enumerate() {
            if let (Some(name), false) = (&seat.name, seat.left) {
                out.push(FromRelay::Joined { pid: self.pids[i], name: name.clone() });
            }
        }
        out
    }

    fn all(&self, message: FromRelay) -> Vec<(usize, FromRelay)> {
        (0..self.pids.len()).map(|i| (i, message.clone())).collect()
    }

    fn others(&self, player: usize, message: FromRelay) -> Vec<(usize, FromRelay)> {
        (0..self.pids.len()).filter(|&i| i != player).map(|i| (i, message.clone())).collect()
    }

    pub fn on_message(&mut self, now: Micros, player: usize, message: FromAgent) -> Vec<(usize, FromRelay)> {
        let pid = self.pids[player];
        match message {
            FromAgent::Joined { name } if self.phase == LobbyPhase::Lobby => {
                self.seats[player] = Seat { name: Some(name.clone()), ..Seat::default() };
                self.last_join = now;
                self.others(player, FromRelay::Joined { pid, name })
            }
            FromAgent::MapSize { size } if size != self.facts.map.size => vec![(
                player,
                FromRelay::Refused {
                    reason: format!("map is {size} bytes, the room's is {} bytes", self.facts.map.size).into_bytes(),
                },
            )],
            FromAgent::Ready if self.phase == LobbyPhase::Lobby => {
                self.seats[player].ready = true;
                Vec::new()
            }
            FromAgent::Loaded if self.phase == LobbyPhase::Loading => {
                self.seats[player].loaded = true;
                if self.seats.iter().all(|s| s.left || s.loaded) {
                    self.phase = LobbyPhase::Playing;
                }
                self.all(FromRelay::Loaded { pid })
            }
            FromAgent::Chat(chat) => self.others(player, FromRelay::Chat(chat)),
            FromAgent::Handicap(value) if self.phase == LobbyPhase::Lobby => self.all(FromRelay::Handicap { pid, value }),
            FromAgent::Left(reason) => {
                let out = self.others(player, FromRelay::Left { pid, reason });
                if self.phase == LobbyPhase::Lobby {
                    self.seats[player] = Seat::default();
                } else {
                    self.seats[player].left = true;
                    if self.phase == LobbyPhase::Loading && self.seats.iter().all(|s| s.left || s.loaded) {
                        self.phase = LobbyPhase::Playing;
                    }
                }
                out
            }
            _ => Vec::new(),
        }
    }

    pub fn next_wake(&self) -> Option<Micros> {
        match self.phase {
            LobbyPhase::Lobby if self.seats.iter().all(|s| s.ready) => Some(self.last_join + self.timing.settle_us),
            LobbyPhase::Countdown => Some(self.countdown_at),
            _ => None,
        }
    }

    pub fn poll(&mut self, now: Micros) -> Vec<(usize, FromRelay)> {
        match self.phase {
            LobbyPhase::Lobby if self.seats.iter().all(|s| s.ready) && now >= self.last_join + self.timing.settle_us => {
                self.phase = LobbyPhase::Countdown;
                self.countdown_at = now + self.timing.countdown_us;
                self.all(FromRelay::CountdownStart)
            }
            LobbyPhase::Countdown if now >= self.countdown_at => {
                self.phase = LobbyPhase::Loading;
                self.all(FromRelay::CountdownEnd)
            }
            _ => Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::room::tests::map;

    #[test]
    fn the_countdown_waits_for_every_player_ready_and_the_settle_time() {
        let mut lobby = Lobby::new(map(), 42, 2, 0, HOST_TIMING);
        lobby.on_message(0, 0, FromAgent::Joined { name: b"a".to_vec() });
        lobby.on_message(0, 0, FromAgent::Ready);
        lobby.on_message(1_000_000, 1, FromAgent::Joined { name: b"b".to_vec() });
        assert!(lobby.poll(3_000_000).is_empty());
        lobby.on_message(1_100_000, 1, FromAgent::Ready);
        assert!(lobby.poll(2_400_000).is_empty());
        assert_eq!(lobby.poll(2_500_000).len(), 2);
        assert!(lobby.poll(8_499_999).is_empty());
        assert_eq!(lobby.poll(8_500_000), vec![(0, FromRelay::CountdownEnd), (1, FromRelay::CountdownEnd)]);
    }
}
