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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_scene_drawn_twice_steps_nothing_and_a_jump_back_restarts() {
        let mut clock = Clock::default();
        assert_eq!(clock.tick(60), Tick { now: 1.0, step: 0.0, restarted: false });
        assert!((clock.tick(63).step - 3.0 / 60.0).abs() < 1e-6);
        assert_eq!(clock.tick(63).step, 0.0);
        assert!(clock.tick(10).restarted);
        assert!(clock.tick(10 + 60).restarted, "a gap past a quarter second starts over");
    }
}
