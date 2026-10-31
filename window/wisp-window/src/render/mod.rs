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
mod emitters;
mod lightning;
mod weather;
mod particles;
mod passes;
mod pipelines;
mod ripples;
mod scene;
mod shadow;
mod targets;
pub mod source;
mod sprite;
mod surface;
pub mod tessellate;
mod uniforms;
mod water;
#[cfg(test)]
mod stage_test;

use std::collections::HashMap;
use std::time::Instant;
use bytemuck::Zeroable;
use wgpu::util::DeviceExt;

use std::sync::Arc;

use crate::decode_pool::Pool;
use crate::model::Facing;
use crate::remaster::{self, Baker, Cache, Edges, Loaded, Quality, Upscaler};
use crate::settings::{Features, Shadows};
use math::{mirrored, multiply, projection, Mat4, IDENTITY};
use gpu::{bone_storage, frame_group, frame_uniform_buffer, instance_storage, color_storage, repeat_sampler, upload, uv_storage, white};
use {lightning::Lightning, weather::Weather};
use model::{Filter, ModelData, ModelEmitter, Paint, Vertex};
use shadow::Shadow;
use uniforms::{lighting_of, FrameUniform, Instance, LayerUniform, Lit, SceneFrame};
use water::{Glow, Water, WaterSettings};
use particles::{ParticleFrame, Particles, Slot};
use scene::{Pose, Scene};
use targets::Targets;
use crate::post::{Post, Tuning, TUNING};

pub use gpu::fitted;
pub use sprite::Shot;
pub use scene::Scene as DrawScene;

const DEPTH: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;
const HDR: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
const SAMPLES: u32 = 4;
const BONES_AT_START: usize = 16 * 1024;
const SLOTS_AT_START: usize = 16 * 1024;
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
    /// None for a water layer, which the water pass binds its own images for.
    bind_group: Option<wgpu::BindGroup>,
}

struct GpuModel {
    vertices: wgpu::Buffer,
    indices: wgpu::Buffer,
    draws: Vec<Draw>,
    opaque_first: bool,
    rig: Box<dyn model::Rig>,
    bones: usize,
    skin: sprite::Skin,
    emitters: Vec<(ModelEmitter, Option<Slot>)>,
    /// The liquid its water layers are drawn as and where their surface lies, for a model that has them.
    liquid: Option<(water::Preset, surface::Surface)>,
    /// The model's box when it has a layer that writes depth, which is what makes it a body that disturbs water.
    body: Option<ripples::Extent>,
}

struct Group {
    model: usize,
    first: u32,
    count: u32,
}

/// A scene's frame uniform and the group that binds it with the bone, opacity and texture-coordinate buffers.
struct FrameSet {
    buffer: wgpu::Buffer,
    group: wgpu::BindGroup,
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
    wanted: Quality,
    baker: Option<Baker>,
    baked_at_build: usize,
    playing: bool,
    unbaked: bool,
    upscaler: Arc<Upscaler>,
    cache: Option<Arc<Cache>>,
    models: Vec<GpuModel>,
    model_ids: HashMap<String, usize>,
    bone_buffer: wgpu::Buffer,
    bone_capacity: usize,
    color_buffer: wgpu::Buffer,
    color_capacity: usize,
    color_scratch: Vec<[f32; 4]>,
    uv_buffer: wgpu::Buffer,
    uv_scratch: Vec<[f32; 4]>,
    instance_buffer: wgpu::Buffer,
    instance_capacity: usize,
    main: FrameSet,
    sky: FrameSet,
    mirror: FrameSet,
    mirror_sky: FrameSet,
    water: Water,
    started: Instant,
    water_level: Option<f32>,
    ripples: ripples::Ripples,
    targets: Option<Targets>,
    post: Post,
    shadow: Shadow,
    tuning: Tuning,
    sprites: Vec<sprite::Slot>,
    bone_scratch: Vec<Mat4>,
    instance_scratch: Vec<Instance>,
    counts: Vec<u32>,
    order: Vec<usize>,
    groups: Vec<Group>,
    sky_group_of: Option<Group>,
    decoder: Pool<Result<Loaded, String>>,
    decoding: HashMap<u64, String>,
    next_job: u64,
    waiting: Vec<(String, Arc<[u8]>)>,
    sources: Vec<(String, Arc<[u8]>)>,
    incoming: Option<Box<Renderer>>,
    features: Features,
    particles: Particles,
    lightning: Lightning,
    weather: Weather,
    pub problems: Vec<String>,
}

impl Renderer {
    /// Doubles textures with `upscaler` instead of the edge-directed filter alone; the one an adapter was checked for is shared by every rebuild of the art.
    pub fn with_upscaler(mut self, upscaler: Arc<Upscaler>) -> Self {
        self.upscaler = upscaler;
        self
    }

    pub fn new(device: wgpu::Device, queue: wgpu::Queue, format: wgpu::TextureFormat, quality: Quality, features: Features) -> Self {
        let (pipelines, frame_layout, layer_layout) = pipelines::build(&device, HDR);
        let bone_buffer = bone_storage(&device, BONES_AT_START);
        let color_buffer = color_storage(&device, SLOTS_AT_START);
        let uv_buffer = uv_storage(&device, SLOTS_AT_START);
        let instance_buffer = instance_storage(&device, INSTANCES_AT_START);
        let shadow = Shadow::new(&device, &layer_layout, [&bone_buffer, &color_buffer, &uv_buffer], match features.shadows { Shadows::Off => 0, Shadows::Map(side) => side });
        let set = |label| {
            let buffer = frame_uniform_buffer(&device, label);
            let group = frame_group(&device, &frame_layout, &buffer, &bone_buffer, &color_buffer, &uv_buffer, shadow.bound());
            FrameSet { buffer, group }
        };
        let (main, sky, mirror, mirror_sky) = (set("main frame"), set("sky frame"), set("mirrored frame"), set("mirrored sky frame"));
        let water = Water::new(&device, HDR, &frame_layout);
        let particles = Particles::new(&device, HDR);
        let lightning = Lightning::new(&device, HDR, &particles);
        let weather = Weather::new(&device, HDR, &particles);
        let post = Post::new(&device, &queue, format, HDR, DEPTH, SAMPLES);
        Self {
            white: upload(&device, &queue, &white()),
            sampler: repeat_sampler(&device),
            device,
            queue,
            format,
            pipelines,
            frame_layout,
            layer_layout,
            textures: HashMap::new(),
            reliefs: HashMap::new(),
            quality,
            wanted: quality,
            baker: None,
            baked_at_build: 0,
            playing: false,
            unbaked: false,
            upscaler: Arc::new(Upscaler::classical()),
            cache: (quality != Quality::Off).then(Cache::open).flatten().map(Arc::new),
            models: Vec::new(),
            model_ids: HashMap::new(),
            bone_buffer,
            bone_capacity: BONES_AT_START,
            color_buffer,
            color_capacity: SLOTS_AT_START,
            color_scratch: Vec::new(),
            uv_buffer,
            uv_scratch: Vec::new(),
            instance_buffer,
            instance_capacity: INSTANCES_AT_START,
            main,
            sky,
            mirror,
            mirror_sky,
            water,
            started: Instant::now(),
            water_level: None,
            ripples: ripples::Ripples::default(),
            targets: None,
            post,
            shadow,
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
            weather,
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
        let mut solid = false;
        for part in data.parts.iter().filter(|_| drawable) {
            for layer in &part.layers {
                opaque_first |= layer.filter.index() < Filter::Blend.index();
                solid |= layer.paint != Paint::Water && layer.filter.writes_depth();
                draws.push(self.layer_draw(path, part, layer));
            }
        }
        let liquid = surface::Surface::of_water(&data).map(|surface| (water::Preset::of_model(path), surface));
        let body = if solid { ripples::extent_of(data.vertices.iter().map(|vertex| vertex.position)) } else { None };
        let emitters = self.register_emitters(path, data.emitters);
        let bones = data.rig.bone_count().max(1);
        self.model_ids.insert(path.to_string(), self.models.len());
        self.models.push(GpuModel { vertices, indices, draws, opaque_first, skin: sprite::Skin::new(data.vertices, data.indices, &data.parts), rig: data.rig, bones, emitters, liquid, body });
        self.counts.push(0);
    }

    /// The draw of one layer of a part: a water layer carries no bind group, any other binds its texture and its slots.
    fn layer_draw(&mut self, path: &str, part: &model::Part, layer: &model::Layer) -> Draw {
        let draw = |bind_group| Draw { filter: layer.filter, first_index: part.first_index, index_count: part.index_count, bind_group };
        let (kind, texture) = match &layer.paint {
            Paint::Water => return draw(None),
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
            contents: bytemuck::bytes_of(&LayerUniform { kind, cutoff: if layer.filter == Filter::Cutout { 0.75 } else { 0.0 }, geoset_slot: part.color_slot, layer_slot: layer.color_slot, ignores_texture_alpha: u32::from(layer.filter == Filter::Additive), lighting: lighting_of(layer.filter, layer.unshaded), pad: [0; 2] }),
            usage: wgpu::BufferUsages::UNIFORM,
        });
        draw(Some(self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("layer"),
            layout: &self.layer_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(texture) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&self.sampler) },
                wgpu::BindGroupEntry { binding: 2, resource: uniform.as_entire_binding() },
            ],
        })))
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

    /// `mirror` is set when the frame is the mirrored copy drawn for the reflection, whose geometry below `plane` is cut away; `lit` says how the light and the sun's map reach what the frame draws.
    fn scene_frame(scene: &Scene, aspect: f32, window: f32, far: f32, size: (u32, u32), plane: f32, mirror: bool, glow: Glow, lit: Lit) -> SceneFrame {
        let camera = &scene.camera;
        let view = camera.view;
        let (light_toward, light_key, light_ambient) = match (&scene.light, lit) {
            (Some(light), Lit::Ambient | Lit::Sunlit(_)) => ([light.toward[0], light.toward[1], light.toward[2], 0.0], [light.key[0], light.key[1], light.key[2], 1.0], [light.ambient[0], light.ambient[1], light.ambient[2], 0.0]),
            _ => ([0.0, 0.0, 1.0, 0.0], [0.0; 4], [1.0, 1.0, 1.0, 0.0]),
        };
        let (fog_color, fog_range) = match &scene.fog {
            Some(fog) => ([fog.color[0], fog.color[1], fog.color[2], 1.0], [fog.start, fog.end, fog.max, 0.0]),
            None => ([0.0; 4], [0.0, 1.0, 1.0, 0.0]),
        };
        let (sun_projection, shadow) = match lit {
            Lit::Sunlit(sun) => (sun.view_projection, [sun.texel, sun.offset, 1.0, 0.0]),
            Lit::Unlit | Lit::Ambient => (IDENTITY, [0.0; 4]),
        };
        let flat = multiply(&projection(camera.tangent, camera.near, far, aspect, window, camera.rise), &view);
        let view_projection = if mirror { multiply(&flat, &mirrored(plane)) } else { flat };
        let (width, height) = (size.0 as f32, size.1 as f32);
        SceneFrame {
            base: FrameUniform { view_projection, light_toward, light_key, light_ambient, fog_color, fog_range },
            eye: [camera.eye[0], camera.eye[1], camera.eye[2], 0.0],
            camera: [camera.near, far, plane, f32::from(u8::from(mirror))],
            screen: [width, height, 1.0 / width.max(1.0), 1.0 / height.max(1.0)],
            glow: glow.light,
            glow_at: glow.at,
            sun_projection,
            shadow,
        }
    }

    /// Lays every resident pose out by model: bone matrices into the scratch, instances grouped so each model's are contiguous.
    fn layout(&mut self, poses: &[Pose], view: &Mat4) {
        self.counts.iter_mut().for_each(|count| *count = 0);
        self.order.clear();
        self.water_level = None;
        let mut widest = 0.0;
        for pose in poses {
            if let Some(&id) = self.model_ids.get(pose.model.as_str()) {
                if let Some((liquid, surface)) = self.models[id].liquid {
                    let (height, area) = surface.placed(&pose.matrix);
                    if self.water_level.is_none() || area > widest {
                        (self.water_level, widest, self.water.liquid) = (Some(height), area, liquid);
                    }
                }
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
        self.color_scratch.clear();
        self.uv_scratch.clear();
        for pose in poses {
            let Some(&id) = self.model_ids.get(pose.model.as_str()) else { continue };
            let group = self.groups.iter().find(|group| group.model == id).map(|group| group.first).unwrap_or(0);
            let model = &mut self.models[id];
            let base = self.bone_scratch.len();
            self.bone_scratch.resize(base + model.bones, IDENTITY);
            model.rig.pose(pose.sequence, pose.frame, pose.clock, &Facing::of(view, &pose.matrix), &mut self.bone_scratch[base..]);
            let color_base = self.color_scratch.len();
            self.color_scratch.extend_from_slice(model.rig.colors());
            self.uv_scratch.extend_from_slice(model.rig.uv_rows());
            let slot = (group + self.counts[id]) as usize;
            self.counts[id] += 1;
            self.instance_scratch[slot] = Instance { model: water::with_reach(pose.matrix, model.liquid.as_ref().filter(|_| model.body.is_none()).map(|(_, surface)| surface.half)), tint: [pose.color[0], pose.color[1], pose.color[2], pose.alpha], team: [pose.team[0], pose.team[1], pose.team[2], 1.0], base: [base as u32, color_base as u32] };
            if pose.sequence >= 0 && pose.alpha > 0.0 {
                for (index, ((emitter, slot), sample)) in model.emitters.iter().zip(model.rig.emitters()).enumerate() {
                    let Some(slot) = *slot else { continue };
                    let Some(bone) = self.bone_scratch.get(base + emitter.spec.node) else { continue };
                    self.particles.emit(pose.id, index, slot, emitter, sample, &multiply(&pose.matrix, bone), pose.alpha);
                }
            }
        }
    }

    /// Poses the sky, grows the storage buffers that outgrew their capacity, uploads the scene's per-frame data and stages its particles and bolts.
    fn prepare(&mut self, scene: &Scene, aspect: f32, window: f32, size: (u32, u32)) -> bool {
        self.layout(&scene.poses, &scene.camera.view);
        let sky = scene.sky.as_ref().and_then(|pose| self.model_ids.get(pose.model.as_str()).map(|&id| (id, pose)));
        let sky_base = self.bone_scratch.len();
        let sky_color_base = self.color_scratch.len();
        if let Some((id, pose)) = sky {
            self.bone_scratch.resize(sky_base + self.models[id].bones, IDENTITY);
            self.models[id].rig.pose(pose.sequence, pose.frame, pose.clock, &Facing::of(&scene.camera.view, &pose.matrix), &mut self.bone_scratch[sky_base..]);
            self.color_scratch.extend_from_slice(self.models[id].rig.colors());
            self.uv_scratch.extend_from_slice(self.models[id].rig.uv_rows());
        }
        if self.bone_scratch.len() > self.bone_capacity || self.color_scratch.len() > self.color_capacity {
            self.bone_capacity = self.bone_scratch.len().next_power_of_two().max(self.bone_capacity);
            self.color_capacity = self.color_scratch.len().next_power_of_two().max(self.color_capacity);
            self.bone_buffer = bone_storage(&self.device, self.bone_capacity);
            self.color_buffer = color_storage(&self.device, self.color_capacity);
            self.uv_buffer = uv_storage(&self.device, self.color_capacity);
            self.bind_frames();
            self.shadow.rebind(&self.device, [&self.bone_buffer, &self.color_buffer, &self.uv_buffer]);
        }
        let sky_instance = self.instance_scratch.len();
        if let Some((_, pose)) = sky {
            let mut placed = pose.matrix;
            placed[12] = scene.camera.eye[0];
            placed[13] = scene.camera.eye[1];
            placed[14] = scene.camera.eye[2];
            self.instance_scratch.push(Instance { model: placed, tint: [1.0, 1.0, 1.0, 1.0], team: [1.0; 4], base: [sky_base as u32, sky_color_base as u32] });
        }
        if self.instance_scratch.len() > self.instance_capacity {
            self.instance_capacity = self.instance_scratch.len().next_power_of_two();
            self.instance_buffer = instance_storage(&self.device, self.instance_capacity);
        }
        self.queue.write_buffer(&self.bone_buffer, 0, bytemuck::cast_slice(&self.bone_scratch));
        self.queue.write_buffer(&self.color_buffer, 0, bytemuck::cast_slice(&self.color_scratch));
        self.queue.write_buffer(&self.uv_buffer, 0, bytemuck::cast_slice(&self.uv_scratch));
        self.queue.write_buffer(&self.instance_buffer, 0, bytemuck::cast_slice(&self.instance_scratch));
        let plane = self.water_level.filter(|_| self.water.ready()).unwrap_or(0.0);
        let seconds = self.started.elapsed().as_secs_f32();
        let glow = if self.water_level.is_some() && self.water.ready() { WaterSettings::of(self.water.liquid).glow(plane, seconds) } else { Glow::NONE };
        let sun = scene.light.as_ref().filter(|light| light.key.iter().any(|&channel| channel > 0.0)).filter(|_| self.shadow.side > 0).and_then(|light| scene.camera.sun_corners(aspect).map(|corners| shadow::sun(corners, light.toward, self.shadow.side)));
        let lit = sun.as_ref().map_or(Lit::Ambient, Lit::Sunlit);
        let main = Self::scene_frame(scene, aspect, window, scene.camera.far, size, plane, false, glow, lit);
        let frames = [(&self.main, scene.camera.far, false, lit), (&self.sky, scene.camera.sky_far, false, Lit::Unlit), (&self.mirror, scene.camera.far, true, lit), (&self.mirror_sky, scene.camera.sky_far, true, Lit::Unlit)];
        for (set, far, mirror, lit) in frames {
            self.queue.write_buffer(&set.buffer, 0, bytemuck::bytes_of(&Self::scene_frame(scene, aspect, window, far, size, plane, mirror, glow, lit)));
        }
        if let Some(sun) = &sun {
            self.shadow.write(&self.queue, sun);
        }
        let view = &scene.camera.view;
        let eye = scene.camera.eye;
        self.particles.finish(
            &self.queue,
            &ParticleFrame { base: main.base, right: [view[0], view[4], view[8], 0.0], up: [view[1], view[5], view[9], 0.0], eye_and_now: [eye[0], eye[1], eye[2], 0.0] },
        );
        self.problems.append(&mut self.particles.problems);
        self.lightning.stage(&self.queue, &scene.lightnings);
        self.weather.stage(&self.queue, &scene.camera, &scene.weathers, &self.features);
        self.sky_group_of = sky.map(|(id, _)| Group { model: id, first: sky_instance as u32, count: 1 });
        sun.is_some()
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
#[cfg(test)]
mod weather_gpu_tests;
