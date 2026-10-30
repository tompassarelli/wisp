//! The `ui` array of a scene: the frames the standalone window draws as menu and HUD.

use std::borrow::Cow;

use serde::Deserialize;

#[derive(Debug, Clone, PartialEq)]
pub struct UiFrame {
    pub rectangle: [f32; 4],
    pub text: String,
    pub texture: String,
    pub color: u32,
    pub text_color: u32,
    pub alpha: u8,
    pub level: i32,
    pub font_file: String,
    pub font_height: f32,
    pub outline: bool,
    pub horizontal: Horizontal,
    pub vertical: Vertical,
    pub scale: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Horizontal {
    #[default]
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Vertical {
    #[default]
    Top,
    Middle,
    Bottom,
}

#[derive(Deserialize)]
struct Envelope<'a> {
    #[serde(borrow, default)]
    ui: Vec<Row<'a>>,
}

#[derive(Deserialize)]
struct Row<'a> {
    rectangle: Option<[f32; 4]>,
    #[serde(borrow, default)]
    text: Cow<'a, str>,
    #[serde(borrow, default)]
    texture: Cow<'a, str>,
    #[serde(default = "opaque")]
    color: u32,
    #[serde(rename = "textColor", default = "opaque")]
    text_color: u32,
    #[serde(default)]
    alpha: u32,
    #[serde(default)]
    visible: bool,
    #[serde(default)]
    level: i32,
    #[serde(default)]
    font: Font<'a>,
    alignment: Option<Alignment>,
    #[serde(default = "unit")]
    scale: f32,
}

#[derive(Deserialize, Default)]
struct Font<'a> {
    #[serde(borrow, default)]
    file: Cow<'a, str>,
    #[serde(default)]
    height: f32,
    #[serde(default)]
    flags: u32,
}

#[derive(Deserialize)]
struct Alignment {
    vertical: Vertical,
    horizontal: Horizontal,
}

fn opaque() -> u32 {
    0xffff_ffff
}

fn unit() -> f32 {
    1.0
}

/// The frames that draw anything, in drawing order: ascending level, scene order within a level.
#[derive(Debug, Default, PartialEq)]
pub struct UiScene {
    pub frames: Vec<UiFrame>,
}

impl UiScene {
    /// Keeps only the visible frames with a rectangle and some alpha, since the scene lists every frame the game ever made.
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        let envelope: Envelope = serde_json::from_slice(bytes).map_err(|error| format!("ui: {error}"))?;
        let mut frames: Vec<UiFrame> = envelope
            .ui
            .into_iter()
            .filter(|row| row.visible && row.alpha > 0)
            .filter_map(|row| {
                let rectangle = row.rectangle?;
                let alignment = row.alignment.unwrap_or(Alignment { vertical: Vertical::Top, horizontal: Horizontal::Left });
                Some(UiFrame {
                    rectangle,
                    text: row.text.into_owned(),
                    texture: row.texture.into_owned(),
                    color: row.color,
                    text_color: row.text_color,
                    alpha: row.alpha.min(255) as u8,
                    level: row.level,
                    font_file: row.font.file.into_owned(),
                    font_height: row.font.height,
                    outline: row.font.flags & 1 != 0,
                    horizontal: alignment.horizontal,
                    vertical: alignment.vertical,
                    scale: row.scale,
                })
            })
            .collect();
        frames.sort_by_key(|frame| frame.level);
        Ok(Self { frames })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCENE: &str = r#"{"frame":3,"units":[],"ui":[
        {"name":"top","rectangle":[0,0.5,0.2,0.4],"text":"b","texture":"","color":4294967295,"textColor":4294967295,"alpha":255,"visible":true,"level":10,"font":{"file":"Fonts\\FRIZQT__.TTF","height":0.02,"flags":1},"alignment":{"vertical":"middle","horizontal":"center"},"scale":1},
        {"name":"hidden","rectangle":[0,0.5,0.2,0.4],"text":"x","alpha":255,"visible":false,"level":0},
        {"name":"clear","rectangle":[0,0.5,0.2,0.4],"text":"x","alpha":0,"visible":true,"level":0},
        {"name":"bare","text":"x","alpha":255,"visible":true,"level":0},
        {"name":"under","rectangle":[0,0.5,0.2,0.4],"text":"a","alpha":255,"visible":true,"level":0,"alignment":null}]}"#;

    #[test]
    fn keeps_drawable_frames_in_level_order() {
        let scene = UiScene::parse(SCENE.as_bytes()).unwrap();
        let texts: Vec<&str> = scene.frames.iter().map(|frame| frame.text.as_str()).collect();
        assert_eq!(texts, ["a", "b"]);
        let top = &scene.frames[1];
        assert_eq!((top.horizontal, top.vertical, top.outline), (Horizontal::Center, Vertical::Middle, true));
        assert_eq!(top.font_file, "Fonts\\FRIZQT__.TTF");
        assert_eq!((scene.frames[0].horizontal, scene.frames[0].vertical), (Horizontal::Left, Vertical::Top));
    }

    #[test]
    fn a_scene_without_ui_has_no_frames() {
        assert!(UiScene::parse(b"{}").unwrap().frames.is_empty());
        assert!(UiScene::parse(b"nope").is_err());
    }
}
