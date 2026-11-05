//! The clock every emitter births by: a scene's game frame at 60 a second, so a scene drawn twice births nothing twice, and a jump back or a long gap starts the sky over.

const FRAMES_PER_SECOND: f32 = 60.0;
const LONGEST_STEP: f32 = 0.25;

/// Where emitters stand for one scene: its time in seconds, the seconds since the last scene, and whether what they hold must be dropped.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(super) struct Tick {
    pub now: f32,
    pub step: f32,
    pub restarted: bool,
}

#[derive(Default)]
pub(super) struct Clock {
    frame: Option<u32>,
    now: f32,
}

impl Clock {
    pub(super) fn tick(&mut self, frame: u32) -> Tick {
        let seconds = frame as f32 / FRAMES_PER_SECOND;
        let (step, restarted) = match self.frame {
            Some(last) if frame >= last && seconds - self.now <= LONGEST_STEP => (seconds - self.now, false),
            Some(_) => (0.0, true),
            None => (0.0, false),
        };
        self.frame = Some(frame);
        self.now = seconds;
        Tick { now: seconds, step, restarted }
    }
}
