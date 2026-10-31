//! Lightning bolts the game puts between two points, re-jagged 24 times a second on the GPU and added over the world.
//! A bolt whose type's row in Splats\LightningData.slk the host read and whose texture is decoded draws as one textured ribbon of that row's width, with the texture scrolling along it;
//! any other bolt draws as a glowing strip with a bright core in its colour. Bolts that share a texture share one instanced draw.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::mem::size_of;
use std::ops::Range;

use bytemuck::{Pod, Zeroable};

use super::particles::Particles;
use super::pipelines::{blend_of, entry};
use super::scene::{Bolt, Look};
use super::model::Filter;
use super::{DEPTH, SAMPLES};

const BOLTS: usize = 256;
const PLAIN_SEGMENTS: u32 = 24;
const MAX_SEGMENTS: u32 = 64;
const GLOW: f32 = 0.0;
const CORE: f32 = 1.0;
const TEXTURED: f32 = 2.0;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct GpuBolt {
    from_and_seed: [f32; 4],
    to_and_kind: [f32; 4],
    color: [f32; 4],
    shape: [f32; 4],
}

/// What staging reads from the renderer: the device to bind a texture with, the decoded textures by lowercase path, and whether any decode is still outstanding.
pub(super) struct Art<'a> {
    pub device: &'a wgpu::Device,
    pub queue: &'a wgpu::Queue,
    pub textures: &'a HashMap<String, wgpu::TextureView>,
    pub white: &'a wgpu::TextureView,
    pub sampler: &'a wgpu::Sampler,
    pub settled: bool,
}

struct Draw {
    group: wgpu::BindGroup,
    instances: Range<u32>,
    vertices: u32,
}

pub(super) struct Lightning {
    pipeline: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
    buffer: wgpu::Buffer,
    staged: Vec<GpuBolt>,
    draws: Vec<Draw>,
    reported: HashSet<String>,
}

impl Lightning {
    pub(super) fn new(device: &wgpu::Device, format: wgpu::TextureFormat, particles: &Particles) -> Self {
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("lightning"), source: wgpu::ShaderSource::Wgsl(include_str!("lightning.wgsl").into()) });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("lightning"),
            entries: &[
                entry(0, wgpu::ShaderStages::VERTEX, wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Storage { read_only: true }, has_dynamic_offset: false, min_binding_size: None }),
                entry(1, wgpu::ShaderStages::FRAGMENT, wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: true }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false }),
                entry(2, wgpu::ShaderStages::FRAGMENT, wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering)),
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: Some("lightning"), bind_group_layouts: &[Some(particles.frame_layout()), Some(&layout)], immediate_size: 0 });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("lightning"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState { module: &module, entry_point: Some("vertex_main"), compilation_options: Default::default(), buffers: &[] },
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("fragment_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState { format, blend: blend_of(Filter::Additive), write_mask: wgpu::ColorWrites::ALL })],
            }),
            primitive: wgpu::PrimitiveState { topology: wgpu::PrimitiveTopology::TriangleStrip, ..Default::default() },
            depth_stencil: Some(wgpu::DepthStencilState { format: DEPTH, depth_write_enabled: Some(false), depth_compare: Some(wgpu::CompareFunction::LessEqual), stencil: Default::default(), bias: Default::default() }),
            multisample: wgpu::MultisampleState { count: SAMPLES, mask: !0, alpha_to_coverage_enabled: false },
            multiview_mask: None,
            cache: None,
        });
        let buffer = device.create_buffer(&wgpu::BufferDescriptor { label: Some("bolts"), size: (BOLTS * 2 * size_of::<GpuBolt>()) as u64, usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
        Self { pipeline, layout, buffer, staged: Vec::with_capacity(BOLTS * 2), draws: Vec::new(), reported: HashSet::new() }
    }

    /// Uploads the scene's bolts; a bolt with no alpha is not drawn. Each keeps its slot's seed, so it stays the same bolt from one scene to the next.
    /// A bolt whose texture is not decoded draws as the plain strip; once nothing is left decoding, each such texture is returned once as a problem.
    pub(super) fn stage(&mut self, art: Art<'_>, bolts: &[Bolt]) -> Vec<String> {
        let mut problems = Vec::new();
        self.staged.clear();
        self.draws.clear();
        let mut textured: BTreeMap<String, Vec<GpuBolt>> = BTreeMap::new();
        let mut plain = Vec::new();
        for (seed, bolt) in bolts.iter().filter(|bolt| bolt.color[3] > 0.0).take(BOLTS).enumerate() {
            let [red, green, blue, alpha] = bolt.color.map(|channel| channel.clamp(0.0, 1.0));
            let at = [bolt.from[0], bolt.from[1], bolt.from[2], seed as f32];
            let key = bolt.look.as_ref().map(|look| look.texture.to_ascii_lowercase());
            match (&bolt.look, key) {
                (Some(look), Some(key)) if art.textures.contains_key(&key) => {
                    let tint = [0, 1, 2].map(|channel| [red, green, blue][channel] * look.color[channel].clamp(0.0, 1.0));
                    textured.entry(key).or_default().push(GpuBolt { from_and_seed: at, to_and_kind: [bolt.to[0], bolt.to[1], bolt.to[2], TEXTURED], color: [tint[0], tint[1], tint[2], alpha], shape: shape_of(look, bolt) });
                }
                (look, key) => {
                    if let (Some(look), Some(key)) = (look, key) {
                        if art.settled && self.reported.insert(key) {
                            problems.push(format!("lightning texture {} was never decoded, so its bolts draw as plain strips", look.texture));
                        }
                    }
                    plain.push((at, [bolt.to[0], bolt.to[1], bolt.to[2]], [red, green, blue, alpha]));
                }
            }
        }
        for (at, to, [red, green, blue, alpha]) in plain {
            self.staged.push(GpuBolt { from_and_seed: at, to_and_kind: [to[0], to[1], to[2], GLOW], color: [red, green, blue, alpha * 0.55], shape: [0.0; 4] });
            self.staged.push(GpuBolt { from_and_seed: at, to_and_kind: [to[0], to[1], to[2], CORE], color: [red + (1.0 - red) * 0.75, green + (1.0 - green) * 0.75, blue + (1.0 - blue) * 0.75, alpha], shape: [0.0; 4] });
        }
        let mut runs = Vec::new();
        if !self.staged.is_empty() {
            runs.push((art.white, 0..self.staged.len() as u32, (PLAIN_SEGMENTS + 1) * 2));
        }
        for (key, group) in &textured {
            let first = self.staged.len() as u32;
            self.staged.extend_from_slice(group);
            runs.push((&art.textures[key], first..self.staged.len() as u32, (MAX_SEGMENTS + 1) * 2));
        }
        for (view, instances, vertices) in runs {
            let group = art.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("bolts"),
                layout: &self.layout,
                entries: &[
                    wgpu::BindGroupEntry { binding: 0, resource: self.buffer.as_entire_binding() },
                    wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(view) },
                    wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(art.sampler) },
                ],
            });
            self.draws.push(Draw { group, instances, vertices });
        }
        art.queue.write_buffer(&self.buffer, 0, bytemuck::cast_slice(&self.staged));
        problems
    }

    pub(super) fn draw<'a>(&'a self, pass: &mut wgpu::RenderPass<'a>, particles: &'a Particles) {
        if self.draws.is_empty() {
            return;
        }
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, particles.frame_group(), &[]);
        for draw in &self.draws {
            pass.set_bind_group(1, &draw.group, &[]);
            pass.draw(0..draw.vertices, draw.instances.clone());
        }
    }
}

/// A textured bolt's half width in world units, its segment count (its reach over the type's average segment length, capped), the sideways jitter the type's noise gives each joint and the texture repeats per world unit.
fn shape_of(look: &Look, bolt: &Bolt) -> [f32; 4] {
    let reach = (0..3).map(|axis| (bolt.to[axis] - bolt.from[axis]).powi(2)).sum::<f32>().sqrt();
    let segment = if look.segment > 0.0 { look.segment } else { reach / PLAIN_SEGMENTS as f32 }.max(1.0);
    let segments = (reach / segment).ceil().clamp(1.0, MAX_SEGMENTS as f32);
    let scale = if look.scale > 0.0 { look.scale } else { 1.0 };
    [look.width.max(0.0) * 0.5, segments, look.noise.max(0.0) * segment, scale / segment]
}
