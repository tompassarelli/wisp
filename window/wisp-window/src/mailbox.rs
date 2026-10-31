use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::Duration;

use crate::input::Input;
use crate::sync::lock;

/// How many samples wait for the game at most: one, so a game that falls behind is never more than a step behind and never runs a backlog of steps at once.
pub const QUEUE_CAPACITY: usize = 1;

#[derive(Clone, Copy, PartialEq, Debug)]
pub struct Sample {
    pub frame: u32,
    pub sampled_ns: u64,
    pub input: Input,
}

pub struct Submission {
    pub bytes: Vec<u8>,
    pub step: u64,
    pub frame: u32,
    /// When the scene reached the library, on its clock.
    pub arrived_ns: u64,
}

/// What ended the stream of samples: the player closing the window, the library failing, or `stop`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum End {
    Closed,
    Failed,
    Stopped,
}

/// What a consumer blocked in `next_event` gets back.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Event {
    Timeout,
    Frame(Sample),
    Ended(End),
}

#[derive(Default)]
struct Samples {
    queue: VecDeque<Sample>,
    end: Option<End>,
}

const ARRIVAL_MEMORY: usize = 32;

/// The scene not yet drawn, the newest sample answered, and when each recent answer arrived, which drawing a scene leaves in place.
#[derive(Default)]
struct Scenes {
    held: Option<Submission>,
    answered: Option<u32>,
    arrivals: [Option<(u32, u64)>; ARRIVAL_MEMORY],
}

#[derive(Default)]
pub struct Mailbox {
    samples: Mutex<Samples>,
    sample_ready: Condvar,
    scene: Mutex<Scenes>,
    scene_ready: Condvar,
    stopping: AtomicBool,
}

impl Mailbox {
    /// Whether a sample pushed now would be queued.
    pub(crate) fn has_room(&self) -> bool {
        lock(&self.samples).queue.len() < QUEUE_CAPACITY
    }

    pub(crate) fn push_sample(&self, sample: Sample) -> bool {
        let mut samples = lock(&self.samples);
        if samples.queue.len() >= QUEUE_CAPACITY {
            return false;
        }
        samples.queue.push_back(sample);
        self.sample_ready.notify_one();
        true
    }

    /// The oldest queued sample, waiting up to `timeout` for one; a zero timeout never waits. A stop outranks every queued sample, and a close or failure follows the samples taken before it.
    pub fn next_event(&self, timeout: Duration) -> Event {
        let guard = lock(&self.samples);
        let (mut guard, _) = self
            .sample_ready
            .wait_timeout_while(guard, timeout, |samples| samples.queue.is_empty() && samples.end.is_none())
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if guard.end == Some(End::Stopped) {
            return Event::Ended(End::Stopped);
        }
        match (guard.queue.pop_front(), guard.end) {
            (Some(sample), _) => Event::Frame(sample),
            (None, Some(end)) => Event::Ended(end),
            (None, None) => Event::Timeout,
        }
    }

    /// Ends the stream for its consumer; the first end stays, except that a stop replaces a close or failure.
    pub fn end(&self, end: End) {
        let mut samples = lock(&self.samples);
        if samples.end.is_none() || end == End::Stopped {
            samples.end = Some(end);
        }
        self.sample_ready.notify_all();
    }

    /// Keeps the scene for the newest sample answered, so a scene that arrives after a newer one is dropped, and notes when each answer arrived; after a stop it keeps nothing.
    pub fn submit(&self, submission: Submission) {
        let mut scenes = lock(&self.scene);
        if self.is_stopping() {
            return;
        }
        scenes.arrivals[submission.frame as usize % ARRIVAL_MEMORY] = Some((submission.frame, submission.arrived_ns));
        scenes.answered = scenes.answered.max(Some(submission.frame));
        if scenes.held.as_ref().is_none_or(|held| held.frame <= submission.frame) {
            scenes.held = Some(submission);
        }
        self.scene_ready.notify_one();
    }

    /// Waits up to `timeout` until the scene for `frame` or a newer one has arrived, whether or not it was drawn since; false after a stop.
    pub(crate) fn wait_for_scene(&self, frame: u32, timeout: Duration) -> bool {
        let answered = |scenes: &Scenes| scenes.answered.is_some_and(|answered| answered >= frame);
        let guard = lock(&self.scene);
        let (guard, _) = self
            .scene_ready
            .wait_timeout_while(guard, timeout, |scenes| !answered(scenes) && !self.is_stopping())
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        answered(&guard) && !self.is_stopping()
    }

    /// When the scene for `frame` arrived, if it has and is among the last 32 answered.
    pub(crate) fn arrived_ns(&self, frame: u32) -> Option<u64> {
        lock(&self.scene).arrivals[frame as usize % ARRIVAL_MEMORY].filter(|(answered, _)| *answered == frame).map(|(_, arrived)| arrived)
    }

    pub(crate) fn take_scene(&self) -> Option<Submission> {
        lock(&self.scene).held.take()
    }

    pub fn is_stopping(&self) -> bool {
        self.stopping.load(Ordering::Acquire)
    }

    /// Wakes every waiter and ends the stream with `End::Stopped`; a scene submitted after this returns is ignored.
    pub fn stop(&self) {
        self.stopping.store(true, Ordering::Release);
        self.end(End::Stopped);
        *lock(&self.scene) = Scenes::default();
        self.scene_ready.notify_all();
    }
}
