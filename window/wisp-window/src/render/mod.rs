//! The native window's scene drawing (wisp:docs/native-window-plan.md, "Porting the renderer").
//!
//! Models and textures are uploaded once, when their bytes arrive, into vertex and index buffers and bind groups. Each frame the scene's
//! poses are grouped by model, their bone matrices go into one storage buffer and their placements into one instance buffer, and every
//! model layer is one instanced draw: the vertex shader skins on the GPU. The per-frame scratch vectors keep their capacity, so a frame
//! with no new model allocates nothing on this thread beyond the scene's own parse.

mod math;
mod gpu;
mod model;
mod pipelines;
mod scene;
mod source;

use std::collections::HashMap;
use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;

use crate::decode_pool::Pool;
use crate::texture::{self, Image};
use math::{multiply, projection, Mat4, IDENTITY};
use gpu::{bone_storage, frame_group, instance_storage, upload, white};
use model::{Filter, ModelData, Paint, Vertex};
use scene::{Pose, Scene};

pub use gpu::fitted;
pub use scene::Scene as DrawScene;

const DEPTH: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;
const SAMPLES: u32 = 4;
const BONES_AT_START: usize = 16 * 1024;
const INSTANCES_AT_START: usize = 4 * 1024;
const DECODERS: usize = 2;
const CLEAR: [f64; 3] = [0.04, 0.06, 0.09];

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct FrameUniform {
    view_projection: Mat4,
    light_toward: [f32; 4],
    light_key: [f32; 4],
    light_ambient: [f32; 4],
    fog_color: [f32; 4],
    fog_range: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Instance {
    model: Mat4,
    tint: [f32; 4],
    team: [f32; 4],
    base: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct LayerUniform {
    kind: u32,
    cutoff: f32,
    pad: [f32; 2],
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
}

struct Group {
    model: usize,
    first: u32,
    count: u32,
}

struct Targets {
    size: (u32, u32),
    color: wgpu::TextureView,
    depth: wgpu::TextureView,
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
    models: Vec<GpuModel>,
    model_ids: HashMap<String, usize>,
    bone_buffer: wgpu::Buffer,
    bone_capacity: usize,
    instance_buffer: wgpu::Buffer,
    instance_capacity: usize,
    main_frame: wgpu::Buffer,
    sky_frame: wgpu::Buffer,
    main_group: wgpu::BindGroup,
    sky_group: wgpu::BindGroup,
    targets: Option<Targets>,
    bone_scratch: Vec<Mat4>,
    instance_scratch: Vec<Instance>,
    counts: Vec<u32>,
    order: Vec<usize>,
    groups: Vec<Group>,
    sky_group_of: Option<Group>,
    decoder: Pool<Result<Image, String>>,
    decoding: HashMap<u64, String>,
    next_job: u64,
    waiting: Vec<(String, Vec<u8>)>,
    pub problems: Vec<String>,
}

impl Renderer {
    pub fn new(device: wgpu::Device, queue: wgpu::Queue, format: wgpu::TextureFormat) -> Self {
        let (pipelines, frame_layout, layer_layout) = pipelines::build(&device, format);
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
        let instance_buffer = instance_storage(&device, INSTANCES_AT_START);
        let main_group = frame_group(&device, &frame_layout, &main_frame, &bone_buffer);
        let sky_group = frame_group(&device, &frame_layout, &sky_frame, &bone_buffer);
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
            models: Vec::new(),
            model_ids: HashMap::new(),
            bone_buffer,
            bone_capacity: BONES_AT_START,
            instance_buffer,
            instance_capacity: INSTANCES_AT_START,
            main_frame,
            sky_frame,
            main_group,
            sky_group,
            targets: None,
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
            problems: Vec::new(),
        }
    }

    /// Takes a file Bun pushed, a model or a texture told apart by its magic. Textures decode on worker threads; a model waits for them so its bind groups hold its real textures, and one that cannot be read is left out.
    pub fn ingest(&mut self, path: &str, bytes: Vec<u8>) {
        if bytes.starts_with(b"MDLX") {
            self.waiting.push((path.to_string(), bytes));
        } else {
            self.next_job += 1;
            self.decoding.insert(self.next_job, path.to_ascii_lowercase());
            self.decoder.submit(self.next_job, move || texture::decode(&bytes));
        }
    }

    /// Uploads the textures that finished decoding and, once none is outstanding, builds the models that were waiting on them; returns how many files that finished, built or failed.
    pub fn pump(&mut self) -> u64 {
        let mut finished = 0;
        while let Some((job, decoded)) = self.decoder.try_recv() {
            let Some(path) = self.decoding.remove(&job) else { continue };
            finished += 1;
            match decoded {
                Ok(image) => {
                    let view = upload(&self.device, &self.queue, &image);
                    self.textures.insert(path, view);
                }
                Err(error) => self.problems.push(format!("{path}: {error}")),
            }
        }
        if self.decoding.is_empty() {
            for (path, bytes) in std::mem::take(&mut self.waiting) {
                finished += 1;
                match source::model(&bytes) {
                    Ok(data) => self.add_model(&path, data),
                    Err(error) => self.problems.push(format!("{path}: {error}")),
                }
            }
        }
        finished
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
                    Paint::Texture(name) => (0, self.textures.get(&name.to_ascii_lowercase()).unwrap_or(&self.white)),
                    Paint::TeamColor => (1, &self.white),
                    Paint::TeamGlow => (2, &self.white),
                    Paint::None => (0, &self.white),
                };
                let uniform = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("layer"),
                    contents: bytemuck::bytes_of(&LayerUniform { kind, cutoff: if layer.filter == Filter::Cutout { 0.75 } else { 0.0 }, pad: [0.0; 2] }),
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
        let bones = data.rig.bone_count().max(1);
        self.model_ids.insert(path.to_string(), self.models.len());
        self.models.push(GpuModel { vertices, indices, draws, opaque_first, rig: data.rig, bones });
        self.counts.push(0);
    }

    pub fn has_model(&self, path: &str) -> bool {
        self.model_ids.contains_key(path)
    }

    fn fit_targets(&mut self, size: (u32, u32)) {
        if self.targets.as_ref().is_some_and(|targets| targets.size == size) {
            return;
        }
        let make = |format, label| {
            self.device
                .create_texture(&wgpu::TextureDescriptor {
                    label: Some(label),
                    size: wgpu::Extent3d { width: size.0, height: size.1, depth_or_array_layers: 1 },
                    mip_level_count: 1,
                    sample_count: SAMPLES,
                    dimension: wgpu::TextureDimension::D2,
                    format,
                    usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                    view_formats: &[],
                })
                .create_view(&Default::default())
        };
        self.targets = Some(Targets { size, color: make(self.format, "scene colour"), depth: make(DEPTH, "scene depth") });
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
        for pose in poses {
            let Some(&id) = self.model_ids.get(pose.model.as_str()) else { continue };
            let group = self.groups.iter().find(|group| group.model == id).map(|group| group.first).unwrap_or(0);
            let model = &mut self.models[id];
            let base = self.bone_scratch.len();
            self.bone_scratch.resize(base + model.bones, IDENTITY);
            model.rig.pose(pose.sequence, pose.frame, pose.clock * 1000.0, &mut self.bone_scratch[base..]);
            let slot = (group + self.counts[id]) as usize;
            self.counts[id] += 1;
            self.instance_scratch[slot] = Instance { model: pose.matrix, tint: [pose.color[0], pose.color[1], pose.color[2], pose.alpha], team: [pose.team[0], pose.team[1], pose.team[2], 1.0], base: base as u32 };
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

    /// Draws `scene` into `target`, a surface view of `size` in this renderer's format, in the encoder's order: the sky, then the world.
    /// The world fills the window and keeps the reach of the `aspect` picture (the game's width over its height) in view: a taller or wider window shows more world, never bars.
    pub fn draw(&mut self, encoder: &mut wgpu::CommandEncoder, target: &wgpu::TextureView, size: (u32, u32), aspect: f32, scene: &Scene) {
        self.fit_targets(size);
        let viewport = [0.0, 0.0, size.0 as f32, size.1 as f32];
        let window = size.0 as f32 / size.1.max(1) as f32;
        self.layout(&scene.poses);
        if self.bone_scratch.len() > self.bone_capacity {
            self.bone_capacity = self.bone_scratch.len().next_power_of_two();
            self.bone_buffer = bone_storage(&self.device, self.bone_capacity);
            self.main_group = frame_group(&self.device, &self.frame_layout, &self.main_frame, &self.bone_buffer);
            self.sky_group = frame_group(&self.device, &self.frame_layout, &self.sky_frame, &self.bone_buffer);
        }
        let sky = scene.sky.as_ref().and_then(|pose| self.model_ids.get(pose.model.as_str()).map(|&id| (id, pose)));
        let sky_base = self.bone_scratch.len();
        if let Some((id, pose)) = sky {
            let bones = self.models[id].bones;
            if sky_base + bones > self.bone_capacity {
                self.problems.push("the sky's bones did not fit".into());
            } else {
                self.bone_scratch.resize(sky_base + bones, IDENTITY);
                self.models[id].rig.pose(pose.sequence, pose.frame, pose.clock * 1000.0, &mut self.bone_scratch[sky_base..]);
            }
        }
        let sky_instance = self.instance_scratch.len();
        if let Some((_, pose)) = sky {
            let mut placed = pose.matrix;
            placed[12] = scene.camera.eye[0];
            placed[13] = scene.camera.eye[1];
            placed[14] = scene.camera.eye[2];
            self.instance_scratch.push(Instance { model: placed, tint: [1.0, 1.0, 1.0, 1.0], team: [1.0; 4], base: sky_base as u32 });
        }
        if self.instance_scratch.len() > self.instance_capacity {
            self.instance_capacity = self.instance_scratch.len().next_power_of_two();
            self.instance_buffer = instance_storage(&self.device, self.instance_capacity);
        }
        self.queue.write_buffer(&self.bone_buffer, 0, bytemuck::cast_slice(&self.bone_scratch));
        self.queue.write_buffer(&self.instance_buffer, 0, bytemuck::cast_slice(&self.instance_scratch));
        self.queue.write_buffer(&self.main_frame, 0, bytemuck::bytes_of(&Self::frame_uniform(scene, aspect, window, scene.camera.far)));
        self.queue.write_buffer(&self.sky_frame, 0, bytemuck::bytes_of(&Self::frame_uniform(scene, aspect, window, scene.camera.sky_far)));
        self.sky_group_of = sky.map(|(id, _)| Group { model: id, first: sky_instance as u32, count: 1 });

        let clear = if scene.clear == [0.0; 3] { CLEAR } else { scene.clear.map(f64::from) };
        let targets = self.targets.as_ref().expect("fit_targets ran");
        let begin = |encoder: &'_ mut wgpu::CommandEncoder, color_load: wgpu::LoadOp<wgpu::Color>, resolve: bool| -> wgpu::RenderPass<'static> {
            encoder
                .begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("scene"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &targets.color,
                        depth_slice: None,
                        resolve_target: resolve.then_some(target),
                        ops: wgpu::Operations { load: color_load, store: wgpu::StoreOp::Store },
                    })],
                    depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                        view: &targets.depth,
                        depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(1.0), store: wgpu::StoreOp::Discard }),
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
            if let Some(group) = &self.sky_group_of {
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
    }
}


impl crate::ui::UiTextures for Renderer {
    fn view(&self, path: &str) -> Option<&wgpu::TextureView> {
        self.textures.get(&path.to_ascii_lowercase())
    }
}
