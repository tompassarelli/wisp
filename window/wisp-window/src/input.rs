use crate::pointer::PointerSample;

/// The buttons the page names, in the bit order of the mask the frame callback carries; a pad presses them, and the keyboard is the game's key events (keys.rs).
pub const BUTTONS: [&str; 12] = ["left", "right", "up", "down", "attack", "special", "jump", "grab", "shield", "walk", "start", "view"];

/// What one sample point reads: the held buttons as a bit mask, the left stick, Y up, raw, and the mouse.
#[derive(Clone, Copy, Default, PartialEq, Debug)]
pub struct Input {
    pub buttons: u32,
    pub axis_x: f32,
    pub axis_y: f32,
    pub pointer: PointerSample,
}

impl Input {
    /// The same reading for a sample that repeats the one before it: a click is delivered once.
    pub fn repeated(self) -> Self {
        Self { pointer: self.pointer.repeated(), ..self }
    }
}
