use windows::Gaming::Input::{Gamepad, GamepadButtons, GameControllerSwitchPosition, RawGameController};

use crate::pad::{PadBackend, PadState};

const TRIGGER_PRESSED: f64 = 0.5;

const GAMEPAD_BUTTONS: [GamepadButtons; 16] = [
    GamepadButtons::A, GamepadButtons::B, GamepadButtons::X, GamepadButtons::Y, GamepadButtons::LeftShoulder, GamepadButtons::RightShoulder,
    GamepadButtons::None, GamepadButtons::None, GamepadButtons::View, GamepadButtons::Menu, GamepadButtons::LeftThumbstick, GamepadButtons::RightThumbstick,
    GamepadButtons::DPadUp, GamepadButtons::DPadDown, GamepadButtons::DPadLeft, GamepadButtons::DPadRight,
];

/// DualShock-style raw controllers, by HID button index, onto the standard layout: Cross, Circle, Square, Triangle, L1, R1, L2, R2, Share, Options, L3, R3.
const DUALSHOCK_BUTTONS: [usize; 12] = [2, 0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/// Windows pads, read straight from Windows.Gaming.Input at the sample point so no poll thread quantizes a press.
#[derive(Default)]
pub struct WindowsPads;

impl PadBackend for WindowsPads {
    fn read(&mut self, index: Option<usize>) -> Option<PadState> {
        let gamepads = Gamepad::Gamepads().ok()?;
        let count = gamepads.Size().ok()? as usize;
        let raws = RawGameController::RawGameControllers().ok()?;
        let raw_count = raws.Size().ok()? as usize;
        let slots = (0..count).filter_map(|slot| gamepads.GetAt(slot as u32).ok().map(|pad| (slot, Slot::Gamepad(pad)))).chain(
            (0..raw_count)
                .filter_map(|slot| raws.GetAt(slot as u32).ok())
                .filter(|raw| Gamepad::FromGameController(raw).is_err())
                .enumerate()
                .map(|(offset, raw)| (count + offset, Slot::Raw(raw))),
        );
        let (_, slot) = slots.into_iter().find(|(slot, _)| index.is_none_or(|wanted| wanted == *slot))?;
        match slot {
            Slot::Gamepad(pad) => gamepad_state(&pad),
            Slot::Raw(raw) => raw_state(&raw),
        }
    }
}

enum Slot {
    Gamepad(Gamepad),
    Raw(RawGameController),
}

fn gamepad_state(pad: &Gamepad) -> Option<PadState> {
    let reading = pad.GetCurrentReading().ok()?;
    let mut state = GAMEPAD_BUTTONS.iter().enumerate().fold(PadState::default(), |state, (index, button)| {
        state.with_button(index, button.0 != 0 && reading.Buttons.0 & button.0 == button.0)
    });
    state = state.with_button(6, reading.LeftTrigger >= TRIGGER_PRESSED).with_button(7, reading.RightTrigger >= TRIGGER_PRESSED);
    Some(PadState { axis_x: reading.LeftThumbstickX as f32, axis_y: reading.LeftThumbstickY as f32, ..state })
}

fn raw_state(raw: &RawGameController) -> Option<PadState> {
    let mut buttons = vec![false; raw.ButtonCount().ok()? as usize];
    let mut switches = vec![GameControllerSwitchPosition::Center; raw.SwitchCount().ok()? as usize];
    let mut axes = vec![0.0; raw.AxisCount().ok()? as usize];
    raw.GetCurrentReading(&mut buttons, &mut switches, &mut axes).ok()?;
    let mut state = DUALSHOCK_BUTTONS.iter().enumerate().fold(PadState::default(), |state, (hid, standard)| state.with_button(*standard, buttons.get(hid).copied().unwrap_or(false)));
    if let Some(position) = switches.first() {
        for (index, down) in [(12, hat_has(position, &[GameControllerSwitchPosition::Up, GameControllerSwitchPosition::UpRight, GameControllerSwitchPosition::UpLeft])),
            (13, hat_has(position, &[GameControllerSwitchPosition::Down, GameControllerSwitchPosition::DownRight, GameControllerSwitchPosition::DownLeft])),
            (14, hat_has(position, &[GameControllerSwitchPosition::Left, GameControllerSwitchPosition::UpLeft, GameControllerSwitchPosition::DownLeft])),
            (15, hat_has(position, &[GameControllerSwitchPosition::Right, GameControllerSwitchPosition::UpRight, GameControllerSwitchPosition::DownRight]))] {
            state = state.with_button(index, down);
        }
    }
    let stick = |axis: usize| axes.get(axis).map_or(0.0, |value| (*value as f32) * 2.0 - 1.0);
    Some(PadState { axis_x: stick(0), axis_y: -stick(1), ..state })
}

fn hat_has(position: &GameControllerSwitchPosition, set: &[GameControllerSwitchPosition]) -> bool {
    set.contains(position)
}
