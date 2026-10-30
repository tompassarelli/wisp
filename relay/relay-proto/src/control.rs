use crate::wire::{WireError, MAGIC, MAX_PACKET, VERSION};

pub const KIND_CREATE: u8 = 3;
pub const KIND_JOIN: u8 = 4;
pub const KIND_CHALLENGE: u8 = 5;
pub const KIND_ROOM: u8 = 6;
pub const KIND_VERIFY: u8 = 7;
pub const KIND_LEAVE: u8 = 8;
pub const KIND_REFUSED: u8 = 9;
pub const KIND_CREATE_PEER: u8 = 13;
pub const KIND_PEER: u8 = 14;
pub const KIND_RELAYED: u8 = 15;
pub const KIND_RESULT: u8 = 16;

pub const PEER_HEADER: usize = 3 + 8;
pub const MIN_PEERS: u8 = 2;
pub const MAX_PEERS: u8 = 4;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    RateLimited,
    NoRoom,
    Full,
    Players,
    Busy,
}

impl Refusal {
    fn code(self) -> u8 {
        match self {
            Refusal::RateLimited => 1,
            Refusal::NoRoom => 2,
            Refusal::Full => 3,
            Refusal::Players => 4,
            Refusal::Busy => 5,
        }
    }

    fn from_code(code: u8) -> Result<Self, WireError> {
        Ok(match code {
            1 => Refusal::RateLimited,
            2 => Refusal::NoRoom,
            3 => Refusal::Full,
            4 => Refusal::Players,
            5 => Refusal::Busy,
            _ => return Err(WireError::Flags),
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Control {
    Create {
        cookie: u64,
        request: u64,
        players: u8,
    },
    Join {
        cookie: u64,
        request: u64,
        room: u64,
    },
    Challenge {
        cookie: u64,
    },
    Room {
        request: u64,
        room: u64,
        token: u64,
        players: u8,
        slot: u8,
        steps: Vec<u8>,
    },
    Verify {
        token: u64,
        cookie: u64,
    },
    Leave {
        token: u64,
    },
    Refused {
        request: u64,
        reason: Refusal,
    },
    CreatePeer {
        cookie: u64,
        request: u64,
        players: u8,
    },
    Peer {
        token: u64,
        payload: Vec<u8>,
    },
    Relayed {
        from: u8,
        payload: Vec<u8>,
    },
    Result {
        token: u64,
        winner: u8,
        checksum: u32,
        rtt_ms: u16,
    },
}

pub fn kind(buf: &[u8]) -> Option<u8> {
    match buf {
        [MAGIC, VERSION, kind, ..] => Some(*kind),
        _ => None,
    }
}

pub fn token(buf: &[u8]) -> Option<u64> {
    Some(u64::from_le_bytes(buf.get(3..11)?.try_into().ok()?))
}

fn put(v: u64, n: usize, out: &mut Vec<u8>) {
    out.extend_from_slice(&v.to_le_bytes()[..n]);
}

fn kind_of(c: &Control) -> u8 {
    match c {
        Control::Create { .. } => KIND_CREATE,
        Control::Join { .. } => KIND_JOIN,
        Control::Challenge { .. } => KIND_CHALLENGE,
        Control::Room { .. } => KIND_ROOM,
        Control::Verify { .. } => KIND_VERIFY,
        Control::Leave { .. } => KIND_LEAVE,
        Control::Refused { .. } => KIND_REFUSED,
        Control::CreatePeer { .. } => KIND_CREATE_PEER,
        Control::Peer { .. } => KIND_PEER,
        Control::Relayed { .. } => KIND_RELAYED,
        Control::Result { .. } => KIND_RESULT,
    }
}

fn put_body(c: &Control, out: &mut Vec<u8>) {
    match c {
        Control::Create {
            cookie,
            request,
            players,
        }
        | Control::CreatePeer {
            cookie,
            request,
            players,
        } => {
            put(*cookie, 8, out);
            put(*request, 8, out);
            out.push(*players);
        }
        Control::Join {
            cookie,
            request,
            room,
        } => {
            put(*cookie, 8, out);
            put(*request, 8, out);
            put(*room, 8, out);
        }
        Control::Challenge { cookie } => put(*cookie, 8, out),
        Control::Room {
            request,
            room,
            token,
            players,
            slot,
            steps,
        } => {
            put(*request, 8, out);
            put(*room, 8, out);
            put(*token, 8, out);
            out.push(*players);
            out.push(*slot);
            out.push(steps.len() as u8);
            out.extend_from_slice(steps);
        }
        Control::Verify { token, cookie } => {
            put(*token, 8, out);
            put(*cookie, 8, out);
        }
        Control::Leave { token } => put(*token, 8, out),
        Control::Refused { request, reason } => {
            put(*request, 8, out);
            out.push(reason.code());
        }
        Control::Peer { token, payload } => {
            put(*token, 8, out);
            out.extend_from_slice(payload);
        }
        Control::Relayed { from, payload } => {
            out.push(*from);
            out.extend_from_slice(payload);
        }
        Control::Result {
            token,
            winner,
            checksum,
            rtt_ms,
        } => {
            put(*token, 8, out);
            out.push(*winner);
            put(*checksum as u64, 4, out);
            put(*rtt_ms as u64, 2, out);
        }
    }
}

pub fn encode(c: &Control) -> Vec<u8> {
    let mut out = vec![MAGIC, VERSION, kind_of(c)];
    put_body(c, &mut out);
    out
}

struct Reader<'a> {
    buf: &'a [u8],
    at: usize,
}

impl Reader<'_> {
    fn take(&mut self, n: usize) -> Result<&[u8], WireError> {
        let s = self.buf.get(self.at..self.at + n).ok_or(WireError::Short)?;
        self.at += n;
        Ok(s)
    }
    fn u8(&mut self) -> Result<u8, WireError> {
        Ok(self.take(1)?[0])
    }
    fn u32(&mut self) -> Result<u32, WireError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn u16(&mut self) -> Result<u16, WireError> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }
    fn u64(&mut self) -> Result<u64, WireError> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
    fn rest(&mut self) -> Vec<u8> {
        let rest = self.buf[self.at..].to_vec();
        self.at = self.buf.len();
        rest
    }
}

fn decode_body(kind: u8, r: &mut Reader) -> Result<Control, WireError> {
    Ok(match kind {
        KIND_CREATE => Control::Create {
            cookie: r.u64()?,
            request: r.u64()?,
            players: r.u8()?,
        },
        KIND_CREATE_PEER => Control::CreatePeer {
            cookie: r.u64()?,
            request: r.u64()?,
            players: r.u8()?,
        },
        KIND_JOIN => Control::Join {
            cookie: r.u64()?,
            request: r.u64()?,
            room: r.u64()?,
        },
        KIND_CHALLENGE => Control::Challenge { cookie: r.u64()? },
        KIND_ROOM => {
            let request = r.u64()?;
            let room = r.u64()?;
            let token = r.u64()?;
            let players = r.u8()?;
            let slot = r.u8()?;
            let n = r.u8()? as usize;
            Control::Room {
                request,
                room,
                token,
                players,
                slot,
                steps: r.take(n)?.to_vec(),
            }
        }
        KIND_VERIFY => Control::Verify {
            token: r.u64()?,
            cookie: r.u64()?,
        },
        KIND_LEAVE => Control::Leave { token: r.u64()? },
        KIND_REFUSED => Control::Refused {
            request: r.u64()?,
            reason: Refusal::from_code(r.u8()?)?,
        },
        KIND_PEER => Control::Peer {
            token: r.u64()?,
            payload: r.rest(),
        },
        KIND_RELAYED => Control::Relayed {
            from: r.u8()?,
            payload: r.rest(),
        },
        KIND_RESULT => Control::Result {
            token: r.u64()?,
            winner: r.u8()?,
            checksum: r.u32()?,
            rtt_ms: r.u16()?,
        },
        _ => return Err(WireError::Kind),
    })
}

pub fn decode(buf: &[u8]) -> Result<Control, WireError> {
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
    let c = decode_body(kind, &mut r)?;
    if r.at != buf.len() {
        return Err(WireError::Trailing);
    }
    Ok(c)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all() -> Vec<Control> {
        vec![
            Control::Create {
                cookie: 1,
                request: 2,
                players: 2,
            },
            Control::Join {
                cookie: 3,
                request: 4,
                room: 5,
            },
            Control::Challenge { cookie: 6 },
            Control::Room {
                request: 7,
                room: 8,
                token: 9,
                players: 2,
                slot: 1,
                steps: vec![17, 17, 16],
            },
            Control::Verify {
                token: 10,
                cookie: 11,
            },
            Control::Leave { token: 12 },
            Control::Result {
                token: 14,
                winner: 1,
                checksum: 0xdead_beef,
                rtt_ms: 34,
            },
            Control::Refused {
                request: 13,
                reason: Refusal::RateLimited,
            },
        ]
    }

    #[test]
    fn control_packets_round_trip_and_refuse_truncation() {
        for c in all() {
            let bytes = encode(&c);
            assert_eq!(decode(&bytes), Ok(c.clone()));
            for len in 0..bytes.len() {
                assert!(decode(&bytes[..len]).is_err());
            }
            let mut long = bytes.clone();
            long.push(0);
            assert_eq!(decode(&long), Err(WireError::Trailing));
        }
    }

    #[test]
    fn a_challenge_is_no_larger_than_the_request_it_answers() {
        let challenge = encode(&Control::Challenge { cookie: 0 }).len();
        for c in all() {
            if matches!(c, Control::Create { .. } | Control::Join { .. }) {
                assert!(challenge <= encode(&c).len());
            }
        }
    }

    fn vector_fields(line: &str) -> (String, std::collections::HashMap<&str, &str>) {
        let mut words = line.split(' ');
        let kind = words.next().unwrap().to_string();
        (kind, words.filter_map(|w| w.split_once('=')).collect())
    }

    fn unhex(text: &str) -> Vec<u8> {
        (0..text.len()).step_by(2).map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap()).collect()
    }

    fn vector_refusal(name: &str) -> Refusal {
        match name {
            "rateLimited" => Refusal::RateLimited,
            "noRoom" => Refusal::NoRoom,
            "full" => Refusal::Full,
            "players" => Refusal::Players,
            "busy" => Refusal::Busy,
            other => panic!("unknown refusal {other}"),
        }
    }

    fn vector_control(kind: &str, f: &std::collections::HashMap<&str, &str>) -> Control {
        let n = |k: &str| f[k].parse::<u64>().unwrap();
        let b = |k: &str| f[k].parse::<u8>().unwrap();
        match kind {
            "create" => Control::Create { cookie: n("cookie"), request: n("request"), players: b("players") },
            "createPeer" => Control::CreatePeer { cookie: n("cookie"), request: n("request"), players: b("players") },
            "join" => Control::Join { cookie: n("cookie"), request: n("request"), room: n("room") },
            "challenge" => Control::Challenge { cookie: n("cookie") },
            "room" => Control::Room { request: n("request"), room: n("room"), token: n("token"), players: b("players"), slot: b("slot"), steps: unhex(f["steps"]) },
            "verify" => Control::Verify { token: n("token"), cookie: n("cookie") },
            "leave" => Control::Leave { token: n("token") },
            "refused" => Control::Refused { request: n("request"), reason: vector_refusal(f["reason"]) },
            "peer" => Control::Peer { token: n("token"), payload: unhex(f["payload"]) },
            "relayed" => Control::Relayed { from: b("from"), payload: unhex(f["payload"]) },
            "result" => Control::Result { token: n("token"), winner: b("winner"), checksum: n("checksum") as u32, rtt_ms: n("rtt") as u16 },
            other => panic!("unknown vector type {other}"),
        }
    }

    #[test]
    fn peer_room_vectors_encode_and_decode_to_the_shared_packets() {
        let file = include_str!("../vectors/control.txt");
        let mut count = 0;
        for line in file.lines().filter(|l| !l.is_empty() && !l.starts_with('#')) {
            let (kind, fields) = vector_fields(line);
            let message = vector_control(&kind, &fields);
            let packet = unhex(fields["hex"]);
            assert_eq!(encode(&message), packet, "{line}");
            assert_eq!(decode(&packet), Ok(message), "{line}");
            count += 1;
        }
        assert!(count >= 20);
    }

    #[test]
    fn peer_room_datagrams_carry_any_payload_up_to_the_packet_limit() {
        let most = MAX_PACKET - PEER_HEADER;
        let full = Control::Peer { token: 5, payload: vec![0xa5; most] };
        let bytes = encode(&full);
        assert_eq!(bytes.len(), MAX_PACKET);
        assert_eq!(token(&bytes), Some(5));
        assert_eq!(decode(&bytes), Ok(full));
        let over = encode(&Control::Peer { token: 5, payload: vec![0; most + 1] });
        assert_eq!(decode(&over), Err(WireError::TooLong));
        assert!(decode(&bytes[..PEER_HEADER - 1]).is_err());
    }
}
