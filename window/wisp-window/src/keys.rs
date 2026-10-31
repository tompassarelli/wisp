use std::collections::{BTreeSet, VecDeque};
use std::sync::Mutex;
use winit::keyboard::KeyCode;

use crate::sync::lock;

pub const META_SHIFT: u8 = 1;
pub const META_CTRL: u8 = 2;
pub const META_ALT: u8 = 4;
pub const META_WIN: u8 = 8;

/// Key events heard and not yet taken; past it new events are dropped, which only happens when the game's thread has stopped asking.
const QUEUE_CAPACITY: usize = 1024;

/// Warcraft's `oskeytype` for each physical key: the Windows virtual-key code, with the left and right modifiers told apart and the OEM keys named by their position on a US layout.
const OSKEYS: &[(KeyCode, u8)] = &[
    (KeyCode::Backspace, 0x08),
    (KeyCode::Tab, 0x09),
    (KeyCode::Enter, 0x0d),
    (KeyCode::NumpadEnter, 0x0d),
    (KeyCode::Pause, 0x13),
    (KeyCode::CapsLock, 0x14),
    (KeyCode::Escape, 0x1b),
    (KeyCode::Space, 0x20),
    (KeyCode::PageUp, 0x21),
    (KeyCode::PageDown, 0x22),
    (KeyCode::End, 0x23),
    (KeyCode::Home, 0x24),
    (KeyCode::ArrowLeft, 0x25),
    (KeyCode::ArrowUp, 0x26),
    (KeyCode::ArrowRight, 0x27),
    (KeyCode::ArrowDown, 0x28),
    (KeyCode::PrintScreen, 0x2c),
    (KeyCode::Insert, 0x2d),
    (KeyCode::Delete, 0x2e),
    (KeyCode::Digit0, 0x30),
    (KeyCode::Digit1, 0x31),
    (KeyCode::Digit2, 0x32),
    (KeyCode::Digit3, 0x33),
    (KeyCode::Digit4, 0x34),
    (KeyCode::Digit5, 0x35),
    (KeyCode::Digit6, 0x36),
    (KeyCode::Digit7, 0x37),
    (KeyCode::Digit8, 0x38),
    (KeyCode::Digit9, 0x39),
    (KeyCode::KeyA, 0x41),
    (KeyCode::KeyB, 0x42),
    (KeyCode::KeyC, 0x43),
    (KeyCode::KeyD, 0x44),
    (KeyCode::KeyE, 0x45),
    (KeyCode::KeyF, 0x46),
    (KeyCode::KeyG, 0x47),
    (KeyCode::KeyH, 0x48),
    (KeyCode::KeyI, 0x49),
    (KeyCode::KeyJ, 0x4a),
    (KeyCode::KeyK, 0x4b),
    (KeyCode::KeyL, 0x4c),
    (KeyCode::KeyM, 0x4d),
    (KeyCode::KeyN, 0x4e),
    (KeyCode::KeyO, 0x4f),
    (KeyCode::KeyP, 0x50),
    (KeyCode::KeyQ, 0x51),
    (KeyCode::KeyR, 0x52),
    (KeyCode::KeyS, 0x53),
    (KeyCode::KeyT, 0x54),
    (KeyCode::KeyU, 0x55),
    (KeyCode::KeyV, 0x56),
    (KeyCode::KeyW, 0x57),
    (KeyCode::KeyX, 0x58),
    (KeyCode::KeyY, 0x59),
    (KeyCode::KeyZ, 0x5a),
    (KeyCode::SuperLeft, 0x5b),
    (KeyCode::SuperRight, 0x5c),
    (KeyCode::ContextMenu, 0x5d),
    (KeyCode::Numpad0, 0x60),
    (KeyCode::Numpad1, 0x61),
    (KeyCode::Numpad2, 0x62),
    (KeyCode::Numpad3, 0x63),
    (KeyCode::Numpad4, 0x64),
    (KeyCode::Numpad5, 0x65),
    (KeyCode::Numpad6, 0x66),
    (KeyCode::Numpad7, 0x67),
    (KeyCode::Numpad8, 0x68),
    (KeyCode::Numpad9, 0x69),
    (KeyCode::NumpadMultiply, 0x6a),
    (KeyCode::NumpadAdd, 0x6b),
    (KeyCode::NumpadComma, 0x6c),
    (KeyCode::NumpadSubtract, 0x6d),
    (KeyCode::NumpadDecimal, 0x6e),
    (KeyCode::NumpadDivide, 0x6f),
    (KeyCode::F1, 0x70),
    (KeyCode::F2, 0x71),
    (KeyCode::F3, 0x72),
    (KeyCode::F4, 0x73),
    (KeyCode::F5, 0x74),
    (KeyCode::F6, 0x75),
    (KeyCode::F7, 0x76),
    (KeyCode::F8, 0x77),
    (KeyCode::F9, 0x78),
    (KeyCode::F10, 0x79),
    (KeyCode::F11, 0x7a),
    (KeyCode::F12, 0x7b),
    (KeyCode::F13, 0x7c),
    (KeyCode::F14, 0x7d),
    (KeyCode::F15, 0x7e),
    (KeyCode::F16, 0x7f),
    (KeyCode::F17, 0x80),
    (KeyCode::F18, 0x81),
    (KeyCode::F19, 0x82),
    (KeyCode::F20, 0x83),
    (KeyCode::F21, 0x84),
    (KeyCode::F22, 0x85),
    (KeyCode::F23, 0x86),
    (KeyCode::F24, 0x87),
    (KeyCode::NumLock, 0x90),
    (KeyCode::ScrollLock, 0x91),
    (KeyCode::ShiftLeft, 0xa0),
    (KeyCode::ShiftRight, 0xa1),
    (KeyCode::ControlLeft, 0xa2),
    (KeyCode::ControlRight, 0xa3),
    (KeyCode::AltLeft, 0xa4),
    (KeyCode::AltRight, 0xa5),
    (KeyCode::Semicolon, 0xba),
    (KeyCode::Equal, 0xbb),
    (KeyCode::Comma, 0xbc),
    (KeyCode::Minus, 0xbd),
    (KeyCode::Period, 0xbe),
    (KeyCode::Slash, 0xbf),
    (KeyCode::Backquote, 0xc0),
    (KeyCode::BracketLeft, 0xdb),
    (KeyCode::Backslash, 0xdc),
    (KeyCode::BracketRight, 0xdd),
    (KeyCode::Quote, 0xde),
    (KeyCode::IntlBackslash, 0xe2),
];

pub fn oskey(code: KeyCode) -> Option<u8> {
    OSKEYS.iter().find(|(known, _)| *known == code).map(|(_, key)| *key)
}

fn modifier(key: u8) -> u8 {
    match key {
        0xa0 | 0xa1 => META_SHIFT,
        0xa2 | 0xa3 => META_CTRL,
        0xa4 | 0xa5 => META_ALT,
        0x5b | 0x5c => META_WIN,
        _ => 0,
    }
}

/// One key going down or up, as `BlzTriggerRegisterPlayerKeyEvent` names it: the `oskeytype`, and the `METAKEY_*` mask of the other modifiers held at that moment.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct KeyEvent {
    pub key: u8,
    pub meta: u8,
    pub down: bool,
}

impl KeyEvent {
    /// The event in one number for the game's thread: the key in bits 0 to 7, the meta mask in 8 to 11, down in bit 12.
    pub fn packed(self) -> u32 {
        self.key as u32 | (self.meta as u32) << 8 | (self.down as u32) << 12
    }
}

#[derive(Default)]
struct State {
    held: BTreeSet<u8>,
    queue: VecDeque<KeyEvent>,
}

impl State {
    fn meta_without(&self, key: u8) -> u8 {
        self.held.iter().filter(|held| **held != key).fold(0, |meta, held| meta | modifier(*held))
    }

    fn push(&mut self, event: KeyEvent) {
        if self.queue.len() < QUEUE_CAPACITY {
            self.queue.push_back(event);
        }
    }
}

/// The keyboard as the window thread hears it, in order, for the game's thread to take. Warcraft's key events are the game's whole keyboard: every press and release is one, and the map's bindings decide what a key does. A key already down is not pressed again and a release of a key not down is not sent, so a key swallowed by the options screen never leaves a stray release.
#[derive(Default)]
pub struct Keys {
    state: Mutex<State>,
}

impl Keys {
    pub fn press(&self, code: KeyCode, down: bool) {
        let Some(key) = oskey(code) else { return };
        let mut state = lock(&self.state);
        if down {
            if state.held.insert(key) {
                let meta = state.meta_without(key);
                state.push(KeyEvent { key, meta, down });
            }
        } else if state.held.remove(&key) {
            let meta = state.meta_without(key);
            state.push(KeyEvent { key, meta, down });
        }
    }

    /// Releases every key held, as when the window loses focus or the options screen opens.
    pub fn release_all(&self) {
        let mut state = lock(&self.state);
        for key in std::mem::take(&mut state.held).into_iter().rev() {
            let meta = state.meta_without(key);
            state.push(KeyEvent { key, meta, down: false });
        }
    }

    /// The events heard since the last call, oldest first, at most `limit`.
    pub fn take(&self, limit: usize) -> Vec<KeyEvent> {
        let mut state = lock(&self.state);
        let count = limit.min(state.queue.len());
        state.queue.drain(..count).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(key: u8, meta: u8, down: bool) -> KeyEvent {
        KeyEvent { key, meta, down }
    }

    #[test]
    fn letters_digits_and_arrows_take_the_windows_virtual_key_codes() {
        assert_eq!(oskey(KeyCode::KeyA), Some(0x41));
        assert_eq!(oskey(KeyCode::KeyN), Some(0x4e));
        assert_eq!(oskey(KeyCode::KeyZ), Some(0x5a));
        assert_eq!(oskey(KeyCode::Digit0), Some(0x30));
        assert_eq!(oskey(KeyCode::Digit7), Some(0x37));
        assert_eq!(oskey(KeyCode::Digit9), Some(0x39));
        assert_eq!(oskey(KeyCode::ArrowLeft), Some(0x25));
        assert_eq!(oskey(KeyCode::ArrowUp), Some(0x26));
        assert_eq!(oskey(KeyCode::ArrowRight), Some(0x27));
        assert_eq!(oskey(KeyCode::ArrowDown), Some(0x28));
        assert_eq!(oskey(KeyCode::Space), Some(0x20));
        assert_eq!(oskey(KeyCode::Enter), Some(0x0d));
        assert_eq!(oskey(KeyCode::Escape), Some(0x1b));
    }

    #[test]
    fn punctuation_takes_the_oem_codes() {
        let table = [
            (KeyCode::Semicolon, 186),
            (KeyCode::Equal, 187),
            (KeyCode::Comma, 188),
            (KeyCode::Minus, 189),
            (KeyCode::Period, 190),
            (KeyCode::Slash, 191),
            (KeyCode::Backquote, 192),
            (KeyCode::BracketLeft, 219),
            (KeyCode::Backslash, 220),
            (KeyCode::BracketRight, 221),
            (KeyCode::Quote, 222),
        ];
        for (code, key) in table {
            assert_eq!(oskey(code), Some(key), "{code:?}");
        }
    }

    #[test]
    fn function_keys_run_from_0x70_and_modifiers_tell_left_from_right() {
        assert_eq!(oskey(KeyCode::F1), Some(0x70));
        assert_eq!(oskey(KeyCode::F10), Some(0x79));
        assert_eq!(oskey(KeyCode::F12), Some(0x7b));
        assert_eq!(oskey(KeyCode::F24), Some(0x87));
        assert_eq!(oskey(KeyCode::ShiftLeft), Some(0xa0));
        assert_eq!(oskey(KeyCode::ShiftRight), Some(0xa1));
        assert_eq!(oskey(KeyCode::ControlLeft), Some(0xa2));
        assert_eq!(oskey(KeyCode::AltRight), Some(0xa5));
        assert_eq!(oskey(KeyCode::SuperLeft), Some(0x5b));
    }

    #[test]
    fn a_key_with_no_oskey_is_not_heard() {
        assert_eq!(oskey(KeyCode::MediaPlayPause), None);
        let keys = Keys::default();
        keys.press(KeyCode::MediaPlayPause, true);
        assert!(keys.take(8).is_empty());
    }

    #[test]
    fn a_press_and_release_are_two_events_in_order_and_a_repeat_is_none() {
        let keys = Keys::default();
        keys.press(KeyCode::KeyN, true);
        keys.press(KeyCode::KeyN, true);
        keys.press(KeyCode::KeyN, false);
        keys.press(KeyCode::KeyN, false);
        assert_eq!(keys.take(8), [event(0x4e, 0, true), event(0x4e, 0, false)]);
        assert!(keys.take(8).is_empty());
    }

    #[test]
    fn meta_is_the_other_modifiers_held() {
        let keys = Keys::default();
        keys.press(KeyCode::ShiftLeft, true);
        keys.press(KeyCode::KeyQ, true);
        keys.press(KeyCode::ControlRight, true);
        keys.press(KeyCode::KeyQ, false);
        keys.press(KeyCode::ControlRight, false);
        keys.press(KeyCode::ShiftLeft, false);
        assert_eq!(
            keys.take(16),
            [
                event(0xa0, 0, true),
                event(0x51, META_SHIFT, true),
                event(0xa3, META_SHIFT, true),
                event(0x51, META_SHIFT | META_CTRL, false),
                event(0xa3, META_SHIFT, false),
                event(0xa0, 0, false),
            ]
        );
    }

    #[test]
    fn release_all_lets_go_of_every_key_held() {
        let keys = Keys::default();
        keys.press(KeyCode::KeyA, true);
        keys.press(KeyCode::KeyB, true);
        keys.take(8);
        keys.release_all();
        keys.press(KeyCode::KeyA, false);
        assert_eq!(keys.take(8), [event(0x42, 0, false), event(0x41, 0, false)]);
    }

    #[test]
    fn take_stops_at_its_limit_and_keeps_the_rest() {
        let keys = Keys::default();
        for code in [KeyCode::KeyA, KeyCode::KeyB, KeyCode::KeyC] {
            keys.press(code, true);
        }
        assert_eq!(keys.take(2).len(), 2);
        assert_eq!(keys.take(2), [event(0x43, 0, true)]);
    }

    #[test]
    fn packed_puts_key_meta_and_direction_in_one_number() {
        assert_eq!(event(0x51, META_SHIFT, true).packed(), 0x1151);
        assert_eq!(event(0xde, 0, false).packed(), 0xde);
    }
}
