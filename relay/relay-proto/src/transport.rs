use crate::wire::{WireError, MAX_PACKET};
use crate::Micros;

pub const FALLBACK_US: Micros = 2_000_000;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Transport {
    #[default]
    Udp,
    Tcp,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Route {
    transport: Transport,
    sent: u32,
}

impl Route {
    pub fn transport(&self) -> Transport {
        self.transport
    }

    pub fn hear(&mut self, via: Transport, acked: u32) {
        if via == Transport::Tcp && self.transport == Transport::Udp {
            self.transport = Transport::Tcp;
            self.sent = acked;
        }
    }

    pub fn floor(&self, from: u32) -> u32 {
        match self.transport {
            Transport::Udp => from,
            Transport::Tcp => from.max(self.sent),
        }
    }

    pub fn sent_to(&mut self, turn: u32) {
        self.sent = turn;
    }
}

#[derive(Clone, Debug, Default)]
pub struct Deframer {
    buf: Vec<u8>,
    used: usize,
}

impl Deframer {
    pub fn push(&mut self, bytes: &[u8]) {
        if self.used > 0 {
            self.buf.drain(..self.used);
            self.used = 0;
        }
        self.buf.extend_from_slice(bytes);
    }

    pub fn next_frame(&mut self) -> Result<Option<&[u8]>, WireError> {
        let rest = &self.buf[self.used..];
        let Some(head) = rest.get(..2) else {
            return Ok(None);
        };
        let len = u16::from_le_bytes([head[0], head[1]]) as usize;
        if len > MAX_PACKET {
            return Err(WireError::TooLong);
        }
        if rest.len() < 2 + len {
            return Ok(None);
        }
        let start = self.used + 2;
        self.used = start + len;
        Ok(Some(&self.buf[start..start + len]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wire::frame;

    #[test]
    fn frames_split_anywhere_come_out_whole_and_in_order() {
        let a = vec![1u8; 300];
        let b = vec![2u8; 5];
        let mut stream = frame(&a);
        stream.extend(frame(&b));
        stream.extend(frame(&[]));
        for cut in 0..stream.len() {
            let mut d = Deframer::default();
            let mut got = Vec::new();
            for part in [&stream[..cut], &stream[cut..]] {
                d.push(part);
                while let Some(f) = d.next_frame().unwrap() {
                    got.push(f.to_vec());
                }
            }
            assert_eq!(got, vec![a.clone(), b.clone(), vec![]]);
        }
    }

    #[test]
    fn a_frame_over_the_packet_ceiling_is_refused() {
        let mut d = Deframer::default();
        d.push(&((MAX_PACKET + 1) as u16).to_le_bytes());
        assert_eq!(d.next_frame(), Err(WireError::TooLong));
    }
}
