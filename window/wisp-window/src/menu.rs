//! The in-game options screen: the graphics preset and the Original or Remastered art, drawn over the world as UI frames and driven by the arrow keys.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use winit::keyboard::KeyCode;

use crate::input::Held;
use crate::settings::Settings;
use crate::sync::lock;
use crate::ui::{Horizontal, UiFrame, UiScene, Vertical};

/// What the window thread tells the render thread the player did.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Event {
    Open,
    Close,
    Up,
    Down,
    Left,
    Right,
    Activate,
}

/// The key that opens and closes the screen; the game uses none of it.
pub const TOGGLE: KeyCode = KeyCode::F10;

/// The event a key sends while the screen is open.
pub fn event_of(code: KeyCode) -> Option<Event> {
    match code {
        KeyCode::ArrowUp | KeyCode::KeyW => Some(Event::Up),
        KeyCode::ArrowDown | KeyCode::KeyS => Some(Event::Down),
        KeyCode::ArrowLeft | KeyCode::KeyA => Some(Event::Left),
        KeyCode::ArrowRight | KeyCode::KeyD => Some(Event::Right),
        KeyCode::Enter | KeyCode::Space => Some(Event::Activate),
        KeyCode::Escape => Some(Event::Close),
        _ => None,
    }
}

/// What the window thread hears of the keys, sorted into the options screen's and the game's: F10 opens and closes the screen; while it is open its keys go to it and the game sees none pressed, but releases still reach the game so no key stays held.
#[derive(Default)]
pub struct Input {
    open: AtomicBool,
    events: Mutex<Vec<Event>>,
}

impl Input {
    pub fn key(&self, held: &Held, code: KeyCode, pressed: bool) {
        let open = self.open.load(Ordering::Acquire);
        let sent = if pressed && code == TOGGLE {
            Some(if open { Event::Close } else { Event::Open })
        } else if pressed && open {
            event_of(code)
        } else {
            None
        };
        match sent {
            Some(event) => {
                match event {
                    Event::Open => {
                        self.open.store(true, Ordering::Release);
                        held.clear();
                    }
                    Event::Close => self.open.store(false, Ordering::Release),
                    _ => {}
                }
                lock(&self.events).push(event);
            }
            None if !open || !pressed => held.press(code, pressed),
            None => {}
        }
    }

    /// The events since the last call, in order.
    pub fn drain(&self) -> Vec<Event> {
        std::mem::take(&mut *lock(&self.events))
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Row {
    Preset,
    Art,
}

const ROWS: [Row; 2] = [Row::Preset, Row::Art];

#[derive(Default)]
pub struct Menu {
    open: bool,
    row: usize,
}

const LEFT: f32 = 0.2;
const RIGHT: f32 = 0.6;
const TOP: f32 = 0.52;
const STEP: f32 = 0.04;
const GOLD: u32 = 0xffff_d24a;
const WHITE: u32 = 0xffff_ffff;
const GREY: u32 = 0xffb4_b4b4;

fn text(rectangle: [f32; 4], text: String, height: f32, color: u32, horizontal: Horizontal) -> UiFrame {
    UiFrame { rectangle, text, texture: String::new(), solid: false, color: WHITE, text_color: color, alpha: 255, level: 1, font_file: String::new(), font_height: height, outline: false, horizontal, vertical: Vertical::Middle, scale: 1.0, plain: false }
}

impl Menu {
    pub fn is_open(&self) -> bool {
        self.open
    }

    /// Applies one event to the screen and the settings; true when the settings changed.
    pub fn handle(&mut self, event: Event, settings: &mut Settings) -> bool {
        match event {
            Event::Open => {
                self.open = true;
                false
            }
            Event::Close => {
                self.open = false;
                false
            }
            _ if !self.open => false,
            Event::Up => {
                self.row = (self.row + ROWS.len() - 1) % ROWS.len();
                false
            }
            Event::Down => {
                self.row = (self.row + 1) % ROWS.len();
                false
            }
            Event::Left | Event::Right | Event::Activate => {
                let before = *settings;
                match ROWS[self.row] {
                    Row::Preset => settings.preset = settings.preset.step(event != Event::Left),
                    Row::Art => settings.art = settings.art.toggled(),
                }
                *settings != before
            }
        }
    }

    /// The frames to draw over the game's own, empty while the screen is closed.
    pub fn scene(&self, settings: &Settings) -> UiScene {
        if !self.open {
            return UiScene::default();
        }
        let features = settings.features();
        let mut frames = Vec::new();
        let bottom = TOP - STEP * (ROWS.len() + features.keys().len() + 4) as f32;
        frames.push(UiFrame { solid: true, color: 0xe010_1418, level: 0, ..text([LEFT - 0.02, TOP + 0.03, RIGHT + 0.02, bottom], String::new(), 0.0, WHITE, Horizontal::Left) });
        let line = |index: usize| [LEFT, TOP - STEP * index as f32, RIGHT, TOP - STEP * (index + 1) as f32];
        frames.push(text(line(0), "Graphics".into(), 0.026, GOLD, Horizontal::Left));
        for (index, row) in ROWS.iter().enumerate() {
            let (label, value) = match row {
                Row::Preset => ("Preset", format!("<  {}  >", settings.preset.name())),
                Row::Art => ("Art", format!("<  {}  >", settings.art.name())),
            };
            let color = if index == self.row { GOLD } else { WHITE };
            frames.push(text(line(index + 1), label.into(), 0.022, color, Horizontal::Left));
            frames.push(text(line(index + 1), value, 0.022, color, Horizontal::Right));
        }
        for (index, (key, value)) in features.keys().into_iter().enumerate() {
            frames.push(text(line(ROWS.len() + 2 + index), key.into(), 0.016, GREY, Horizontal::Left));
            frames.push(text(line(ROWS.len() + 2 + index), value, 0.016, GREY, Horizontal::Right));
        }
        frames.push(text(line(ROWS.len() + features.keys().len() + 3), "Up and Down choose, Left and Right change, Esc closes".into(), 0.014, GREY, Horizontal::Left));
        UiScene { frames }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::{Art, Preset};

    #[test]
    fn left_and_right_step_the_selected_row() {
        let mut menu = Menu::default();
        let mut settings = Settings { preset: Preset::High, art: Art::Original };
        menu.handle(Event::Open, &mut settings);
        assert!(menu.handle(Event::Right, &mut settings));
        assert_eq!(settings.preset, Preset::Ultra);
        assert!(menu.handle(Event::Left, &mut settings));
        assert!(menu.handle(Event::Left, &mut settings));
        assert_eq!(settings.preset, Preset::Medium);
        menu.handle(Event::Down, &mut settings);
        assert!(menu.handle(Event::Activate, &mut settings));
        assert_eq!(settings.art, Art::Remastered);
        assert!(menu.handle(Event::Right, &mut settings));
        assert_eq!(settings.art, Art::Original);
    }
}
