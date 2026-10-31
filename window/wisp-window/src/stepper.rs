//! The game's 60 Hz clock on its own thread (wisp:docs/native-window-plan.md, "The step clock"): it samples input and queues each step at its due time whatever the display does, and the render thread only moves the phase of those due times toward the vblank the scene will show at.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use crate::clock::Clock;
use crate::input::Input;
use crate::mailbox::{Mailbox, Sample, Submission};
use crate::sync::lock;

pub const STEP_NS: u64 = 1_000_000_000 / 60;
const CATCH_UP_STEPS: u64 = 6;
const SLEW_NS: i64 = 250_000;
const AIM_LIFETIME_NS: u64 = 100_000_000;
const COMMENSURATE_TOLERANCE: f64 = 0.02;
const TAKEN_LIMIT: usize = 64;

/// What the window is running: its loading state, the game, or the baseline, where Rust answers each step with an empty scene.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum Mode {
    Loading,
    Game,
    Baseline,
}

/// How the step clock reads input.
pub trait Seam {
    fn input(&self) -> Input;
}

/// The phase the display asks the clock to sample at: the times `at_ns + k * every_ns`, as asked at `asked_ns`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Aim {
    pub at_ns: u64,
    pub every_ns: u64,
    pub asked_ns: u64,
}

impl Aim {
    /// The sample times that put a step's scene, `lead_ns` after its sample, at a vblank of a display whose frames are `period_ns` long and one of which began at `vblank_ns`; none for a display whose rate is no whole multiple or fraction of 60 Hz, which the clock then leaves to run free.
    pub fn for_display(vblank_ns: u64, period_ns: u64, lead_ns: u64, asked_ns: u64) -> Option<Self> {
        if period_ns == 0 {
            return None;
        }
        let ratio = period_ns.max(STEP_NS) as f64 / period_ns.min(STEP_NS) as f64;
        if (ratio - ratio.round()).abs() > COMMENSURATE_TOLERANCE * ratio.round() {
            return None;
        }
        let every_ns = if period_ns < STEP_NS + STEP_NS / 2 { period_ns } else { STEP_NS };
        let at_ns = vblank_ns + (every_ns - lead_ns % every_ns) % every_ns;
        Some(Self { at_ns, every_ns, asked_ns })
    }

    /// `due_ns` moved at most 0.25 ms toward the nearest of the aimed times.
    fn pull(&self, due_ns: u64) -> u64 {
        let every = self.every_ns as i64;
        let ahead = (self.at_ns as i64 - due_ns as i64).rem_euclid(every);
        let error = if ahead > every / 2 { ahead - every } else { ahead };
        (due_ns as i64 + error.clamp(-SLEW_NS, SLEW_NS)) as u64
    }
}

/// The due times of the steps, one 60th of a second apart on the monotonic clock. While the display asks for a phase, each due time moves at most 0.25 ms toward it, so the rate never leaves 60 Hz by more than 1.5 % and settles on a display a little off 60 Hz; a clock more than six steps behind, as after a suspend, starts again from now instead of running the steps it missed.
#[derive(Default)]
pub struct Cadence {
    due_ns: Option<u64>,
}

impl Cadence {
    pub fn due_ns(&self, now_ns: u64) -> u64 {
        self.due_ns.unwrap_or(now_ns)
    }

    /// Moves past the step due at or before `now_ns`.
    pub fn advance(&mut self, now_ns: u64, aim: Option<Aim>) {
        let due = self.due_ns(now_ns);
        let mut next = due + STEP_NS;
        if now_ns >= due + CATCH_UP_STEPS * STEP_NS {
            next = now_ns + STEP_NS;
        }
        if let Some(aim) = aim.filter(|aim| now_ns.saturating_sub(aim.asked_ns) <= AIM_LIFETIME_NS) {
            next = aim.pull(next);
        }
        self.due_ns = Some(next);
    }
}

/// One step the clock took: its frame, when its input was read, how long after its due time that was, and whether the game's queue was full.
#[derive(Clone, Copy, Debug)]
pub struct Taken {
    pub frame: u32,
    pub sampled_ns: u64,
    pub late_ns: u64,
    pub dropped: bool,
}

#[derive(Default)]
struct State {
    cadence: Cadence,
    frame: u32,
    aim: Option<Aim>,
    taken: VecDeque<Taken>,
}

/// The step clock's state, shared by the thread that steps and the render thread that aims it and reads what it took.
#[derive(Default)]
pub struct Stepper {
    state: Mutex<State>,
}

impl Stepper {
    pub fn due_ns(&self, now_ns: u64) -> u64 {
        lock(&self.state).cadence.due_ns(now_ns)
    }

    /// The frame the next step will carry and when it is due.
    pub fn next(&self, now_ns: u64) -> (u32, u64) {
        let state = lock(&self.state);
        (state.frame, state.cadence.due_ns(now_ns))
    }

    pub fn aim(&self, aim: Option<Aim>) {
        lock(&self.state).aim = aim;
    }

    /// The steps taken since the last call, oldest first.
    pub fn take(&self) -> Vec<Taken> {
        lock(&self.state).taken.drain(..).collect()
    }

    /// Takes the step due at or before `now_ns`, if one is: reads the input and queues it for the game, or answers it with an empty scene in the baseline; while loading, the clock runs and nothing is queued.
    pub fn tick(&self, now_ns: u64, mode: Mode, seam: &impl Seam, mailbox: &Mailbox) {
        let (frame, due) = {
            let mut state = lock(&self.state);
            let due = state.cadence.due_ns(now_ns);
            if now_ns < due {
                return;
            }
            let aim = state.aim;
            state.cadence.advance(now_ns, aim);
            if mode == Mode::Loading {
                return;
            }
            state.frame = state.frame.wrapping_add(1);
            (state.frame.wrapping_sub(1), due)
        };
        let sample = Sample { frame, sampled_ns: now_ns, input: seam.input() };
        let dropped = if mode == Mode::Baseline {
            mailbox.submit(Submission { bytes: b"{}".to_vec(), step: frame as u64, frame, arrived_ns: now_ns });
            false
        } else {
            !mailbox.push_sample(sample)
        };
        let mut state = lock(&self.state);
        state.taken.push_back(Taken { frame, sampled_ns: now_ns, late_ns: now_ns - due, dropped });
        if state.taken.len() > TAKEN_LIMIT {
            state.taken.pop_front();
        }
    }
}

/// The step clock's thread: sleeps to each due time and takes the step in the mode `mode` reads, until the mailbox stops or `mode` reads none, as once the window has closed.
pub fn run(stepper: Arc<Stepper>, clock: impl Clock, mailbox: Arc<Mailbox>, mode: impl Fn() -> Option<Mode>, seam: impl Seam) {
    while !mailbox.is_stopping() {
        clock.sleep_until(stepper.due_ns(clock.now_ns()));
        let Some(mode) = mode() else {
            return;
        };
        stepper.tick(clock.now_ns(), mode, &seam, &mailbox);
    }
}

#[cfg(test)]
mod tests;
