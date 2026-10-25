use crate::Micros;

const FRAME_HZ: Micros = 60;
const SECOND: Micros = 1_000_000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Frames {
    pub visible_stalls: u64,
    pub frozen: u64,
    pub stretched_us: Micros,
    start: Micros,
    end: Micros,
    last_at: Option<Micros>,
    last_frame: Micros,
}

impl Frames {
    pub fn new(start: Micros, end: Micros) -> Self {
        Frames {
            visible_stalls: 0,
            frozen: 0,
            stretched_us: 0,
            start,
            end,
            last_at: None,
            last_frame: -1,
        }
    }

    fn frame(&self, at: Micros) -> Micros {
        (at - self.start) * FRAME_HZ / SECOND
    }

    pub fn feed(&mut self, at: Micros, step_us: Micros) {
        if at < self.start || at >= self.end {
            return;
        }
        if let Some(last) = self.last_at {
            if (at - last - step_us) * FRAME_HZ >= SECOND {
                self.visible_stalls += 1;
            }
        }
        self.last_at = Some(at);
        let frame = self.frame(at);
        self.frozen += (frame - self.last_frame - 1).max(0) as u64;
        self.last_frame = self.last_frame.max(frame);
    }

    pub fn close(&mut self) {
        let frames = self.frame(self.end);
        self.frozen += (frames - self.last_frame - 1).max(0) as u64;
        self.last_frame = self.last_frame.max(frames - 1);
    }
}
