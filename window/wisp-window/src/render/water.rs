//! Water: a layer painted with one of Warcraft's water frames (ReplaceableTextures\Water, read from the player's install and pushed by Bun, never shipped) is not drawn
//! as a textured layer. The scene is drawn in three steps: solid layers are resolved into a refraction image and a depth buffer, a mirrored copy is drawn into a reflection
//! image, and the water pass reads all three. Depth below the surface, taken from the depth buffer, sets the shallow-to-deep ramp, the contact softening and the shore foam.

use std::collections::BTreeMap;
use std::mem::size_of;

use bytemuck::{Pod, Zeroable};
use serde::{Deserialize, Deserializer, Serialize};
use wgpu::util::DeviceExt;

use crate::texture::Image;

use super::gpu::upload_layers;
use super::model::Vertex;
use super::ripples::{Source, SOURCES};
use super::pipelines::{entry, shader_source, INSTANCE_ATTRIBUTES, VERTEX_ATTRIBUTES};
use super::{Instance, DEPTH, SAMPLES};

const FRAME_PREFIX: &str = "replaceabletextures\\water\\water";

/// Whether `path` names one of Warcraft's water frames, whatever its case or separators.
pub fn is_frame(path: &str) -> bool {
    let path = path.to_ascii_lowercase().replace('/', "\\");
    path.starts_with(FRAME_PREFIX) && path.ends_with(".blp")
}

/// A liquid the water pass draws; a scene names one with `preset` and may still set any single field over it.
#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Preset {
    Water,
    Poison,
    Lava,
}

/// What a stage may set about its water; every field has the default that reads as Warcraft's own water seen from the side.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(default, rename_all = "camelCase")]
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
        }
    }
}

impl WaterSettings {
    pub fn of(preset: Preset) -> Self {
        match preset {
            Preset::Water => Self::default(),
            // Naxxramas ooze: thick, green and slow, bright from within where it is deep, with lazy bubbles.
            Preset::Poison => Self {
                shallow: [0.36, 0.48, 0.14],
                deep: [0.05, 0.16, 0.05],
                foam: [0.70, 0.95, 0.30],
                absorption: 0.03,
                depth_rate: 0.006,
                foam_width: 55.0,
                normal_strength: 0.6,
                fps: 4.0,
                specular_power: 60.0,
                specular: 0.55,
                caustics: 0.15,
                refraction: 0.015,
                reflection: 0.3,
                wave_height: 7.0,
                wave_speed: 0.22,
                glow: [0.42, 1.0, 0.10],
                emissive: 0.32,
                glow_reach: 260.0,
                glow_light: 0.32,
                opacity: 0.92,
                bubbles: 0.45,
                swell: 0.5,
                swirl: 0.9,
                ..Self::default()
            },
            // Molten rock: a slow dark crust drifting over a bright core, lighting what is near it, with heat shimmer, bubbles and embers.
            Preset::Lava => Self {
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
                crust: 0.62,
                shimmer: 0.7,
                bubbles: 0.8,
                embers: 0.7,
                swell: 0.0,
                ..Self::default()
            },
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

/// Reads a scene's `water`: `preset` picks the liquid and any other field is set over it.
pub fn scene_water<'de, D: Deserializer<'de>>(deserializer: D) -> Result<WaterSettings, D::Error> {
    use serde::de::Error;
    use serde_json::{Map, Value};
    let mut given = Map::<String, Value>::deserialize(deserializer)?;
    let preset = given.remove("preset").map(serde_json::from_value).transpose().map_err(D::Error::custom)?.unwrap_or(Preset::Water);
    let Value::Object(mut merged) = serde_json::to_value(WaterSettings::of(preset)).map_err(D::Error::custom)? else {
        return Err(D::Error::custom("water settings are not an object"));
    };
    merged.extend(given);
    serde_json::from_value(Value::Object(merged)).map_err(D::Error::custom)
}


#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub(super) struct WaterUniform {
    shallow: [f32; 4],
    deep: [f32; 4],
    foam: [f32; 4],
    flow: [f32; 4],
    shine: [f32; 4],
    wave: [f32; 4],
    glow: [f32; 4],
    look: [f32; 4],
    sparks: [f32; 4],
    ripples: [[f32; 4]; 2 * SOURCES],
}

impl WaterUniform {
    pub fn new(settings: &WaterSettings, seconds: f32, sources: &[Source]) -> Self {
        let mut ripples = [[0.0; 4]; 2 * SOURCES];
        for (slot, source) in sources.iter().take(SOURCES).enumerate() {
            ripples[2 * slot] = source.at;
            ripples[2 * slot + 1] = source.motion;
        }
        let linear = |colour: [f32; 3]| colour.map(|channel| super::linear_of(f64::from(channel)) as f32);
        let (shallow, deep, foam, glow) = (linear(settings.shallow), linear(settings.deep), linear(settings.foam), linear(settings.glow));
        Self {
            shallow: [shallow[0], shallow[1], shallow[2], settings.absorption],
            deep: [deep[0], deep[1], deep[2], settings.depth_rate],
            foam: [foam[0], foam[1], foam[2], settings.foam_width],
            flow: [settings.tile, settings.normal_strength, settings.fps, seconds],
            shine: [settings.specular_power, settings.specular, settings.caustics, settings.refraction],
            wave: [settings.wave_height, settings.wave_number, settings.wave_speed, settings.reflection],
            glow: [glow[0], glow[1], glow[2], settings.emissive],
            look: [settings.crust, settings.shimmer, settings.opacity, settings.bubbles],
            sparks: [settings.embers, settings.swirl, settings.swell, sources.len().min(SOURCES) as f32],
            ripples,
        }
    }
}

/// The images a frame of water reads, sized to the window: the solid scene resolved, its depth, and the mirrored scene at half size.
pub(super) struct Targets {
    pub size: (u32, u32),
    pub refracted: wgpu::TextureView,
    pub reflect_color: wgpu::TextureView,
    pub reflect_resolved: wgpu::TextureView,
    pub reflect_depth: wgpu::TextureView,
    pub reflect_size: (u32, u32),
}

impl Targets {
    pub fn new(device: &wgpu::Device, format: wgpu::TextureFormat, size: (u32, u32)) -> Self {
        let reflect_size = ((size.0 / 2).max(1), (size.1 / 2).max(1));
        let make = |label, size: (u32, u32), format, samples, usage| {
            device
                .create_texture(&wgpu::TextureDescriptor {
                    label: Some(label),
                    size: wgpu::Extent3d { width: size.0, height: size.1, depth_or_array_layers: 1 },
                    mip_level_count: 1,
                    sample_count: samples,
                    dimension: wgpu::TextureDimension::D2,
                    format,
                    usage,
                    view_formats: &[],
                })
                .create_view(&Default::default())
        };
        let sampled = wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING;
        Self {
            size,
            refracted: make("refraction", size, format, 1, sampled),
            reflect_color: make("reflection colour", reflect_size, format, SAMPLES, wgpu::TextureUsages::RENDER_ATTACHMENT),
            reflect_resolved: make("reflection", reflect_size, format, 1, sampled),
            reflect_depth: make("reflection depth", reflect_size, DEPTH, SAMPLES, wgpu::TextureUsages::RENDER_ATTACHMENT),
            reflect_size,
        }
    }
}

pub(super) struct Water {
    layout: wgpu::BindGroupLayout,
    pub pipeline: wgpu::RenderPipeline,
    uniform: wgpu::Buffer,
    tiled: wgpu::Sampler,
    clamped: wgpu::Sampler,
    frames: BTreeMap<String, Image>,
    array: Option<wgpu::TextureView>,
    dirty: bool,
    pub targets: Option<Targets>,
}

impl Water {
    pub fn new(device: &wgpu::Device, format: wgpu::TextureFormat, frame_layout: &wgpu::BindGroupLayout) -> Self {
        let fragment = wgpu::ShaderStages::FRAGMENT;
        let texture = |multisampled, sample_type, view_dimension| wgpu::BindingType::Texture { sample_type, view_dimension, multisampled };
        let filterable = wgpu::TextureSampleType::Float { filterable: true };
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("water"),
            entries: &[
                entry(0, fragment, texture(false, filterable, wgpu::TextureViewDimension::D2Array)),
                entry(1, fragment, wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering)),
                entry(2, fragment, texture(false, filterable, wgpu::TextureViewDimension::D2)),
                entry(3, fragment, texture(false, filterable, wgpu::TextureViewDimension::D2)),
                entry(4, fragment, texture(true, wgpu::TextureSampleType::Depth, wgpu::TextureViewDimension::D2)),
                entry(5, fragment, wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering)),
                entry(6, fragment, wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None }),
            ],
        });
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("water"), source: wgpu::ShaderSource::Wgsl(shader_source(include_str!("water.wgsl")).into()) });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: Some("water"), bind_group_layouts: &[Some(frame_layout), Some(&layout)], immediate_size: 0 });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("water"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some("vertex_main"),
                compilation_options: Default::default(),
                buffers: &[
                    Some(wgpu::VertexBufferLayout { array_stride: size_of::<Vertex>() as u64, step_mode: wgpu::VertexStepMode::Vertex, attributes: &VERTEX_ATTRIBUTES }),
                    Some(wgpu::VertexBufferLayout { array_stride: size_of::<Instance>() as u64, step_mode: wgpu::VertexStepMode::Instance, attributes: &INSTANCE_ATTRIBUTES }),
                ],
            },
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("fragment_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState { format, blend: Some(wgpu::BlendState::ALPHA_BLENDING), write_mask: wgpu::ColorWrites::ALL })],
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: Some(wgpu::DepthStencilState { format: DEPTH, depth_write_enabled: Some(false), depth_compare: Some(wgpu::CompareFunction::LessEqual), stencil: Default::default(), bias: Default::default() }),
            multisample: wgpu::MultisampleState { count: SAMPLES, mask: !0, alpha_to_coverage_enabled: false },
            multiview_mask: None,
            cache: None,
        });
        let sampler = |mode| device.create_sampler(&wgpu::SamplerDescriptor { address_mode_u: mode, address_mode_v: mode, mag_filter: wgpu::FilterMode::Linear, min_filter: wgpu::FilterMode::Linear, ..Default::default() });
        Self {
            layout,
            pipeline,
            uniform: device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: Some("water"), contents: bytemuck::bytes_of(&WaterUniform::zeroed()), usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST }),
            tiled: sampler(wgpu::AddressMode::Repeat),
            clamped: sampler(wgpu::AddressMode::ClampToEdge),
            frames: BTreeMap::new(),
            array: None,
            dirty: false,
            targets: None,
        }
    }

    /// Keeps a decoded frame until the array is built; a frame's path is its slot, so a repeated push replaces it.
    pub fn keep(&mut self, path: String, image: Image) {
        self.frames.insert(path, image);
        self.dirty = true;
    }

    /// Builds the frame array from the frames kept, those of the first frame's size, once nothing more is decoding.
    pub fn build(&mut self, device: &wgpu::Device, queue: &wgpu::Queue) -> Option<String> {
        if !self.dirty {
            return None;
        }
        self.dirty = false;
        let first = self.frames.values().next()?;
        let size = (first.width, first.height);
        let images: Vec<&Image> = self.frames.values().filter(|image| (image.width, image.height) == size).collect();
        let skipped = self.frames.len() - images.len();
        self.array = Some(upload_layers(device, queue, &images));
        (skipped > 0).then(|| format!("{skipped} water frames are not {}x{} and were left out", size.0, size.1))
    }

    pub fn ready(&self) -> bool {
        self.array.is_some()
    }

    pub fn fit(&mut self, device: &wgpu::Device, format: wgpu::TextureFormat, size: (u32, u32)) {
        if self.targets.as_ref().is_none_or(|targets| targets.size != size) {
            self.targets = Some(Targets::new(device, format, size));
        }
    }

    pub fn write(&self, queue: &wgpu::Queue, settings: &WaterSettings, seconds: f32, sources: &[Source]) {
        queue.write_buffer(&self.uniform, 0, bytemuck::bytes_of(&WaterUniform::new(settings, seconds, sources)));
    }

    /// The group the water pass binds; made per frame since it names the window-sized images.
    pub fn group(&self, device: &wgpu::Device, depth: &wgpu::TextureView) -> Option<wgpu::BindGroup> {
        let (array, targets) = (self.array.as_ref()?, self.targets.as_ref()?);
        Some(device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("water"),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(array) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&self.tiled) },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(&targets.refracted) },
                wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::TextureView(&targets.reflect_resolved) },
                wgpu::BindGroupEntry { binding: 4, resource: wgpu::BindingResource::TextureView(depth) },
                wgpu::BindGroupEntry { binding: 5, resource: wgpu::BindingResource::Sampler(&self.clamped) },
                wgpu::BindGroupEntry { binding: 6, resource: self.uniform.as_entire_binding() },
            ],
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn water_frames_are_told_by_their_install_path() {
        assert!(is_frame("ReplaceableTextures\\Water\\Water00.blp"));
        assert!(is_frame("replaceabletextures/water/water44.BLP"));
        assert!(!is_frame("ReplaceableTextures\\TeamColor\\TeamColor00.blp"));
        assert!(!is_frame("war3mapImported\\StageWater.tga"));
    }

    #[test]
    fn a_scene_may_set_part_of_the_water() {
        let settings: WaterSettings = serde_json::from_str(r#"{"fps": 24, "deep": [0, 0, 1]}"#).unwrap();
        assert_eq!(settings.fps, 24.0);
        assert_eq!(settings.deep, [0.0, 0.0, 1.0]);
        assert_eq!(settings.tile, WaterSettings::default().tile);
    }

    #[derive(Deserialize)]
    struct Wrapped {
        #[serde(deserialize_with = "scene_water")]
        water: WaterSettings,
    }

    fn scene_water_of(json: &str) -> WaterSettings {
        serde_json::from_str::<Wrapped>(json).unwrap().water
    }

    #[test]
    fn a_scene_picks_a_liquid_and_may_still_set_a_field_over_it() {
        assert_eq!(scene_water_of(r#"{"water": {}}"#), WaterSettings::default());
        assert_eq!(scene_water_of(r#"{"water": {"preset": "lava"}}"#), WaterSettings::of(Preset::Lava));
        let poison = scene_water_of(r#"{"water": {"preset": "poison", "fps": 9}}"#);
        assert_eq!(poison.fps, 9.0);
        assert_eq!(poison.deep, WaterSettings::of(Preset::Poison).deep);
    }

    #[test]
    fn the_liquids_differ_as_their_looks_require() {
        let (water, poison, lava) = (WaterSettings::of(Preset::Water), WaterSettings::of(Preset::Poison), WaterSettings::of(Preset::Lava));
        assert!(poison.deep[1] > poison.deep[0] && poison.deep[1] > poison.deep[2], "poison is green");
        assert!(poison.fps < water.fps && poison.wave_speed < water.wave_speed, "poison is slower");
        assert!(poison.absorption > water.absorption && poison.opacity > water.opacity, "poison is thicker");
        assert!(poison.emissive > 0.0, "poison glows");
        assert!(lava.fps < poison.fps && lava.crust > 0.0 && lava.shimmer > 0.0 && lava.bubbles > 0.0 && lava.embers > 0.0);
        assert!(lava.glow_light > poison.glow_light, "lava lights its surroundings most");
        assert_eq!(water.glow(0.0, 0.0).light, [0.0, 0.0, 0.0, 1.0]);
    }

    #[test]
    fn the_uniform_carries_the_time_and_the_ramp_rates() {
        let uniform = WaterUniform::new(&WaterSettings::default(), 3.5, &[]);
        assert_eq!(uniform.flow[3], 3.5);
        assert_eq!(uniform.shallow[3], WaterSettings::default().absorption);
        assert_eq!(uniform.deep[3], WaterSettings::default().depth_rate);
    }

    #[test]
    fn the_uniform_carries_the_ripple_sources_and_their_count() {
        let source = Source { at: [10.0, 20.0, 30.0, 4.0], motion: [1.0, 2.0, 3.0, 1.0] };
        let uniform = WaterUniform::new(&WaterSettings::default(), 0.0, &[source, source]);
        assert_eq!(uniform.sparks[3], 2.0);
        assert_eq!(uniform.ripples[2], source.at);
        assert_eq!(uniform.ripples[3], source.motion);
        assert_eq!(WaterUniform::new(&WaterSettings::default(), 0.0, &[]).sparks[3], 0.0);
    }
}
