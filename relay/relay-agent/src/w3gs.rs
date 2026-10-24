pub const PING_FROM_HOST: u8 = 0x01;
pub const SLOT_INFO_JOIN: u8 = 0x04;
pub const REJECT_JOIN: u8 = 0x05;
pub const PLAYER_INFO: u8 = 0x06;
pub const PLAYER_LEFT: u8 = 0x07;
pub const PLAYER_LOADED: u8 = 0x08;
pub const SLOT_INFO: u8 = 0x09;
pub const COUNT_DOWN_START: u8 = 0x0a;
pub const COUNT_DOWN_END: u8 = 0x0b;
pub const INCOMING_ACTION: u8 = 0x0c;
pub const CHAT_FROM_HOST: u8 = 0x0f;
pub const START_LAG: u8 = 0x10;
pub const STOP_LAG: u8 = 0x11;
pub const LEAVE_ACK: u8 = 0x1b;
pub const REQ_JOIN: u8 = 0x1e;
pub const LEAVE_REQ: u8 = 0x21;
pub const GAME_LOADED_SELF: u8 = 0x23;
pub const OUTGOING_ACTION: u8 = 0x26;
pub const OUTGOING_KEEP_ALIVE: u8 = 0x27;
pub const CHAT_TO_HOST: u8 = 0x28;
pub const SEARCH_GAME: u8 = 0x2f;
pub const GAME_INFO: u8 = 0x30;
pub const MAP_CHECK: u8 = 0x3d;
pub const MAP_SIZE: u8 = 0x42;
pub const PONG_TO_HOST: u8 = 0x46;
pub const PROTO_BUF: u8 = 0x59;

pub const PROTOBUF_PLAYER_PROFILE: u8 = 0x03;
pub const PROTOBUF_PLAYER_SKINS: u8 = 0x04;
pub const PROTOBUF_PLAYER_UNKNOWN5: u8 = 0x05;

pub const CHAT: u8 = 0x10;
pub const CHAT_HANDICAP: u8 = 0x14;
pub const CHAT_SCOPED: u8 = 0x20;

pub const LEAVE_DISCONNECT: u32 = 0x01;
pub const LEAVE_LOBBY: u32 = 0x0d;

pub const SLOT_OPEN: u8 = 0;
pub const SLOT_CLOSED: u8 = 1;
pub const SLOT_OCCUPIED: u8 = 2;
pub const RACE_RANDOM_SELECTABLE: u8 = 0x60;

pub const PRODUCT: &[u8; 4] = b"PX3W";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Packet {
    pub kind: u8,
    pub payload: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum W3gsError {
    NotW3gs(u8),
    Length(usize),
    Short,
    Unterminated,
    ActionCrc,
    TooLong(usize),
}

impl std::fmt::Display for W3gsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            W3gsError::NotW3gs(byte) => write!(f, "not a W3GS packet: byte {byte:#04x}"),
            W3gsError::Length(length) => write!(f, "W3GS packet length {length}"),
            W3gsError::Short => write!(f, "payload ends early"),
            W3gsError::Unterminated => write!(f, "unterminated string"),
            W3gsError::ActionCrc => write!(f, "OutgoingAction CRC32 mismatch"),
            W3gsError::TooLong(length) => write!(f, "W3GS packet is {length} bytes, over 65535"),
        }
    }
}

#[derive(Default)]
pub struct Writer(Vec<u8>);

impl Writer {
    pub fn u8(mut self, value: u8) -> Self {
        self.0.push(value);
        self
    }
    pub fn u16(mut self, value: u16) -> Self {
        self.0.extend_from_slice(&value.to_le_bytes());
        self
    }
    pub fn u32(mut self, value: u32) -> Self {
        self.0.extend_from_slice(&value.to_le_bytes());
        self
    }
    pub fn raw(mut self, bytes: &[u8]) -> Self {
        self.0.extend_from_slice(bytes);
        self
    }
    pub fn cstring(self, text: &[u8]) -> Self {
        self.raw(text).u8(0)
    }
    pub fn bytes(self) -> Vec<u8> {
        self.0
    }
}

pub struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    pub fn new(bytes: &'a [u8]) -> Self {
        Reader { bytes, at: 0 }
    }
    pub fn remaining(&self) -> usize {
        self.bytes.len() - self.at
    }
    pub fn take(&mut self, length: usize) -> Result<&'a [u8], W3gsError> {
        if self.remaining() < length {
            return Err(W3gsError::Short);
        }
        let slice = &self.bytes[self.at..self.at + length];
        self.at += length;
        Ok(slice)
    }
    pub fn u8(&mut self) -> Result<u8, W3gsError> {
        Ok(self.take(1)?[0])
    }
    pub fn u16(&mut self) -> Result<u16, W3gsError> {
        let b = self.take(2)?;
        Ok(u16::from_le_bytes([b[0], b[1]]))
    }
    pub fn u32(&mut self) -> Result<u32, W3gsError> {
        let b = self.take(4)?;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }
    pub fn cbytes(&mut self) -> Result<&'a [u8], W3gsError> {
        let end = self.bytes[self.at..].iter().position(|&b| b == 0).ok_or(W3gsError::Unterminated)?;
        let slice = &self.bytes[self.at..self.at + end];
        self.at += end + 1;
        Ok(slice)
    }
    pub fn rest(&mut self) -> &'a [u8] {
        let slice = &self.bytes[self.at..];
        self.at = self.bytes.len();
        slice
    }
}

pub fn encode(kind: u8, payload: &[u8]) -> Vec<u8> {
    let length = payload.len() + 4;
    assert!(length <= 0xffff, "{}", W3gsError::TooLong(length));
    let mut packet = Vec::with_capacity(length);
    packet.extend_from_slice(&[0xf7, kind, length as u8, (length >> 8) as u8]);
    packet.extend_from_slice(payload);
    packet
}

#[derive(Default)]
pub struct Splitter {
    buffer: Vec<u8>,
}

impl Splitter {
    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<Packet>, W3gsError> {
        self.buffer.extend_from_slice(chunk);
        let mut packets = Vec::new();
        let mut at = 0;
        while self.buffer.len() - at >= 4 {
            if self.buffer[at] != 0xf7 {
                return Err(W3gsError::NotW3gs(self.buffer[at]));
            }
            let length = u16::from_le_bytes([self.buffer[at + 2], self.buffer[at + 3]]) as usize;
            if length < 4 {
                return Err(W3gsError::Length(length));
            }
            if self.buffer.len() - at < length {
                break;
            }
            packets.push(Packet { kind: self.buffer[at + 1], payload: self.buffer[at + 4..at + length].to_vec() });
            at += length;
        }
        self.buffer.drain(..at);
        Ok(packets)
    }
}

pub fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for &byte in bytes {
        crc ^= byte as u32;
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb8_8320 & (crc & 1).wrapping_neg());
        }
    }
    !crc
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SockAddr {
    pub ip: [u8; 4],
    pub port: u16,
}

fn sock_addr(writer: Writer, address: Option<SockAddr>) -> Writer {
    match address {
        None => writer.raw(&[0; 16]),
        Some(a) => writer.u16(2).u16(a.port).raw(&a.ip).raw(&[0; 8]),
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Slot {
    pub player_id: u8,
    pub download: u8,
    pub status: u8,
    pub computer: bool,
    pub team: u8,
    pub color: u8,
    pub race: u8,
    pub computer_type: u8,
    pub handicap: u8,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SlotTable {
    pub slots: Vec<Slot>,
    pub random_seed: u32,
    pub layout: u8,
    pub players: u8,
}

fn slot_table(mut writer: Writer, table: &SlotTable) -> Writer {
    writer = writer.u16(7 + 9 * table.slots.len() as u16).u8(table.slots.len() as u8);
    for s in &table.slots {
        writer = writer
            .u8(s.player_id)
            .u8(s.download)
            .u8(s.status)
            .u8(s.computer as u8)
            .u8(s.team)
            .u8(s.color)
            .u8(s.race)
            .u8(s.computer_type)
            .u8(s.handicap);
    }
    writer.u32(table.random_seed).u8(table.layout).u8(table.players)
}

pub fn slot_info(table: &SlotTable) -> Vec<u8> {
    encode(SLOT_INFO, &slot_table(Writer::default(), table).bytes())
}

pub fn slot_info_join(table: &SlotTable, player_id: u8, address: SockAddr) -> Vec<u8> {
    encode(SLOT_INFO_JOIN, &sock_addr(slot_table(Writer::default(), table).u8(player_id), Some(address)).bytes())
}

pub fn player_info(player_id: u8, name: &[u8]) -> Vec<u8> {
    let head = Writer::default().u32(1).u8(player_id).cstring(name).u8(2).u8(0).u8(0);
    encode(PLAYER_INFO, &sock_addr(sock_addr(head, None), None).bytes())
}

pub fn reject_join(reason: u32) -> Vec<u8> {
    encode(REJECT_JOIN, &Writer::default().u32(reason).bytes())
}

fn varint(mut writer: Writer, value: u32) -> Writer {
    let mut rest = value;
    while rest >= 0x80 {
        writer = writer.u8((rest & 0x7f) as u8 | 0x80);
        rest >>= 7;
    }
    writer.u8(rest as u8)
}

fn proto_number(writer: Writer, field: u32, value: u32) -> Writer {
    varint(varint(writer, field << 3), value)
}

fn proto_bytes(writer: Writer, field: u32, value: &[u8]) -> Writer {
    varint(varint(writer, (field << 3) | 2), value.len() as u32).raw(value)
}

fn protobuf(kind: u8, message: &[u8]) -> Vec<u8> {
    encode(PROTO_BUF, &Writer::default().u8(kind).u32(message.len() as u32).raw(message).bytes())
}

pub fn player_skins(player_id: u8) -> Vec<u8> {
    protobuf(PROTOBUF_PLAYER_SKINS, &proto_number(Writer::default(), 1, player_id as u32).bytes())
}

pub fn player_profile(player_id: u8, name: &[u8]) -> Vec<u8> {
    let message = proto_bytes(proto_bytes(proto_number(Writer::default(), 1, player_id as u32), 2, name), 4, b"p042");
    protobuf(PROTOBUF_PLAYER_PROFILE, &message.bytes())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MapCheck {
    pub path: Vec<u8>,
    pub size: u32,
    pub crc32: u32,
    pub xoro: u32,
    pub sha1: [u8; 20],
}

pub fn map_check(map: &MapCheck) -> Vec<u8> {
    let w = Writer::default().u32(1).cstring(&map.path).u32(map.size).u32(map.crc32).u32(map.xoro).raw(&map.sha1);
    encode(MAP_CHECK, &w.bytes())
}

pub fn count_down_start() -> Vec<u8> {
    encode(COUNT_DOWN_START, &[])
}

pub fn count_down_end() -> Vec<u8> {
    encode(COUNT_DOWN_END, &[])
}

pub fn player_loaded(player_id: u8) -> Vec<u8> {
    encode(PLAYER_LOADED, &[player_id])
}

pub fn player_left(player_id: u8, reason: u32) -> Vec<u8> {
    encode(PLAYER_LEFT, &Writer::default().u8(player_id).u32(reason).bytes())
}

pub fn leave_ack() -> Vec<u8> {
    encode(LEAVE_ACK, &[])
}

pub fn ping_from_host(ticks: u32) -> Vec<u8> {
    encode(PING_FROM_HOST, &Writer::default().u32(ticks).bytes())
}

pub fn start_lag(lagging: &[(u8, u32)]) -> Vec<u8> {
    let mut w = Writer::default().u8(lagging.len() as u8);
    for &(pid, ms) in lagging {
        w = w.u8(pid).u32(ms);
    }
    encode(START_LAG, &w.bytes())
}

pub fn stop_lag(player_id: u8, ms: u32) -> Vec<u8> {
    encode(STOP_LAG, &Writer::default().u8(player_id).u32(ms).bytes())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlayerAction {
    pub player_id: u8,
    pub data: Vec<u8>,
}

pub fn incoming_action(step_ms: u16, actions: &[PlayerAction]) -> Vec<u8> {
    let head = Writer::default().u16(step_ms);
    if actions.is_empty() {
        return encode(INCOMING_ACTION, &head.bytes());
    }
    let mut body = Writer::default();
    for a in actions {
        body = body.u8(a.player_id).u16(a.data.len() as u16).raw(&a.data);
    }
    let body = body.bytes();
    encode(INCOMING_ACTION, &head.u16(crc32(&body) as u16).raw(&body).bytes())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReqJoin {
    pub host_counter: u32,
    pub entry_key: u32,
    pub listen_port: u16,
    pub join_counter: u32,
    pub name: Vec<u8>,
}

pub fn decode_req_join(payload: &[u8]) -> Result<ReqJoin, W3gsError> {
    let mut r = Reader::new(payload);
    let host_counter = r.u32()?;
    let entry_key = r.u32()?;
    r.u8()?;
    let listen_port = r.u16()?;
    let join_counter = r.u32()?;
    let name = r.cbytes()?.to_vec();
    Ok(ReqJoin { host_counter, entry_key, listen_port, join_counter, name })
}

pub fn decode_map_size(payload: &[u8]) -> Result<u32, W3gsError> {
    let mut r = Reader::new(payload);
    r.u32()?;
    r.u8()?;
    r.u32()
}

pub fn decode_outgoing_action(payload: &[u8]) -> Result<Vec<u8>, W3gsError> {
    let mut r = Reader::new(payload);
    let crc = r.u32()?;
    let data = r.rest();
    if crc32(data) != crc {
        return Err(W3gsError::ActionCrc);
    }
    Ok(data.to_vec())
}

pub fn decode_keep_alive(payload: &[u8]) -> Result<u32, W3gsError> {
    let mut r = Reader::new(payload);
    r.u8()?;
    r.u32()
}

pub fn decode_leave_req(payload: &[u8]) -> Result<u32, W3gsError> {
    Reader::new(payload).u32()
}

pub use relay_proto::room::Chat;

pub fn handicap(chat: &Chat) -> Option<u8> {
    (chat.kind == CHAT_HANDICAP).then(|| chat.body.first().copied()).flatten()
}

pub fn decode_chat(payload: &[u8]) -> Result<Chat, W3gsError> {
    let mut r = Reader::new(payload);
    let count = r.u8()? as usize;
    let to = r.take(count)?.to_vec();
    let from = r.u8()?;
    let kind = r.u8()?;
    Ok(Chat { to, from, kind, body: r.rest().to_vec() })
}

pub fn chat_from_host(chat: &Chat) -> Vec<u8> {
    let w = Writer::default().u8(chat.to.len() as u8).raw(&chat.to).u8(chat.from).u8(chat.kind).raw(&chat.body);
    encode(CHAT_FROM_HOST, &w.bytes())
}

