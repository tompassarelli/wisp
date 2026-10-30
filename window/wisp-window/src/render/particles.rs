//! Particle emitters on the GPU (wisp:docs/native-window-plan.md, "Effects").
//!
//! A particle never changes after it is born, so the CPU writes one 64-byte record per birth, once, into a ring buffer, and the vertex
//! shader works out where the particle is, how big and what colour from the record and the clock: velocity, gravity and the emitter's
//! life curves are all closed-form. One ring serves every emitter that shares a texture and blend, and each ring is one instanced draw.

use std::collections::HashMap;
use std::mem::size_of;

use bytemuck::{Pod, Zeroable};

use super::math::Mat4;
use super::model::{EmitterSample, Filter, ModelEmitter};
use super::pipelines::{blend_of, entry};
use super::{FrameUniform, DEPTH, SAMPLES};
use crate::model::{LINE_EMITTER, XY_QUAD};

const RING: usize = 16 * 1024;
const SPECS: usize = 1024;
const BORN_PER_STEP: u32 = 256;
const FRAMES_PER_SECOND: f32 = 60.0;
const LONGEST_STEP: f32 = 0.25;
const HEAD: u32 = 1;
const TAIL: u32 = 2;
const FLAT: u32 = 4;
const KEYED: u32 = 8;
const BLENDS: [Filter; 4] = [Filter::Blend, Filter::Additive, Filter::Modulate, Filter::Modulate2x];

/// How an emitter's particles look over their life, shared by all of them: colours (alpha last), scale, frame ranges and flags.
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Spec {
    colors: [[f32; 4]; 3],
    scaling: [f32; 4],
    head_frames: [f32; 4],
    tail_frames: [f32; 4],
    grid: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Particle {
    origin_and_birth: [f32; 4],
    velocity_and_life: [f32; 4],
    gravity_angle_spec_alpha: [f32; 4],
    scale: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub(super) struct ParticleFrame {
    pub(super) base: FrameUniform,
    pub(super) right: [f32; 4],
    pub(super) up: [f32; 4],
    pub(super) eye_and_now: [f32; 4],
}

struct Ring {
    buffer: wgpu::Buffer,
    group: wgpu::BindGroup,
    blend: usize,
    births: Vec<f32>,
    longest_life: f32,
    head: usize,
    live: usize,
    staged: Vec<Particle>,
}

#[derive(Default)]
struct Running {
    owed: f32,
    key_frame: i32,
    seen: u64,
}

/// Where a model's emitter draws: its ring and its spec.
#[derive(Clone, Copy)]
pub(super) struct Slot {
    ring: usize,
    spec: u32,
}

pub(super) struct Particles {
    pipelines: Vec<wgpu::RenderPipeline>,
    frame_layout: wgpu::BindGroupLayout,
    ring_layout: wgpu::BindGroupLayout,
    frame_buffer: wgpu::Buffer,
    spec_buffer: wgpu::Buffer,
    frame_group: wgpu::BindGroup,
    specs: u32,
    rings: Vec<Ring>,
    ring_ids: HashMap<(String, usize), usize>,
    running: HashMap<(u32, u32), Running>,
    generation: u64,
    frame: Option<u32>,
    now: f32,
    step: f32,
    random: u64,
    pub(super) problems: Vec<String>,
}

fn storage() -> wgpu::BindingType {
    wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Storage { read_only: true }, has_dynamic_offset: false, min_binding_size: None }
}

fn blend_index(filter_mode: u32) -> usize {
    match filter_mode {
        1 => 1,
        2 => 2,
        3 => 3,
        _ => 0,
    }
}

impl Particles {
    pub(super) fn new(device: &wgpu::Device, format: wgpu::TextureFormat) -> Self {
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("particles"), source: wgpu::ShaderSource::Wgsl(include_str!("particle.wgsl").into()) });
        let frame_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("particle frame"),
            entries: &[
                entry(0, wgpu::ShaderStages::VERTEX_FRAGMENT, wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None }),
                entry(1, wgpu::ShaderStages::VERTEX, storage()),
            ],
        });
        let ring_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("particle ring"),
            entries: &[
                entry(0, wgpu::ShaderStages::VERTEX, storage()),
                entry(1, wgpu::ShaderStages::FRAGMENT, wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: true }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false }),
                entry(2, wgpu::ShaderStages::FRAGMENT, wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering)),
            ],
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: Some("particles"), bind_group_layouts: &[Some(&frame_layout), Some(&ring_layout)], immediate_size: 0 });
        let pipelines = BLENDS
            .iter()
            .map(|&filter| {
                device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                    label: Some("particles"),
                    layout: Some(&layout),
                    vertex: wgpu::VertexState { module: &module, entry_point: Some("vertex_main"), compilation_options: Default::default(), buffers: &[] },
                    fragment: Some(wgpu::FragmentState {
                        module: &module,
                        entry_point: Some("fragment_main"),
                        compilation_options: Default::default(),
                        targets: &[Some(wgpu::ColorTargetState { format, blend: blend_of(filter), write_mask: wgpu::ColorWrites::ALL })],
                    }),
                    primitive: wgpu::PrimitiveState::default(),
                    depth_stencil: Some(wgpu::DepthStencilState { format: DEPTH, depth_write_enabled: Some(false), depth_compare: Some(wgpu::CompareFunction::LessEqual), stencil: Default::default(), bias: Default::default() }),
                    multisample: wgpu::MultisampleState { count: SAMPLES, mask: !0, alpha_to_coverage_enabled: false },
                    multiview_mask: None,
                    cache: None,
                })
            })
            .collect();
        let frame_buffer = device.create_buffer(&wgpu::BufferDescriptor { label: Some("particle frame"), size: size_of::<ParticleFrame>() as u64, usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
        let spec_buffer = device.create_buffer(&wgpu::BufferDescriptor { label: Some("particle specs"), size: (SPECS * size_of::<Spec>()) as u64, usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
        let frame_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("particle frame"),
            layout: &frame_layout,
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: frame_buffer.as_entire_binding() }, wgpu::BindGroupEntry { binding: 1, resource: spec_buffer.as_entire_binding() }],
        });
        Self {
            pipelines,
            frame_layout,
            ring_layout,
            frame_buffer,
            spec_buffer,
            frame_group,
            specs: 0,
            rings: Vec::new(),
            ring_ids: HashMap::new(),
            running: HashMap::new(),
            generation: 0,
            frame: None,
            now: 0.0,
            step: 0.0,
            random: 0x9E37_79B9_7F4A_7C15,
            problems: Vec::new(),
        }
    }

    /// Registers one emitter of a model that has just been built: its look goes to the spec buffer, and its particles to the ring of its texture and blend.
    pub(super) fn register(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, emitter: &ModelEmitter, texture: (&str, &wgpu::TextureView), sampler: &wgpu::Sampler) -> Option<Slot> {
        if self.specs as usize >= SPECS {
            self.problems.push("more particle emitters than the window has room for".into());
            return None;
        }
        let spec = &emitter.spec;
        let blend = blend_index(spec.filter_mode);
        let key = (texture.0.to_ascii_lowercase(), blend);
        let ring = match self.ring_ids.get(&key) {
            Some(&ring) => ring,
            None => {
                let buffer = device.create_buffer(&wgpu::BufferDescriptor { label: Some("particles"), size: (RING * size_of::<Particle>()) as u64, usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
                let group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("particles"),
                    layout: &self.ring_layout,
                    entries: &[
                        wgpu::BindGroupEntry { binding: 0, resource: buffer.as_entire_binding() },
                        wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(texture.1) },
                        wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(sampler) },
                    ],
                });
                self.rings.push(Ring { buffer, group, blend, births: vec![f32::NEG_INFINITY; RING], longest_life: 0.0, head: 0, live: 0, staged: Vec::new() });
                self.ring_ids.insert(key, self.rings.len() - 1);
                self.rings.len() - 1
            }
        };
        let flags = u32::from(spec.head) * HEAD | u32::from(spec.tail) * TAIL | u32::from(spec.flags & XY_QUAD != 0) * FLAT | u32::from(spec.filter_mode == 4) * KEYED;
        let color = |at: usize| [spec.colors[at][0], spec.colors[at][1], spec.colors[at][2], spec.alphas[at]];
        let record = Spec {
            colors: [color(0), color(1), color(2)],
            scaling: [spec.scaling[0], spec.scaling[1], spec.scaling[2], spec.time],
            head_frames: [spec.head_life[0], spec.head_life[1], spec.head_decay[0], spec.head_decay[1]],
            tail_frames: [spec.tail_life[0], spec.tail_life[1], spec.tail_decay[0], spec.tail_decay[1]],
            grid: [spec.rows as f32, spec.columns as f32, spec.tail_length, flags as f32],
        };
        queue.write_buffer(&self.spec_buffer, u64::from(self.specs) * size_of::<Spec>() as u64, bytemuck::bytes_of(&record));
        self.specs += 1;
        Some(Slot { ring, spec: self.specs - 1 })
    }

    pub(super) fn frame_layout(&self) -> &wgpu::BindGroupLayout {
        &self.frame_layout
    }

    pub(super) fn frame_group(&self) -> &wgpu::BindGroup {
        &self.frame_group
    }

    /// Starts a scene: time is the scene's game frame at 60 per second, so a scene drawn twice births nothing twice and a jump back clears the sky.
    pub(super) fn begin(&mut self, frame: u32) {
        let seconds = frame as f32 / FRAMES_PER_SECOND;
        self.generation += 1;
        self.step = match self.frame {
            Some(last) if frame >= last && seconds - self.now <= LONGEST_STEP => seconds - self.now,
            Some(_) => {
                self.running.clear();
                for ring in &mut self.rings {
                    ring.live = 0;
                    ring.staged.clear();
                }
                0.0
            }
            None => 0.0,
        };
        self.frame = Some(frame);
        self.now = seconds;
    }

    fn random(&mut self, low: f32, high: f32) -> f32 {
        self.random ^= self.random << 13;
        self.random ^= self.random >> 7;
        self.random ^= self.random << 17;
        low + (high - low) * ((self.random >> 40) as f32 / (1u64 << 24) as f32)
    }

    /// Births the particles an emitter owes for the time since the last scene. `world` places the emitter's node in the world.
    pub(super) fn emit(&mut self, id: u32, index: usize, slot: Slot, emitter: &ModelEmitter, sample: &EmitterSample, world: &Mat4, alpha: f32) {
        let state = self.running.entry((id, index as u32)).or_default();
        state.seen = self.generation;
        let step_ms = self.step * 1000.0;
        if step_ms <= 0.0 || !sample.visible {
            return;
        }
        let spec = &emitter.spec;
        if spec.squirt && spec.emission_rate.track.is_some() {
            if let Some((frame, count)) = sample.key {
                if frame != state.key_frame {
                    state.key_frame = frame;
                    if count > 0.0 {
                        state.owed += count * 1000.0;
                    }
                }
            }
        } else {
            state.owed += sample.rate * step_ms;
        }
        let due = ((state.owed / 1000.0) as u32).min(BORN_PER_STEP);
        state.owed = (state.owed - due as f32 * 1000.0).max(0.0);
        let scale = (world[0] * world[0] + world[1] * world[1] + world[2] * world[2]).sqrt();
        for born in 0..due {
            let (width, length) = (sample.width, sample.length);
            let local = [spec.pivot[0] + self.random(-width / 2.0, width / 2.0), spec.pivot[1] + self.random(-length / 2.0, length / 2.0), spec.pivot[2]];
            let speed = if sample.variation > 0.0 { sample.speed * (1.0 + self.random(-sample.variation, sample.variation)) } else { sample.speed };
            let lean = self.random(0.0, sample.latitude.to_radians());
            let spin = self.random(0.0, std::f32::consts::TAU);
            let (lean_sin, lean_cos, spin_sin, spin_cos) = (lean.sin(), lean.cos(), spin.sin(), spin.cos());
            let (x, y, z) = (speed * lean_sin, 0.0, speed * lean_cos);
            let mut direction = [x * spin_cos - y * spin_sin, x * spin_sin + y * spin_cos, z];
            if spec.flags & LINE_EMITTER != 0 {
                direction[0] = 0.0;
            }
            let moved = |matrix: &Mat4, point: [f32; 3], w: f32| -> [f32; 3] { std::array::from_fn(|row| matrix[row] * point[0] + matrix[4 + row] * point[1] + matrix[8 + row] * point[2] + matrix[12 + row] * w) };
            let origin = moved(world, local, 1.0);
            let velocity = moved(world, direction, 0.0);
            let birth = self.now - self.step * (1.0 - (born as f32 + 0.5) / due as f32);
            let ring = &mut self.rings[slot.ring];
            ring.longest_life = ring.longest_life.max(spec.life_span);
            ring.staged.push(Particle {
                origin_and_birth: [origin[0], origin[1], origin[2], birth],
                velocity_and_life: [velocity[0], velocity[1], velocity[2], spec.life_span],
                gravity_angle_spec_alpha: [sample.gravity * scale, spin, f32::from_bits(slot.spec), alpha],
                scale: [scale, 0.0, 0.0, 0.0],
            });
        }
    }

    /// Ends a scene's births: uploads what was born into the rings, drops the emitters that were not posed, and writes the frame uniform.
    pub(super) fn finish(&mut self, queue: &wgpu::Queue, frame: &ParticleFrame) {
        let generation = self.generation;
        self.running.retain(|_, state| state.seen == generation);
        let now = self.now;
        for ring in &mut self.rings {
            let staged = ring.staged.len().min(RING);
            let fresh = &ring.staged[ring.staged.len() - staged..];
            let first = staged.min(RING - ring.head);
            queue.write_buffer(&ring.buffer, (ring.head * size_of::<Particle>()) as u64, bytemuck::cast_slice(&fresh[..first]));
            if first < staged {
                queue.write_buffer(&ring.buffer, 0, bytemuck::cast_slice(&fresh[first..]));
            }
            for (at, particle) in fresh.iter().enumerate() {
                ring.births[(ring.head + at) % RING] = particle.origin_and_birth[3];
            }
            ring.head = (ring.head + staged) % RING;
            ring.live = (ring.live + staged).min(RING);
            ring.staged.clear();
            while ring.live > 0 && ring.births[(ring.head + RING - ring.live) % RING] + ring.longest_life < now {
                ring.live -= 1;
            }
        }
        let mut frame = *frame;
        frame.eye_and_now[3] = now;
        queue.write_buffer(&self.frame_buffer, 0, bytemuck::bytes_of(&frame));
    }

    pub(super) fn draw<'a>(&'a self, pass: &mut wgpu::RenderPass<'a>) {
        pass.set_bind_group(0, &self.frame_group, &[]);
        for ring in self.rings.iter().filter(|ring| ring.live > 0) {
            pass.set_pipeline(&self.pipelines[ring.blend]);
            pass.set_bind_group(1, &ring.group, &[]);
            let first = (ring.head + RING - ring.live) % RING;
            if first < ring.head {
                pass.draw(0..12, first as u32..ring.head as u32);
            } else {
                pass.draw(0..12, first as u32..RING as u32);
                pass.draw(0..12, 0..ring.head as u32);
            }
        }
    }
}
