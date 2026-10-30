//! The native window's scene drawing (wisp:docs/native-window-plan.md, "Porting the renderer").
//!
//! Models and textures are uploaded once, when their bytes arrive, into vertex and index buffers and bind groups. Each frame the scene's
//! poses are grouped by model, their bone matrices go into one storage buffer and their placements into one instance buffer, and every
//! model layer is one instanced draw: the vertex shader skins on the GPU. The per-frame scratch vectors keep their capacity, so a frame
//! with no new model allocates nothing on this thread beyond the scene's own parse.

mod math;
mod assets;
mod gpu;
pub mod model;
mod lightning;
mod particles;
mod pipelines;
mod scene;
mod targets;
pub mod source;
mod sprite;
pub mod tessellate;
mod uniforms;

use std::collections::HashMap;
use bytemuck::Zeroable;
use wgpu::util::DeviceExt;

use std::sync::Arc;

use crate::decode_pool::Pool;
use crate::remaster::{self, Cache, Prepared, Quality};
use crate::settings::Features;
use math::{multiply, projection, Mat4, IDENTITY};
use gpu::{bone_storage, frame_group, instance_storage, opacity_storage, upload, uv_storage, white};
use lightning::Lightning;
use model::{Filter, ModelData, ModelEmitter, Paint, Vertex};
use uniforms::{FrameUniform, Instance, LayerUniform};
use particles::{ParticleFrame, Particles, Slot};
use scene::{Pose, Scene};
use targets::Targets;
use crate::post::{Look, Post, Tuning, TUNING};

pub use gpu::fitted;
pub use sprite::Shot;
pub use scene::Scene as DrawScene;

const DEPTH: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;
const HDR: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
const SAMPLES: u32 = 4;
const BONES_AT_START: usize = 16 * 1024;
const OPACITIES_AT_START: usize = 16 * 1024;
const INSTANCES_AT_START: usize = 4 * 1024;
const DECODERS: usize = 2;
const CLEAR: [f64; 3] = [0.04, 0.06, 0.09];

fn linear_of(display: f64) -> f64 {
    if display <= 0.04045 { display / 12.92 } else { ((display + 0.055) / 1.055).powf(2.4) }
}

struct Draw {
    filter: Filter,
    first_index: u32,
    index_count: u32,
    bind_group: wgpu::BindGroup,
}

struct GpuModel {
    vertices: wgpu::Buffer,
    indices: wgpu::Buffer,
    draws: Vec<Draw>,
    opaque_first: bool,
    rig: Box<dyn model::Rig>,
    bones: usize,
    emitters: Vec<(ModelEmitter, Option<Slot>)>,
}

struct Group {
    model: usize,
    first: u32,
    count: u32,
}

pub struct Renderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    format: wgpu::TextureFormat,
    pipelines: Vec<wgpu::RenderPipeline>,
    frame_layout: wgpu::BindGroupLayout,
    layer_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    white: wgpu::TextureView,
    textures: HashMap<String, wgpu::TextureView>,
    reliefs: HashMap<String, wgpu::TextureView>,
    quality: Quality,
    cache: Option<Arc<Cache>>,
    models: Vec<GpuModel>,
    model_ids: HashMap<String, usize>,
    bone_buffer: wgpu::Buffer,
    bone_capacity: usize,
    opacity_buffer: wgpu::Buffer,
    opacity_capacity: usize,
    opacity_scratch: Vec<f32>,
    uv_buffer: wgpu::Buffer,
    uv_scratch: Vec<[f32; 4]>,
    instance_buffer: wgpu::Buffer,
    instance_capacity: usize,
    main_frame: wgpu::Buffer,
    sky_frame: wgpu::Buffer,
    main_group: wgpu::BindGroup,
    sky_group: wgpu::BindGroup,
    targets: Option<Targets>,
    post: Post,
    tuning: Tuning,
    sprites: Vec<sprite::Slot>,
    bone_scratch: Vec<Mat4>,
    instance_scratch: Vec<Instance>,
    counts: Vec<u32>,
    order: Vec<usize>,
    groups: Vec<Group>,
    sky_group_of: Option<Group>,
    decoder: Pool<Result<Prepared, String>>,
    decoding: HashMap<u64, String>,
    next_job: u64,
    waiting: Vec<(String, Arc<[u8]>)>,
    sources: Vec<(String, Arc<[u8]>)>,
    incoming: Option<Box<Renderer>>,
    features: Features,
    particles: Particles,
    lightning: Lightning,
    pub problems: Vec<String>,
}

impl Renderer {
    pub fn new(device: wgpu::Device, queue: wgpu::Queue, format: wgpu::TextureFormat, quality: Quality, features: Features) -> Self {
        let (pipelines, frame_layout, layer_layout) = pipelines::build(&device, HDR);
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            address_mode_u: wgpu::AddressMode::Repeat,
            address_mode_v: wgpu::AddressMode::Repeat,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Linear,
            anisotropy_clamp: 4,
            ..Default::default()
        });
        let uniform = |label| device.create_buffer(&wgpu::BufferDescriptor { label: Some(label), size: size_of::<FrameUniform>() as u64, usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
        let (main_frame, sky_frame) = (uniform("main frame"), uniform("sky frame"));
        let bone_buffer = bone_storage(&device, BONES_AT_START);
        let opacity_buffer = opacity_storage(&device, OPACITIES_AT_START);
        let uv_buffer = uv_storage(&device, OPACITIES_AT_START);
        let instance_buffer = instance_storage(&device, INSTANCES_AT_START);
        let main_group = frame_group(&device, &frame_layout, &main_frame, &bone_buffer, &opacity_buffer, &uv_buffer);
        let sky_group = frame_group(&device, &frame_layout, &sky_frame, &bone_buffer, &opacity_buffer, &uv_buffer);
        let particles = Particles::new(&device, HDR);
        let lightning = Lightning::new(&device, HDR, &particles);
        let post = Post::new(&device, &queue, format, HDR, DEPTH, SAMPLES);
        Self {
            white: upload(&device, &queue, &white()),
            device,
            queue,
            format,
            pipelines,
            frame_layout,
            layer_layout,
            sampler,
            textures: HashMap::new(),
            reliefs: HashMap::new(),
            quality,
            cache: (quality != Quality::Off).then(Cache::open).flatten().map(Arc::new),
            models: Vec::new(),
            model_ids: HashMap::new(),
            bone_buffer,
            bone_capacity: BONES_AT_START,
            opacity_buffer,
            opacity_capacity: OPACITIES_AT_START,
            opacity_scratch: Vec::new(),
            uv_buffer,
            uv_scratch: Vec::new(),
            instance_buffer,
            instance_capacity: INSTANCES_AT_START,
            main_frame,
            sky_frame,
            main_group,
            sky_group,
            targets: None,
            post,
            tuning: assets::tuning_of(features, TUNING),
            sprites: Vec::new(),
            bone_scratch: Vec::new(),
            instance_scratch: Vec::new(),
            counts: Vec::new(),
            order: Vec::new(),
            groups: Vec::new(),
            sky_group_of: None,
            decoder: Pool::new(DECODERS),
            decoding: HashMap::new(),
            next_job: 0,
            waiting: Vec::new(),
            sources: Vec::new(),
            incoming: None,
            features,
            particles,
            lightning,
            problems: Vec::new(),
        }
    }

    /// Sets how strongly the final-image pass acts; a strength of zero skips that effect's passes (the graphics settings' bloom and ambient-occlusion keys).
    pub fn set_post_tuning(&mut self, tuning: Tuning) {
        self.tuning = tuning;
    }

    fn add_model(&mut self, path: &str, data: ModelData) {
        let drawable = !data.indices.is_empty() && !data.vertices.is_empty();
        let (placeholder_vertex, placeholder_index) = (Vertex::zeroed(), 0u32);
        let (vertex_bytes, index_bytes) = if drawable { (bytemuck::cast_slice(&data.vertices), bytemuck::cast_slice(&data.indices)) } else { (bytemuck::bytes_of(&placeholder_vertex), bytemuck::bytes_of(&placeholder_index)) };
        let vertices = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: Some(path), contents: vertex_bytes, usage: wgpu::BufferUsages::VERTEX });
        let indices = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: Some(path), contents: index_bytes, usage: wgpu::BufferUsages::INDEX });
        let mut draws = Vec::new();
        let mut opaque_first = false;
        for part in data.parts.iter().filter(|_| drawable) {
            for layer in &part.layers {
                opaque_first |= layer.filter.index() < Filter::Blend.index();
                let (kind, texture) = match &layer.paint {
                    Paint::Texture(name) => match self.textures.get(&name.to_ascii_lowercase()) {
                        Some(view) => (0, view),
                        None => {
                            self.problems.push(format!("{path}: texture {name} was never decoded, so its layer draws white"));
                            (0, &self.white)
                        }
                    },
                    Paint::TeamColor => (1, &self.white),
                    Paint::TeamGlow => (2, &self.white),
                    Paint::None => (0, &self.white),
                };
                let uniform = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("layer"),
                    contents: bytemuck::bytes_of(&LayerUniform { kind, cutoff: if layer.filter == Filter::Cutout { 0.75 } else { 0.0 }, geoset_slot: part.opacity_slot, layer_slot: layer.opacity_slot, ignores_texture_alpha: u32::from(layer.filter == Filter::Additive), pad: [0; 3] }),
                    usage: wgpu::BufferUsages::UNIFORM,
                });
                let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("layer"),
                    layout: &self.layer_layout,
                    entries: &[
                        wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(texture) },
                        wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&self.sampler) },
                        wgpu::BindGroupEntry { binding: 2, resource: uniform.as_entire_binding() },
                    ],
                });
                draws.push(Draw { filter: layer.filter, first_index: part.first_index, index_count: part.index_count, bind_group });
            }
        }
        let mut emitters = Vec::new();
        for emitter in data.emitters {
            let (key, view) = match &emitter.paint {
                Paint::Texture(name) => (name.as_str(), self.textures.get(&name.to_ascii_lowercase()).unwrap_or(&self.white)),
                _ => ("", &self.white),
            };
            let slot = self.particles.register(&self.device, &self.queue, &emitter, (key, view), &self.sampler);
            emitters.push((emitter, slot));
        }
        let bones = data.rig.bone_count().max(1);
        self.model_ids.insert(path.to_string(), self.models.len());
        self.models.push(GpuModel { vertices, indices, draws, opaque_first, rig: data.rig, bones, emitters });
        self.counts.push(0);
    }

    pub fn has_model(&self, path: &str) -> bool {
        self.model_ids.contains_key(path)
    }

    fn fit_targets(&mut self, size: (u32, u32)) {
        if self.targets.as_ref().is_some_and(|targets| targets.size == size) {
            return;
        }
        let targets = Targets::new(&self.device, size);
        self.post.fit(size, &targets.resolved, &targets.depth);
        self.targets = Some(targets);
    }

    fn frame_uniform(scene: &Scene, aspect: f32, window: f32, far: f32) -> FrameUniform {
        let camera = &scene.camera;
        let view = camera.view;
        let (light_toward, light_key, light_ambient) = match &scene.light {
            Some(light) => ([light.toward[0], light.toward[1], light.toward[2], 0.0], [light.key[0], light.key[1], light.key[2], 1.0], [light.ambient[0], light.ambient[1], light.ambient[2], 0.0]),
            None => ([0.0, 0.0, 1.0, 0.0], [0.0; 4], [1.0, 1.0, 1.0, 0.0]),
        };
        let (fog_color, fog_range) = match &scene.fog {
            Some(fog) => ([fog.color[0], fog.color[1], fog.color[2], 1.0], [fog.start, fog.end, fog.max, 0.0]),
            None => ([0.0; 4], [0.0, 1.0, 1.0, 0.0]),
        };
        FrameUniform { view_projection: multiply(&projection(camera.tangent, camera.near, far, aspect, window, camera.rise), &view), light_toward, light_key, light_ambient, fog_color, fog_range }
    }

    /// Lays every resident pose out by model: bone matrices into the scratch, instances grouped so each model's are contiguous.
    fn layout(&mut self, poses: &[Pose]) {
        self.counts.iter_mut().for_each(|count| *count = 0);
        self.order.clear();
        for pose in poses {
            if let Some(&id) = self.model_ids.get(pose.model.as_str()) {
                if self.counts[id] == 0 {
                    self.order.push(id);
                }
                self.counts[id] += 1;
            }
        }
        let models = &self.models;
        self.order.sort_by_key(|&id| !models[id].opaque_first);
        self.groups.clear();
        let mut cursor = 0;
        for &id in &self.order {
            self.groups.push(Group { model: id, first: cursor, count: self.counts[id] });
            cursor += self.counts[id];
            self.counts[id] = 0;
        }
        self.instance_scratch.clear();
        self.instance_scratch.resize(cursor as usize, Instance::zeroed());
        self.bone_scratch.clear();
        self.opacity_scratch.clear();
        self.uv_scratch.clear();
        for pose in poses {
            let Some(&id) = self.model_ids.get(pose.model.as_str()) else { continue };
            let group = self.groups.iter().find(|group| group.model == id).map(|group| group.first).unwrap_or(0);
            let model = &mut self.models[id];
            let base = self.bone_scratch.len();
            self.bone_scratch.resize(base + model.bones, IDENTITY);
            model.rig.pose(pose.sequence, pose.frame, pose.clock, &mut self.bone_scratch[base..]);
            let opacity_base = self.opacity_scratch.len();
            self.opacity_scratch.extend_from_slice(model.rig.opacities());
            self.uv_scratch.extend_from_slice(model.rig.uv_rows());
            let slot = (group + self.counts[id]) as usize;
            self.counts[id] += 1;
            self.instance_scratch[slot] = Instance { model: pose.matrix, tint: [pose.color[0], pose.color[1], pose.color[2], pose.alpha], team: [pose.team[0], pose.team[1], pose.team[2], 1.0], base: [base as u32, opacity_base as u32] };
            if pose.sequence >= 0 && pose.alpha > 0.0 {
                for (index, ((emitter, slot), sample)) in model.emitters.iter().zip(model.rig.emitters()).enumerate() {
                    let Some(slot) = *slot else { continue };
                    let Some(bone) = self.bone_scratch.get(base + emitter.spec.node) else { continue };
                    self.particles.emit(pose.id, index, slot, emitter, sample, &multiply(&pose.matrix, bone), pose.alpha);
                }
            }
        }
    }

    fn draw_groups<'a>(&'a self, pass: &mut wgpu::RenderPass<'a>, groups: &[Group], opaque: bool) {
        for group in groups.iter().filter(|group| self.models[group.model].opaque_first == opaque && !self.models[group.model].draws.is_empty()) {
            let model = &self.models[group.model];
            pass.set_vertex_buffer(0, model.vertices.slice(..));
            pass.set_vertex_buffer(1, self.instance_buffer.slice(..));
            pass.set_index_buffer(model.indices.slice(..), wgpu::IndexFormat::Uint32);
            for draw in &model.draws {
                pass.set_pipeline(&self.pipelines[draw.filter.index()]);
                pass.set_bind_group(1, &draw.bind_group, &[]);
                pass.draw_indexed(draw.first_index..draw.first_index + draw.index_count, 0, group.first..group.first + group.count);
            }
        }
    }

    /// Poses the sky, grows the storage buffers that outgrew their capacity, uploads the scene's per-frame data and stages its particles and bolts.
    fn prepare(&mut self, scene: &Scene, aspect: f32, window: f32) {
        self.layout(&scene.poses);
        let sky = scene.sky.as_ref().and_then(|pose| self.model_ids.get(pose.model.as_str()).map(|&id| (id, pose)));
        let sky_base = self.bone_scratch.len();
        let sky_opacity_base = self.opacity_scratch.len();
        if let Some((id, pose)) = sky {
            self.bone_scratch.resize(sky_base + self.models[id].bones, IDENTITY);
            self.models[id].rig.pose(pose.sequence, pose.frame, pose.clock, &mut self.bone_scratch[sky_base..]);
            self.opacity_scratch.extend_from_slice(self.models[id].rig.opacities());
            self.uv_scratch.extend_from_slice(self.models[id].rig.uv_rows());
        }
        if self.bone_scratch.len() > self.bone_capacity || self.opacity_scratch.len() > self.opacity_capacity {
            self.bone_capacity = self.bone_scratch.len().next_power_of_two().max(self.bone_capacity);
            self.opacity_capacity = self.opacity_scratch.len().next_power_of_two().max(self.opacity_capacity);
            self.bone_buffer = bone_storage(&self.device, self.bone_capacity);
            self.opacity_buffer = opacity_storage(&self.device, self.opacity_capacity);
            self.uv_buffer = uv_storage(&self.device, self.opacity_capacity);
            self.main_group = frame_group(&self.device, &self.frame_layout, &self.main_frame, &self.bone_buffer, &self.opacity_buffer, &self.uv_buffer);
            self.sky_group = frame_group(&self.device, &self.frame_layout, &self.sky_frame, &self.bone_buffer, &self.opacity_buffer, &self.uv_buffer);
        }
        let sky_instance = self.instance_scratch.len();
        if let Some((_, pose)) = sky {
            let mut placed = pose.matrix;
            placed[12] = scene.camera.eye[0];
            placed[13] = scene.camera.eye[1];
            placed[14] = scene.camera.eye[2];
            self.instance_scratch.push(Instance { model: placed, tint: [1.0, 1.0, 1.0, 1.0], team: [1.0; 4], base: [sky_base as u32, sky_opacity_base as u32] });
        }
        if self.instance_scratch.len() > self.instance_capacity {
            self.instance_capacity = self.instance_scratch.len().next_power_of_two();
            self.instance_buffer = instance_storage(&self.device, self.instance_capacity);
        }
        self.queue.write_buffer(&self.bone_buffer, 0, bytemuck::cast_slice(&self.bone_scratch));
        self.queue.write_buffer(&self.opacity_buffer, 0, bytemuck::cast_slice(&self.opacity_scratch));
        self.queue.write_buffer(&self.uv_buffer, 0, bytemuck::cast_slice(&self.uv_scratch));
        self.queue.write_buffer(&self.instance_buffer, 0, bytemuck::cast_slice(&self.instance_scratch));
        self.queue.write_buffer(&self.main_frame, 0, bytemuck::bytes_of(&Self::frame_uniform(scene, aspect, window, scene.camera.far)));
        self.queue.write_buffer(&self.sky_frame, 0, bytemuck::bytes_of(&Self::frame_uniform(scene, aspect, window, scene.camera.sky_far)));
        let view = &scene.camera.view;
        let eye = scene.camera.eye;
        self.particles.finish(
            &self.queue,
            &ParticleFrame { base: Self::frame_uniform(scene, aspect, window, scene.camera.far), right: [view[0], view[4], view[8], 0.0], up: [view[1], view[5], view[9], 0.0], eye_and_now: [eye[0], eye[1], eye[2], 0.0] },
        );
        self.problems.append(&mut self.particles.problems);
        self.lightning.stage(&self.queue, &scene.lightnings);
        self.sky_group_of = sky.map(|(id, _)| Group { model: id, first: sky_instance as u32, count: 1 });
    }

    /// Draws `scene` into `target`, a surface view of `size` in this renderer's format, in the encoder's order: the sky, then the world.
    /// The world fills the window and keeps the reach of the `aspect` picture (the game's width over its height) in view: a taller or wider window shows more world, never bars.
    pub fn draw(&mut self, encoder: &mut wgpu::CommandEncoder, target: &wgpu::TextureView, size: (u32, u32), aspect: f32, scene: &Scene) {
        self.fit_targets(size);
        self.particles.begin(scene.frame);
        let viewport = [0.0, 0.0, size.0 as f32, size.1 as f32];
        let window = size.0 as f32 / size.1.max(1) as f32;
        self.prepare(scene, aspect, window);

        let clear = (if scene.clear == [0.0; 3] { CLEAR } else { scene.clear.map(f64::from) }).map(linear_of);
        let look = Look::of(scene, aspect, fitted(size, aspect).map(|edge| edge as f32), self.post.srgb_surface(), &self.tuning);
        let procedural_sky = scene.sky.is_some() || scene.fog.is_some();
        self.post.prepare(&look);
        let targets = self.targets.as_ref().expect("fit_targets ran");
        let begin = |encoder: &'_ mut wgpu::CommandEncoder, color_load: wgpu::LoadOp<wgpu::Color>, resolve: bool| -> wgpu::RenderPass<'static> {
            encoder
                .begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("scene"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &targets.color,
                        depth_slice: None,
                        resolve_target: resolve.then_some(&targets.resolved),
                        ops: wgpu::Operations { load: color_load, store: wgpu::StoreOp::Store },
                    })],
                    depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                        view: &targets.depth,
                        depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(1.0), store: wgpu::StoreOp::Store }),
                        stencil_ops: None,
                    }),
                    timestamp_writes: None,
                    occlusion_query_set: None,
                    multiview_mask: None,
                })
                .forget_lifetime()
        };
        {
            let mut pass = begin(encoder, wgpu::LoadOp::Clear(wgpu::Color { r: clear[0], g: clear[1], b: clear[2], a: 1.0 }), false);
            pass.set_viewport(viewport[0], viewport[1], viewport[2], viewport[3], 0.0, 1.0);
            if procedural_sky {
                self.post.draw_sky(&mut pass);
            } else if let Some(group) = &self.sky_group_of {
                pass.set_bind_group(0, &self.sky_group, &[]);
                self.draw_groups(&mut pass, std::slice::from_ref(group), true);
                self.draw_groups(&mut pass, std::slice::from_ref(group), false);
            }
        }
        let mut pass = begin(encoder, wgpu::LoadOp::Load, true);
        pass.set_viewport(viewport[0], viewport[1], viewport[2], viewport[3], 0.0, 1.0);
        pass.set_bind_group(0, &self.main_group, &[]);
        self.draw_groups(&mut pass, &self.groups, true);
        self.draw_groups(&mut pass, &self.groups, false);
        self.particles.draw(&mut pass);
        self.lightning.draw(&mut pass, &self.particles);
        drop(pass);
        self.post.encode(encoder, target);
    }
}


impl crate::ui::UiTextures for Renderer {
    fn view(&self, path: &str) -> Option<&wgpu::TextureView> {
        if let Some(rest) = path.strip_prefix("sprite/") {
            let (index, size) = rest.split_once('/')?;
            let (width, height) = size.split_once('x')?;
            return self.sprite_view(index.parse().ok()?, (width.parse().ok()?, height.parse().ok()?));
        }
        self.textures.get(&path.to_ascii_lowercase())
    }
}

#[cfg(test)]
mod gpu_tests;
