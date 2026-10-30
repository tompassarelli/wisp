//! The scene Bun sends each frame, already reduced to what the GPU draws: wisp:host/window/drawScene.ts builds it from the `RenderScene`.

use serde::Deserialize;

use super::math::Mat4;
use super::water::WaterSettings;

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Camera {
    pub view: Mat4,
    pub eye: [f32; 3],
    pub tangent: f32,
    pub near: f32,
    pub far: f32,
    pub sky_far: f32,
    pub rise: f32,
    /// How far from the eye the sun's shadow map reaches.
    #[serde(default)]
    pub reach: f32,
}

impl Camera {
    /// The eight corners of the view volume between the near plane and `reach`, which the sun's map covers; none when the camera has no reach.
    pub fn sun_corners(&self, aspect: f32) -> Option<[[f32; 3]; 8]> {
        if self.reach <= self.near {
            return None;
        }
        let view = &self.view;
        let (right, up, back) = ([view[0], view[4], view[8]], [view[1], view[5], view[9]], [view[2], view[6], view[10]]);
        let mut corners = [[0.0; 3]; 8];
        for (index, corner) in corners.iter_mut().enumerate() {
            let depth = if index < 4 { self.near } else { self.reach };
            let (sx, sy) = (if index & 2 == 0 { -1.0 } else { 1.0 }, if index & 1 == 0 { -1.0 } else { 1.0 });
            let half = depth * self.tangent;
            for axis in 0..3 {
                corner[axis] = self.eye[axis] - back[axis] * depth + right[axis] * sx * half + up[axis] * sy * half / aspect;
            }
        }
        Some(corners)
    }
}

#[derive(Deserialize)]
pub struct Fog {
    pub color: [f32; 3],
    pub start: f32,
    pub end: f32,
    pub max: f32,
}

#[derive(Deserialize)]
pub struct Light {
    pub toward: [f32; 3],
    pub key: [f32; 3],
    pub ambient: [f32; 3],
}

/// A stage's sky as its map sets it: the zenith colour, how much of the sky cloud covers, the sun's direction and colour, and how far stars and a horizon glow show; colours are display values 0 to 1, angles degrees.
#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct SkyLook {
    pub zenith: [f32; 3],
    pub cover: f32,
    pub sun_azimuth: f32,
    pub sun_elevation: f32,
    pub sun: [f32; 3],
    pub stars: f32,
    pub glow: f32,
}

/// One placed model: its path, where it stands, the sequence and frame it shows and the colours it is drawn with.
#[derive(Deserialize)]
pub struct Pose {
    /// The game handle of the model, which keeps its particle emitters running from one scene to the next; 0 for a pose with none.
    #[serde(default)]
    pub id: u32,
    pub model: String,
    pub matrix: Mat4,
    pub sequence: i32,
    pub frame: f32,
    pub clock: f32,
    pub alpha: f32,
    pub color: [f32; 3],
    pub team: [f32; 3],
}

/// A weather the map added: the four letters of its id in Warcraft's weather table and the rect it covers (min x, min y, max x, max y).
#[derive(Deserialize)]
pub struct WeatherPose {
    pub id: String,
    pub rect: [f32; 4],
}

/// A lightning bolt between two world points, its colour 0 to 1.
#[derive(Deserialize)]
pub struct Bolt {
    pub from: [f32; 3],
    pub to: [f32; 3],
    pub color: [f32; 4],
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Scene {
    pub lightnings: Vec<Bolt>,
    pub weathers: Vec<WeatherPose>,
    pub camera: Camera,
    pub fog: Option<Fog>,
    pub light: Option<Light>,
    pub sky: Option<Pose>,
    #[serde(rename = "skyLook")]
    pub sky_look: Option<SkyLook>,
    pub poses: Vec<Pose>,
    /// The game frame this scene shows.
    pub frame: u32,
    /// How many of the scene's models Bun has not finished sending; a capture waits for none.
    pub pending: u32,
    /// Whether the game is in play (a match) rather than in its menus, as the map last told `WispSetPlaying`; the remaster bakes and swaps art only while it is not.
    #[serde(default)]
    pub playing: bool,
    #[serde(default)]
    pub clear: [f32; 3],
    #[serde(deserialize_with = "super::water::scene_water")]
    pub water: WaterSettings,
}

impl Scene {
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        serde_json::from_slice(bytes).map_err(|error| format!("the scene did not parse: {error}"))
    }
}
