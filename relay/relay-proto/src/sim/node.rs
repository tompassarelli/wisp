use super::{Fed, Node, Scenario, UpAction};
use crate::wire::{self, digest_turn, Packet};
use crate::Micros;

impl Node {
    pub(super) fn receive(&mut self, now: Micros, bytes: &[u8], keep: bool) {
        self.note_arrivals(now, bytes, keep);
        let local = self.clock.local(now);
        let _ = self.agent.on_packet(local, bytes);
    }

    fn note_arrivals(&mut self, now: Micros, bytes: &[u8], keep: bool) {
        let (from, count) = match wire::decode(bytes) {
            Ok(Packet::Down(d)) => {
                if keep {
                    self.out.down_arrivals.push((d.seq, now - d.sent_us as Micros));
                }
                (d.turn_from as usize, d.turns.len())
            }
            Ok(Packet::Cover(c)) => (c.turn_from as usize, c.turns.len()),
            _ => return,
        };
        let end = from + count;
        if end > self.arrived.len() {
            self.arrived.resize(end, Micros::MIN);
        }
        for got in &mut self.arrived[from..end] {
            if *got == Micros::MIN {
                *got = now;
            }
        }
    }

    pub(super) fn step(&mut self, now: Micros, s: &Scenario) -> Vec<Vec<u8>> {
        if now >= self.next_action {
            self.act(now, s);
        }
        let before = self.agent.stats().underrun_at.len();
        let catch_up = self.agent.catching_up();
        let (fed, packets) = self.agent.poll(self.clock.local(now));
        for _ in before..self.agent.stats().underrun_at.len() {
            self.out.underruns.push(now);
        }
        for (k, f) in fed.into_iter().enumerate() {
            self.record_feed(now, f, s, catch_up && k == 0);
        }
        packets
    }

    fn act(&mut self, now: Micros, s: &Scenario) {
        let spec = &s.agents[self.index];
        let mut data = vec![self.index as u8];
        data.extend_from_slice(&self.action_count.to_le_bytes());
        let extra =
            self.rng
                .range(spec.action_bytes.0 as i64, spec.action_bytes.1 as i64) as usize;
        data.extend((0..extra).map(|_| self.rng.next_u64() as u8));
        self.action_count += 1;
        self.sent_at.push(now);
        let action = UpAction {
            release: self.rng.chance(spec.releases),
            data,
        };
        if s.keep_turns {
            self.out.sent.push(action.clone());
        }
        let _ = self.agent.send_action(self.clock.local(now), action);
        let gap = self.rng.exp(1e6 / spec.actions_hz) as Micros;
        let actions_end = s.lobby_us + s.match_us;
        self.next_action = if now + gap < actions_end {
            now + gap
        } else {
            Micros::MAX
        };
    }

    fn record_feed(&mut self, now: Micros, f: Fed, s: &Scenario, catch_up: bool) {
        let match_start = s.lobby_us;
        self.out.fed_digest = digest_turn(self.out.fed_digest, f.index, &f.turn);
        self.out.fed_count += 1;
        self.agent.record_checksum(self.out.fed_digest as u32);
        let step = s.cadence.step_ms(f.index.wrapping_sub(1)) as Micros * 1000;
        if let Some(last) = self.last_feed {
            if ((now - last) - step).abs() > 2_000 {
                self.out.uneven_feeds += 1;
            }
        }
        self.out.frames.feed(f.at, step, f.lag_us, f.at - f.target, catch_up);
        self.last_feed = Some(now);
        for a in &f.turn.actions {
            if a.player as usize == self.index && a.data.len() >= 5 {
                let count = u32::from_le_bytes([a.data[1], a.data[2], a.data[3], a.data[4]]);
                if let Some(&sent) = self.sent_at.get(count as usize) {
                    self.out.echo.add(now - sent);
                }
            }
        }
        let period = self.agent.period_us();
        for (k, &(_, outage_end)) in s.outages.iter().enumerate() {
            if self.out.drains[k].is_none()
                && now >= outage_end
                && outage_end > match_start
                && !self.agent.catching_up()
                && self.agent.extra_us() <= period
            {
                self.out.drains[k] = Some(now - outage_end);
            }
        }
        if s.keep_turns {
            self.out.fed.push(f);
        }
    }
}
