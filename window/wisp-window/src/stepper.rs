//! The game's 60 Hz clock on its own thread (wisp:docs/native-window-plan.md, "The step clock"): it samples input and queues each step at its due time whatever the display does, and the render thread only moves the phase of those due times toward the vblank the scene will show at.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use crate::clock::Clock;
use crate::input::Input;
use crate::mailbox::{Mailbox, Sample, Submission};
use crate::sync::lock;

pub const STEP_NS: u64 = 1_000_000_000_u64.div_ceil(60);
const EARLY_TOLERANCE_NS: i64 = 1_000_000;
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
    fn input(&mut self) -> Input;
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

    /// `due_ns` moved later toward the aimed times, at most 0.25 ms; never earlier, so no two due times fall closer than a step. A due time up to 1 ms early of an aimed time stays, and one further ahead of it is moved later until it comes round to the next.
    fn delay(&self, due_ns: u64) -> u64 {
        let every = self.every_ns as i64;
        let ahead = (self.at_ns as i64 - due_ns as i64).rem_euclid(every);
        let error = if ahead > every / 2 { ahead - every } else { ahead };
        let delay = if error >= 0 { error.min(SLEW_NS) } else if error >= -EARLY_TOLERANCE_NS { 0 } else { SLEW_NS };
        (due_ns as i64 + delay) as u64
    }
}

/// The due times of the steps, at least a 60th of a second apart on the monotonic clock, so the game never takes more than 60 steps in any second. While the display asks for a phase, each due time moves at most 0.25 ms later toward it, so the clock settles on a display at or a little under 60 Hz and the rate never leaves 60 Hz by more than 1.5 %. A step the clock wakes too late for is dropped, never run late beside the next: the clock takes the step it woke for and goes on at the next due time still ahead.
#[derive(Default)]
pub struct Cadence {
    due_ns: Option<u64>,
}

impl Cadence {
    pub fn due_ns(&self, now_ns: u64) -> u64 {
        self.due_ns.unwrap_or(now_ns)
    }

    /// Moves past the step due at or before `now_ns` and returns how many later due times had passed by then, which it drops.
    pub fn advance(&mut self, now_ns: u64, aim: Option<Aim>) -> u32 {
        let due = self.due_ns(now_ns);
        let passed = now_ns.saturating_sub(due) / STEP_NS;
        let mut next = due + (passed + 1) * STEP_NS;
        if let Some(aim) = aim.filter(|aim| now_ns.saturating_sub(aim.asked_ns) <= AIM_LIFETIME_NS) {
            next = aim.delay(next);
        }
        self.due_ns = Some(next);
        passed.min(u32::MAX as u64) as u32
    }
}

/// One step the clock took: its frame, when its input was read and how long after its due time that was.
#[derive(Clone, Copy, Debug)]
pub struct Taken {
    pub frame: u32,
    pub sampled_ns: u64,
    pub late_ns: u64,
}

/// The steps taken since the render thread last looked, and how many the clock dropped.
#[derive(Default)]
pub struct Steps {
    pub taken: Vec<Taken>,
    pub dropped: u32,
}

#[derive(Default)]
struct State {
    cadence: Cadence,
    frame: u32,
    aim: Option<Aim>,
    taken: VecDeque<Taken>,
    dropped: u32,
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

    /// The frame the next step will carry and when it is due; the frame is also how many steps the game has been given.
    pub fn next(&self, now_ns: u64) -> (u32, u64) {
        let state = lock(&self.state);
        (state.frame, state.cadence.due_ns(now_ns))
    }

    pub fn aim(&self, aim: Option<Aim>) {
        lock(&self.state).aim = aim;
    }

    /// The steps taken since the last call, oldest first, and the steps dropped.
    pub fn take(&self) -> Steps {
        let mut state = lock(&self.state);
        Steps { taken: state.taken.drain(..).collect(), dropped: std::mem::take(&mut state.dropped) }
    }

    /// Takes the step due at or before `now_ns`, if one is: reads the input and queues it for the game, or answers it with an empty scene in the baseline; while loading, the clock runs and nothing is queued. A step whose game is still busy with the sample before it is dropped with its input left unread, so a stalled game loses the steps it could not take instead of running them all at once afterwards.
    pub fn tick(&self, now_ns: u64, mode: Mode, seam: &mut impl Seam, mailbox: &Mailbox) {
        let (frame, due) = {
            let mut state = lock(&self.state);
            let due = state.cadence.due_ns(now_ns);
            if now_ns < due {
                return;
            }
            let aim = state.aim;
            let passed = state.cadence.advance(now_ns, aim);
            if mode == Mode::Loading {
                return;
            }
            state.dropped = state.dropped.saturating_add(passed);
            if mode == Mode::Game && !mailbox.has_room() {
                state.dropped = state.dropped.saturating_add(1);
                return;
            }
            state.frame = state.frame.wrapping_add(1);
            (state.frame.wrapping_sub(1), due)
        };
        let sample = Sample { frame, sampled_ns: now_ns, input: seam.input() };
        if mode == Mode::Baseline {
            mailbox.submit(Submission { bytes: b"{}".to_vec(), step: frame as u64, frame, arrived_ns: now_ns });
        } else {
            mailbox.push_sample(sample);
        }
        let mut state = lock(&self.state);
        state.taken.push_back(Taken { frame, sampled_ns: now_ns, late_ns: now_ns - due });
        if state.taken.len() > TAKEN_LIMIT {
            state.taken.pop_front();
        }
    }
}

/// The step clock's thread: sleeps to each due time and takes the step in the mode `mode` reads, until the mailbox stops or `mode` reads none, as once the window has closed.
pub fn run(stepper: Arc<Stepper>, clock: impl Clock, mailbox: Arc<Mailbox>, mode: impl Fn() -> Option<Mode>, mut seam: impl Seam) {
    while !mailbox.is_stopping() {
        clock.sleep_until(stepper.due_ns(clock.now_ns()));
        let Some(mode) = mode() else {
            return;
        };
        stepper.tick(clock.now_ns(), mode, &mut seam, &mailbox);
    }
}

#[cfg(test)]
mod tests;
