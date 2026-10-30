//! Lightning bolts the game puts between two points: a glowing ribbon and a bright core, re-jagged 24 times a second on the GPU.
//! Warcraft textures them by code name; this draws every code name the same way, in the bolt's colour, additively and over the world.

use std::mem::size_of;

use bytemuck::{Pod, Zeroable};

use super::particles::Particles;
use super::pipelines::{blend_of, entry};
use super::scene::Bolt;
use super::model::Filter;
use super::{DEPTH, SAMPLES};

const BOLTS: usize = 256;
const SEGMENTS: u32 = 24;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct GpuBolt {
    from_and_seed: [f32; 4],
    to: [f32; 4],
    color: [f32; 4],
}

pub(super) struct Lightning {
    pipeline: wgpu::RenderPipeline,
    buffer: wgpu::Buffer,
    group: wgpu::BindGroup,
    staged: Vec<GpuBolt>,
}

impl Lightning {
    pub(super) fn new(device: &wgpu::Device, format: wgpu::TextureFormat, particles: &Particles) -> Self {
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("lightning"), source: wgpu::ShaderSource::Wgsl(include_str!("lightning.wgsl").into()) });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("lightning"),
            entries: &[entry(0, wgpu::ShaderStages::VERTEX, wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Storage { read_only: true }, has_dynamic_offset: false, min_binding_size: None })],
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
        let buffer = device.create_buffer(&wgpu::BufferDescriptor { label: Some("bolts"), size: (BOLTS * size_of::<GpuBolt>()) as u64, usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
        let group = device.create_bind_group(&wgpu::BindGroupDescriptor { label: Some("bolts"), layout: &layout, entries: &[wgpu::BindGroupEntry { binding: 0, resource: buffer.as_entire_binding() }] });
        Self { pipeline, buffer, group, staged: Vec::with_capacity(BOLTS) }
    }

    /// Uploads the scene's bolts; a bolt with no alpha is not drawn. Each keeps its slot's seed, so it stays the same bolt from one scene to the next.
    pub(super) fn stage(&mut self, queue: &wgpu::Queue, bolts: &[Bolt]) {
        self.staged.clear();
        for (seed, bolt) in bolts.iter().filter(|bolt| bolt.color[3] > 0.0).take(BOLTS).enumerate() {
            let [red, green, blue, alpha] = bolt.color.map(|channel| channel.clamp(0.0, 1.0));
            self.staged.push(GpuBolt { from_and_seed: [bolt.from[0], bolt.from[1], bolt.from[2], seed as f32], to: [bolt.to[0], bolt.to[1], bolt.to[2], 0.0], color: [red, green, blue, alpha] });
        }
        queue.write_buffer(&self.buffer, 0, bytemuck::cast_slice(&self.staged));
    }

    pub(super) fn draw<'a>(&'a self, pass: &mut wgpu::RenderPass<'a>, particles: &'a Particles) {
        if self.staged.is_empty() {
            return;
        }
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, particles.frame_group(), &[]);
        pass.set_bind_group(1, &self.group, &[]);
        pass.draw(0..(SEGMENTS + 1) * 2, 0..self.staged.len() as u32 * 2);
    }
}
