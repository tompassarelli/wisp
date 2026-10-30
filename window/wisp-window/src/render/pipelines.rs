//! The model pipelines: one per layer filter mode, sharing one shader and the two bind group layouts.

use std::mem::size_of;

use super::model::{Filter, Vertex, FILTERS};
use super::{Instance, DEPTH, SAMPLES};

pub(super) fn entry(binding: u32, visibility: wgpu::ShaderStages, ty: wgpu::BindingType) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry { binding, visibility, ty, count: None }
}

fn uniform_type() -> wgpu::BindingType {
    wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None }
}

fn blend_of(filter: Filter) -> Option<wgpu::BlendState> {
    use wgpu::BlendFactor::{Dst, One, OneMinusSrcAlpha, Src, SrcAlpha, Zero};
    let blend = |source, destination| wgpu::BlendState {
        color: wgpu::BlendComponent { src_factor: source, dst_factor: destination, operation: wgpu::BlendOperation::Add },
        alpha: wgpu::BlendComponent { src_factor: Zero, dst_factor: One, operation: wgpu::BlendOperation::Add },
    };
    match filter {
        Filter::Opaque | Filter::Cutout => None,
        Filter::Blend => Some(blend(SrcAlpha, OneMinusSrcAlpha)),
        Filter::Additive | Filter::AddAlpha => Some(blend(SrcAlpha, One)),
        Filter::Modulate => Some(blend(Zero, Src)),
        Filter::Modulate2x => Some(blend(Dst, Src)),
    }
}


/// The seven pipelines in `FILTERS` order, and the frame and layer bind group layouts they use.
pub(super) fn build(device: &wgpu::Device, format: wgpu::TextureFormat) -> (Vec<wgpu::RenderPipeline>, wgpu::BindGroupLayout, wgpu::BindGroupLayout) {
    let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("model"), source: wgpu::ShaderSource::Wgsl(include_str!("shader.wgsl").into()) });
    let both = wgpu::ShaderStages::VERTEX_FRAGMENT;
    let frame_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("frame"),
        entries: &[
            entry(0, both, uniform_type()),
            entry(1, wgpu::ShaderStages::VERTEX, wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Storage { read_only: true }, has_dynamic_offset: false, min_binding_size: None }),
        ],
    });
    let layer_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("layer"),
        entries: &[
            entry(0, wgpu::ShaderStages::FRAGMENT, wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: true }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false }),
            entry(1, wgpu::ShaderStages::FRAGMENT, wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering)),
            entry(2, wgpu::ShaderStages::FRAGMENT, uniform_type()),
        ],
    });
    let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: Some("model"), bind_group_layouts: &[Some(&frame_layout), Some(&layer_layout)], immediate_size: 0 });
    let vertex_attributes = wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3, 2 => Float32x2, 3 => Uint16x4, 4 => Float32x4];
    let instance_attributes = wgpu::vertex_attr_array![5 => Float32x4, 6 => Float32x4, 7 => Float32x4, 8 => Float32x4, 9 => Float32x4, 10 => Float32x4, 11 => Uint32];
    let pipelines = FILTERS
        .iter()
        .map(|&filter| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("model"),
                layout: Some(&layout),
                vertex: wgpu::VertexState {
                    module: &module,
                    entry_point: Some("vertex_main"),
                    compilation_options: Default::default(),
                    buffers: &[
                        Some(wgpu::VertexBufferLayout { array_stride: size_of::<Vertex>() as u64, step_mode: wgpu::VertexStepMode::Vertex, attributes: &vertex_attributes }),
                        Some(wgpu::VertexBufferLayout { array_stride: size_of::<Instance>() as u64, step_mode: wgpu::VertexStepMode::Instance, attributes: &instance_attributes }),
                    ],
                },
                fragment: Some(wgpu::FragmentState {
                    module: &module,
                    entry_point: Some("fragment_main"),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState { format, blend: blend_of(filter), write_mask: wgpu::ColorWrites::ALL })],
                }),
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: Some(wgpu::DepthStencilState {
                    format: DEPTH,
                    depth_write_enabled: Some(filter.writes_depth()),
                    depth_compare: Some(wgpu::CompareFunction::LessEqual),
                    stencil: Default::default(),
                    bias: Default::default(),
                }),
                multisample: wgpu::MultisampleState { count: SAMPLES, mask: !0, alpha_to_coverage_enabled: false },
                multiview_mask: None,
                cache: None,
            })
        })
        .collect();
    (pipelines, frame_layout, layer_layout)
}
