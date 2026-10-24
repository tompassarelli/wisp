use relay_proto::lobby::{Lobby, LobbyPhase, LobbyTiming};
use relay_proto::mark;
use relay_proto::room::{self, FromAgent, FromRelay};
use relay_proto::stream::{self, RoomStream};
use relay_proto::wire::Action;
use relay_proto::Micros;

#[derive(Debug)]
pub struct GameRoom {
    seed: u32,
    timing: LobbyTiming,
    players: u8,
    lobby: Option<Lobby>,
    streams: Vec<RoomStream>,
    log: Vec<String>,
}

impl GameRoom {
    pub fn new(seed: u32, tokens: &[u64], timing: LobbyTiming) -> Self {
        GameRoom {
            seed,
            timing,
            players: tokens.len() as u8,
            lobby: None,
            streams: tokens.iter().map(|&t| RoomStream::new(t)).collect(),
            log: Vec::new(),
        }
    }

    pub fn hosted(&self) -> bool {
        self.lobby.is_some()
    }

    pub fn playing(&self) -> bool {
        self.lobby.as_ref().is_some_and(|l| l.phase() == LobbyPhase::Playing)
    }

    pub fn mark(&self) -> Option<Action> {
        self.lobby.as_ref()?.lowest_present().map(|p| mark::mark_action(p as u8))
    }

    pub fn take_log(&mut self) -> Vec<String> {
        std::mem::take(&mut self.log)
    }

    pub fn on_stream(&mut self, now: Micros, slot: usize, bytes: &[u8]) {
        let Ok(packet) = stream::decode(bytes) else { return };
        for message in self.streams[slot].receive(&packet) {
            match room::decode_from_agent(&message) {
                Ok(m) => self.on_message(now, slot, m),
                Err(e) => self.log.push(format!("slot {slot} sent a bad room message: {e:?}")),
            }
        }
    }

    fn welcome(&mut self, slot: usize) {
        if let Some(lobby) = &self.lobby {
            for m in lobby.welcome(slot) {
                self.streams[slot].push(room::encode_from_relay(&m));
            }
        }
    }

    fn on_message(&mut self, now: Micros, slot: usize, message: FromAgent) {
        self.log.push(format!("slot {slot} {message:?}"));
        match (message, &mut self.lobby) {
            (FromAgent::Host { map, computers }, None) if slot == 0 => {
                self.lobby = Some(Lobby::new(map, self.seed, self.players, computers, self.timing));
                for s in 0..self.streams.len() {
                    self.welcome(s);
                }
            }
            (FromAgent::Host { .. }, _) => {}
            (message, Some(lobby)) => {
                let out = lobby.on_message(now, slot, message);
                self.route(out);
            }
            (_, None) => {}
        }
    }

    fn route(&mut self, out: Vec<(usize, FromRelay)>) {
        for (slot, m) in out {
            self.streams[slot].push(room::encode_from_relay(&m));
        }
    }

    pub fn next_wake(&self) -> Micros {
        let lobby = self.lobby.as_ref().and_then(Lobby::next_wake).unwrap_or(Micros::MAX);
        self.streams.iter().filter_map(RoomStream::next_wake).fold(lobby, Micros::min)
    }

    pub fn poll(&mut self, now: Micros) -> Vec<(usize, Vec<u8>)> {
        if let Some(lobby) = &mut self.lobby {
            let phase = lobby.phase();
            let out = lobby.poll(now);
            if lobby.phase() != phase {
                self.log.push(format!("phase {:?}", lobby.phase()));
            }
            self.route(out);
        }
        (0..self.streams.len()).filter_map(|s| self.streams[s].poll(now).map(|p| (s, p))).collect()
    }
}
