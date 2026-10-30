//! Pads, read at the sample point (wisp:docs/native-window-plan.md, "Pads, keyboard and platforms").

use crate::input::Input;

pub const STANDARD_BUTTONS: usize = 16;

/// The page bit each standard-layout button index presses, from the table the browser keeps for `Gamepad.buttons`.
const PAGE_BIT: [Option<u32>; STANDARD_BUTTONS] =
    [Some(4), Some(6), Some(5), Some(6), Some(9), Some(7), Some(8), Some(8), Some(11), Some(10), None, None, Some(2), Some(3), Some(0), Some(1)];

/// One pad as the standard layout names it: a bit per button index and the left stick as it comes, Y up.
#[derive(Clone, Copy, Default, PartialEq, Debug)]
pub struct PadState {
    pub buttons: u16,
    pub axis_x: f32,
    pub axis_y: f32,
}

impl PadState {
    pub fn with_button(mut self, index: usize, down: bool) -> Self {
        if down && index < STANDARD_BUTTONS {
            self.buttons |= 1 << index;
        }
        self
    }

    fn page_mask(self) -> u32 {
        PAGE_BIT.iter().enumerate().filter(|(index, _)| self.buttons >> index & 1 == 1).filter_map(|(_, bit)| *bit).fold(0, |mask, bit| mask | 1 << bit)
    }
}

/// A platform's pads. `read` takes in whatever the system has queued and returns the pad at slot `index`, or the first connected pad when `index` is `None`.
pub trait PadBackend {
    fn read(&mut self, index: Option<usize>) -> Option<PadState>;
}

struct NoPads;

impl PadBackend for NoPads {
    fn read(&mut self, _: Option<usize>) -> Option<PadState> {
        None
    }
}

pub struct Pads {
    backend: Box<dyn PadBackend>,
}

impl Pads {
    pub fn open() -> Self {
        Self::with(platform())
    }

    pub fn with(backend: Box<dyn PadBackend>) -> Self {
        Self { backend }
    }

    /// The pad's input at this sample point, merged over `keys`. The pad is always read, so events do not pile up while the window is unfocused, but an unfocused window gets no pad input.
    pub fn sample(&mut self, index: Option<usize>, focused: bool, keys: u32) -> Input {
        let pad = self.backend.read(index).filter(|_| focused).unwrap_or_default();
        Input { buttons: keys | pad.page_mask(), axis_x: pad.axis_x, axis_y: pad.axis_y }
    }
}

#[cfg(target_os = "linux")]
fn platform() -> Box<dyn PadBackend> {
    match crate::pad_gilrs::GilrsPads::open() {
        Some(pads) => Box::new(pads),
        None => Box::new(NoPads),
    }
}

#[cfg(windows)]
fn platform() -> Box<dyn PadBackend> {
    Box::new(crate::pad_windows::WindowsPads::default())
}

#[cfg(not(any(target_os = "linux", windows)))]
fn platform() -> Box<dyn PadBackend> {
    Box::new(NoPads)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixed(Vec<(usize, PadState)>);

    impl PadBackend for Fixed {
        fn read(&mut self, index: Option<usize>) -> Option<PadState> {
            self.0.iter().find(|(slot, _)| index.is_none_or(|wanted| wanted == *slot)).map(|(_, state)| *state)
        }
    }

    fn pads(slots: &[(usize, PadState)]) -> Pads {
        Pads::with(Box::new(Fixed(slots.to_vec())))
    }

    fn names(mask: u32) -> Vec<&'static str> {
        crate::input::BUTTONS.iter().enumerate().filter(|(bit, _)| mask >> bit & 1 == 1).map(|(_, name)| *name).collect()
    }

    #[test]
    fn pad_input_presses_the_buttons_the_browser_maps_standard_buttons_to() {
        let expected = [
            (0, "attack"), (1, "jump"), (2, "special"), (3, "jump"), (4, "walk"), (5, "grab"), (6, "shield"), (7, "shield"),
            (8, "view"), (9, "start"), (12, "up"), (13, "down"), (14, "left"), (15, "right"),
        ];
        for (index, name) in expected {
            let input = pads(&[(0, PadState::default().with_button(index, true))]).sample(None, true, 0);
            assert_eq!(names(input.buttons), [name], "standard button {index}");
        }
        for index in [10, 11] {
            let input = pads(&[(0, PadState::default().with_button(index, true))]).sample(None, true, 0);
            assert_eq!(input.buttons, 0, "stick click {index} presses nothing");
        }
    }

    #[test]
    fn pad_input_axes_pass_through_raw_with_y_up() {
        let state = PadState { buttons: 0, axis_x: -0.1, axis_y: 0.9 };
        let input = pads(&[(0, state)]).sample(None, true, 0);
        assert_eq!((input.axis_x, input.axis_y), (-0.1, 0.9));
    }

    #[test]
    fn pad_input_adds_to_the_keys_held() {
        let input = pads(&[(0, PadState::default().with_button(0, true))]).sample(None, true, 1 << 1);
        assert_eq!(names(input.buttons), ["right", "attack"]);
    }

    #[test]
    fn pad_input_gamepad_index_selects_one_pad_and_the_default_takes_the_first() {
        let slots = [(1, PadState::default().with_button(0, true)), (3, PadState::default().with_button(2, true))];
        assert_eq!(names(pads(&slots).sample(None, true, 0).buttons), ["attack"]);
        assert_eq!(names(pads(&slots).sample(Some(3), true, 0).buttons), ["special"]);
        assert_eq!(pads(&slots).sample(Some(2), true, 0).buttons, 0);
    }

    #[test]
    fn pad_input_is_cleared_while_the_window_is_unfocused() {
        let state = PadState { buttons: 1, axis_x: 1.0, axis_y: 1.0 };
        let input = pads(&[(0, state)]).sample(None, false, 0);
        assert_eq!((input.buttons, input.axis_x, input.axis_y), (0, 0.0, 0.0));
    }
}
