use crate::Micros;

const SECOND: Micros = 1_000_000;
const CALLBACK_HZ: Micros = 60;
const RAISE_STEP_US: Micros = 8_000;
const SPIKY_WINDOW_US: Micros = 60 * SECOND;

pub fn ceiling(headroom_us: Option<Micros>, depth_us: Micros, max_total_us: Micros) -> Micros {
    headroom_us.map_or(0, |h| h.min(max_total_us - depth_us).max(0) / RAISE_STEP_US * RAISE_STEP_US)
}

#[derive(Debug)]
pub(super) struct Raise {
    ceiling_us: Micros,
    pub floor_us: Micros,
    pub spiky: bool,
    pub stalls: u64,
    game_us: Micros,
    last_callback: Option<Micros>,
    stalled: bool,
    last_stall: Option<Micros>,
}

impl Raise {
    pub fn new() -> Self {
        Raise {
            ceiling_us: 0,
            floor_us: 0,
            spiky: false,
            stalls: 0,
            game_us: 0,
            last_callback: None,
            stalled: false,
            last_stall: None,
        }
    }

    pub fn cap(&mut self, ceiling_us: Micros) {
        self.ceiling_us = ceiling_us;
    }

    pub fn fed(&mut self, now: Micros, step_us: Micros) {
        let before = self.game_us * CALLBACK_HZ / SECOND;
        self.game_us += step_us;
        let mut stall = false;
        for _ in before..self.game_us * CALLBACK_HZ / SECOND {
            if let Some(last) = self.last_callback.replace(now) {
                let long = (now - last) * 2 * CALLBACK_HZ >= 3 * SECOND;
                stall |= long && !self.stalled;
                self.stalled = long;
            }
        }
        if stall {
            self.stalls += 1;
            if self.last_stall.is_some_and(|at| now - at <= SPIKY_WINDOW_US) {
                self.spiky = true;
            }
            self.last_stall = Some(now);
        }
    }

    pub fn floor(&mut self) -> Micros {
        if self.spiky {
            self.floor_us = self.ceiling_us;
        }
        self.floor_us
    }
}
