use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::Duration;

use crate::input::Input;
use crate::sync::lock;

pub const QUEUE_CAPACITY: usize = 8;
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

#[derive(Default)]
pub struct Mailbox {
    samples: Mutex<Samples>,
    sample_ready: Condvar,
    scene: Mutex<Option<Submission>>,
    scene_ready: Condvar,
    stopping: AtomicBool,
}

impl Mailbox {
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

    /// Keeps the scene for the newest sample answered, so a scene that arrives after a newer one is dropped; after a stop it keeps nothing.
    pub fn submit(&self, submission: Submission) {
        let mut scene = lock(&self.scene);
        if self.is_stopping() {
            return;
        }
        if scene.as_ref().is_none_or(|held| held.frame <= submission.frame) {
            *scene = Some(submission);
        }
        self.scene_ready.notify_one();
    }

    pub(crate) fn wait_for_scene(&self, frame: u32, timeout: Duration) -> bool {
        let guard = lock(&self.scene);
        let (guard, _) = self
            .scene_ready
            .wait_timeout_while(guard, timeout, |scene| !scene.as_ref().is_some_and(|held| held.frame >= frame) && !self.is_stopping())
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        guard.as_ref().is_some_and(|held| held.frame >= frame)
    }

    pub(crate) fn take_scene(&self) -> Option<Submission> {
        lock(&self.scene).take()
    }

    pub fn is_stopping(&self) -> bool {
        self.stopping.load(Ordering::Acquire)
    }

    /// Wakes every waiter and ends the stream with `End::Stopped`; a scene submitted after this returns is ignored.
    pub fn stop(&self) {
        self.stopping.store(true, Ordering::Release);
        self.end(End::Stopped);
        lock(&self.scene).take();
        self.scene_ready.notify_all();
    }
}
