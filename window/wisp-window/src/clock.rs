use std::sync::OnceLock;
use std::thread;
use std::time::{Duration, Instant};

use crate::mailbox::Mailbox;

fn origin() -> Instant {
    static ORIGIN: OnceLock<Instant> = OnceLock::new();
    *ORIGIN.get_or_init(Instant::now)
}

/// Nanoseconds on the monotonic clock the library shares with Bun, counted from the first call.
pub fn now_ns() -> u64 {
    origin().elapsed().as_nanos() as u64
}

/// The time the frame loop and the step clock run on: when things happen, how they sleep, and how long the frame loop waits for a scene.
pub trait Clock {
    fn now_ns(&self) -> u64;

    /// Sleeps until `target_ns` on this clock.
    fn sleep_until(&self, target_ns: u64) {
        let wait = target_ns.saturating_sub(self.now_ns());
        if wait > 0 {
            thread::sleep(Duration::from_nanos(wait));
        }
    }

    /// Waits until the scene for `frame` arrives or `deadline_ns` passes on this clock; true when it arrived.
    fn wait_for_scene(&self, mailbox: &Mailbox, frame: u32, deadline_ns: u64) -> bool {
        mailbox.wait_for_scene(frame, Duration::from_nanos(deadline_ns.saturating_sub(self.now_ns())))
    }
}

/// The library's own monotonic clock.
#[derive(Clone)]
pub struct LibraryClock;

impl Clock for LibraryClock {
    fn now_ns(&self) -> u64 {
        now_ns()
    }
}
