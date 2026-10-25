use super::Agent;
use crate::transport::Transport;
use crate::wire::{self, Up, MAX_PACKET, MAX_PACKETS_PER_TICK};
use crate::Micros;

impl Agent {
    pub(super) fn upstream(&mut self, now: Micros) -> Vec<Vec<u8>> {
        let (cover, cover_turns) = match (&self.choice, self.cover, self.transport) {
            (Some(c), 1.., Transport::Udp) => (self.cover, (c.turns + 1).min(u8::MAX as u32) as u8),
            _ => (0, 0),
        };
        self.next_send = now + self.period;
        let checksums = self.checksums.make_contiguous();
        let actions = self.actions.make_contiguous();
        let (mut sums_sent, mut actions_sent) = match self.transport {
            Transport::Udp => (0, 0),
            Transport::Tcp => (
                (self.streamed_checksums.saturating_sub(self.checksum_base) as usize)
                    .min(checksums.len()),
                (self.streamed_actions.saturating_sub(self.action_base) as usize)
                    .min(actions.len()),
            ),
        };
        let mut out = Vec::new();
        loop {
            let head = Up {
                token: self.cfg.token,
                seq: self.up_seq,
                sent_us: now as u64,
                turn_ack: self.received_through,
                cover,
                cover_turns,
                checksum_from: self.checksum_base + sums_sent as u32,
                checksums: Vec::new(),
                action_from: self.action_base + actions_sent as u32,
                actions: Vec::new(),
            };
            self.up_seq = self.up_seq.wrapping_add(1);
            let (bytes, s, a) = wire::encode_up(
                &head,
                &checksums[sums_sent..],
                &actions[actions_sent..],
                MAX_PACKET,
            );
            out.push(bytes);
            sums_sent += s;
            actions_sent += a;
            self.streamed_checksums = self.checksum_base + sums_sent as u32;
            self.streamed_actions = self.action_base + actions_sent as u32;
            let done = sums_sent == checksums.len() && actions_sent == actions.len();
            if done || s + a == 0 || out.len() == MAX_PACKETS_PER_TICK {
                return out;
            }
        }
    }
}
