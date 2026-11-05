use std::collections::VecDeque;

use crate::pacing::Phase;

const PERIOD_SPAN_FRAMES: u64 = 600;
const PERIOD_MIN_SPAN_FRAMES: u64 = 30;
const PENDING_LIMIT: usize = 8;
const SEARCH_CREEP_MS: f64 = 0.2;
const BASE_MARGIN_MS: f64 = 1.0;
const WIDEN_MS: f64 = 0.5;
const MISS_WINDOW_FRAMES: u64 = 300;
const MISSES_TO_WIDEN: usize = 3;
const COST_WINDOW: usize = 600;
const AIM_TOLERANCE_NS: u64 = 100_000;
const SETTLE_FRAMES: u32 = 60;
const SLACK_KEPT_MS: f64 = 0.25;

/// One image the display reported: when it reached the screen on the library's clock, the display's frame counter then, and whether the display dropped it for a newer one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Shown {
    pub shown_ns: u64,
    pub msc: u64,
    pub skipped: bool,
}

/// Where the lock stands: searching for the latch by moving it later, settling at the latch found while the step clock comes round and the loop's own slack is measured, or locked.
#[derive(Clone, Copy, Default, PartialEq)]
enum Stage {
    #[default]
    Searching,
    Settling { frames: u32, slack_ms: f64 },
    Locked,
}

#[derive(Clone, Copy)]
struct Present {
    presented_ns: u64,
    lead_ms: f64,
}

/// Locks the frame loop to the display's own presentation reports: the vblank grid, its true period from the reported frame counter, and the lead, how long before a reported vblank a present must be made for that vblank to show it. The loop paces to the latch grid, each vblank less the lead, as it would to vblanks. Each present is judged on its own against the grid: it misses when the display shows it after the first vblank its lead aimed it at, or drops it for a newer one. Once the reports have measured the period, the lead shrinks 0.2 ms a frame, so the latch only ever moves later, which the step clock follows. Two misses in a row give the headroom the display needs, the second present's time before its vblank and two creeps, where one alone is a frame dearer than most, and the lead becomes that headroom plus a margin: 1 ms, and the spread between the median frame's GPU cost and the dearest seen, so a frame that costs more, such as one that carries a press, still makes its vblank. That lead counts no slack, the time the loop leaves between a present and its latch, so it is safe whatever the loop does; after 60 frames for the step clock to come round, the least slack over the next 60, less 0.25 ms, moves the lead later once, and it locks; a miss while it settles keeps the lead where it is. Locked, it moves only when three misses within 300 frames, each made at the current lead, widen it by 0.5 ms. It never moves earlier otherwise, because the step clock keeps a sample up to 1 ms past its aim where it is and meets a latch moved further earlier only by slewing a whole period later.
#[derive(Default)]
pub struct DisplayLock {
    phase: Phase,
    counted: VecDeque<(u64, u64)>,
    presents: VecDeque<Present>,
    costs: VecDeque<f64>,
    lead_ms: Option<f64>,
    stage: Stage,
    searched_missed: bool,
    frames: u64,
    misses: VecDeque<u64>,
    crossings: u32,
}

impl DisplayLock {
    /// Records a present call, which the display's next report answers.
    pub fn presented(&mut self, presented_ns: u64, period_ms: f64) {
        let lead_ms = self.lead_ms(period_ms);
        self.presents.push_back(Present { presented_ns, lead_ms });
        if self.presents.len() > PENDING_LIMIT {
            self.presents.pop_front();
        }
    }

    /// Records what a frame cost the GPU, which sizes the margin the lock leaves for a dearer frame.
    pub fn cost(&mut self, cost_ms: f64) {
        self.costs.push_back(cost_ms);
        if self.costs.len() > COST_WINDOW {
            self.costs.pop_front();
        }
    }

    /// Takes one report, oldest first, and returns whether it showed its present after the vblank the present was aimed at; none are judged before the reports have measured the period.
    pub fn observe(&mut self, shown: Shown, nominal_period_ms: f64) -> bool {
        if !shown.skipped {
            self.count(shown);
        }
        let measured = self.period_ms();
        let period_ms = measured.unwrap_or(nominal_period_ms);
        if !shown.skipped {
            self.phase.lock(shown.shown_ns, period_ms);
        }
        let Some(present) = self.presents.pop_front() else {
            return false;
        };
        let lead_ns = (present.lead_ms * 1e6) as u64;
        let aimed = self.vblank_from((present.presented_ns + lead_ns).saturating_sub(AIM_TOLERANCE_NS), shown, period_ms);
        let (Some(aimed), Some(_)) = (aimed, measured) else {
            return false;
        };
        let missed = shown.skipped || shown.shown_ns as f64 > aimed as f64 + period_ms * 5e5;
        self.crossings += u32::from(missed);
        self.frames += 1;
        self.steer(missed, present, aimed.saturating_sub(present.presented_ns) as f64 / 1e6, period_ms);
        missed
    }

    /// Moves the lead after one judged present that was made `headroom_ms` before the vblank it was aimed at.
    fn steer(&mut self, missed: bool, present: Present, headroom_ms: f64, period_ms: f64) {
        let current = self.lead_ms(period_ms);
        match self.stage {
            Stage::Searching if missed && !self.searched_missed => {
                self.searched_missed = true;
                self.lead_ms = Some((current - SEARCH_CREEP_MS).max(0.0));
            }
            Stage::Searching if missed => {
                self.lead_ms = Some((headroom_ms + 2.0 * SEARCH_CREEP_MS + self.margin_ms()).min(period_ms));
                self.stage = Stage::Settling { frames: 0, slack_ms: f64::INFINITY };
            }
            Stage::Searching => {
                self.searched_missed = false;
                self.lead_ms = Some((current - SEARCH_CREEP_MS).max(0.0));
            }
            Stage::Settling { frames, slack_ms } if present.lead_ms == current => {
                let slack_ms = if missed { 0.0 } else if frames >= SETTLE_FRAMES { slack_ms.min(headroom_ms - present.lead_ms) } else { slack_ms };
                self.stage = if frames >= 2 * SETTLE_FRAMES {
                    self.lead_ms = Some((current - (slack_ms - SLACK_KEPT_MS).max(0.0)).max(0.0));
                    Stage::Locked
                } else {
                    Stage::Settling { frames: frames + 1, slack_ms }
                };
            }
            Stage::Settling { .. } => {}
            Stage::Locked if missed && present.lead_ms == current => {
                self.misses.push_back(self.frames);
                while self.misses.front().is_some_and(|frame| self.frames - frame >= MISS_WINDOW_FRAMES) {
                    self.misses.pop_front();
                }
                if self.misses.len() >= MISSES_TO_WIDEN {
                    self.misses.clear();
                    self.lead_ms = Some((current + WIDEN_MS).min(period_ms));
                }
            }
            Stage::Locked => {}
        }
    }

    /// The first vblank at or after `at_ns` on the grid through the reported one, earlier or later than it.
    fn vblank_from(&self, at_ns: u64, shown: Shown, period_ms: f64) -> Option<u64> {
        let period = (period_ms * 1e6) as u64;
        let reported = self.phase.next_vblank_ns(shown.shown_ns, period_ms)?;
        if period == 0 {
            return None;
        }
        Some(if at_ns <= reported { reported - (reported - at_ns) / period * period } else { reported + (at_ns - reported).div_ceil(period) * period })
    }

    /// The room the lock leaves past the last lead that made its vblank: 1 ms and how much more than the median frame the dearest frame seen cost the GPU.
    fn margin_ms(&self) -> f64 {
        let mut costs: Vec<f64> = self.costs.iter().copied().collect();
        costs.sort_by(f64::total_cmp);
        let spread = costs.last().zip(costs.get(costs.len() / 2)).map_or(0.0, |(dearest, median)| dearest - median);
        BASE_MARGIN_MS + spread
    }

    fn count(&mut self, shown: Shown) {
        match self.counted.back() {
            Some((_, msc)) if shown.msc == *msc => return,
            Some((_, msc)) if shown.msc < *msc => self.counted.clear(),
            _ => {}
        }
        self.counted.push_back((shown.shown_ns, shown.msc));
        while self.counted.front().is_some_and(|(_, msc)| shown.msc - msc > PERIOD_SPAN_FRAMES) {
            self.counted.pop_front();
        }
    }

    /// The display's frame in milliseconds, measured from its reports over up to 600 frames; none before they span 30.
    pub fn period_ms(&self) -> Option<f64> {
        let (&(first_ns, first_msc), &(last_ns, last_msc)) = (self.counted.front()?, self.counted.back()?);
        let span = last_msc - first_msc;
        (span >= PERIOD_MIN_SPAN_FRAMES).then(|| last_ns.saturating_sub(first_ns) as f64 / span as f64 / 1e6)
    }

    /// The first latch at or after `now_ns`: a reported vblank less the lead; none before a report came.
    pub fn next_vblank_ns(&self, now_ns: u64, period_ms: f64) -> Option<u64> {
        let lead = (self.lead_ms(period_ms) * 1e6) as u64;
        self.phase.next_vblank_ns(now_ns + lead, period_ms).map(|vblank| vblank - lead)
    }

    /// How long before a reported vblank the present must be made for that vblank to show it; a period less one creep before the search starts.
    pub fn lead_ms(&self, period_ms: f64) -> f64 {
        self.lead_ms.unwrap_or(period_ms - SEARCH_CREEP_MS)
    }

    /// Whether the display has reported a present.
    pub fn reporting(&self) -> bool {
        !self.counted.is_empty()
    }

    /// How many presents showed after the vblank they were aimed at, or were dropped.
    pub fn crossings(&self) -> u32 {
        self.crossings
    }
}

