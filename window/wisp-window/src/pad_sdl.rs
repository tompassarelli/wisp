use std::ffi::c_int;

use padbridge_model::PadKind;
use sdl3_sys::gamepad::{
    SDL_CloseGamepad, SDL_GamepadAxis, SDL_GamepadButton, SDL_GamepadType, SDL_GetGamepadAxis, SDL_GetGamepadButton, SDL_GetGamepadTypeForID, SDL_GetGamepads,
    SDL_Gamepad, SDL_OpenGamepad, SDL_SetGamepadEventsEnabled, SDL_UpdateGamepads, SDL_GAMEPAD_AXIS_LEFTX, SDL_GAMEPAD_AXIS_LEFTY, SDL_GAMEPAD_AXIS_LEFT_TRIGGER,
    SDL_GAMEPAD_AXIS_RIGHT_TRIGGER,
};
use sdl3_sys::events::{SDL_FlushEvents, SDL_EVENT_FIRST, SDL_EVENT_LAST};
use sdl3_sys::hints::{SDL_SetHint, SDL_HINT_JOYSTICK_ALLOW_BACKGROUND_EVENTS};
use sdl3_sys::init::{SDL_InitSubSystem, SDL_QuitSubSystem, SDL_INIT_GAMEPAD};
use sdl3_sys::joystick::SDL_JoystickID;
use sdl3_sys::stdinc::SDL_free;

use crate::pad::{PadBackend, PadState, STANDARD_BUTTONS};

pub const TRIGGER_THRESHOLD: i16 = 4000;

enum Source {
    Button(SDL_GamepadButton),
    Trigger(SDL_GamepadAxis),
}

const STANDARD: [Source; STANDARD_BUTTONS] = [
    Source::Button(SDL_GamepadButton::SOUTH),
    Source::Button(SDL_GamepadButton::EAST),
    Source::Button(SDL_GamepadButton::WEST),
    Source::Button(SDL_GamepadButton::NORTH),
    Source::Button(SDL_GamepadButton::LEFT_SHOULDER),
    Source::Button(SDL_GamepadButton::RIGHT_SHOULDER),
    Source::Trigger(SDL_GAMEPAD_AXIS_LEFT_TRIGGER),
    Source::Trigger(SDL_GAMEPAD_AXIS_RIGHT_TRIGGER),
    Source::Button(SDL_GamepadButton::BACK),
    Source::Button(SDL_GamepadButton::START),
    Source::Button(SDL_GamepadButton::LEFT_STICK),
    Source::Button(SDL_GamepadButton::RIGHT_STICK),
    Source::Button(SDL_GamepadButton::DPAD_UP),
    Source::Button(SDL_GamepadButton::DPAD_DOWN),
    Source::Button(SDL_GamepadButton::DPAD_LEFT),
    Source::Button(SDL_GamepadButton::DPAD_RIGHT),
];

struct Open {
    id: SDL_JoystickID,
    pad: *mut SDL_Gamepad,
    kind: PadKind,
}

impl Open {
    fn state(&self) -> PadState {
        let axis = |axis| unsafe { SDL_GetGamepadAxis(self.pad, axis) };
        let state = STANDARD.iter().enumerate().fold(PadState::default().of_kind(self.kind), |state, (index, source)| {
            let down = match source {
                Source::Button(button) => unsafe { SDL_GetGamepadButton(self.pad, *button) },
                Source::Trigger(trigger) => axis(*trigger) > TRIGGER_THRESHOLD,
            };
            state.with_button(index, down)
        });
        let unit = |raw: i16| (f32::from(raw) / f32::from(i16::MAX)).clamp(-1.0, 1.0);
        PadState { axis_x: unit(axis(SDL_GAMEPAD_AXIS_LEFTX)), axis_y: -unit(axis(SDL_GAMEPAD_AXIS_LEFTY)), ..state }
    }
}

/// Pads through SDL3's gamepad API, the stack padbridge reads with: `read` runs `SDL_UpdateGamepads` and reads the state on the calling thread at the sample point, and SDL keeps joystick events on because its gamepad layer is driven by them, so each read flushes the queue.
pub struct SdlPads {
    open: Vec<Open>,
}

impl SdlPads {
    pub fn open() -> Option<Self> {
        unsafe {
            SDL_SetHint(SDL_HINT_JOYSTICK_ALLOW_BACKGROUND_EVENTS, c"1".as_ptr());
            if !SDL_InitSubSystem(SDL_INIT_GAMEPAD) {
                return None;
            }
            SDL_SetGamepadEventsEnabled(false);
        }
        Some(Self { open: Vec::new() })
    }

    fn connected() -> Vec<SDL_JoystickID> {
        let mut count: c_int = 0;
        let list = unsafe { SDL_GetGamepads(&mut count) };
        if list.is_null() {
            return Vec::new();
        }
        let mut ids = unsafe { std::slice::from_raw_parts(list, usize::try_from(count).unwrap_or(0)) }.to_vec();
        unsafe { SDL_free(list.cast()) };
        ids.sort_by_key(|id| id.0);
        ids
    }

    fn sync(&mut self) {
        let ids = Self::connected();
        self.open.retain(|open| {
            let kept = ids.contains(&open.id);
            if !kept {
                unsafe { SDL_CloseGamepad(open.pad) };
            }
            kept
        });
        for id in ids {
            if self.open.iter().any(|open| open.id == id) {
                continue;
            }
            let pad = unsafe { SDL_OpenGamepad(id) };
            if !pad.is_null() {
                self.open.push(Open { id, pad, kind: kind_of(id) });
            }
        }
        self.open.sort_by_key(|open| open.id.0);
    }
}

pub fn kind_of(id: SDL_JoystickID) -> PadKind {
    if unsafe { SDL_GetGamepadTypeForID(id) } == SDL_GamepadType::GAMECUBE {
        PadKind::GameCube
    } else {
        PadKind::Xbox
    }
}

impl PadBackend for SdlPads {
    fn read(&mut self, index: Option<usize>) -> Option<PadState> {
        unsafe {
            SDL_UpdateGamepads();
            SDL_FlushEvents(SDL_EVENT_FIRST.0, SDL_EVENT_LAST.0);
        }
        self.sync();
        let open = match index {
            Some(slot) => self.open.get(slot)?,
            None => self.open.first()?,
        };
        Some(open.state())
    }
}

impl Drop for SdlPads {
    fn drop(&mut self) {
        for open in self.open.drain(..) {
            unsafe { SDL_CloseGamepad(open.pad) };
        }
        unsafe { SDL_QuitSubSystem(SDL_INIT_GAMEPAD) };
    }
}

#[cfg(test)]
mod tests {
    use std::ffi::{c_void, CStr};
    use std::sync::{Mutex, MutexGuard};
    use std::thread::sleep;
    use std::time::{Duration, Instant};

    use sdl3_sys::gamepad::SDL_GetGamepadName;
    use sdl3_sys::init::{SDL_InitSubSystem, SDL_INIT_JOYSTICK};
    use sdl3_sys::joystick::{
        SDL_AttachVirtualJoystick, SDL_CloseJoystick, SDL_DetachVirtualJoystick, SDL_JoystickType, SDL_OpenJoystick, SDL_SetJoystickVirtualAxis,
        SDL_SetJoystickVirtualButton, SDL_VirtualJoystickDesc, SDL_Joystick,
    };

    use super::*;
    use crate::pad::Pads;

    const NINTENDO: u16 = 0x057e;
    const GAMECUBE_ADAPTER: u16 = 0x0337;
    const GENERIC: u16 = 0x1209;

    const VIRTUAL_BUTTONS: [SDL_GamepadButton; 8] = [
        SDL_GamepadButton::SOUTH, SDL_GamepadButton::EAST, SDL_GamepadButton::WEST, SDL_GamepadButton::NORTH, SDL_GamepadButton::BACK, SDL_GamepadButton::START,
        SDL_GamepadButton::LEFT_SHOULDER, SDL_GamepadButton::RIGHT_SHOULDER,
    ];

    static ONE_SDL_PAD_AT_A_TIME: Mutex<()> = Mutex::new(());

    fn exclusive() -> MutexGuard<'static, ()> {
        ONE_SDL_PAD_AT_A_TIME.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    struct Virtual {
        id: SDL_JoystickID,
        joystick: *mut SDL_Joystick,
    }

    impl Virtual {
        fn attach(vendor_id: u16, product_id: u16) -> Self {
            assert!(unsafe { SDL_InitSubSystem(SDL_INIT_JOYSTICK) });
            let button_mask = VIRTUAL_BUTTONS.iter().fold(0u32, |mask, button| mask | 1 << button.0);
            let axis_mask = [SDL_GAMEPAD_AXIS_LEFTX, SDL_GAMEPAD_AXIS_LEFTY, SDL_GAMEPAD_AXIS_LEFT_TRIGGER, SDL_GAMEPAD_AXIS_RIGHT_TRIGGER].iter().fold(0u32, |mask, axis| mask | 1 << axis.0);
            let desc = SDL_VirtualJoystickDesc {
                r#type: SDL_JoystickType::GAMEPAD.0 as u16,
                vendor_id,
                product_id,
                naxes: 6,
                nbuttons: 8,
                button_mask,
                axis_mask,
                name: c"wisp-window test pad".as_ptr(),
                userdata: std::ptr::null_mut::<c_void>(),
                ..SDL_VirtualJoystickDesc::new()
            };
            let id = unsafe { SDL_AttachVirtualJoystick(&desc) };
            assert_ne!(id.0, 0, "SDL attaches a virtual joystick");
            let joystick = unsafe { SDL_OpenJoystick(id) };
            assert!(!joystick.is_null());
            for (axis, rest) in [0, 0, 0, 0, i16::MIN, i16::MIN].into_iter().enumerate() {
                unsafe { SDL_SetJoystickVirtualAxis(joystick, axis as c_int, rest) };
            }
            Self { id, joystick }
        }

        fn button(&self, button: SDL_GamepadButton, down: bool) {
            let index = VIRTUAL_BUTTONS.iter().position(|candidate| *candidate == button).expect("a virtual button");
            assert!(unsafe { SDL_SetJoystickVirtualButton(self.joystick, index as c_int, down) });
        }

        fn axis(&self, axis: SDL_GamepadAxis, raw: i16) {
            assert!(unsafe { SDL_SetJoystickVirtualAxis(self.joystick, axis.0, raw) });
        }
    }

    impl Drop for Virtual {
        fn drop(&mut self) {
            unsafe {
                SDL_CloseJoystick(self.joystick);
                SDL_DetachVirtualJoystick(self.id);
                SDL_QuitSubSystem(SDL_INIT_JOYSTICK);
            }
        }
    }

    fn slot_where(pads: &mut SdlPads, found: impl Fn(&Open) -> bool) -> usize {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            pads.read(None);
            if let Some(slot) = pads.open.iter().position(&found) {
                return slot;
            }
            assert!(Instant::now() < deadline, "SDL does not list the test pad");
            sleep(Duration::from_millis(1));
        }
    }

    fn names(mask: u32) -> Vec<&'static str> {
        crate::input::BUTTONS.iter().enumerate().filter(|(bit, _)| mask >> bit & 1 == 1).map(|(_, name)| *name).collect()
    }

    #[test]
    fn a_virtual_pad_with_the_gamecube_adapter_ids_is_a_gamecube_pad_with_padbridges_melee_layout() {
        let _exclusive = exclusive();
        let mut pads = SdlPads::open().expect("SDL opens the gamepad subsystem");
        let pad = Virtual::attach(NINTENDO, GAMECUBE_ADAPTER);
        let slot = slot_where(&mut pads, |open| open.id == pad.id);
        assert_eq!(pads.read(Some(slot)).expect("the pad is open").kind, PadKind::GameCube);
        assert_eq!(kind_of(pad.id), PadKind::GameCube);
        let mut window_pads = Pads::with(Box::new(pads));
        let mut layout = |button: SDL_GamepadButton| {
            pad.button(button, true);
            let input = window_pads.sample(Some(slot), true, 0);
            pad.button(button, false);
            names(input.buttons)
        };
        assert_eq!(layout(SDL_GamepadButton::SOUTH), ["attack"], "A attacks");
        assert_eq!(layout(SDL_GamepadButton::WEST), ["special"], "B, SDL's west button, specials");
        assert_eq!(layout(SDL_GamepadButton::EAST), ["jump"], "X, SDL's east button, jumps");
        assert_eq!(layout(SDL_GamepadButton::NORTH), ["jump"], "Y jumps");
        assert_eq!(layout(SDL_GamepadButton::RIGHT_SHOULDER), ["grab"], "Z grabs");
    }

    #[test]
    fn a_generic_virtual_pad_is_an_xbox_pad_with_padbridges_melee_layout() {
        let _exclusive = exclusive();
        let mut pads = SdlPads::open().expect("SDL opens the gamepad subsystem");
        let pad = Virtual::attach(GENERIC, 0x0001);
        let slot = slot_where(&mut pads, |open| open.id == pad.id);
        assert_eq!(pads.read(Some(slot)).expect("the pad is open").kind, PadKind::Xbox);
        let mut window_pads = Pads::with(Box::new(pads));
        pad.button(SDL_GamepadButton::EAST, true);
        assert_eq!(names(window_pads.sample(Some(slot), true, 0).buttons), ["special"], "Xbox B specials");
        pad.button(SDL_GamepadButton::EAST, false);
        pad.axis(SDL_GAMEPAD_AXIS_LEFT_TRIGGER, i16::MAX);
        assert_eq!(names(window_pads.sample(Some(slot), true, 0).buttons), ["shield"], "a full trigger shields");
    }

    #[cfg(feature = "uinput")]
    mod uinput {
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

        fn wait_for<T>(timeout: Duration, mut probe: impl FnMut() -> Option<T>) -> Option<T> {
            let deadline = Instant::now() + timeout;
            loop {
                if let Some(found) = probe() {
                    return Some(found);
                }
                if Instant::now() >= deadline {
                    return None;
                }
                sleep(Duration::from_micros(50));
            }
        }

        #[test]
        fn pad_press_reaches_next_sample() {
            let _exclusive = exclusive();
            let mut pads = SdlPads::open().expect("SDL opens the gamepad subsystem");
            let mut device = virtual_pad();
            let slot = slot_where(&mut pads, |open| unsafe { CStr::from_ptr(SDL_GetGamepadName(open.pad)) }.to_bytes() == NAME.as_bytes());
            let neutral = pads.read(Some(slot)).expect("the pad is open");
            assert_eq!(neutral.buttons, 0);

            let mut reads = Vec::new();
            let mut presses = Vec::new();
            for round in 0..20 {
                let events = [InputEvent::new(EventType::KEY.0, KeyCode::BTN_SOUTH.0, 1), InputEvent::new(EventType::ABSOLUTE.0, AbsoluteAxisCode::ABS_X.0, 32767)];
                let emitted = Instant::now();
                device.emit(&events).unwrap();
                let pressed = wait_for(Duration::from_millis(100), || {
                    let began = Instant::now();
                    let state = pads.read(Some(slot))?;
                    reads.push(began.elapsed());
                    Some(state).filter(|state| state.buttons >> BUTTON_A & 1 == 1)
                })
                .expect("the press reaches a sample point within 100 ms");
                presses.push(emitted.elapsed());
                assert!(pressed.axis_x > 0.99, "round {round}: stick right reads {}", pressed.axis_x);

                device.emit(&[InputEvent::new(EventType::KEY.0, KeyCode::BTN_SOUTH.0, 0), InputEvent::new(EventType::ABSOLUTE.0, AbsoluteAxisCode::ABS_X.0, 0)]).unwrap();
                wait_for(Duration::from_millis(100), || pads.read(Some(slot)).filter(|state| state.buttons == 0 && state.axis_x == 0.0)).expect("the release reaches a sample point within 100 ms");
            }
            reads.sort();
            presses.sort();
            eprintln!(
                "pad read cost: median {:?}, p90 {:?}, max {:?}; press to read: median {:?}, p90 {:?}, max {:?}",
                reads[reads.len() / 2],
                reads[reads.len() * 9 / 10],
                reads[reads.len() - 1],
                presses[presses.len() / 2],
                presses[presses.len() * 9 / 10],
                presses[presses.len() - 1]
            );
        }
    }
}
