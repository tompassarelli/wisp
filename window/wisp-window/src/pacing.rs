use std::collections::VecDeque;

const WORK_WINDOW: usize = 120;
const WORK_MINIMUM: usize = 10;
const MARGIN_START_MS: f64 = 1.0;
const MARGIN_GROWTH_MS: f64 = 0.5;
const CLEAN_FRAMES_TO_SHRINK: u32 = 600;
const MARGIN_LIMIT_MS: f64 = 6.0;
const SIM_HZ: f64 = 60.0;
const FALLBACK_WORK_MS: f64 = 4.0;
const WAKE_LIMIT_MS: f64 = 2.0;
const PHASE_CREEP_NS: u64 = 50_000;
const CATCH_UP_STEPS: u64 = 6;

/// Where in a display frame the sample is taken: late enough that the step, the encode and the draw finish just before the present, early enough to leave the measured p99 and a margin.
pub struct Pacer {
    work: VecDeque<f64>,
    finish: VecDeque<f64>,
    wake: VecDeque<f64>,
    margin_ms: f64,
    clean: u32,
}

impl Default for Pacer {
    fn default() -> Self {
        Self { work: VecDeque::new(), finish: VecDeque::new(), wake: VecDeque::new(), margin_ms: MARGIN_START_MS, clean: 0 }
    }
}

fn push(window: &mut VecDeque<f64>, value: f64) {
    window.push_back(value);
    if window.len() > WORK_WINDOW {
        window.pop_front();
    }
}

fn p99(window: &VecDeque<f64>) -> Option<f64> {
    if window.len() < WORK_MINIMUM {
        return None;
    }
    let mut sorted: Vec<f64> = window.iter().copied().collect();
    sorted.sort_by(f64::total_cmp);
    Some(sorted[((sorted.len() as f64 * 0.99).ceil() as usize).clamp(1, sorted.len()) - 1])
}

impl Pacer {
    /// Records one frame: `work_ms` from the sample to the scene's arrival, `finish_ms` from the scene's arrival to the present call.
    pub fn record(&mut self, work_ms: f64, finish_ms: f64) {
        push(&mut self.work, work_ms);
        push(&mut self.finish, finish_ms);
    }

    /// How late the render thread woke from a sleep it timed to a point in the frame: the scheduler's lateness, which the deadline's own wake will add to the present.
    pub fn record_wake(&mut self, late_ms: f64) {
        push(&mut self.wake, late_ms);
    }

    /// A frame that presented on time grows the clean run; after 600 the margin gives back what a miss took.
    pub fn clean_frame(&mut self) {
        self.clean += 1;
        if self.clean >= CLEAN_FRAMES_TO_SHRINK {
            self.clean = 0;
            self.margin_ms = (self.margin_ms - MARGIN_GROWTH_MS).max(MARGIN_START_MS);
        }
    }

    /// A late scene or a missed present: the next samples move earlier.
    pub fn missed(&mut self) {
        self.clean = 0;
        self.margin_ms = (self.margin_ms + MARGIN_GROWTH_MS).min(MARGIN_LIMIT_MS);
    }

    #[cfg(test)]
    pub fn margin_ms(&self) -> f64 {
        self.margin_ms
    }

    fn finish_ms(&self) -> f64 {
        p99(&self.finish).unwrap_or(FALLBACK_WORK_MS / 2.0) + p99(&self.wake).unwrap_or(0.0).min(WAKE_LIMIT_MS) + self.margin_ms
    }

    /// The time the game gets between the sample and the deadline. A late scene is cut off at the deadline, so its measured time says only that the budget was too small: the margin, which a miss grows, widens it.
    fn work_ms(&self) -> f64 {
        p99(&self.work).unwrap_or(FALLBACK_WORK_MS) + self.margin_ms
    }

    /// Milliseconds after the acquire at which to sample, for a display frame of `period_ms`.
    pub fn sample_offset_ms(&self, period_ms: f64) -> f64 {
        (period_ms - self.work_ms() - self.finish_ms()).max(0.0)
    }

    /// Milliseconds after the acquire by which the scene must have arrived to be drawn and presented before the next vblank.
    pub fn scene_deadline_ms(&self, period_ms: f64) -> f64 {
        (period_ms - self.finish_ms()).max(0.0)
    }
}

/// How many steps each display frame runs on the 60 Hz sim clock: one on the first frame whose acquire is at or after the step's due time, so a 144 Hz display steps on every 2nd or 3rd vblank and redraws the last scene between, and every step that came due since on a frame slower than the sim, up to six, so a display that falls as low as 10 Hz drops frames instead of slowing the game.
#[derive(Default)]
pub struct StepClock {
    due_ns: Option<u64>,
}

impl StepClock {
    pub fn steps_due(&mut self, acquired_ns: u64, period_ms: f64) -> u32 {
        let step_ns = (1e9 / SIM_HZ) as u64;
        let slack_ns = ((period_ms * 1e6) as u64).min(step_ns) / 2;
        let due = *self.due_ns.get_or_insert(acquired_ns);
        let reach = acquired_ns + slack_ns;
        if reach < due {
            return 0;
        }
        let behind = (reach - due) / step_ns + 1;
        if behind > CATCH_UP_STEPS {
            self.due_ns = Some(acquired_ns + step_ns);
            return 1;
        }
        self.due_ns = Some(due + behind * step_ns);
        behind as u32
    }
}

/// The vblank phase learned while a `Fifo` acquire blocked on the display, used to time a mode whose acquire returns at once.
#[derive(Default)]
pub struct Phase {
    anchor_ns: Option<u64>,
}

impl Phase {
    /// Takes one blocking acquire and returns the vblank it stands for. A wake is never early, so an acquire before the extrapolated vblank moves the phase to it, and one after leaves the phase where it was but for a creep of 50 us that follows a display slightly off its nominal rate; a wake latency therefore never moves the frame's anchor.
    pub fn lock(&mut self, acquired_ns: u64, period_ms: f64) -> u64 {
        let period = (period_ms * 1e6) as u64;
        let locked = match self.anchor_ns {
            Some(anchor) if period > 0 && acquired_ns > anchor => {
                let predicted = anchor + ((acquired_ns - anchor + period / 2) / period) * period;
                if acquired_ns < predicted { acquired_ns } else { predicted + (acquired_ns - predicted).min(PHASE_CREEP_NS) }
            }
            _ => acquired_ns,
        };
        self.anchor_ns = Some(locked);
        locked
    }

    /// The first vblank at or after `now_ns`, extrapolated from the learned anchor; none before one is learned.
    pub fn next_vblank_ns(&self, now_ns: u64, period_ms: f64) -> Option<u64> {
        let anchor = self.anchor_ns?;
        let period = (period_ms * 1e6) as u64;
        if period == 0 || now_ns <= anchor {
            return Some(anchor);
        }
        Some(anchor + (now_ns - anchor).div_ceil(period) * period)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sample_point_leaves_the_measured_work_and_a_margin() {
        let mut pacer = Pacer::default();
        for _ in 0..50 {
            pacer.record(2.0, 1.0);
        }
        assert!((pacer.sample_offset_ms(16.667) - (16.667 - 2.0 - 1.0 - 2.0)).abs() < 1e-9);
        assert!((pacer.scene_deadline_ms(16.667) - (16.667 - 1.0 - 1.0)).abs() < 1e-9);
    }

    #[test]
    fn a_miss_moves_the_sample_earlier_and_clean_frames_give_it_back() {
        let mut pacer = Pacer::default();
        for _ in 0..50 {
            pacer.record(2.0, 1.0);
        }
        let before = pacer.sample_offset_ms(16.667);
        pacer.missed();
        assert!((before - pacer.sample_offset_ms(16.667) - 2.0 * MARGIN_GROWTH_MS).abs() < 1e-9, "a miss moves the sample point earlier by the margin's growth in the work and the finish");
        for _ in 0..CLEAN_FRAMES_TO_SHRINK {
            pacer.clean_frame();
        }
        assert_eq!(pacer.margin_ms(), MARGIN_START_MS);
    }

    #[test]
    fn the_sample_point_falls_back_before_there_are_measurements() {
        let pacer = Pacer::default();
        assert!(pacer.sample_offset_ms(16.667) > 0.0 && pacer.sample_offset_ms(16.667) < 16.667);
        assert_eq!(Pacer::default().sample_offset_ms(2.0), 0.0);
    }

    fn steps_over(hz: f64, seconds: f64) -> Vec<u64> {
        let period_ns = (1e9 / hz) as u64;
        let mut clock = StepClock::default();
        let mut vblank = 0;
        let mut stepped = Vec::new();
        for k in 0..(hz * seconds) as u64 {
            if clock.steps_due(1_000_000 + k * period_ns, 1e3 / hz) > 0 {
                stepped.push(k);
                vblank = k;
            }
        }
        assert!(vblank > 0);
        stepped
    }

    #[test]
    fn sixty_hertz_steps_on_every_vblank() {
        assert_eq!(steps_over(60.0, 2.0).len(), 120);
    }

    #[test]
    fn a_144_hz_display_steps_sixty_times_a_second_two_or_three_vblanks_apart() {
        let steps = steps_over(144.0, 10.0);
        assert!((599..=601).contains(&steps.len()), "{} steps in ten seconds", steps.len());
        assert!(steps.windows(2).all(|pair| (2..=3).contains(&(pair[1] - pair[0]))));
    }

    #[test]
    fn a_120_hz_display_steps_sixty_times_a_second_every_second_vblank() {
        let steps = steps_over(120.0, 10.0);
        assert!((599..=601).contains(&steps.len()), "{} steps in ten seconds", steps.len());
        assert!(steps.windows(2).all(|pair| pair[1] - pair[0] == 2));
    }

    #[test]
    fn a_display_slightly_off_its_rate_still_steps_sixty_times_a_second() {
        for hz in [119.88, 143.9, 239.76] {
            let steps = steps_over(hz, 10.0);
            let rate = steps.len() as f64 / 10.0;
            assert!((rate - 60.0).abs() <= 0.2, "{hz} Hz stepped {rate} a second");
        }
    }

    #[test]
    fn a_display_under_sixty_hertz_still_steps_sixty_times_a_second() {
        for hz in [50.0, 40.0, 30.0, 20.0, 10.0] {
            let period_ns = (1e9 / hz) as u64;
            let mut clock = StepClock::default();
            let steps: u32 = (0..(hz * 10.0) as u64).map(|k| clock.steps_due(1_000_000 + k * period_ns, 1e3 / hz)).sum();
            let last_frame_short = (60.0 / hz).ceil() as u32;
            assert!((600 - last_frame_short..=601).contains(&steps), "{hz} Hz ran {steps} steps in ten seconds");
        }
    }

    #[test]
    fn a_missed_vblank_runs_the_step_it_skipped() {
        let mut clock = StepClock::default();
        let period_ns = 16_666_667;
        let vblanks = [0, 1, 2, 4, 5, 6];
        let steps: Vec<u32> = vblanks.iter().map(|k| clock.steps_due(1_000_000 + k * period_ns, 16.667)).collect();
        assert_eq!(steps, [1, 1, 1, 2, 1, 1]);
    }

    #[test]
    fn a_stall_catches_up_at_most_one_step() {
        let mut clock = StepClock::default();
        let period_ns = 8_333_333;
        for k in 0..10 {
            clock.steps_due(1_000_000 + k * period_ns, 8.333);
        }
        let after = 1_000_000 + 10 * period_ns + 2_000_000_000;
        let stepped = (0..5).filter(|k| clock.steps_due(after + k * period_ns, 8.333) > 0).count();
        assert!(stepped <= 3, "{stepped} steps in five vblanks after a two second stall");
    }

    #[test]
    fn the_phase_extrapolates_from_the_learned_vblank() {
        let mut phase = Phase::default();
        assert_eq!(phase.next_vblank_ns(5, 10.0), None);
        phase.lock(1_000_000, 10.0);
        assert_eq!(phase.next_vblank_ns(1_000_001, 10.0), Some(11_000_000));
        assert_eq!(phase.next_vblank_ns(31_000_000, 10.0), Some(31_000_000));
    }

    #[test]
    fn a_late_wake_does_not_move_the_vblank_it_stands_for() {
        let mut phase = Phase::default();
        assert_eq!(phase.lock(1_000_000, 10.0), 1_000_000);
        assert_eq!(phase.lock(11_000_000 + 4_000_000, 10.0), 11_000_000 + PHASE_CREEP_NS);
        assert_eq!(phase.lock(21_000_000 + PHASE_CREEP_NS, 10.0), 21_000_000 + PHASE_CREEP_NS);
        assert_eq!(phase.lock(31_000_000 - 20_000, 10.0), 31_000_000 - 20_000, "an early acquire moves the phase to it");
    }

    #[test]
    fn the_deadline_leaves_the_measured_wake_lateness() {
        let mut pacer = Pacer::default();
        for _ in 0..50 {
            pacer.record(2.0, 1.0);
            pacer.record_wake(0.75);
        }
        assert!((pacer.scene_deadline_ms(16.667) - (16.667 - 1.0 - 0.75 - 1.0)).abs() < 1e-9);
    }
}
