use std::net::SocketAddr;

use relay_proto::control::{self, Control};
use relay_proto::transport::Transport;
use relay_proto::wire::{self, Down, Packet, DOWN_HEADER, MAX_PACKET};
use relay_proto::Micros;

pub const AMPLIFICATION: u64 = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Peer {
    pub addr: SocketAddr,
    pub via: Transport,
}

impl Peer {
    pub fn tcp(addr: SocketAddr) -> Self {
        Peer {
            addr,
            via: Transport::Tcp,
        }
    }
}

impl From<SocketAddr> for Peer {
    fn from(addr: SocketAddr) -> Self {
        Peer {
            addr,
            via: Transport::Udp,
        }
    }
}

impl PartialEq<SocketAddr> for Peer {
    fn eq(&self, other: &SocketAddr) -> bool {
        *self == Peer::from(*other)
    }
}

pub type Out = Vec<(Peer, Vec<u8>)>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Delivery {
    Sent,
    Trimmed,
    Withheld,
    Undecodable,
}

#[derive(Debug)]
pub(crate) struct Path {
    pub(crate) addr: Peer,
    pub(crate) verified: bool,
    pub(crate) received: u64,
    pub(crate) sent: u64,
    pub(crate) last_challenge: Option<Micros>,
}

impl Path {
    pub(crate) fn verified(addr: Peer) -> Self {
        Path {
            addr,
            verified: true,
            received: 0,
            sent: 0,
            last_challenge: None,
        }
    }

    pub(crate) fn challenge(&mut self, cookie: u64, now: Micros, gap: Micros, out: &mut Out) -> bool {
        if self.verified || self.last_challenge.is_some_and(|t| now - t < gap) {
            return false;
        }
        let sent = self.send(control::encode(&Control::Challenge { cookie }), out);
        if sent {
            self.last_challenge = Some(now);
        }
        sent
    }

    pub(crate) fn budget(&self) -> u64 {
        (AMPLIFICATION * self.received).saturating_sub(self.sent)
    }

    pub(crate) fn send(&mut self, bytes: Vec<u8>, out: &mut Out) -> bool {
        if !self.verified {
            if bytes.len() as u64 > self.budget() {
                return false;
            }
            self.sent += bytes.len() as u64;
        }
        out.push((self.addr, bytes));
        true
    }
}

pub(crate) fn bind<'a>(slot: &'a mut Option<Path>, from: Peer, rebinds: &mut u64) -> &'a mut Path {
    if slot.as_ref().is_none_or(|p| p.addr != from) {
        *rebinds += 1;
        *slot = None;
    }
    slot.get_or_insert_with(|| Path {
        addr: from,
        verified: false,
        received: 0,
        sent: 0,
        last_challenge: None,
    })
}

pub(crate) fn send_down(path: &mut Path, bytes: Vec<u8>, out: &mut Out) -> Delivery {
    if path.verified || bytes.len() as u64 <= path.budget() {
        path.send(bytes, out);
        return Delivery::Sent;
    }
    let budget = path.budget().min(MAX_PACKET as u64) as usize;
    let Ok(Packet::Down(down)) = wire::decode(&bytes) else {
        return Delivery::Undecodable;
    };
    if budget < DOWN_HEADER {
        return Delivery::Withheld;
    }
    let head = Down {
        turns: Vec::new(),
        ..down.clone()
    };
    let (trimmed, _) = wire::encode_down(&head, &down.turns, budget);
    path.send(trimmed, out);
    Delivery::Trimmed
}
