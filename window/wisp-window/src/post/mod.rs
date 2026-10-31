//! The native window's final-image pass (wisp:docs/native-window-plan.md, "The post stack").
//!
//! The scene pass leaves linear HDR light in a half-float target and its depth behind. This module draws the sky into that target, then
//! reads both: half-resolution ambient occlusion from the depth, a bloom chain of the light above a threshold, and one composite that
//! darkens creases, adds the glow, tones the light with AgX and the stage's grade through a lookup table, and writes the surface.

mod look;

use std::mem::size_of;

pub use look::{agx, srgb_encode, tone_map, Grade, Look, Params, Tuning, LUT_SIZE, TUNING};

const COMMON: &str = include_str!("common.wgsl");
const NOISE: &str = include_str!("noise.wgsl");
/// The cloud texture is this many times smaller than the target on each side: clouds are soft, and a sixteenth of the pixels keeps three layers and the shafts cheap.
const CLOUD_SCALE: u32 = 4;
const BLOOM_LEVELS: u32 = 5;
const BLOOM_SHOWN: usize = 1;
const BLOOM_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
const OCCLUSION_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rg16Float;
const HALF_DEPTH_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::R32Float;
const ADDITIVE: wgpu::BlendState = wgpu::BlendState {
    color: wgpu::BlendComponent { src_factor: wgpu::BlendFactor::One, dst_factor: wgpu::BlendFactor::One, operation: wgpu::BlendOperation::Add },
    alpha: wgpu::BlendComponent::REPLACE,
};

fn texture_entry(binding: u32, multisampled: bool, dimension: wgpu::TextureViewDimension, depth: bool) -> wgpu::BindGroupLayoutEntry {
    let sample_type = if depth { wgpu::TextureSampleType::Depth } else { wgpu::TextureSampleType::Float { filterable: !multisampled } };
    wgpu::BindGroupLayoutEntry { binding, visibility: wgpu::ShaderStages::FRAGMENT, ty: wgpu::BindingType::Texture { sample_type, view_dimension: dimension, multisampled }, count: None }
}

fn unfiltered_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry { binding, visibility: wgpu::ShaderStages::FRAGMENT, ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: false }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false }, count: None }
}

fn params_entry() -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding: 0,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None },
        count: None,
    }
}

fn sampler_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry { binding, visibility: wgpu::ShaderStages::FRAGMENT, ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering), count: None }
}

struct Layouts {
    cloud: wgpu::BindGroupLayout,
    sky: wgpu::BindGroupLayout,
    depth: wgpu::BindGroupLayout,
    occlusion: wgpu::BindGroupLayout,
    bloom: wgpu::BindGroupLayout,
    composite: wgpu::BindGroupLayout,
}

struct Pipelines {
    cloud: wgpu::RenderPipeline,
    sky: wgpu::RenderPipeline,
    depth: wgpu::RenderPipeline,
    occlusion: wgpu::RenderPipeline,
    prefilter: wgpu::RenderPipeline,
    down: wgpu::RenderPipeline,
    up: wgpu::RenderPipeline,
    composite: wgpu::RenderPipeline,
}

/// The textures and bind groups that depend on the target's size.
struct Targets {
    cloud: wgpu::TextureView,
    sky_group: wgpu::BindGroup,
    half_depth: wgpu::TextureView,
    depth_group: wgpu::BindGroup,
    occlusion: wgpu::TextureView,
    occlusion_group: wgpu::BindGroup,
    bloom: Vec<wgpu::TextureView>,
    prefilter_group: wgpu::BindGroup,
    down_groups: Vec<wgpu::BindGroup>,
    up_groups: Vec<wgpu::BindGroup>,
    composite_group: wgpu::BindGroup,
}

pub struct Post {
    device: wgpu::Device,
    queue: wgpu::Queue,
    srgb: bool,
    layouts: Layouts,
    pipelines: Pipelines,
    sampler: wgpu::Sampler,
    params: wgpu::Buffer,
    cloud_group: wgpu::BindGroup,
    clouded: bool,
    lut: wgpu::TextureView,
    lut_texture: wgpu::Texture,
    lut_grade: Option<Grade>,
    occluding: bool,
    glowing: bool,
    targets: Option<Targets>,
}

fn module(device: &wgpu::Device, label: &str, sources: &[&str]) -> wgpu::ShaderModule {
    device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some(label), source: wgpu::ShaderSource::Wgsl([&[COMMON], sources].concat().concat().into()) })
}

fn pipeline(device: &wgpu::Device, label: &str, module: &wgpu::ShaderModule, layout: &wgpu::BindGroupLayout, fragment: &str, target: wgpu::ColorTargetState, multisample: u32, depth: Option<wgpu::TextureFormat>) -> wgpu::RenderPipeline {
    let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: Some(label), bind_group_layouts: &[Some(layout)], immediate_size: 0 });
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(label),
        layout: Some(&layout),
        vertex: wgpu::VertexState { module, entry_point: Some("vertex_fullscreen"), compilation_options: Default::default(), buffers: &[] },
        fragment: Some(wgpu::FragmentState { module, entry_point: Some(fragment), compilation_options: Default::default(), targets: &[Some(target)] }),
        primitive: wgpu::PrimitiveState::default(),
        depth_stencil: depth.map(|format| wgpu::DepthStencilState { format, depth_write_enabled: Some(false), depth_compare: Some(wgpu::CompareFunction::Always), stencil: Default::default(), bias: Default::default() }),
        multisample: wgpu::MultisampleState { count: multisample, mask: !0, alpha_to_coverage_enabled: false },
        multiview_mask: None,
        cache: None,
    })
}

fn colour(format: wgpu::TextureFormat, blend: Option<wgpu::BlendState>) -> wgpu::ColorTargetState {
    wgpu::ColorTargetState { format, blend, write_mask: wgpu::ColorWrites::ALL }
}

fn view_of(device: &wgpu::Device, label: &str, size: (u32, u32), format: wgpu::TextureFormat) -> wgpu::TextureView {
    device
        .create_texture(&wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d { width: size.0.max(1), height: size.1.max(1), depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        })
        .create_view(&Default::default())
}

fn binding<'a>(binding: u32, resource: wgpu::BindingResource<'a>) -> wgpu::BindGroupEntry<'a> {
    wgpu::BindGroupEntry { binding, resource }
}

impl Post {
    /// `scene_format`, `depth_format` and `samples` are the scene pass's target, which the sky is drawn into; `surface` is what the composite writes.
    pub fn new(device: &wgpu::Device, queue: &wgpu::Queue, surface: wgpu::TextureFormat, scene_format: wgpu::TextureFormat, depth_format: wgpu::TextureFormat, samples: u32) -> Self {
        let layout = |label, entries: &[wgpu::BindGroupLayoutEntry]| device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor { label: Some(label), entries });
        let flat = wgpu::TextureViewDimension::D2;
        let layouts = Layouts {
            cloud: layout("cloud", &[params_entry()]),
            sky: layout("sky", &[params_entry(), texture_entry(1, false, flat, false), sampler_entry(2)]),
            depth: layout("depth", &[params_entry(), texture_entry(1, true, flat, true)]),
            occlusion: layout("occlusion", &[params_entry(), unfiltered_entry(1)]),
            bloom: layout("bloom", &[params_entry(), sampler_entry(1), texture_entry(2, false, flat, false)]),
            composite: layout(
                "composite",
                &[params_entry(), sampler_entry(1), texture_entry(2, false, flat, false), texture_entry(3, false, flat, false), texture_entry(4, false, flat, false), texture_entry(5, false, wgpu::TextureViewDimension::D3, false), texture_entry(6, true, flat, true)],
            ),
        };
        let sky = module(device, "sky", &[NOISE, include_str!("sky.wgsl")]);
        let cloud = module(device, "cloud", &[NOISE, include_str!("clouds.wgsl")]);
        let depth = module(device, "depth", &[include_str!("depth.wgsl")]);
        let occlusion = module(device, "occlusion", &[include_str!("occlusion.wgsl")]);
        let bloom = module(device, "bloom", &[include_str!("bloom.wgsl")]);
        let composite = module(device, "composite", &[include_str!("composite.wgsl")]);
        let sky_layout = &layouts.sky;
        let pipelines = Pipelines {
            cloud: pipeline(device, "cloud", &cloud, &layouts.cloud, "cloud_main", colour(BLOOM_FORMAT, None), 1, None),
            sky: pipeline(device, "sky", &sky, sky_layout, "sky_main", colour(scene_format, None), samples, Some(depth_format)),
            depth: pipeline(device, "depth", &depth, &layouts.depth, "depth_main", colour(HALF_DEPTH_FORMAT, None), 1, None),
            occlusion: pipeline(device, "occlusion", &occlusion, &layouts.occlusion, "occlusion_main", colour(OCCLUSION_FORMAT, None), 1, None),
            prefilter: pipeline(device, "prefilter", &bloom, &layouts.bloom, "prefilter_main", colour(BLOOM_FORMAT, None), 1, None),
            down: pipeline(device, "bloom down", &bloom, &layouts.bloom, "down_main", colour(BLOOM_FORMAT, None), 1, None),
            up: pipeline(device, "bloom up", &bloom, &layouts.bloom, "up_main", colour(BLOOM_FORMAT, Some(ADDITIVE)), 1, None),
            composite: pipeline(device, "composite", &composite, &layouts.composite, "composite_main", colour(surface, None), 1, None),
        };
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor { mag_filter: wgpu::FilterMode::Linear, min_filter: wgpu::FilterMode::Linear, address_mode_u: wgpu::AddressMode::ClampToEdge, address_mode_v: wgpu::AddressMode::ClampToEdge, address_mode_w: wgpu::AddressMode::ClampToEdge, ..Default::default() });
        let params = device.create_buffer(&wgpu::BufferDescriptor { label: Some("post params"), size: size_of::<Params>() as u64, usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
        let cloud_group = device.create_bind_group(&wgpu::BindGroupDescriptor { label: Some("cloud"), layout: &layouts.cloud, entries: &[binding(0, params.as_entire_binding())] });
        let lut_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("grade"),
            size: wgpu::Extent3d { width: LUT_SIZE, height: LUT_SIZE, depth_or_array_layers: LUT_SIZE },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D3,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let lut = lut_texture.create_view(&Default::default());
        Self { device: device.clone(), queue: queue.clone(), srgb: surface.is_srgb(), layouts, pipelines, sampler, params, cloud_group, clouded: false, lut, lut_texture, lut_grade: None, occluding: true, glowing: true, targets: None }
    }

    /// Whether the display encodes what the composite writes, which `Look::of` needs to know.
    pub fn srgb_surface(&self) -> bool {
        self.srgb
    }

    /// Sizes the post targets to the scene's: `hdr` is the single-sample colour the scene pass resolved into, `depth` its multisampled depth.
    pub fn fit(&mut self, size: (u32, u32), hdr: &wgpu::TextureView, depth: &wgpu::TextureView) {
        let device = &self.device;
        let half = |size: (u32, u32), level: u32| ((size.0 >> level).max(1), (size.1 >> level).max(1));
        let cloud = view_of(device, "clouds", ((size.0 / CLOUD_SCALE).max(1), (size.1 / CLOUD_SCALE).max(1)), BLOOM_FORMAT);
        let sky_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("sky"),
            layout: &self.layouts.sky,
            entries: &[binding(0, self.params.as_entire_binding()), binding(1, wgpu::BindingResource::TextureView(&cloud)), binding(2, wgpu::BindingResource::Sampler(&self.sampler))],
        });
        let half_depth = view_of(device, "half depth", half(size, 1), HALF_DEPTH_FORMAT);
        let occlusion = view_of(device, "occlusion", half(size, 1), OCCLUSION_FORMAT);
        let bloom: Vec<wgpu::TextureView> = (1..=BLOOM_LEVELS).map(|level| view_of(device, "bloom", half(size, level), BLOOM_FORMAT)).collect();
        let group = |layout: &wgpu::BindGroupLayout, source: &wgpu::TextureView| {
            device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("bloom"),
                layout,
                entries: &[binding(0, self.params.as_entire_binding()), binding(1, wgpu::BindingResource::Sampler(&self.sampler)), binding(2, wgpu::BindingResource::TextureView(source))],
            })
        };
        let depth_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("depth"),
            layout: &self.layouts.depth,
            entries: &[binding(0, self.params.as_entire_binding()), binding(1, wgpu::BindingResource::TextureView(depth))],
        });
        let occlusion_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("occlusion"),
            layout: &self.layouts.occlusion,
            entries: &[binding(0, self.params.as_entire_binding()), binding(1, wgpu::BindingResource::TextureView(&half_depth))],
        });
        let composite_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("composite"),
            layout: &self.layouts.composite,
            entries: &[
                binding(0, self.params.as_entire_binding()),
                binding(1, wgpu::BindingResource::Sampler(&self.sampler)),
                binding(2, wgpu::BindingResource::TextureView(hdr)),
                binding(3, wgpu::BindingResource::TextureView(&bloom[BLOOM_SHOWN])),
                binding(4, wgpu::BindingResource::TextureView(&occlusion)),
                binding(5, wgpu::BindingResource::TextureView(&self.lut)),
                binding(6, wgpu::BindingResource::TextureView(depth)),
            ],
        });
        self.targets = Some(Targets {
            cloud,
            sky_group,
            prefilter_group: group(&self.layouts.bloom, hdr),
            down_groups: bloom[..bloom.len() - 1].iter().map(|view| group(&self.layouts.bloom, view)).collect(),
            up_groups: bloom[BLOOM_SHOWN + 1..].iter().map(|view| group(&self.layouts.bloom, view)).collect(),
            depth_group,
            half_depth,
            occlusion_group,
            composite_group,
            occlusion,
            bloom,
        });
    }

    /// Writes the frame's constants, and the grade's table when the grade changed since the last frame.
    pub fn prepare(&mut self, look: &Look) {
        self.queue.write_buffer(&self.params, 0, bytemuck::bytes_of(&look.params));
        (self.occluding, self.glowing, self.clouded) = (look.occluding, look.glowing, look.clouded);
        if self.lut_grade != Some(look.grade) {
            self.lut_grade = Some(look.grade);
            self.queue.write_texture(
                self.lut_texture.as_image_copy(),
                &look::build_lut(&look.grade),
                wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(LUT_SIZE * 4), rows_per_image: Some(LUT_SIZE) },
                wgpu::Extent3d { width: LUT_SIZE, height: LUT_SIZE, depth_or_array_layers: LUT_SIZE },
            );
        }
    }

    /// Draws the sky as the first thing in the scene pass, behind everything: one triangle over the viewport.
    pub fn draw_sky(&self, pass: &mut wgpu::RenderPass<'_>) {
        let targets = self.targets.as_ref().expect("fit ran");
        pass.set_pipeline(&self.pipelines.sky);
        pass.set_bind_group(0, &targets.sky_group, &[]);
        pass.draw(0..3, 0..1);
    }

    /// Paints the sky's cloud layers and sun shafts into the small cloud texture the sky pass lays over its gradient, when the stage's sky has clouds; call it before the scene pass.
    pub fn draw_clouds(&self, encoder: &mut wgpu::CommandEncoder) {
        if self.clouded {
            let targets = self.targets.as_ref().expect("fit ran");
            Self::fullscreen(encoder, "clouds", &targets.cloud, wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), &self.pipelines.cloud, &self.cloud_group);
        }
    }

    fn fullscreen(encoder: &mut wgpu::CommandEncoder, label: &str, target: &wgpu::TextureView, load: wgpu::LoadOp<wgpu::Color>, pipeline: &wgpu::RenderPipeline, group: &wgpu::BindGroup) {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some(label),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment { view: target, depth_slice: None, resolve_target: None, ops: wgpu::Operations { load, store: wgpu::StoreOp::Store } })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(pipeline);
        pass.set_bind_group(0, group, &[]);
        pass.draw(0..3, 0..1);
    }

    /// Occlusion and the bloom chain when their strengths are above zero, then the composite onto `target`; `fit` and `prepare` have run.
    pub fn encode(&self, encoder: &mut wgpu::CommandEncoder, target: &wgpu::TextureView) {
        self.encode_marked(encoder, target, &mut |_, _| ());
    }

    /// `encode`, calling `mark` with the encoder and the pass's name after each pass, so a caller can write timestamps between them.
    pub fn encode_marked(&self, encoder: &mut wgpu::CommandEncoder, target: &wgpu::TextureView, mark: &mut dyn FnMut(&mut wgpu::CommandEncoder, &str)) {
        let targets = self.targets.as_ref().expect("fit ran");
        let clear = wgpu::LoadOp::Clear(wgpu::Color::BLACK);
        let mut run = |encoder: &mut wgpu::CommandEncoder, label: &str, view: &wgpu::TextureView, load, pipeline: &wgpu::RenderPipeline, group: &wgpu::BindGroup| {
            Self::fullscreen(encoder, label, view, load, pipeline, group);
            mark(encoder, label);
        };
        if self.occluding {
            run(encoder, "half depth", &targets.half_depth, clear, &self.pipelines.depth, &targets.depth_group);
            run(encoder, "occlusion", &targets.occlusion, clear, &self.pipelines.occlusion, &targets.occlusion_group);
        }
        if self.glowing {
            run(encoder, "bloom prefilter", &targets.bloom[0], clear, &self.pipelines.prefilter, &targets.prefilter_group);
            for (level, group) in targets.down_groups.iter().enumerate() {
                run(encoder, "bloom down", &targets.bloom[level + 1], clear, &self.pipelines.down, group);
            }
            for (index, group) in targets.up_groups.iter().enumerate().rev() {
                run(encoder, "bloom up", &targets.bloom[BLOOM_SHOWN + index], wgpu::LoadOp::Load, &self.pipelines.up, group);
            }
        }
        run(encoder, "composite", target, clear, &self.pipelines.composite, &targets.composite_group);
    }
}

#[cfg(test)]
mod tests;
