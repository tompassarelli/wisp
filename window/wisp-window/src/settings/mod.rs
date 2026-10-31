//! The player's graphics settings: a preset that names which costly renderer features run, and the Original or Remastered art.
//!
//! Every costly feature has an off switch here, because players' hardware differs and rollback needs a steady frame. A feature that
//! has not landed yet still has its field in `Features`; the renderer reads the field when the feature arrives.

mod store;

use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::remaster::Quality;

pub use store::Store;

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Preset {
    Low,
    Medium,
    #[default]
    High,
    Ultra,
}

pub const PRESETS: [Preset; 4] = [Preset::Low, Preset::Medium, Preset::High, Preset::Ultra];

impl Preset {
    pub fn name(self) -> &'static str {
        match self {
            Preset::Low => "Low",
            Preset::Medium => "Medium",
            Preset::High => "High",
            Preset::Ultra => "Ultra",
        }
    }

    /// The features this preset runs.
    pub fn features(self) -> Features {
        match self {
            Preset::Low => Features { shadows: Shadows::Off, msaa: 1, ssao: false, contact_shadows: false, bloom: false, volumetrics: false, cloud_layers: 1, weather_percent: 25, water: Water::Flat, render_scale_percent: 75 },
            Preset::Medium => Features { shadows: Shadows::Map(1024), msaa: 2, ssao: false, contact_shadows: false, bloom: false, volumetrics: false, cloud_layers: 2, weather_percent: 50, water: Water::Reflective, render_scale_percent: 100 },
            Preset::High => Features { shadows: Shadows::Map(2048), msaa: 4, ssao: true, contact_shadows: true, bloom: true, volumetrics: false, cloud_layers: 3, weather_percent: 100, water: Water::Reflective, render_scale_percent: 100 },
            Preset::Ultra => Features { shadows: Shadows::Map(4096), msaa: 8, ssao: true, contact_shadows: true, bloom: true, volumetrics: true, cloud_layers: 3, weather_percent: 100, water: Water::Refractive, render_scale_percent: 100 },
        }
    }

    pub fn step(self, forward: bool) -> Self {
        let at = PRESETS.iter().position(|&preset| preset == self).unwrap_or(0);
        PRESETS[if forward { (at + 1) % PRESETS.len() } else { (at + PRESETS.len() - 1) % PRESETS.len() }]
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Art {
    Original,
    #[default]
    Remastered,
}

impl Art {
    pub fn name(self) -> &'static str {
        match self {
            Art::Original => "Original",
            Art::Remastered => "Remastered",
        }
    }

    pub fn toggled(self) -> Self {
        match self {
            Art::Original => Art::Remastered,
            Art::Remastered => Art::Original,
        }
    }

    pub fn quality(self) -> Quality {
        match self {
            Art::Original => Quality::Off,
            Art::Remastered => Quality::Standard,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Shadows {
    Off,
    /// A shadow map of this many texels a side.
    Map(u32),
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Water {
    Flat,
    Reflective,
    Refractive,
}

/// What the renderer may spend. A field is the setting's key: a feature reads `renderer.features().<field>` and draws nothing when it is off.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Features {
    pub shadows: Shadows,
    /// Samples per pixel: 1, 2, 4 or 8. Unread until the final-image pass can resample its depth.
    pub msaa: u32,
    pub ssao: bool,
    /// Screen-space shadows from the sun: a short ray march in the depth that seats feet, weapons and small props where the shadow map is too coarse.
    pub contact_shadows: bool,
    pub bloom: bool,
    /// Volumetric fog and light shafts.
    pub volumetrics: bool,
    /// Painted cloud layers the sky draws, 1 to 3; the third layer also draws the sun's shafts.
    pub cloud_layers: u8,
    /// Weather particles drawn, as a percentage of what the weather emits.
    pub weather_percent: u8,
    pub water: Water,
    /// The scene's resolution as a percentage of the window's, upscaled to fill it. Unread until the final-image pass takes a scene smaller than the window.
    pub render_scale_percent: u8,
}

impl Features {
    /// Each setting key and its value, for the log and `standalone.json`.
    pub fn keys(&self) -> [(&'static str, String); 10] {
        [
            ("shadows", match self.shadows {
                Shadows::Off => "off".into(),
                Shadows::Map(side) => side.to_string(),
            }),
            ("msaa", self.msaa.to_string()),
            ("ssao", self.ssao.to_string()),
            ("contactShadows", self.contact_shadows.to_string()),
            ("bloom", self.bloom.to_string()),
            ("volumetrics", self.volumetrics.to_string()),
            ("cloudLayers", self.cloud_layers.to_string()),
            ("weather", format!("{}%", self.weather_percent)),
            ("water", format!("{:?}", self.water).to_ascii_lowercase()),
            ("renderScale", format!("{}%", self.render_scale_percent)),
        ]
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub preset: Preset,
    #[serde(default)]
    pub art: Art,
}

impl Settings {
    pub fn features(&self) -> Features {
        self.preset.features()
    }

    /// The remaster quality to draw with: a `WISP_REMASTER` developer override when one is given, else what the art choice means.
    pub fn quality(&self, developer_override: Option<Quality>) -> Quality {
        developer_override.unwrap_or_else(|| self.art.quality())
    }
}

/// `WISP_REMASTER=off|standard|high`, for developers only: it replaces the art choice and reaches the High quality no menu offers.
pub fn developer_quality() -> Option<Quality> {
    std::env::var("WISP_REMASTER").ok().and_then(|value| Quality::from_str(&value).ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_preset_costs_no_less_than_the_one_below() {
        let cost = |features: Features| {
            (matches!(features.shadows, Shadows::Map(_)) as u32 + features.ssao as u32 + features.contact_shadows as u32 + features.bloom as u32 + features.volumetrics as u32, features.msaa, features.weather_percent, features.render_scale_percent, features.cloud_layers)
        };
        for pair in PRESETS.windows(2) {
            let (low, high) = (cost(pair[0].features()), cost(pair[1].features()));
            assert!(low.0 <= high.0 && low.1 <= high.1 && low.2 <= high.2 && low.3 <= high.3 && low.4 <= high.4, "{:?} to {:?}", pair[0], pair[1]);
        }
    }

    #[test]
    fn the_developer_override_wins_over_the_art_choice() {
        let settings = Settings { preset: Preset::High, art: Art::Original };
        assert_eq!(settings.quality(None), Quality::Off);
        assert_eq!(settings.quality(Some(Quality::High)), Quality::High);
        assert_eq!(Settings { art: Art::Remastered, ..settings }.quality(None), Quality::Standard);
    }
}
