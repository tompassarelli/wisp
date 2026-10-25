use crate::Micros;

const FRAME_HZ: Micros = 60;
const SECOND: Micros = 1_000_000;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Frames {
    pub callbackless: u64,
    pub stalls: u64,
    pub long_stalls: u64,
    pub double_callbacks: u64,
    pub catch_up_us: Micros,
    pub max_per_poll: u32,
    pub peak_lag_us: Micros,
    pub lag_events: u64,
    pub long_lag_events: u64,
    start: Micros,
    end: Micros,
    game_us: Micros,
    last_feed: Option<Micros>,
    last_callback: Option<Micros>,
    per_poll: u32,
    stall_level: u8,
    lag_level: u8,
}

fn half_frames(us: Micros) -> Micros {
    us * 2 * FRAME_HZ / SECOND
}

impl Frames {
    pub fn new(start: Micros, end: Micros) -> Self {
        Frames {
            start,
            end,
            ..Frames::default()
        }
    }

    pub fn feed(&mut self, at: Micros, step_us: Micros, lag_us: Micros, late_us: Micros, catch_up: bool) {
        if at < self.start || at >= self.end {
            return;
        }
        self.per_poll = if self.last_feed == Some(at) { self.per_poll + 1 } else { 1 };
        self.max_per_poll = self.max_per_poll.max(self.per_poll);
        if let (true, Some(last)) = (catch_up, self.last_feed) {
            self.catch_up_us += at - last;
        }
        self.last_feed = Some(at);
        let before = self.game_us * FRAME_HZ / SECOND;
        self.game_us += step_us;
        for _ in before..self.game_us * FRAME_HZ / SECOND {
            self.callback(at);
        }
        self.peak_lag_us = self.peak_lag_us.max(lag_us);
        self.lag(late_us);
    }

    fn callback(&mut self, at: Micros) {
        let Some(last) = self.last_callback.replace(at) else {
            return;
        };
        let halves = half_frames(at - last);
        if halves < 1 {
            self.double_callbacks += 1;
        }
        self.callbackless += ((halves + 1) / 2 - 1).max(0) as u64;
        if halves < 3 {
            self.stall_level = 0;
            return;
        }
        if self.stall_level < 1 {
            self.stalls += 1;
            self.stall_level = 1;
        }
        if halves >= 5 && self.stall_level < 2 {
            self.long_stalls += 1;
            self.stall_level = 2;
        }
    }

    fn lag(&mut self, late_us: Micros) {
        let frames = late_us * FRAME_HZ / SECOND;
        if frames < 1 {
            self.lag_level = 0;
            return;
        }
        if frames >= 2 && self.lag_level < 2 {
            self.lag_events += 1;
        }
        if frames >= 4 && self.lag_level < 4 {
            self.long_lag_events += 1;
        }
        self.lag_level = self.lag_level.max(frames.min(4) as u8);
    }
}
