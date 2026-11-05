use std::sync::Mutex;

use winit::event::{MouseButton, MouseScrollDelta};

use crate::sync::lock;

/// The pixels of a touchpad scroll that make one notch of a wheel.
const PIXELS_PER_NOTCH: f32 = 40.0;

/// The bit of a button in the masks a pointer sample carries.
pub fn button_bit(button: MouseButton) -> Option<u8> {
    match button {
        MouseButton::Left => Some(1),
        MouseButton::Right => Some(2),
        MouseButton::Middle => Some(4),
        _ => None,
    }
}

/// What one sample point reads of the mouse: the cursor in physical pixels from the window's top-left, the window's size, whether the cursor is over it, the buttons held and the buttons pressed and released since the last sample, and the whole notches the wheel turned since the last sample, positive away from the user.
#[derive(Clone, Copy, Default, PartialEq, Debug)]
pub struct PointerSample {
    pub x: f32,
    pub y: f32,
    pub width: u32,
    pub height: u32,
    pub inside: bool,
    pub held: u8,
    pub pressed: u8,
    pub released: u8,
    pub wheel: i16,
}

impl PointerSample {
    /// The masks and the inside flag in one number, for the sample the game's thread reads: held in bits 0 to 2, pressed in 4 to 6, released in 8 to 10, inside in bit 12.
    pub fn bits(self) -> u32 {
        self.held as u32 | (self.pressed as u32) << 4 | (self.released as u32) << 8 | (self.inside as u32) << 12
    }
}

#[derive(Default)]
struct State {
    x: f32,
    y: f32,
    inside: bool,
    held: u8,
    pressed: u8,
    released: u8,
    wheel: f32,
}

/// The mouse as the window thread hears it, read by the render thread at its sample point; a press and a release between two samples both survive until the next one.
#[derive(Default)]
pub struct Pointer {
    state: Mutex<State>,
}

impl Pointer {
    pub fn moved(&self, x: f32, y: f32) {
        let mut state = lock(&self.state);
        state.x = x;
        state.y = y;
        state.inside = true;
    }

    pub fn left(&self) {
        lock(&self.state).inside = false;
    }

    /// A turn of the wheel in notches; a touchpad's pixels count for a notch at `PIXELS_PER_NOTCH`, and a part of a notch waits for the rest of it.
    pub fn wheel(&self, delta: MouseScrollDelta) {
        let notches = match delta {
            MouseScrollDelta::LineDelta(_, y) => y,
            MouseScrollDelta::PixelDelta(position) => position.y as f32 / PIXELS_PER_NOTCH,
        };
        lock(&self.state).wheel += notches;
    }

    pub fn button(&self, button: MouseButton, down: bool) {
        let Some(bit) = button_bit(button) else { return };
        let mut state = lock(&self.state);
        if down {
            state.held |= bit;
            state.pressed |= bit;
        } else if state.held & bit != 0 {
            state.held &= !bit;
            state.released |= bit;
        }
    }

    /// A window that lost focus releases the buttons it held, so none stays down for the game.
    pub fn clear(&self) {
        let mut state = lock(&self.state);
        state.released |= state.held;
        state.held = 0;
    }

    /// A button pressed since the last sample reads as held in this one even if it was released again, and that release is reported in the next sample, so a click quicker than a frame is still a press the game sees held for one step.
    pub fn sample(&self, width: u32, height: u32) -> PointerSample {
        let mut state = lock(&self.state);
        let quick = state.pressed & state.released;
        let wheel = state.wheel.trunc();
        state.wheel -= wheel;
        let sample = PointerSample { x: state.x, y: state.y, width, height, inside: state.inside, held: state.held | state.pressed, pressed: state.pressed, released: state.released & !quick, wheel: wheel as i16 };
        state.pressed = 0;
        state.released = quick;
        sample
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_press_and_release_between_samples_reach_two_samples_in_order() {
        let pointer = Pointer::default();
        pointer.moved(10.0, 20.0);
        pointer.button(MouseButton::Left, true);
        pointer.button(MouseButton::Left, false);
        let sample = pointer.sample(1280, 720);
        assert_eq!((sample.x, sample.y, sample.width, sample.height), (10.0, 20.0, 1280, 720));
        assert_eq!((sample.held, sample.pressed, sample.released), (1, 1, 0), "the press is held for one sample");
        let next = pointer.sample(1280, 720);
        assert_eq!((next.held, next.pressed, next.released), (0, 0, 1), "its release follows");
        assert_eq!(pointer.sample(1280, 720).released, 0, "an edge is delivered once");
    }

}
