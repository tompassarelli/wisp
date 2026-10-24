use super::Agent;
use crate::depth::{self, LinkEstimate};

impl Agent {
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
