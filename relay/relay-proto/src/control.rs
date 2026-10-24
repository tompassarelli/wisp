use crate::wire::{WireError, MAGIC, MAX_PACKET, VERSION};

pub const KIND_CREATE: u8 = 3;
pub const KIND_JOIN: u8 = 4;
pub const KIND_CHALLENGE: u8 = 5;
pub const KIND_ROOM: u8 = 6;
pub const KIND_VERIFY: u8 = 7;
pub const KIND_LEAVE: u8 = 8;
pub const KIND_REFUSED: u8 = 9;

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

pub fn encode(c: &Control) -> Vec<u8> {
    fn put(v: u64, n: usize, out: &mut Vec<u8>) {
        out.extend_from_slice(&v.to_le_bytes()[..n]);
    }
    let mut out = vec![MAGIC, VERSION];
    match c {
        Control::Create {
            cookie,
            request,
            players,
        } => {
            out.push(KIND_CREATE);
            put(*cookie, 8, &mut out);
            put(*request, 8, &mut out);
            out.push(*players);
        }
        Control::Join {
            cookie,
            request,
            room,
        } => {
            out.push(KIND_JOIN);
            put(*cookie, 8, &mut out);
            put(*request, 8, &mut out);
            put(*room, 8, &mut out);
        }
        Control::Challenge { cookie } => {
            out.push(KIND_CHALLENGE);
            put(*cookie, 8, &mut out);
        }
        Control::Room {
            request,
            room,
            token,
            players,
            slot,
            steps,
        } => {
            out.push(KIND_ROOM);
            put(*request, 8, &mut out);
            put(*room, 8, &mut out);
            put(*token, 8, &mut out);
            out.push(*players);
            out.push(*slot);
            out.push(steps.len() as u8);
            out.extend_from_slice(steps);
        }
        Control::Verify { token, cookie } => {
            out.push(KIND_VERIFY);
            put(*token, 8, &mut out);
            put(*cookie, 8, &mut out);
        }
        Control::Leave { token } => {
            out.push(KIND_LEAVE);
            put(*token, 8, &mut out);
        }
        Control::Refused { request, reason } => {
            out.push(KIND_REFUSED);
            put(*request, 8, &mut out);
            out.push(reason.code());
        }
    }
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
    fn u64(&mut self) -> Result<u64, WireError> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
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
    let c = match r.u8()? {
        KIND_CREATE => Control::Create {
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
        _ => return Err(WireError::Kind),
    };
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
}
