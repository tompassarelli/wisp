pub const MAGIC: u8 = 0x57;
pub const VERSION: u8 = 1;
pub const MAX_PACKET: usize = 1200;
pub const MAX_ACTION: usize = 512;
pub const MAX_CHECKSUMS: usize = 64;
pub const MAX_PACKETS_PER_TICK: usize = 4;
pub const NOT_STARTED: u64 = u64::MAX;

pub const KIND_DOWN: u8 = 1;
pub const KIND_UP: u8 = 2;

pub const DOWN_HEADER: usize = 3 + 8 + 4 + 8 + 8 + 4 + 4 + 4 + 2;
pub const UP_HEADER: usize = 3 + 8 + 4 + 8 + 4 + 4 + 2 + 4 + 2;
pub const TURN_HEADER: usize = 3;
pub const ACTION_HEADER: usize = 7;
pub const UP_ACTION_HEADER: usize = 3;
pub const MAX_TURN: usize = MAX_PACKET - DOWN_HEADER;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Action {
    pub player: u8,
    pub seq: u32,
    pub data: Vec<u8>,
}

impl Action {
    pub fn wire_len(&self) -> usize {
        ACTION_HEADER + self.data.len()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UpAction {
    pub release: bool,
    pub data: Vec<u8>,
}

impl UpAction {
    pub fn wire_len(&self) -> usize {
        UP_ACTION_HEADER + self.data.len()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Turn {
    pub step_ms: u8,
    pub actions: Vec<Action>,
}

impl Turn {
    pub fn wire_len(&self) -> usize {
        TURN_HEADER + self.actions.iter().map(Action::wire_len).sum::<usize>()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Down {
    pub token: u64,
    pub seq: u32,
    pub sent_us: u64,
    pub base_us: u64,
    pub action_ack: u32,
    pub checksum_ack: u32,
    pub turn_from: u32,
    pub turns: Vec<Turn>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Up {
    pub token: u64,
    pub seq: u32,
    pub sent_us: u64,
    pub turn_ack: u32,
    pub checksum_from: u32,
    pub checksums: Vec<u32>,
    pub action_from: u32,
    pub actions: Vec<UpAction>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Packet {
    Down(Down),
    Up(Up),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WireError {
    Short,
    Magic,
    Version,
    Kind,
    Trailing,
    TooLong,
    Flags,
}

struct Writer(Vec<u8>);

impl Writer {
    fn head(kind: u8, token: u64) -> Self {
        let mut w = Writer(Vec::with_capacity(MAX_PACKET));
        w.u8(MAGIC);
        w.u8(VERSION);
        w.u8(kind);
        w.u64(token);
        w
    }
    fn u8(&mut self, v: u8) {
        self.0.push(v);
    }
    fn u16(&mut self, v: u16) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    fn u32(&mut self, v: u32) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    fn u64(&mut self, v: u64) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    fn patch_u16(&mut self, at: usize, v: u16) {
        self.0[at..at + 2].copy_from_slice(&v.to_le_bytes());
    }
    fn bytes(&mut self, b: &[u8]) {
        self.0.extend_from_slice(b);
    }
}

struct Reader<'a> {
    buf: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn room(&self, count: u16, size: usize) -> usize {
        (count as usize).min((self.buf.len() - self.at) / size)
    }
    fn take(&mut self, n: usize) -> Result<&'a [u8], WireError> {
        let end = self.at.checked_add(n).ok_or(WireError::Short)?;
        let s = self.buf.get(self.at..end).ok_or(WireError::Short)?;
        self.at = end;
        Ok(s)
    }
    fn u8(&mut self) -> Result<u8, WireError> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> Result<u16, WireError> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }
    fn u32(&mut self) -> Result<u32, WireError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn u64(&mut self) -> Result<u64, WireError> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
}

pub fn encode_down(head: &Down, turns: &[Turn], budget: usize) -> (Vec<u8>, usize) {
    let mut w = Writer::head(KIND_DOWN, head.token);
    w.u32(head.seq);
    w.u64(head.sent_us);
    w.u64(head.base_us);
    w.u32(head.action_ack);
    w.u32(head.checksum_ack);
    w.u32(head.turn_from);
    let count_at = w.0.len();
    w.u16(0);
    let mut n = 0;
    for turn in turns {
        if w.0.len() + turn.wire_len() > budget || n == u16::MAX as usize {
            break;
        }
        w.u8(turn.step_ms);
        w.u16(turn.actions.len() as u16);
        for a in &turn.actions {
            w.u8(a.player);
            w.u32(a.seq);
            w.u16(a.data.len() as u16);
            w.bytes(&a.data);
        }
        n += 1;
    }
    w.patch_u16(count_at, n as u16);
    (w.0, n)
}

pub fn encode_up(
    head: &Up,
    checksums: &[u32],
    actions: &[UpAction],
    budget: usize,
) -> (Vec<u8>, usize, usize) {
    let mut w = Writer::head(KIND_UP, head.token);
    w.u32(head.seq);
    w.u64(head.sent_us);
    w.u32(head.turn_ack);
    w.u32(head.checksum_from);
    let sums = checksums
        .len()
        .min(MAX_CHECKSUMS)
        .min(budget.saturating_sub(UP_HEADER) / 4);
    w.u16(sums as u16);
    for &c in &checksums[..sums] {
        w.u32(c);
    }
    w.u32(head.action_from);
    let count_at = w.0.len();
    w.u16(0);
    let mut n = 0;
    for a in actions {
        if w.0.len() + a.wire_len() > budget || n == u16::MAX as usize {
            break;
        }
        w.u8(u8::from(a.release));
        w.u16(a.data.len() as u16);
        w.bytes(&a.data);
        n += 1;
    }
    w.patch_u16(count_at, n as u16);
    (w.0, sums, n)
}

pub fn encode(packet: &Packet) -> Result<Vec<u8>, WireError> {
    let (bytes, complete) = match packet {
        Packet::Down(d) => {
            let (b, n) = encode_down(d, &d.turns, MAX_PACKET);
            (b, n == d.turns.len())
        }
        Packet::Up(u) => {
            let (b, s, n) = encode_up(u, &u.checksums, &u.actions, MAX_PACKET);
            (b, s == u.checksums.len() && n == u.actions.len())
        }
    };
    if complete {
        Ok(bytes)
    } else {
        Err(WireError::TooLong)
    }
}

pub fn decode(buf: &[u8]) -> Result<Packet, WireError> {
    if buf.len() > MAX_PACKET {
        return Err(WireError::TooLong);
    }
    let mut r = Reader { buf, at: 0 };
    if r.u8()? != MAGIC {
        return Err(WireError::Magic);
    }
    if r.u8()? != VERSION {
        return Err(WireError::Version);
    }
    let kind = r.u8()?;
    let token = r.u64()?;
    let packet = match kind {
        KIND_DOWN => Packet::Down(decode_down(&mut r, token)?),
        KIND_UP => Packet::Up(decode_up(&mut r, token)?),
        _ => return Err(WireError::Kind),
    };
    if r.at != buf.len() {
        return Err(WireError::Trailing);
    }
    Ok(packet)
}

fn decode_down(r: &mut Reader, token: u64) -> Result<Down, WireError> {
    let seq = r.u32()?;
    let sent_us = r.u64()?;
    let base_us = r.u64()?;
    let action_ack = r.u32()?;
    let checksum_ack = r.u32()?;
    let turn_from = r.u32()?;
    let count = r.u16()?;
    let mut turns = Vec::with_capacity(r.room(count, TURN_HEADER));
    for _ in 0..count {
        let step_ms = r.u8()?;
        let n = r.u16()?;
        let mut actions = Vec::with_capacity(r.room(n, ACTION_HEADER));
        for _ in 0..n {
            let player = r.u8()?;
            let seq = r.u32()?;
            let len = r.u16()? as usize;
            actions.push(Action {
                player,
                seq,
                data: r.take(len)?.to_vec(),
            });
        }
        turns.push(Turn { step_ms, actions });
    }
    Ok(Down {
        token,
        seq,
        sent_us,
        base_us,
        action_ack,
        checksum_ack,
        turn_from,
        turns,
    })
}

fn decode_up(r: &mut Reader, token: u64) -> Result<Up, WireError> {
    let seq = r.u32()?;
    let sent_us = r.u64()?;
    let turn_ack = r.u32()?;
    let checksum_from = r.u32()?;
    let sums = r.u16()?;
    let mut checksums = Vec::with_capacity(r.room(sums, 4));
    for _ in 0..sums {
        checksums.push(r.u32()?);
    }
    let action_from = r.u32()?;
    let n = r.u16()?;
    let mut actions = Vec::with_capacity(r.room(n, UP_ACTION_HEADER));
    for _ in 0..n {
        let release = match r.u8()? {
            0 => false,
            1 => true,
            _ => return Err(WireError::Flags),
        };
        let len = r.u16()? as usize;
        actions.push(UpAction {
            release,
            data: r.take(len)?.to_vec(),
        });
    }
    Ok(Up {
        token,
        seq,
        sent_us,
        turn_ack,
        checksum_from,
        checksums,
        action_from,
        actions,
    })
}

pub fn frame(packet: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(packet.len() + 2);
    out.extend_from_slice(&(packet.len() as u16).to_le_bytes());
    out.extend_from_slice(packet);
    out
}

pub fn unframe(stream: &[u8]) -> Option<(&[u8], usize)> {
    let len = u16::from_le_bytes(stream.get(..2)?.try_into().ok()?) as usize;
    let body = stream.get(2..2 + len)?;
    Some((body, 2 + len))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_down() -> Down {
        Down {
            token: 0x0123_4567_89ab_cdef,
            seq: 7,
            sent_us: 1_000_000,
            base_us: 20_000_000,
            action_ack: 3,
            checksum_ack: 9,
            turn_from: 41,
            turns: vec![
                Turn {
                    step_ms: 17,
                    actions: vec![],
                },
                Turn {
                    step_ms: 16,
                    actions: vec![Action {
                        player: 1,
                        seq: 2,
                        data: vec![9, 8, 7],
                    }],
                },
            ],
        }
    }

    #[test]
    fn down_round_trips() {
        let d = sample_down();
        let bytes = encode(&Packet::Down(d.clone())).unwrap();
        assert_eq!(
            bytes.len(),
            DOWN_HEADER + d.turns.iter().map(Turn::wire_len).sum::<usize>()
        );
        assert_eq!(decode(&bytes), Ok(Packet::Down(d)));
    }

    #[test]
    fn up_round_trips() {
        let u = Up {
            token: 5,
            seq: 1,
            sent_us: 2,
            turn_ack: 3,
            checksum_from: 4,
            checksums: vec![10, 11],
            action_from: 6,
            actions: [(false, vec![1]), (true, vec![]), (true, vec![2, 3])]
                .into_iter()
                .map(|(release, data)| UpAction { release, data })
                .collect(),
        };
        let bytes = encode(&Packet::Up(u.clone())).unwrap();
        assert_eq!(bytes.len(), UP_HEADER + 8 + 3 * UP_ACTION_HEADER + 3);
        assert_eq!(decode(&bytes), Ok(Packet::Up(u)));
    }

    #[test]
    fn an_unknown_action_flag_is_refused() {
        let u = Up {
            token: 5,
            seq: 1,
            sent_us: 2,
            turn_ack: 3,
            checksum_from: 4,
            checksums: vec![],
            action_from: 6,
            actions: vec![UpAction {
                release: true,
                data: vec![7],
            }],
        };
        let mut bytes = encode(&Packet::Up(u)).unwrap();
        let flag = bytes.len() - 1 - 2 - 1;
        bytes[flag] = 2;
        assert_eq!(decode(&bytes), Err(WireError::Flags));
    }

    #[test]
    fn down_keeps_oldest_turns_within_budget() {
        let mut d = sample_down();
        let big = Turn {
            step_ms: 17,
            actions: vec![Action {
                player: 0,
                seq: 0,
                data: vec![0; 400],
            }],
        };
        d.turns = vec![big.clone(), big.clone(), big.clone(), big];
        let (bytes, n) = encode_down(&d, &d.turns, MAX_PACKET);
        assert_eq!(n, 2);
        assert!(bytes.len() <= MAX_PACKET);
        match decode(&bytes).unwrap() {
            Packet::Down(got) => assert_eq!(got.turns, d.turns[..2].to_vec()),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn every_truncation_is_refused() {
        let bytes = encode(&Packet::Down(sample_down())).unwrap();
        for len in 0..bytes.len() {
            assert!(
                decode(&bytes[..len]).is_err(),
                "prefix of {len} bytes decoded"
            );
        }
        let mut long = bytes.clone();
        long.push(0);
        assert_eq!(decode(&long), Err(WireError::Trailing));
    }

    #[test]
    fn frames_carry_packets_on_a_stream() {
        let a = encode(&Packet::Down(sample_down())).unwrap();
        let mut stream = frame(&a);
        stream.extend(frame(&a));
        let (first, used) = unframe(&stream).unwrap();
        assert_eq!(decode(first), decode(&a));
        let (second, _) = unframe(&stream[used..]).unwrap();
        assert_eq!(second, &a[..]);
        assert!(unframe(&stream[..3]).is_none());
    }
}
