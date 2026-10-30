use windows::Gaming::Input::{Gamepad, GamepadButtons, GameControllerSwitchPosition, RawGameController};

use crate::pad::{PadBackend, PadState};
use crate::sdl_mapping::{Database, RawReading, HAT_DOWN, HAT_LEFT, HAT_RIGHT, HAT_UP};

const TRIGGER_PRESSED: f64 = 0.5;

const GAMEPAD_BUTTONS: [GamepadButtons; 16] = [
    GamepadButtons::A, GamepadButtons::B, GamepadButtons::X, GamepadButtons::Y, GamepadButtons::LeftShoulder, GamepadButtons::RightShoulder,
    GamepadButtons::None, GamepadButtons::None, GamepadButtons::View, GamepadButtons::Menu, GamepadButtons::LeftThumbstick, GamepadButtons::RightThumbstick,
    GamepadButtons::DPadUp, GamepadButtons::DPadDown, GamepadButtons::DPadLeft, GamepadButtons::DPadRight,
];

/// Windows pads, read straight from Windows.Gaming.Input at the sample point so no poll thread quantizes a press.
pub struct WindowsPads {
    database: Database,
}

impl Default for WindowsPads {
    fn default() -> Self {
        Self { database: Database::windows() }
    }
}

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
            Slot::Raw(raw) => raw_state(&self.database, &raw),
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

fn raw_state(database: &Database, raw: &RawGameController) -> Option<PadState> {
    let mapping = database.find(raw.HardwareVendorId().ok()?, raw.HardwareProductId().ok()?)?;
    let mut buttons = vec![false; raw.ButtonCount().ok()? as usize];
    let mut switches = vec![GameControllerSwitchPosition::Center; raw.SwitchCount().ok()? as usize];
    let mut axes = vec![0.0; raw.AxisCount().ok()? as usize];
    raw.GetCurrentReading(&mut buttons, &mut switches, &mut axes).ok()?;
    let hats: Vec<u8> = switches.iter().map(hat_mask).collect();
    let axes: Vec<f32> = axes.iter().map(|value| *value as f32 * 2.0 - 1.0).collect();
    Some(mapping.apply(&RawReading { buttons: &buttons, hats: &hats, axes: &axes }))
}

fn hat_mask(position: &GameControllerSwitchPosition) -> u8 {
    match *position {
        GameControllerSwitchPosition::Up => HAT_UP,
        GameControllerSwitchPosition::UpRight => HAT_UP | HAT_RIGHT,
        GameControllerSwitchPosition::Right => HAT_RIGHT,
        GameControllerSwitchPosition::DownRight => HAT_DOWN | HAT_RIGHT,
        GameControllerSwitchPosition::Down => HAT_DOWN,
        GameControllerSwitchPosition::DownLeft => HAT_DOWN | HAT_LEFT,
        GameControllerSwitchPosition::Left => HAT_LEFT,
        GameControllerSwitchPosition::UpLeft => HAT_UP | HAT_LEFT,
        _ => 0,
    }
}
