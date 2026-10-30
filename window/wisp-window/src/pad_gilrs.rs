use gilrs::{Axis, Button, Gilrs};

use crate::pad::{PadBackend, PadState, STANDARD_BUTTONS};

const STANDARD: [Button; STANDARD_BUTTONS] = [
    Button::South, Button::East, Button::West, Button::North, Button::LeftTrigger, Button::RightTrigger, Button::LeftTrigger2, Button::RightTrigger2,
    Button::Select, Button::Start, Button::LeftThumb, Button::RightThumb, Button::DPadUp, Button::DPadDown, Button::DPadLeft, Button::DPadRight,
];

/// Linux pads: gilrs reads evdev on its own thread and queues the events, and `read` drains that queue at the sample point.
pub struct GilrsPads {
    gilrs: Gilrs,
}

impl GilrsPads {
    pub fn open() -> Option<Self> {
        Gilrs::new().ok().map(|gilrs| Self { gilrs })
    }
}

impl PadBackend for GilrsPads {
    fn read(&mut self, index: Option<usize>) -> Option<PadState> {
        while self.gilrs.next_event().is_some() {}
        let (_, pad) = self.gilrs.gamepads().find(|(id, _)| index.is_none_or(|wanted| wanted == usize::from(*id)))?;
        let buttons = STANDARD.iter().enumerate().fold(PadState::default(), |state, (index, button)| state.with_button(index, pad.is_pressed(*button)));
        Some(PadState { axis_x: pad.value(Axis::LeftStickX), axis_y: pad.value(Axis::LeftStickY), ..buttons })
    }
}

#[cfg(all(test, feature = "uinput"))]
mod tests {
    use std::thread::sleep;
    use std::time::{Duration, Instant};

    use evdev::uinput::VirtualDevice;
    use evdev::{AbsInfo, AbsoluteAxisCode, AttributeSet, BusType, EventType, InputEvent, InputId, KeyCode, UinputAbsSetup};

    use super::*;

    const NAME: &str = "wisp-window test pad";
    const BUTTON_A: usize = 0;

    fn virtual_pad() -> VirtualDevice {
        let mut keys = AttributeSet::<KeyCode>::new();
        for key in [KeyCode::BTN_SOUTH, KeyCode::BTN_EAST, KeyCode::BTN_NORTH, KeyCode::BTN_WEST, KeyCode::BTN_TL, KeyCode::BTN_TR, KeyCode::BTN_SELECT, KeyCode::BTN_START] {
            keys.insert(key);
        }
        let stick = |axis| UinputAbsSetup::new(axis, AbsInfo::new(0, -32768, 32767, 16, 128, 0));
        VirtualDevice::builder()
            .and_then(|builder| builder.name(NAME).input_id(InputId::new(BusType::BUS_USB, 0x1209, 0x0001, 1)).with_keys(&keys))
            .and_then(|builder| builder.with_absolute_axis(&stick(AbsoluteAxisCode::ABS_X)))
            .and_then(|builder| builder.with_absolute_axis(&stick(AbsoluteAxisCode::ABS_Y)))
            .and_then(|builder| builder.build())
            .expect("/dev/uinput must be writable for the uinput feature")
    }

    fn slot_of_test_pad(pads: &GilrsPads) -> Option<usize> {
        pads.gilrs.gamepads().find(|(_, pad)| pad.name() == NAME).map(|(id, _)| usize::from(id))
    }

    fn wait_for<T>(timeout: Duration, mut probe: impl FnMut() -> Option<T>) -> Option<T> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(found) = probe() {
                return Some(found);
            }
            if Instant::now() >= deadline {
                return None;
            }
            sleep(Duration::from_millis(1));
        }
    }

    #[test]
    fn pad_press_reaches_next_sample() {
        let mut pads = GilrsPads::open().expect("gilrs opens on Linux");
        let mut device = virtual_pad();
        let slot = wait_for(Duration::from_secs(3), || {
            pads.read(None);
            slot_of_test_pad(&pads)
        })
        .expect("gilrs sees the virtual pad");
        let neutral = pads.read(Some(slot)).expect("the pad is connected");
        assert_eq!(neutral.buttons, 0);

        device.emit(&[InputEvent::new(EventType::KEY.0, KeyCode::BTN_SOUTH.0, 1), InputEvent::new(EventType::ABSOLUTE.0, AbsoluteAxisCode::ABS_X.0, 32767)]).unwrap();
        let pressed = wait_for(Duration::from_millis(100), || pads.read(Some(slot)).filter(|state| state.buttons >> BUTTON_A & 1 == 1)).expect("the press reaches a sample point within 100 ms");
        assert!(pressed.axis_x > 0.99, "stick right reads {}", pressed.axis_x);

        device.emit(&[InputEvent::new(EventType::KEY.0, KeyCode::BTN_SOUTH.0, 0)]).unwrap();
        wait_for(Duration::from_millis(100), || pads.read(Some(slot)).filter(|state| state.buttons == 0)).expect("the release reaches a sample point within 100 ms");
    }
}
