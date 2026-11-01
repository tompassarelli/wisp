use super::pose::Playhead;
use super::Color;
use super::track::{Key, Track};

/// A number the file stores either fixed or as an animation track; a track with no key in the shown sequence reads as `default`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Scalar {
    pub fixed: f32,
    pub track: Option<Track<1>>,
}

impl Scalar {
    pub(crate) fn fixed(value: f32) -> Self {
        Self { fixed: value, track: None }
    }

    pub fn at(&self, playhead: &Playhead, default: f32) -> f32 {
        match &self.track {
            Some(track) => track.vector(playhead).map_or(default, |value| value[0]),
            None => self.fixed,
        }
    }

    /// The key at or before the playhead, for emitters that fire once per key.
    pub fn key_at(&self, playhead: &Playhead) -> Option<&Key<1>> {
        self.track.as_ref()?.left_key(playhead)
    }
}

/// A version-2 particle emitter (`PRE2`): where particles are born, how they move, and how they look over their life.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Emitter2 {
    pub node: usize,
    pub flags: u32,
    pub pivot: [f32; 3],
    pub speed: Scalar,
    pub variation: Scalar,
    pub latitude: Scalar,
    pub gravity: Scalar,
    pub emission_rate: Scalar,
    pub width: Scalar,
    pub length: Scalar,
    pub visibility: Scalar,
    pub life_span: f32,
    pub filter_mode: u32,
    pub rows: u32,
    pub columns: u32,
    pub head: bool,
    pub tail: bool,
    pub tail_length: f32,
    pub time: f32,
    pub colors: [[f32; 3]; 3],
    pub alphas: [f32; 3],
    pub scaling: [f32; 3],
    pub head_life: [f32; 3],
    pub head_decay: [f32; 3],
    pub tail_life: [f32; 3],
    pub tail_decay: [f32; 3],
    pub texture_id: i32,
    pub squirt: bool,
    /// Where the emitter draws against the model's translucent layers: below zero before them, else after.
    pub priority_plane: i32,
}

pub const LINE_EMITTER: u32 = 131_072;
pub const XY_QUAD: u32 = 1_048_576;

/// A ribbon emitter (`RIBB`): a strip laid behind its node, one edge per emission, from `height_above` to `height_below` along the node's Y axis.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Ribbon {
    pub node: usize,
    pub pivot: [f32; 3],
    pub height_above: Scalar,
    pub height_below: Scalar,
    pub alpha: Scalar,
    pub color: Color,
    pub life_span: f32,
    /// The cell of the material's texture, counted along rows of `columns`, that the strip shows.
    pub texture_slot: Scalar,
    pub emission_rate: f32,
    pub rows: u32,
    pub columns: u32,
    pub material_id: i32,
    pub gravity: f32,
    pub visibility: Scalar,
}

/// A version-1 particle emitter (`PREM`): each particle is a copy of the model at `path`, flung from the node and pulled down by gravity.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Emitter1 {
    pub node: usize,
    pub flags: u32,
    pub pivot: [f32; 3],
    pub emission_rate: Scalar,
    pub gravity: Scalar,
    pub longitude: Scalar,
    /// Radians, unlike a version-2 emitter's degrees.
    pub latitude: Scalar,
    pub path: String,
    pub life_span: Scalar,
    pub speed: Scalar,
    pub visibility: Scalar,
}

/// The node flag of a version-1 emitter whose particles are models; an emitter without it names an image, which Classic models do not use.
pub const EMITTER_USES_MDL: u32 = 32_768;
