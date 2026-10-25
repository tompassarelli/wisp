use std::collections::BTreeMap;

use relay_proto::room::{FromAgent as Up, FromRelay as Down, RoomFacts};
use relay_proto::wire::Action;

use crate::keys::ReleaseMarker;
use crate::slots::slot_table;
use crate::w3gs::{self, MapCheck, Packet, PlayerAction, SlotTable, SockAddr, W3gsError};

const HANDICAPS: [u8; 6] = [50, 60, 70, 80, 90, 100];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Lobby,
    Countdown,
    Loading,
    Playing,
    Over,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Output {
    pub to_client: Vec<Vec<u8>>,
    pub to_relay: Vec<Up>,
    pub actions: Vec<(Vec<u8>, bool)>,
    pub checksums: Vec<u32>,
}

#[derive(Clone, Debug, Default)]
struct Seat {
    name: Option<Vec<u8>>,
    loaded: bool,
    left: bool,
}

#[derive(Debug)]
pub struct GameHost {
    room: RoomFacts,
    seats: BTreeMap<u8, Seat>,
    handicaps: BTreeMap<u8, u8>,
    connected: bool,
    map_ok: bool,
    skins: bool,
    ready_sent: bool,
    phase: Phase,
    marker: ReleaseMarker,
}

impl GameHost {
    pub fn new(room: RoomFacts) -> Self {
        let seats = room.pids().into_iter().map(|pid| (pid, Seat::default())).collect();
        GameHost {
            room,
            seats,
            handicaps: BTreeMap::new(),
            connected: false,
            map_ok: false,
            skins: false,
            ready_sent: false,
            phase: Phase::Lobby,
            marker: ReleaseMarker::default(),
        }
    }

    pub fn phase(&self) -> Phase {
        self.phase
    }

    pub fn local(&self) -> u8 {
        self.room.you
    }

    pub fn room(&self) -> &RoomFacts {
        &self.room
    }

    fn present(&self, pid: u8) -> bool {
        self.seats.get(&pid).is_some_and(|s| s.name.is_some() && !s.left)
    }

    fn name(&self, pid: u8) -> &[u8] {
        self.seats.get(&pid).and_then(|s| s.name.as_deref()).unwrap_or_default()
    }

    fn local_left(&self) -> bool {
        self.seats.get(&self.local()).is_some_and(|s| s.left)
    }

    pub fn table(&self) -> SlotTable {
        slot_table(&self.room, &|pid| self.present(pid), &self.handicaps)
    }

    fn others(&self) -> Vec<u8> {
        self.seats.keys().copied().filter(|&pid| pid != self.local() && self.present(pid)).collect()
    }

    pub fn ping(&self, ticks: u32) -> Option<Vec<u8>> {
        (self.connected && !self.local_left() && self.phase != Phase::Playing).then(|| w3gs::ping_from_host(ticks))
    }

    pub fn client(&mut self, packet: &Packet, address: SockAddr, acked: u32) -> Result<Output, W3gsError> {
        let mut out = Output::default();
        if packet.kind == w3gs::REQ_JOIN {
            self.join(&packet.payload, address, &mut out)?;
        } else if self.connected {
            self.in_game(packet, acked, &mut out)?;
            if self.phase == Phase::Lobby && !self.ready_sent && self.map_ok && (self.seats.len() == 1 || self.skins) {
                self.ready_sent = true;
                out.to_relay.push(Up::Ready);
            }
        }
        Ok(out)
    }

    fn join(&mut self, payload: &[u8], address: SockAddr, out: &mut Output) -> Result<(), W3gsError> {
        let request = w3gs::decode_req_join(payload)?;
        if self.connected || self.phase != Phase::Lobby {
            out.to_client.push(w3gs::reject_join(if self.phase == Phase::Lobby { 0x09 } else { 0x0a }));
            return Ok(());
        }
        let local = self.local();
        self.connected = true;
        self.seats.entry(local).or_default().name = Some(request.name.clone());
        let table = self.table();
        let others = self.others();
        out.to_client.push(w3gs::slot_info_join(&table, local, address));
        out.to_client.push(w3gs::slot_info(&table));
        out.to_client.extend(others.iter().map(|&pid| w3gs::player_info(pid, self.name(pid))));
        out.to_client.extend(others.iter().map(|&pid| w3gs::player_skins(pid)));
        out.to_client.extend(others.iter().chain([&local]).map(|&pid| w3gs::player_profile(pid, self.name(pid))));
        let map = &self.room.map;
        out.to_client.push(w3gs::map_check(&MapCheck { path: map.path.clone(), size: map.size, crc32: map.crc32, xoro: map.xoro, sha1: map.sha1 }));
        out.to_relay.push(Up::Joined { name: request.name });
        Ok(())
    }

    fn in_game(&mut self, packet: &Packet, acked: u32, out: &mut Output) -> Result<(), W3gsError> {
        let payload = &packet.payload;
        match packet.kind {
            w3gs::MAP_SIZE => {
                let size = w3gs::decode_map_size(payload)?;
                self.map_ok = size == self.room.map.size;
                out.to_relay.push(Up::MapSize { size });
            }
            w3gs::PROTO_BUF => {
                self.skins |= payload.first() == Some(&w3gs::PROTOBUF_PLAYER_SKINS);
                out.to_client.push(w3gs::encode(w3gs::PROTO_BUF, payload));
            }
            w3gs::GAME_LOADED_SELF => {
                self.seats.entry(self.local()).or_default().loaded = true;
                out.to_client.push(w3gs::player_loaded(self.local()));
                out.to_relay.push(Up::Loaded);
                self.advance_loading();
            }
            w3gs::OUTGOING_ACTION => {
                let data = w3gs::decode_outgoing_action(payload)?;
                let release = self.marker.mark(&data, acked);
                out.actions.push((data, release));
            }
            w3gs::OUTGOING_KEEP_ALIVE => out.checksums.push(w3gs::decode_keep_alive(payload)?),
            w3gs::CHAT_TO_HOST => out.to_relay.push(self.chat(w3gs::decode_chat(payload)?)),
            w3gs::LEAVE_REQ => {
                let reason = w3gs::decode_leave_req(payload)?;
                out.to_client.push(w3gs::leave_ack());
                self.leave_local();
                out.to_relay.push(Up::Left(reason));
            }
            _ => {}
        }
        Ok(())
    }

    fn chat(&self, chat: w3gs::Chat) -> Up {
        match w3gs::handicap(&chat) {
            Some(value) if self.phase == Phase::Lobby && chat.from == self.local() && HANDICAPS.contains(&value) => Up::Handicap(value),
            _ => Up::Chat(chat),
        }
    }

    pub fn closed(&mut self) -> Output {
        let mut out = Output::default();
        if self.connected && !self.local_left() {
            self.leave_local();
            out.to_relay.push(Up::Left(w3gs::LEAVE_DISCONNECT));
        }
        out
    }

    fn leave_local(&mut self) {
        let local = self.local();
        self.seats.entry(local).or_default().left = true;
        if self.phase == Phase::Lobby {
            self.seats.insert(local, Seat::default());
            self.connected = false;
            self.map_ok = false;
            self.skins = false;
            self.ready_sent = false;
            self.handicaps.remove(&local);
        } else if self.seats.values().all(|s| s.left) {
            self.phase = Phase::Over;
        }
    }

    fn advance_loading(&mut self) {
        if self.phase == Phase::Loading && self.seats.values().filter(|s| !s.left).all(|s| s.loaded) {
            self.phase = Phase::Playing;
        }
    }

    pub fn relay(&mut self, event: Down) -> Vec<Vec<u8>> {
        let packets = self.room_event(event);
        if self.connected && !self.local_left() {
            packets
        } else {
            Vec::new()
        }
    }

    fn room_event(&mut self, event: Down) -> Vec<Vec<u8>> {
        let remote = |pid: u8, seats: &BTreeMap<u8, Seat>, local: u8| pid != local && seats.contains_key(&pid);
        let local = self.local();
        match event {
            Down::Joined { pid, name } if remote(pid, &self.seats, local) => self.remote_joined(pid, name),
            Down::Left { pid, reason } if remote(pid, &self.seats, local) => self.remote_left(pid, reason),
            Down::Loaded { pid } if remote(pid, &self.seats, local) => {
                self.seats.get_mut(&pid).expect("seat").loaded = true;
                self.advance_loading();
                vec![w3gs::player_loaded(pid)]
            }
            Down::Handicap { pid, value } if self.phase == Phase::Lobby && HANDICAPS.contains(&value) => {
                self.handicaps.insert(pid, value);
                vec![w3gs::slot_info(&self.table())]
            }
            Down::Chat(chat) if chat.from != local && chat.to.contains(&local) => vec![w3gs::chat_from_host(&chat)],
            Down::CountdownStart if self.phase == Phase::Lobby => {
                self.phase = Phase::Countdown;
                vec![w3gs::slot_info(&self.table()), w3gs::count_down_start()]
            }
            Down::CountdownEnd if self.phase == Phase::Countdown => {
                self.phase = Phase::Loading;
                vec![w3gs::count_down_end()]
            }
            _ => Vec::new(),
        }
    }

    fn remote_joined(&mut self, pid: u8, name: Vec<u8>) -> Vec<Vec<u8>> {
        let packets = vec![w3gs::player_info(pid, &name), w3gs::player_skins(pid), w3gs::player_profile(pid, &name)];
        self.seats.insert(pid, Seat { name: Some(name), ..Seat::default() });
        let mut packets = packets;
        packets.push(w3gs::slot_info(&self.table()));
        packets
    }

    fn remote_left(&mut self, pid: u8, reason: u32) -> Vec<Vec<u8>> {
        let mut packets = vec![w3gs::player_left(pid, reason)];
        if self.phase == Phase::Lobby {
            self.seats.insert(pid, Seat::default());
            self.handicaps.remove(&pid);
            packets.push(w3gs::slot_info(&self.table()));
        } else {
            self.seats.get_mut(&pid).expect("seat").left = true;
            if self.seats.values().all(|s| s.left) {
                self.phase = Phase::Over;
            }
            self.advance_loading();
        }
        packets
    }

    pub fn lag(&self, lagging: &[u8]) -> Option<Vec<u8>> {
        (self.phase == Phase::Playing).then(|| w3gs::start_lag(&lagging.iter().map(|&pid| (pid, 0)).collect::<Vec<_>>()))
    }

    pub fn lag_end(&self, pid: u8) -> Option<Vec<u8>> {
        (self.phase == Phase::Playing).then(|| w3gs::stop_lag(pid, 0))
    }

    pub fn turn(&mut self, step_ms: u16, actions: Vec<Action>) -> Option<Vec<u8>> {
        if self.phase == Phase::Loading {
            self.phase = Phase::Playing;
        }
        (self.phase == Phase::Playing && self.connected && !self.local_left()).then(|| w3gs::incoming_action(step_ms, &self.player_actions(actions)))
    }

    fn player_actions(&self, actions: Vec<Action>) -> Vec<PlayerAction> {
        let pids = self.room.pids();
        actions
            .into_iter()
            .filter_map(|a| pids.get(a.player as usize).map(|&pid| PlayerAction { player_id: pid, data: a.data }))
            .collect()
    }

    pub fn listing(&self, version: u32, name: &[u8], port: u16, uptime_seconds: u32) -> Option<Vec<u8>> {
        let map = &self.room.map;
        (self.phase == Phase::Lobby).then(|| {
            crate::listing::game_info(&crate::listing::GameInfo {
                version,
                name,
                width: map.width,
                height: map.height,
                xoro: map.xoro,
                path: &map.path,
                sha1: map.sha1,
                slots: map.players.len() as u32,
                open_slots: self.seats.values().filter(|s| s.name.is_none()).count() as u32,
                uptime_seconds,
                port,
            })
        })
    }
}
