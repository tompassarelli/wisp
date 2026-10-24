use std::collections::VecDeque;

use crate::cadence::Cadence;
use crate::depth::{self, DepthChoice, LinkSample, MAX_DEPTH, UNDERRUN_BAR};
use crate::wire::{
    self, Packet, Turn, Up, WireError, MAX_ACTION, MAX_PACKET, MAX_PACKETS_PER_TICK, NOT_STARTED,
};
use crate::Micros;

#[derive(Clone, Debug)]
pub struct AgentConfig {
    pub token: u64,
    pub cadence: Cadence,
    pub bar: f64,
    pub max_depth: u32,
    pub catch_up_gap_us: Micros,
    pub slew_us: Micros,
    pub settle_us: Micros,
    pub window_us: Micros,
    pub anchor_every: u32,
    pub margin_quantile: Option<f64>,
}

impl AgentConfig {
    pub fn new(token: u64, cadence: Cadence) -> Self {
        AgentConfig {
            token,
            cadence,
            bar: UNDERRUN_BAR,
            max_depth: MAX_DEPTH,
            catch_up_gap_us: 4_000,
            slew_us: 1_000,
            settle_us: 30_000_000,
            window_us: 10_000_000,
            anchor_every: 30,
            margin_quantile: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Fed {
    pub index: u32,
    pub turn: Turn,
    pub at: Micros,
}

#[derive(Clone, Debug, Default)]
pub struct AgentStats {
    pub underrun_at: Vec<Micros>,
    pub catch_ups: u64,
    pub fed: u64,
    pub buffer_sum_us: i128,
    pub max_extra_us: Micros,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AgentError {
    Wire(WireError),
    NotDown,
    WrongToken,
    ActionTooLong,
}

#[derive(Debug)]
pub struct Agent {
    cfg: AgentConfig,
    period: Micros,
    base: Option<Micros>,
    buffer: VecDeque<Option<Turn>>,
    next_feed: u32,
    received_through: u32,
    lobby: LinkSample,
    choice: Option<DepthChoice>,
    depth_us: Micros,
    window: VecDeque<(Micros, Micros)>,
    since_anchor: u32,
    anchor_target: Micros,
    anchor_applied: Micros,
    extra_us: Micros,
    catch_up: bool,
    last_feed: Micros,
    last_underrun: Micros,
    waiting: bool,
    actions: VecDeque<Vec<u8>>,
    action_base: u32,
    checksums: VecDeque<u32>,
    checksum_base: u32,
    next_send: Micros,
    up_seq: u32,
    stats: AgentStats,
}

impl Agent {
    pub fn new(cfg: AgentConfig, now: Micros) -> Self {
        let period = cfg.cadence.period_us();
        Agent {
            cfg,
            period,
            base: None,
            buffer: VecDeque::new(),
            next_feed: 0,
            received_through: 0,
            lobby: LinkSample::default(),
            choice: None,
            depth_us: 0,
            window: VecDeque::new(),
            since_anchor: 0,
            anchor_target: 0,
            anchor_applied: 0,
            extra_us: 0,
            catch_up: false,
            last_feed: now,
            last_underrun: now,
            waiting: false,
            actions: VecDeque::new(),
            action_base: 0,
            checksums: VecDeque::new(),
            checksum_base: 0,
            next_send: now,
            up_seq: 0,
            stats: AgentStats::default(),
        }
    }

    pub fn choice(&self) -> Option<&DepthChoice> {
        self.choice.as_ref()
    }

    pub fn stats(&self) -> &AgentStats {
        &self.stats
    }

    pub fn extra_us(&self) -> Micros {
        self.extra_us
    }

    pub fn period_us(&self) -> Micros {
        self.period
    }

    pub fn catching_up(&self) -> bool {
        self.catch_up
    }

    pub fn next_feed(&self) -> u32 {
        self.next_feed
    }

    pub fn unacked_actions(&self) -> usize {
        self.actions.len()
    }

    pub fn choose_depth(&mut self) -> DepthChoice {
        let choice = self.lobby.choose_with_margin(
            self.period,
            self.cfg.bar,
            self.cfg.max_depth,
            self.cfg.margin_quantile,
        );
        self.depth_us = choice.turns as Micros * self.period + choice.link.margin_us;
        self.anchor_target = choice.link.anchor_us;
        self.anchor_applied = choice.link.anchor_us;
        self.choice = Some(choice.clone());
        choice
    }

    pub fn on_packet(&mut self, now: Micros, bytes: &[u8]) -> Result<(), AgentError> {
        let down = match wire::decode(bytes).map_err(AgentError::Wire)? {
            Packet::Down(d) => d,
            Packet::Up(_) => return Err(AgentError::NotDown),
        };
        if down.token != self.cfg.token {
            return Err(AgentError::WrongToken);
        }
        let offset = now - down.sent_us as Micros;
        if self.choice.is_none() {
            self.lobby.record(down.seq, offset);
        }
        self.observe_offset(now, offset);
        if down.base_us != NOT_STARTED {
            self.base.get_or_insert(down.base_us as Micros);
        }
        while self.action_base < down.action_ack && self.actions.pop_front().is_some() {
            self.action_base += 1;
        }
        while self.checksum_base < down.checksum_ack && self.checksums.pop_front().is_some() {
            self.checksum_base += 1;
        }
        for (i, turn) in down.turns.into_iter().enumerate() {
            let index = down.turn_from.wrapping_add(i as u32);
            if index < self.next_feed {
                continue;
            }
            let slot = (index - self.next_feed) as usize;
            if slot >= self.buffer.len() {
                self.buffer.resize(slot + 1, None);
            }
            if self.buffer[slot].is_none() {
                self.buffer[slot] = Some(turn);
            }
        }
        self.advance_received();
        Ok(())
    }

    pub fn send_action(&mut self, now: Micros, data: Vec<u8>) -> Result<(), AgentError> {
        if data.len() > MAX_ACTION {
            return Err(AgentError::ActionTooLong);
        }
        self.actions.push_back(data);
        self.next_send = self.next_send.min(now);
        Ok(())
    }

    pub fn record_checksum(&mut self, value: u32) {
        self.checksums.push_back(value);
    }

    pub fn next_wake(&self) -> Micros {
        let mut wake = self.next_send;
        if let (Some(_), Some(_)) = (self.base, &self.choice) {
            match self.buffer.front() {
                Some(Some(_)) => wake = wake.min(self.due()),
                _ if !self.waiting => wake = wake.min(self.scheduled(self.next_feed)),
                _ => {}
            }
        }
        wake
    }

    pub fn poll(&mut self, now: Micros) -> (Vec<Fed>, Vec<Vec<u8>>) {
        let fed = self.feed(now);
        let packets = if now >= self.next_send {
            self.upstream(now)
        } else {
            Vec::new()
        };
        (fed, packets)
    }

    fn observe_offset(&mut self, now: Micros, offset: Micros) {
        self.window.push_back((now, offset));
        while self
            .window
            .front()
            .is_some_and(|&(t, _)| now - t > self.cfg.window_us)
        {
            self.window.pop_front();
        }
        self.since_anchor += 1;
        if self.since_anchor >= self.cfg.anchor_every {
            self.since_anchor = 0;
            let mut sorted: Vec<Micros> = self.window.iter().map(|&(_, o)| o).collect();
            sorted.sort_unstable();
            self.anchor_target = depth::percentile(&sorted, 0.05);
        }
    }

    fn advance_received(&mut self) {
        let mut i = (self.received_through - self.next_feed) as usize;
        while self.buffer.get(i).is_some_and(Option::is_some) {
            i += 1;
        }
        self.received_through = self.next_feed + i as u32;
    }

    fn nominal(&self, index: u32) -> Micros {
        self.base.unwrap_or(0)
            + self.cfg.cadence.relay_time(index)
            + self.anchor_applied
            + self.depth_us
    }

    fn scheduled(&self, index: u32) -> Micros {
        self.nominal(index) + self.extra_us
    }

    fn due(&self) -> Micros {
        if self.catch_up {
            self.last_feed + self.cfg.catch_up_gap_us
        } else {
            self.scheduled(self.next_feed)
        }
    }

    fn feed(&mut self, now: Micros) -> Vec<Fed> {
        let mut out = Vec::new();
        if self.base.is_none() || self.choice.is_none() {
            return out;
        }
        loop {
            let index = self.next_feed;
            if !matches!(self.buffer.front(), Some(Some(_))) {
                if !self.waiting && now >= self.scheduled(index) {
                    self.waiting = true;
                    self.stats.underrun_at.push(now);
                }
                break;
            }
            if now < self.due() {
                break;
            }
            if self.waiting {
                self.extra_us += now - self.scheduled(index);
                self.waiting = false;
                self.last_underrun = now;
            }
            let turn = self.buffer.pop_front().unwrap().unwrap();
            self.next_feed += 1;
            self.last_feed = now;
            self.settle(index, now);
            self.stats.fed += 1;
            self.stats.buffer_sum_us += (self.depth_us + self.extra_us) as i128;
            self.stats.max_extra_us = self.stats.max_extra_us.max(self.extra_us);
            out.push(Fed {
                index,
                turn,
                at: now,
            });
        }
        out
    }

    fn settle(&mut self, index: u32, now: Micros) {
        let t = self.period;
        if self.catch_up {
            self.extra_us = (now - self.nominal(index)).max(0);
            if self.extra_us <= t {
                self.catch_up = false;
            }
        } else if self.extra_us > 2 * t {
            self.catch_up = true;
            self.stats.catch_ups += 1;
        } else if self.extra_us > t {
            self.extra_us -= self.cfg.slew_us.min(self.extra_us - t);
        } else if self.extra_us > 0 && now - self.last_underrun >= self.cfg.settle_us {
            self.extra_us -= self.cfg.slew_us.min(self.extra_us);
        }
        let shift =
            (self.anchor_target - self.anchor_applied).clamp(-self.cfg.slew_us, self.cfg.slew_us);
        self.anchor_applied += shift;
    }

    fn upstream(&mut self, now: Micros) -> Vec<Vec<u8>> {
        self.next_send = now + self.period;
        let checksums = self.checksums.make_contiguous();
        let actions = self.actions.make_contiguous();
        let (mut sums_sent, mut actions_sent) = (0usize, 0usize);
        let mut out = Vec::new();
        loop {
            let head = Up {
                token: self.cfg.token,
                seq: self.up_seq,
                sent_us: now as u64,
                turn_ack: self.received_through,
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
            let done = sums_sent == checksums.len() && actions_sent == actions.len();
            if done || s + a == 0 || out.len() == MAX_PACKETS_PER_TICK {
                return out;
            }
        }
    }
}
