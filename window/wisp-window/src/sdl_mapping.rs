//! SDL's controller mapping database read for raw controllers (wisp:docs/native-window-plan.md, "Pads, keyboard and platforms").

use std::collections::HashMap;

use crate::pad::PadState;

const WINDOWS_DATABASE: &str = include_str!("../data/gamecontrollerdb-windows.txt");

const BUS_USB: &str = "03000000";
const TRIGGER_PRESSED: f32 = 0.0;
const HALF_PRESSED: f32 = 0.5;

pub const HAT_UP: u8 = 1;
pub const HAT_RIGHT: u8 = 2;
pub const HAT_DOWN: u8 = 4;
pub const HAT_LEFT: u8 = 8;

/// The standard-layout button index each SDL button name presses.
const STANDARD_NAMES: [(&str, usize); 16] = [
    ("a", 0), ("b", 1), ("x", 2), ("y", 3), ("leftshoulder", 4), ("rightshoulder", 5), ("lefttrigger", 6), ("righttrigger", 7),
    ("back", 8), ("start", 9), ("leftstick", 10), ("rightstick", 11), ("dpup", 12), ("dpdown", 13), ("dpleft", 14), ("dpright", 15),
];

/// One raw controller's state as the platform reports it: buttons, hat bitmasks and axes already in -1 to 1.
pub struct RawReading<'a> {
    pub buttons: &'a [bool],
    pub hats: &'a [u8],
    pub axes: &'a [f32],
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Source {
    Button(usize),
    Hat { hat: usize, mask: u8 },
    Axis { index: usize, half: Half, inverted: bool },
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Half {
    Whole,
    Positive,
    Negative,
}

impl Source {
    fn parse(text: &str) -> Option<Self> {
        let (half, text) = match text.as_bytes().first()? {
            b'+' => (Half::Positive, &text[1..]),
            b'-' => (Half::Negative, &text[1..]),
            _ => (Half::Whole, text),
        };
        let (kind, rest) = text.split_at(1);
        match kind {
            "b" => Some(Self::Button(rest.parse().ok()?)),
            "h" => {
                let (hat, mask) = rest.split_once('.')?;
                Some(Self::Hat { hat: hat.parse().ok()?, mask: mask.parse().ok()? })
            }
            "a" => {
                let (index, inverted) = rest.strip_suffix('~').map_or((rest, false), |index| (index, true));
                Some(Self::Axis { index: index.parse().ok()?, half, inverted })
            }
            _ => None,
        }
    }

    fn axis_value(self, reading: &RawReading) -> f32 {
        let Self::Axis { index, half, inverted } = self else { return 0.0 };
        let value = reading.axes.get(index).copied().unwrap_or(0.0) * if inverted { -1.0 } else { 1.0 };
        match half {
            Half::Whole => value,
            Half::Positive => value.max(0.0),
            Half::Negative => (-value).max(0.0),
        }
    }

    fn pressed(self, reading: &RawReading) -> bool {
        match self {
            Self::Button(index) => reading.buttons.get(index).copied().unwrap_or(false),
            Self::Hat { hat, mask } => reading.hats.get(hat).is_some_and(|position| position & mask != 0),
            Self::Axis { half: Half::Whole, .. } => self.axis_value(reading) > TRIGGER_PRESSED,
            Self::Axis { .. } => self.axis_value(reading) > HALF_PRESSED,
        }
    }
}

/// One database entry: where on the raw controller each standard-layout button and the left stick come from.
#[derive(Debug, PartialEq)]
pub struct Mapping {
    buttons: Vec<(usize, Source)>,
    left_x: Option<Source>,
    left_y: Option<Source>,
}

impl Mapping {
    /// Parses `guid,name,field:source,...`, returning the GUID alongside. `None` for a comment or a line with no GUID.
    pub fn parse(line: &str) -> Option<(&str, Self)> {
        let mut fields = line.trim().split(',');
        let guid = fields.next().filter(|guid| guid.len() == 32)?;
        fields.next()?;
        let entries: Vec<(&str, Source)> = fields.filter_map(|field| field.split_once(':')).filter_map(|(name, source)| Some((name, Source::parse(source)?))).collect();
        let find = |wanted: &str| entries.iter().find(|(name, _)| *name == wanted).map(|(_, source)| *source);
        let buttons = STANDARD_NAMES.iter().filter_map(|(name, index)| find(name).map(|source| (*index, source))).collect();
        Some((guid, Self { buttons, left_x: find("leftx"), left_y: find("lefty") }))
    }

    /// The pad as the standard layout names it. SDL's stick Y points down; the standard layout's points up.
    pub fn apply(&self, reading: &RawReading) -> PadState {
        let state = self.buttons.iter().fold(PadState::default(), |state, (index, source)| state.with_button(*index, source.pressed(reading)));
        let stick = |source: Option<Source>| source.map_or(0.0, |source| source.axis_value(reading));
        PadState { axis_x: stick(self.left_x), axis_y: -stick(self.left_y), ..state }
    }
}

/// Mappings by the USB vendor and product a raw controller reports; the database's version and name-hash bytes are not matched.
pub struct Database {
    mappings: HashMap<(u16, u16), Mapping>,
}

impl Database {
    pub fn windows() -> Self {
        Self::parse(WINDOWS_DATABASE)
    }

    pub fn parse(text: &str) -> Self {
        let mappings = text
            .lines()
            .filter_map(Mapping::parse)
            .filter(|(guid, _)| guid.starts_with(BUS_USB))
            .filter_map(|(guid, mapping)| Some((ids(guid)?, mapping)))
            .collect();
        Self { mappings }
    }

    pub fn find(&self, vendor: u16, product: u16) -> Option<&Mapping> {
        self.mappings.get(&(vendor, product))
    }
}

fn ids(guid: &str) -> Option<(u16, u16)> {
    let little_endian = |digits: &str| Some(u16::from_str_radix(&digits[2..4], 16).ok()? << 8 | u16::from_str_radix(&digits[0..2], 16).ok()?);
    Some((little_endian(&guid[8..12])?, little_endian(&guid[16..20])?))
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOGITECH_F310: &str = "030000006d0400001dc2000000000000,Logitech F310,a:b0,b:b1,back:b6,dpdown:h0.4,dpleft:h0.8,dpright:h0.2,dpup:h0.1,leftshoulder:b4,leftstick:b8,lefttrigger:a2,leftx:a0,lefty:a1,rightshoulder:b5,rightstick:b9,righttrigger:a5,rightx:a3,righty:a4,start:b7,x:b2,y:b3,platform:Windows,";
    const SPLIT_TRIGGER: &str = "030000000d0f00001000000000000000,Split,a:b0,b:b1,lefttrigger:+a2,righttrigger:-a2,leftx:a0~,lefty:a1,dpup:h0.1,platform:Windows,";

    fn mapped(line: &str) -> Mapping {
        Mapping::parse(line).expect("a mapping line").1
    }

    fn reading(buttons: &[usize], hat: u8, axes: &[f32]) -> (Vec<bool>, Vec<u8>, Vec<f32>) {
        ((0..12).map(|index| buttons.contains(&index)).collect(), vec![hat], axes.to_vec())
    }

    fn state(mapping: &Mapping, buttons: &[usize], hat: u8, axes: &[f32]) -> PadState {
        let (buttons, hats, axes) = reading(buttons, hat, axes);
        mapping.apply(&RawReading { buttons: &buttons, hats: &hats, axes: &axes })
    }

    #[test]
    fn raw_controller_mapping_sends_a_recorded_entry_to_the_standard_layout() {
        let f310 = mapped(LOGITECH_F310);
        let rest = [0.0, 0.0, -1.0, 0.0, 0.0, -1.0];
        let expected = [(0, 0), (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 8), (7, 9), (8, 10), (9, 11)];
        for (hid, standard) in expected {
            assert_eq!(state(&f310, &[hid], 0, &rest).buttons, 1 << standard, "hid button {hid}");
        }
        for (hat, standard) in [(HAT_UP, 12), (HAT_DOWN, 13), (HAT_LEFT, 14), (HAT_RIGHT, 15)] {
            assert_eq!(state(&f310, &[], hat, &rest).buttons, 1 << standard, "hat {hat}");
        }
        assert_eq!(state(&f310, &[], HAT_UP | HAT_LEFT, &rest).buttons, 1 << 12 | 1 << 14);
    }

    #[test]
    fn raw_controller_mapping_reads_triggers_and_the_left_stick_from_axes() {
        let f310 = mapped(LOGITECH_F310);
        assert_eq!(state(&f310, &[], 0, &[0.0, 0.0, 1.0, 0.0, 0.0, -1.0]).buttons, 1 << 6);
        assert_eq!(state(&f310, &[], 0, &[0.0, 0.0, -1.0, 0.0, 0.0, 1.0]).buttons, 1 << 7);
        let stick = state(&f310, &[], 0, &[-0.25, 0.75, -1.0, 0.0, 0.0, -1.0]);
        assert_eq!((stick.axis_x, stick.axis_y), (-0.25, -0.75));
    }

    #[test]
    fn raw_controller_mapping_honours_half_axes_and_inverted_axes() {
        let split = mapped(SPLIT_TRIGGER);
        assert_eq!(state(&split, &[], 0, &[0.0, 0.0, 1.0]).buttons, 1 << 6);
        assert_eq!(state(&split, &[], 0, &[0.0, 0.0, -1.0]).buttons, 1 << 7);
        assert_eq!(state(&split, &[], 0, &[0.0, 0.0, 0.2]).buttons, 0);
        assert_eq!(state(&split, &[], 0, &[0.5, 0.0, 0.0]).axis_x, -0.5);
    }

    #[test]
    fn raw_controller_mapping_finds_an_entry_by_the_vendor_and_product_a_controller_reports() {
        let database = Database::parse(&format!("# comment\n{LOGITECH_F310}\n{SPLIT_TRIGGER}\n"));
        assert_eq!(database.find(0x046d, 0xc21d), Some(&mapped(LOGITECH_F310)));
        assert_eq!(database.find(0x0f0d, 0x0010), Some(&mapped(SPLIT_TRIGGER)));
        assert!(database.find(0x046d, 0xc21e).is_none());
    }

    #[test]
    fn raw_controller_mapping_ignores_a_name_hash_and_a_version_in_the_guid() {
        let hashed = LOGITECH_F310.replacen("030000006d0400001dc2000000000000", "030000006d0400001dc2000011010000", 1);
        assert!(Database::parse(&hashed).find(0x046d, 0xc21d).is_some());
    }

    #[test]
    fn raw_controller_mapping_database_maps_a_dualshock_and_a_pad_that_is_not_one() {
        let database = Database::windows();
        let dualshock = database.find(0x054c, 0x05c4).expect("PS4 Controller");
        let pressed = state(dualshock, &[1], 0, &[0.0; 6]);
        assert_eq!(pressed.buttons, 1);
        let f310 = database.find(0x046d, 0xc21d).expect("Logitech F310");
        assert_eq!(state(f310, &[1], 0, &[0.0, 0.0, -1.0, 0.0, 0.0, -1.0]).buttons, 1 << 1);
        assert!(database.find(0x0000, 0x0000).is_none());
    }
}
