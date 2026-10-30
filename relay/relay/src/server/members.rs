use relay_proto::control::{self, Control};
use relay_proto::Micros;

use crate::path::{bind, Out, Path, Peer};
use crate::room::Body;
use crate::server::Server;

impl Server {
    pub(super) fn on_verify(&mut self, now: Micros, from: Peer, token: u64, cookie: u64) {
        if !self.cookie_ok(from, cookie, now) {
            return;
        }
        let Some(&(room, slot)) = self.tokens.get(&token) else {
            return;
        };
        let room = self.rooms.get_mut(&room).unwrap();
        room.heard = now;
        let slot = &mut room.slots[slot];
        match &mut slot.path {
            Some(p) if p.addr == from && p.verified => {}
            Some(p) if p.addr == from => {
                p.verified = true;
                self.stats.verified += 1;
            }
            _ => {
                slot.path = Some(Path::verified(from));
                self.stats.rebinds += 1;
                self.stats.verified += 1;
            }
        }
    }

    pub(super) fn on_leave(&mut self, now: Micros, token: u64) {
        let Some(&(id, slot)) = self.tokens.get(&token) else {
            return;
        };
        let room = self.rooms.get_mut(&id).unwrap();
        room.slots[slot].left = true;
        if room.done() {
            self.close(id, now);
        }
    }

    pub(super) fn on_peer(&mut self, now: Micros, from: Peer, bytes: &[u8], out: &mut Out) {
        let Some(&(id, index)) = control::token(bytes).and_then(|t| self.tokens.get(&t)) else {
            return;
        };
        let cookie = self.cookie(from, now);
        let room = self.rooms.get_mut(&id).unwrap();
        let slot = &mut room.slots[index];
        if !matches!(room.body, Body::Peer) || slot.left || slot.joined_by.is_none() {
            return;
        }
        room.heard = now;
        let path = bind(&mut slot.path, from, &mut self.stats.rebinds);
        if !path.verified {
            path.received += bytes.len() as u64;
            if path.challenge(cookie, now, self.cfg.challenge_gap_us, out) {
                self.stats.challenges += 1;
            }
            return;
        }
        let Ok(Control::Peer { payload, .. }) = control::decode(bytes) else {
            return;
        };
        let before = out.len();
        room.forward(index, &payload, out);
        room.relayed += out[before..].iter().map(|(_, b)| b.len() as u64).sum::<u64>();
        self.stats.forwarded += (out.len() - before) as u64;
    }
}
