//! The scene Bun sends each frame, already reduced to what the GPU draws: wisp:host/window/drawScene.ts builds it from the `RenderScene`.

use serde::Deserialize;

use super::math::Mat4;

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
    pub camera: Camera,
    pub fog: Option<Fog>,
    pub light: Option<Light>,
    pub sky: Option<Pose>,
    pub poses: Vec<Pose>,
    /// The game frame this scene shows.
    pub frame: u32,
    /// How many of the scene's models Bun has not finished sending; a capture waits for none.
    pub pending: u32,
    #[serde(default)]
    pub clear: [f32; 3],
}

impl Scene {
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        serde_json::from_slice(bytes).map_err(|error| format!("the scene did not parse: {error}"))
    }
}
