use crate::input::Input;
use crate::stepper::Seam;

const PERIOD_NS: u64 = 16_666_667;

struct Quiet;

impl Seam for Quiet {
    fn input(&mut self) -> Input {
        Input::default()
    }
}

mod simulated;
