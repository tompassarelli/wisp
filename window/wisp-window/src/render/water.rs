//! Water: a layer painted with one of Warcraft's water frames (ReplaceableTextures\Water, read from the player's install and pushed by Bun, never shipped) is not drawn
//! as a textured layer. The scene is drawn in three steps: solid layers are resolved into a refraction image and a depth buffer, a mirrored copy is drawn into a reflection
//! image, and the water pass reads all three. Depth below the surface, taken from the depth buffer, sets the shallow-to-deep ramp, the contact softening and the shore foam.

pub(super) mod falls;

use std::collections::BTreeMap;
use std::mem::size_of;

use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;

use crate::post::REFLECTION_SHRINK;
use crate::texture::Image;

use falls::Fall;
use super::gpu::upload_layers;
use super::model::Vertex;
use super::liquid::{Preset, WaterSettings};
use super::ripples::{Source, SOURCES};
use super::pipelines::{entry, shader_source, INSTANCE_ATTRIBUTES, VERTEX_ATTRIBUTES};
use super::{depth_shader, Instance, DEPTH};

const FRAME_PREFIX: &str = "replaceabletextures\\water\\water";

/// Whether `path` names one of Warcraft's water frames, whatever its case or separators.
pub fn is_frame(path: &str) -> bool {
    let path = path.to_ascii_lowercase().replace('/', "\\");
    path.starts_with(FRAME_PREFIX) && path.ends_with(".blp")
}

/// The matrix with the model's reach in its two spare cells (the w of its x and y columns), where the water shader reads it to find the model's edge.
pub(super) fn with_reach(mut matrix: super::math::Mat4, reach: Option<[f32; 2]>) -> super::math::Mat4 {
    if let Some([x, y]) = reach {
        matrix[3] = x;
        matrix[7] = y;
    }
    matrix
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
    calm: [f32; 4],
    fall: [[f32; 4]; falls::ROWS],
    mid: [f32; 4],
    wind: [f32; 4],
    ripples: [[f32; 4]; 2 * SOURCES],
}

impl WaterUniform {
    pub fn new(settings: &WaterSettings, seconds: f32, sources: &[Source], plane: Option<f32>) -> Self {
        let mut ripples = [[0.0; 4]; 2 * SOURCES];
        for (slot, source) in sources.iter().take(SOURCES).enumerate() {
            ripples[2 * slot] = source.at;
            ripples[2 * slot + 1] = source.motion;
        }
        let linear = |colour: [f32; 3]| colour.map(|channel| super::linear_of(f64::from(channel)) as f32);
        let (shallow, mid, deep, foam, glow) = (linear(settings.shallow), linear(settings.mid), linear(settings.deep), linear(settings.foam), linear(settings.glow));
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
            calm: [settings.breakup, settings.detail_reach, settings.sparkle_cover, settings.haze_lift],
            fall: Fall::WATERFALL.rows(plane),
            mid: [mid[0], mid[1], mid[2], settings.muted],
            wind: [settings.chop, settings.chop_size, settings.crest_light, settings.glint],
            ripples,
        }
    }
}

/// The images a frame of water reads, sized to the window: the solid scene resolved, its depth, and the mirrored scene at half size.
pub(super) struct Targets {
    pub size: (u32, u32),
    pub refracted: wgpu::TextureView,
    pub refracted_texture: wgpu::Texture,
    pub reflect_color: wgpu::TextureView,
    pub reflect_resolved: wgpu::TextureView,
    pub reflect_depth: wgpu::TextureView,
    pub reflect_size: (u32, u32),
}

impl Targets {
    pub fn new(device: &wgpu::Device, format: wgpu::TextureFormat, size: (u32, u32), samples: u32) -> Self {
        let reflect_size = ((size.0 / REFLECTION_SHRINK).max(1), (size.1 / REFLECTION_SHRINK).max(1));
        let make = |label, size: (u32, u32), format, samples, usage| {
            device.create_texture(&wgpu::TextureDescriptor {
                label: Some(label),
                size: wgpu::Extent3d { width: size.0, height: size.1, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: samples,
                dimension: wgpu::TextureDimension::D2,
                format,
                usage,
                view_formats: &[],
            })
        };
        let view = |texture: &wgpu::Texture| texture.create_view(&Default::default());
        let sampled = wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING;
        let refracted = make("refraction", size, format, 1, sampled | wgpu::TextureUsages::COPY_DST);
        let reflect_resolved = view(&make("reflection", reflect_size, format, 1, sampled));
        Self {
            size,
            refracted: view(&refracted),
            refracted_texture: refracted,
            reflect_color: if samples > 1 { view(&make("reflection colour", reflect_size, format, samples, wgpu::TextureUsages::RENDER_ATTACHMENT)) } else { reflect_resolved.clone() },
            reflect_resolved,
            reflect_depth: view(&make("reflection depth", reflect_size, DEPTH, samples, wgpu::TextureUsages::RENDER_ATTACHMENT)),
            reflect_size,
        }
    }
}

pub(super) struct Water {
    layout: wgpu::BindGroupLayout,
    pub pipeline: wgpu::RenderPipeline,
    /// The pipeline for falling water (water/falls.rs), which shares the sea's images and uniform.
    pub falls: wgpu::RenderPipeline,
    uniform: wgpu::Buffer,
    tiled: wgpu::Sampler,
    clamped: wgpu::Sampler,
    frames: BTreeMap<String, Image>,
    array: Option<wgpu::TextureView>,
    dirty: bool,
    samples: u32,
    pub targets: Option<Targets>,
    /// The liquid the water model on screen names.
    pub liquid: Preset,
}

impl Water {
    pub fn new(device: &wgpu::Device, format: wgpu::TextureFormat, frame_layout: &wgpu::BindGroupLayout, samples: u32) -> Self {
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
                entry(4, fragment, texture(samples > 1, wgpu::TextureSampleType::Depth, wgpu::TextureViewDimension::D2)),
                entry(5, fragment, wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering)),
                entry(6, fragment, wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None }),
            ],
        });
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("water"), source: wgpu::ShaderSource::Wgsl(depth_shader(&shader_source(include_str!("water.wgsl")), samples).into()) });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: Some("water"), bind_group_layouts: &[Some(frame_layout), Some(&layout)], immediate_size: 0 });
        let build = |label, fragment_entry: &str| device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some(label),
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
                entry_point: Some(fragment_entry),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState { format, blend: Some(wgpu::BlendState::ALPHA_BLENDING), write_mask: wgpu::ColorWrites::ALL })],
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: Some(wgpu::DepthStencilState { format: DEPTH, depth_write_enabled: Some(false), depth_compare: Some(wgpu::CompareFunction::LessEqual), stencil: Default::default(), bias: Default::default() }),
            multisample: wgpu::MultisampleState { count: samples, mask: !0, alpha_to_coverage_enabled: false },
            multiview_mask: None,
            cache: None,
        });
        let (pipeline, falls) = (build("water", "fragment_main"), build("falls", "fragment_fall"));
        let sampler = |mode| device.create_sampler(&wgpu::SamplerDescriptor { address_mode_u: mode, address_mode_v: mode, mag_filter: wgpu::FilterMode::Linear, min_filter: wgpu::FilterMode::Linear, ..Default::default() });
        Self {
            layout,
            pipeline,
            falls,
            uniform: device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: Some("water"), contents: bytemuck::bytes_of(&WaterUniform::zeroed()), usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST }),
            tiled: sampler(wgpu::AddressMode::Repeat),
            clamped: sampler(wgpu::AddressMode::ClampToEdge),
            frames: BTreeMap::new(),
            array: None,
            dirty: false,
            samples,
            targets: None,
            liquid: Preset::Water,
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
            self.targets = Some(Targets::new(device, format, size, self.samples));
        }
    }

    pub fn write(&self, queue: &wgpu::Queue, settings: &WaterSettings, seconds: f32, sources: &[Source], plane: Option<f32>) {
        queue.write_buffer(&self.uniform, 0, bytemuck::bytes_of(&WaterUniform::new(settings, seconds, sources, plane)));
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
