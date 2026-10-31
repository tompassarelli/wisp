use std::sync::atomic::{AtomicU32, Ordering};
use winit::keyboard::KeyCode;

use crate::pointer::PointerSample;

/// The buttons the page names, in the bit order of the mask the frame callback carries.
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

/// The bit of the button a physical key presses, from the table the page keeps for `event.code`.
pub fn button_bit(code: KeyCode) -> Option<u32> {
    let bit = match code {
        KeyCode::ArrowLeft | KeyCode::KeyA => 0,
        KeyCode::ArrowRight | KeyCode::KeyD => 1,
        KeyCode::ArrowUp | KeyCode::KeyW => 2,
        KeyCode::ArrowDown | KeyCode::KeyS => 3,
        KeyCode::KeyJ => 4,
        KeyCode::KeyK => 5,
        KeyCode::Space => 6,
        KeyCode::KeyL => 7,
        KeyCode::ShiftLeft | KeyCode::ShiftRight => 8,
        KeyCode::ControlLeft => 9,
        KeyCode::Enter => 10,
        KeyCode::KeyV => 11,
        _ => return None,
    };
    Some(bit)
}

/// Buttons held by key, shared between the window thread that hears the keys and the render thread that samples them.
#[derive(Default)]
pub struct Held {
    mask: AtomicU32,
    shifts: AtomicU32,
}

impl Held {
    pub fn press(&self, code: KeyCode, down: bool) {
        let Some(bit) = button_bit(code) else { return };
        let side = match code {
            KeyCode::ShiftLeft => 1,
            KeyCode::ShiftRight => 2,
            _ => 0,
        };
        if side != 0 {
            let shifts = if down { self.shifts.fetch_or(side, Ordering::AcqRel) | side } else { self.shifts.fetch_and(!side, Ordering::AcqRel) & !side };
            self.set(bit, shifts != 0);
        } else {
            self.set(bit, down);
        }
    }

    fn set(&self, bit: u32, down: bool) {
        if down {
            self.mask.fetch_or(1 << bit, Ordering::AcqRel);
        } else {
            self.mask.fetch_and(!(1 << bit), Ordering::AcqRel);
        }
    }

    pub fn clear(&self) {
        self.mask.store(0, Ordering::Release);
        self.shifts.store(0, Ordering::Release);
    }

    pub fn sample(&self) -> u32 {
        self.mask.load(Ordering::Acquire)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_press_and_release_their_buttons() {
        let held = Held::default();
        held.press(KeyCode::KeyA, true);
        held.press(KeyCode::KeyJ, true);
        assert_eq!(held.sample(), 0b1_0001);
        held.press(KeyCode::KeyA, false);
        assert_eq!(held.sample(), 0b1_0000);
        held.press(KeyCode::KeyQ, true);
        assert_eq!(held.sample(), 0b1_0000);
    }

    #[test]
    fn shield_stays_held_until_both_shift_keys_are_up() {
        let held = Held::default();
        held.press(KeyCode::ShiftLeft, true);
        held.press(KeyCode::ShiftRight, true);
        held.press(KeyCode::ShiftLeft, false);
        assert_eq!(held.sample(), 1 << 8);
        held.press(KeyCode::ShiftRight, false);
        assert_eq!(held.sample(), 0);
    }

    #[test]
    fn losing_focus_releases_every_key() {
        let held = Held::default();
        held.press(KeyCode::Enter, true);
        held.press(KeyCode::ShiftLeft, true);
        held.clear();
        assert_eq!(held.sample(), 0);
    }
}
