//! Pads, read at the sample point (wisp:docs/native-window-plan.md, "Pads, keyboard and platforms").

use padbridge_model::{pad_bindings, pad_key, Control, PadKind, PadPreset, Press, RightStick, TriggerShields};

use crate::input::Input;
use crate::pointer::PointerSample;

pub const STANDARD_BUTTONS: usize = 16;

const CONTROLS: [Control; STANDARD_BUTTONS] = [
    Control::A, Control::B, Control::X, Control::Y, Control::Lb, Control::Rb, Control::Lt, Control::Rt,
    Control::Back, Control::Start, Control::LeftStick, Control::LeftStick, Control::DpadUp, Control::DpadDown, Control::DpadLeft, Control::DpadRight,
];

const RIGHT_STICK_CLICK: usize = 11;

const PAGE_BIT: [(char, u32); 9] = [
    (pad_key::ATTACK, 4), (pad_key::SPECIAL, 5), (pad_key::JUMP, 6), (pad_key::GRAB, 7), (pad_key::SHIELD, 8), (pad_key::RIGHT_SHIELD, 8),
    (pad_key::LIGHT_SHIELD, 8), (pad_key::TILT, 9), (pad_key::PAUSE, 10),
];

const VIEW_BIT: u32 = 11;

/// One pad as SDL's standard layout names it: a bit per button index, the left stick as it comes with Y up, and the pad family.
#[derive(Clone, Copy, Default, PartialEq, Debug)]
pub struct PadState {
    pub kind: PadKind,
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

    pub fn of_kind(self, kind: PadKind) -> Self {
        Self { kind, ..self }
    }
}

/// The page buttons each standard button presses on a pad of one family, from padbridge's melee preset, so a pad plays the same in the window as in Warcraft.
struct Layout {
    xbox: [u32; STANDARD_BUTTONS],
    game_cube: [u32; STANDARD_BUTTONS],
}

impl Layout {
    fn new() -> Self {
        Self { xbox: Self::table(PadKind::Xbox), game_cube: Self::table(PadKind::GameCube) }
    }

    fn table(kind: PadKind) -> [u32; STANDARD_BUTTONS] {
        let bindings = pad_bindings(PadPreset::Melee, TriggerShields::default(), RightStick::default(), kind);
        let mut table = [0; STANDARD_BUTTONS];
        for (index, control) in CONTROLS.iter().enumerate().filter(|(index, _)| *index != RIGHT_STICK_CLICK) {
            table[index] = bindings
                .iter()
                .filter(|binding| binding.control == *control)
                .filter_map(|binding| match &binding.press {
                    Press::Key(key) => PAGE_BIT.iter().find(|(page_key, _)| key.chars().eq([*page_key])).map(|(_, bit)| 1 << bit),
                    _ => None,
                })
                .fold(0, |mask, bit| mask | bit);
        }
        for (index, bit) in [(8, VIEW_BIT), (12, 2), (13, 3), (14, 0), (15, 1)] {
            table[index] |= 1 << bit;
        }
        table
    }

    fn page_mask(&self, state: PadState) -> u32 {
        let table = match state.kind {
            PadKind::Xbox => &self.xbox,
            PadKind::GameCube => &self.game_cube,
        };
        table.iter().enumerate().filter(|(index, _)| state.buttons >> index & 1 == 1).fold(0, |mask, (_, bits)| mask | bits)
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
    layout: Layout,
}

impl Pads {
    pub fn open() -> Self {
        Self::with(platform())
    }

    pub fn with(backend: Box<dyn PadBackend>) -> Self {
        Self { backend, layout: Layout::new() }
    }

    /// The pad's input at this sample point, merged over `keys`. The pad is always read, so events do not pile up while the window is unfocused, but an unfocused window gets no pad input.
    pub fn sample(&mut self, index: Option<usize>, focused: bool, keys: u32) -> Input {
        let pad = self.backend.read(index).filter(|_| focused).unwrap_or_default();
        Input { buttons: keys | self.layout.page_mask(pad), axis_x: pad.axis_x, axis_y: pad.axis_y, pointer: PointerSample::default() }
    }
}

fn platform() -> Box<dyn PadBackend> {
    match crate::pad_sdl::SdlPads::open() {
        Some(pads) => Box::new(pads),
        None => Box::new(NoPads),
    }
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

    fn press(kind: PadKind, index: usize) -> Vec<&'static str> {
        names(pads(&[(0, PadState::default().with_button(index, true).of_kind(kind))]).sample(None, true, 0).buttons)
    }

    #[test]
    fn xbox_pad_buttons_press_the_buttons_padbridges_melee_layout_gives_them() {
        let expected = [
            (0, "attack"), (1, "special"), (2, "jump"), (3, "jump"), (5, "grab"), (6, "shield"), (7, "shield"),
            (8, "view"), (9, "start"), (12, "up"), (13, "down"), (14, "left"), (15, "right"),
        ];
        for (index, name) in expected {
            assert_eq!(press(PadKind::Xbox, index), [name], "standard button {index}");
        }
        for index in [4, 10, 11] {
            assert!(press(PadKind::Xbox, index).is_empty(), "standard button {index} presses nothing");
        }
    }

    #[test]
    fn gamecube_pad_buttons_press_the_buttons_padbridges_melee_layout_gives_its_printed_letters() {
        let expected = [(0, "attack"), (1, "jump"), (2, "special"), (3, "jump"), (5, "grab"), (6, "shield"), (7, "shield"), (9, "start")];
        for (index, name) in expected {
            assert_eq!(press(PadKind::GameCube, index), [name], "standard button {index}");
        }
    }

    #[test]
    fn every_page_button_of_padbridges_layout_is_pressed_by_the_control_it_names_on_both_pad_families() {
        for kind in [PadKind::Xbox, PadKind::GameCube] {
            for binding in pad_bindings(PadPreset::Melee, TriggerShields::default(), RightStick::default(), kind) {
                let Press::Key(key) = &binding.press else { continue };
                let Some((_, bit)) = PAGE_BIT.iter().find(|(page_key, _)| key.chars().eq([*page_key])) else { continue };
                let index = CONTROLS.iter().position(|control| *control == binding.control).expect("a fighter button is a standard button");
                assert!(press(kind, index).contains(&crate::input::BUTTONS[*bit as usize]), "{kind:?} {:?} presses {}", binding.control, binding.action);
            }
        }
    }

    #[test]
    fn pad_input_axes_pass_through_raw_with_y_up() {
        let state = PadState { axis_x: -0.1, axis_y: 0.9, ..PadState::default() };
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
        assert_eq!(names(pads(&slots).sample(Some(3), true, 0).buttons), ["jump"]);
        assert_eq!(pads(&slots).sample(Some(2), true, 0).buttons, 0);
    }

    #[test]
    fn pad_input_is_cleared_while_the_window_is_unfocused() {
        let state = PadState { buttons: 1, axis_x: 1.0, axis_y: 1.0, ..PadState::default() };
        let input = pads(&[(0, state)]).sample(None, false, 0);
        assert_eq!((input.buttons, input.axis_x, input.axis_y), (0, 0.0, 0.0));
    }
}
