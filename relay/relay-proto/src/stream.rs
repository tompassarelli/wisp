use std::collections::VecDeque;

use crate::room::{In, Out};
use crate::wire::{WireError, MAGIC, MAX_PACKET, VERSION};
use crate::Micros;

pub const KIND_STREAM: u8 = 10;
pub const RESEND_US: Micros = 50_000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StreamPacket {
    pub token: u64,
    pub ack: u32,
    pub from: u32,
    pub messages: Vec<Vec<u8>>,
}

pub fn is_stream(buf: &[u8]) -> bool {
    buf.len() >= 3 && buf[0] == MAGIC && buf[1] == VERSION && buf[2] == KIND_STREAM
}

pub fn encode(c: &StreamPacket) -> Vec<u8> {
    let mut o = Out(vec![MAGIC, VERSION, KIND_STREAM]);
    o.u64(c.token).u32(c.ack).u32(c.from).u16(c.messages.len() as u16);
    for m in &c.messages {
        o.blob(m);
    }
    o.0
}

pub fn decode(buf: &[u8]) -> Result<StreamPacket, WireError> {
    if buf.len() > MAX_PACKET {
        return Err(WireError::TooLong);
    }
    if !is_stream(buf) {
        return Err(WireError::Kind);
    }
    let mut r = In { buf, at: 3 };
    let token = r.u64()?;
    let ack = r.u32()?;
    let from = r.u32()?;
    let count = r.u16()?;
    let messages = (0..count).map(|_| r.blob()).collect::<Result<_, _>>()?;
    r.done()?;
    Ok(StreamPacket { token, ack, from, messages })
}

#[derive(Debug)]
pub struct RoomStream {
    token: u64,
    outbox: VecDeque<Vec<u8>>,
    out_base: u32,
    received: u32,
    next_send: Micros,
    ack_owed: bool,
}

impl RoomStream {
    pub fn new(token: u64) -> Self {
        RoomStream { token, outbox: VecDeque::new(), out_base: 0, received: 0, next_send: 0, ack_owed: false }
    }

    pub fn push(&mut self, message: Vec<u8>) {
        self.outbox.push_back(message);
        self.next_send = 0;
    }

    pub fn unacked(&self) -> usize {
        self.outbox.len()
    }

    pub fn receive(&mut self, c: &StreamPacket) -> Vec<Vec<u8>> {
        while self.out_base < c.ack && self.outbox.pop_front().is_some() {
            self.out_base += 1;
        }
        let mut fresh = Vec::new();
        for (i, m) in c.messages.iter().enumerate() {
            if c.from.wrapping_add(i as u32) == self.received {
                fresh.push(m.clone());
                self.received += 1;
            }
        }
        if !c.messages.is_empty() {
            self.ack_owed = true;
            self.next_send = 0;
        }
        fresh
    }

    pub fn next_wake(&self) -> Option<Micros> {
        (self.ack_owed || !self.outbox.is_empty()).then_some(self.next_send)
    }

    pub fn poll(&mut self, now: Micros) -> Option<Vec<u8>> {
        if now < self.next_send || !(self.ack_owed || !self.outbox.is_empty()) {
            return None;
        }
        let mut messages = Vec::new();
        let mut size = 3 + 8 + 4 + 4 + 2;
        for m in &self.outbox {
            if size + 2 + m.len() > MAX_PACKET {
                break;
            }
            size += 2 + m.len();
            messages.push(m.clone());
        }
        self.ack_owed = false;
        self.next_send = if self.outbox.is_empty() { Micros::MAX } else { now + RESEND_US };
        Some(encode(&StreamPacket { token: self.token, ack: self.received, from: self.out_base, messages }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_lost_stream_packet_is_resent_and_delivered_once_in_order() {
        let mut a = RoomStream::new(5);
        let mut b = RoomStream::new(5);
        a.push(vec![1]);
        a.push(vec![2]);
        let lost = a.poll(0).unwrap();
        drop(lost);
        assert_eq!(a.poll(RESEND_US - 1), None);
        let again = decode(&a.poll(RESEND_US).unwrap()).unwrap();
        assert_eq!(b.receive(&again), vec![vec![1], vec![2]]);
        assert_eq!(b.receive(&again), Vec::<Vec<u8>>::new());
        let ack = decode(&b.poll(RESEND_US).unwrap()).unwrap();
        a.receive(&ack);
        assert_eq!(a.unacked(), 0);
    }
}
