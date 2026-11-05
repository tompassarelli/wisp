//! The liquids the water pass draws and what each looks like: Warcraft's water, Naxxramas poison and lava, with the settings the water shader reads for each.

/// A liquid the water pass draws.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Preset {
    Water,
    Poison,
    Lava,
}

/// How a liquid looks; every field has the default that reads as Warcraft's own water seen from the side.
#[derive(Clone, Debug, PartialEq)]
pub struct WaterSettings {
    pub shallow: [f32; 3],
    pub deep: [f32; 3],
    pub foam: [f32; 3],
    /// Beer-Lambert rates per world unit of water the view ray crosses: how fast the bed gives way to the body colour, and the body to the deep colour.
    pub absorption: f32,
    pub depth_rate: f32,
    pub foam_width: f32,
    /// World units one repeat of a water frame covers.
    pub tile: f32,
    pub normal_strength: f32,
    /// Water frames shown per second; neighbours cross-fade so the motion stays smooth above 60 Hz.
    pub fps: f32,
    pub specular_power: f32,
    pub specular: f32,
    pub caustics: f32,
    pub refraction: f32,
    pub reflection: f32,
    pub wave_height: f32,
    pub wave_number: f32,
    pub wave_speed: f32,
    /// Colour the liquid shines with, and how strongly: lava and poison are lit from within, so they stay bright in shade.
    pub glow: [f32; 3],
    pub emissive: f32,
    /// How far above the surface the glow lights models, in world units, and how strongly it does.
    pub glow_reach: f32,
    pub glow_light: f32,
    /// The least the body hides the bed, 0 to 1: poison is thick, lava is opaque.
    pub opacity: f32,
    /// Share of the surface under dark cooled crust, 0 to 1.
    pub crust: f32,
    /// Heat shimmer: how far the surface wobbles what it reflects and refracts.
    pub shimmer: f32,
    /// Bubbles that swell and pop, and embers that drift over the surface, per area.
    pub bubbles: f32,
    pub embers: f32,
    /// How strongly long swells streak the surface, and how bright the spiral whirlpools and veins lit from within shine, 0 for none.
    pub swell: f32,
    pub swirl: f32,
    /// How strongly a slow field of large drifting patches breaks the surface up, 0 to 1: it gathers the caustics, glints and fine ripples into loose clumps and shades the body in broad shapes, so no tile repeat shows.
    pub breakup: f32,
    /// View distance in world units past which the fine ripples, caustics and glints have faded out, 0 to leave them at every distance.
    pub detail_reach: f32,
    /// Share of the surface the clumps of caustics and glints cover, 0 to 1.
    pub sparkle_cover: f32,
    /// How far the horizon haze lifts from the deep colour toward the fog or sky, 0 to 1.
    pub haze_lift: f32,
    /// The middle stop of a muted liquid's three-stop depth ramp (shallow, mid, deep).
    pub mid: [f32; 3],
    /// How far the liquid takes the muted look, 0 to 1: three-stop ramp, no caustic web, no crest foam, a dimmed reflection and foam capped soft and translucent.
    pub muted: f32,
    /// Fine wind-driven chop over the whole surface in place of the water frames' finer layer: its slope, 0 for none, and the size of its waves (1 sets crests about 80 units apart across the view).
    pub chop: f32,
    pub chop_size: f32,
    /// How far the chop's crests lighten toward the crest colour where the sun catches them, and how bright the soft glint path of a sun low behind the water runs over the near surface.
    pub crest_light: f32,
    pub glint: f32,
}

impl Default for WaterSettings {
    fn default() -> Self {
        Self {
            shallow: [0.30, 0.74, 0.72],
            deep: [0.02, 0.22, 0.34],
            foam: [0.93, 0.97, 1.0],
            absorption: 0.012,
            depth_rate: 0.0035,
            foam_width: 60.0,
            tile: 512.0,
            normal_strength: 0.9,
            fps: 12.0,
            specular_power: 90.0,
            specular: 0.9,
            caustics: 0.6,
            refraction: 0.035,
            reflection: 1.0,
            wave_height: 14.0,
            wave_number: 0.012,
            wave_speed: 0.6,
            glow: [0.0; 3],
            emissive: 0.0,
            glow_reach: 0.0,
            glow_light: 0.0,
            opacity: 0.0,
            crust: 0.0,
            shimmer: 0.0,
            bubbles: 0.0,
            embers: 0.0,
            swell: 1.0,
            swirl: 0.0,
            breakup: 0.0,
            detail_reach: 0.0,
            sparkle_cover: 1.0,
            haze_lift: 0.6,
            mid: [0.0; 3],
            muted: 0.0,
            chop: 0.0,
            chop_size: 1.0,
            crest_light: 0.0,
            glint: 0.0,
        }
    }
}

impl Preset {
    /// The liquid a water model's own path names: a lava or poison model is drawn with its look, any other as water.
    pub fn of_model(path: &str) -> Self {
        let path = path.to_ascii_lowercase();
        let names = |words: &[&str]| words.iter().any(|word| path.contains(word));
        if names(&["lava", "magma", "molten"]) {
            Self::Lava
        } else if names(&["poison", "plague", "ooze", "slime", "toxic"]) {
            Self::Poison
        } else {
            Self::Water
        }
    }
}

impl WaterSettings {
    pub fn of(preset: Preset) -> Self {
        match preset {
            Preset::Water => Self::sea(),
            Preset::Poison => Self::ooze(),
            Preset::Lava => Self::molten(),
        }
    }

    /// A calm muted sea after World of Warcraft Forever: a three-stop ramp from depth, fine wind chop whose crests catch the light, a soft glint path near the camera, no caustic web or swell, a dim reflection and soft foam only where the water meets something.
    fn sea() -> Self {
        Self {
            shallow: [0.259, 0.396, 0.369],
            mid: [0.141, 0.286, 0.259],
            deep: [0.059, 0.173, 0.204],
            foam: [0.576, 0.837, 0.837],
            absorption: 0.02,
            depth_rate: 0.004,
            foam_width: 40.0,
            normal_strength: 0.3,
            specular_power: 200.0,
            specular: 0.0,
            caustics: 0.0,
            reflection: 0.45,
            wave_height: 3.0,
            swell: 0.0,
            breakup: 1.0,
            detail_reach: 4500.0,
            sparkle_cover: 0.3,
            haze_lift: 0.35,
            muted: 1.0,
            chop: 1.0,
            chop_size: 0.6,
            crest_light: 0.06,
            glint: 0.07,
            ..Self::default()
        }
    }

    /// Naxxramas ooze: thick, green and slow, lit softly from within where it is deep, muted like the sea: its own three green stops, no caustic web or glitter, a dim reflection and soft foam.
    fn ooze() -> Self {
        Self {
            shallow: [0.32, 0.42, 0.22],
            mid: [0.17, 0.28, 0.145],
            deep: [0.085, 0.165, 0.095],
            foam: [0.60, 0.78, 0.40],
            muted: 1.0,
            absorption: 0.03,
            depth_rate: 0.006,
            foam_width: 55.0,
            normal_strength: 0.15,
            fps: 4.0,
            specular_power: 60.0,
            specular: 0.0,
            caustics: 0.0,
            refraction: 0.015,
            reflection: 0.3,
            wave_height: 3.0,
            wave_speed: 0.22,
            glow: [0.50, 0.95, 0.30],
            emissive: 0.14,
            glow_reach: 260.0,
            glow_light: 0.32,
            opacity: 0.92,
            bubbles: 0.0,
            swell: 0.0,
            swirl: 0.12,
            ..Self::default()
        }
    }

    /// Molten rock: a slow dark crust drifting over a bright core, lighting what is near it, with heat shimmer, bubbles and embers.
    fn molten() -> Self {
        Self {
            shallow: [1.0, 0.50, 0.06],
            deep: [0.50, 0.07, 0.02],
            foam: [1.0, 0.82, 0.30],
            absorption: 0.5,
            depth_rate: 0.5,
            foam_width: 28.0,
            tile: 640.0,
            normal_strength: 0.45,
            fps: 2.5,
            specular_power: 40.0,
            specular: 0.2,
            caustics: 0.0,
            refraction: 0.01,
            reflection: 0.14,
            wave_height: 4.0,
            wave_speed: 0.1,
            glow: [1.0, 0.40, 0.07],
            emissive: 1.0,
            glow_reach: 340.0,
            glow_light: 0.95,
            opacity: 1.0,
            crust: 0.55,
            shimmer: 0.7,
            bubbles: 0.8,
            embers: 0.7,
            swell: 0.0,
            ..Self::default()
        }
    }

    /// The light the liquid throws onto models above `plane`, with the seconds that move its flicker.
    pub fn glow(&self, plane: f32, seconds: f32) -> Glow {
        let reach = self.glow_reach.max(1.0);
        Glow { light: [self.glow[0] * self.glow_light, self.glow[1] * self.glow_light, self.glow[2] * self.glow_light, reach], at: [plane, seconds, 0.0, 0.0] }
    }
}

/// What the model shader reads to light models from the liquid below them.
#[derive(Clone, Copy)]
pub struct Glow {
    pub light: [f32; 4],
    pub at: [f32; 4],
}

impl Glow {
    pub const NONE: Self = Self { light: [0.0; 4], at: [0.0; 4] };
}
