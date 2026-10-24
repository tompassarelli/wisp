use super::Agent;
use crate::depth::{self, DepthChoice, LinkEstimate};
use crate::Micros;

impl Agent {
    pub(super) fn choose_covered(&self) -> DepthChoice {
        let pick = |cover: u8| {
            self.lobby.choose_with_cover(
                self.period,
                self.cfg.bar,
                self.cfg.max_depth,
                self.cfg.margin_quantile,
                cover,
            )
        };
        let depth_of = |c: &DepthChoice| c.turns as Micros * self.period + c.link.margin_us;
        let fits = |c: &DepthChoice| !c.too_poor && depth_of(c) <= self.cfg.cover_from_us;
        let choice = pick(0);
        if self.cfg.max_cover == 0 || choice.link.loss_after_loss <= self.cfg.bursty {
            return choice;
        }
        let cap = (self.cfg.cover_cap_us / self.period).max(1) as u32;
        (1..=self.cfg.max_cover)
            .map(pick)
            .find(fits)
            .unwrap_or_else(|| {
                let mut c = pick(self.cfg.max_cover);
                if c.turns > cap {
                    c.turns = cap;
                    c.too_poor = false;
                }
                c
            })
    }

    pub(super) fn count(&mut self, seq: u32) {
        if self.choice.is_none() {
            return;
        }
        self.match_loss.record(seq);
        if self.match_loss.counts().total >= self.next_review {
            self.next_review += self.cfg.cover_every;
            self.review_cover();
        }
    }

    pub(super) fn review_cover(&mut self) {
        let Some(choice) = &self.choice else {
            return;
        };
        if self.cover >= self.cfg.max_cover {
            return;
        }
        let (loss, loss_after_loss) = self.lobby_counts.add(&self.match_loss.counts()).rates();
        if loss_after_loss <= self.cfg.bursty {
            return;
        }
        let link = LinkEstimate {
            loss,
            loss_after_loss,
            ..choice.link.clone()
        };
        let late = |cover: u8| {
            depth::predicted_late_with_cover(
                &link,
                &self.lobby_offsets,
                self.period,
                choice.turns,
                cover,
            )
        };
        self.cover = (self.cover..=self.cfg.max_cover)
            .find(|&c| late(c) <= self.cfg.bar)
            .unwrap_or(self.cfg.max_cover);
    }
}
