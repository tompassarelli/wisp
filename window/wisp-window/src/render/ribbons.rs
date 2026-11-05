//! Ribbon emitters on the GPU (wisp:docs/native-window-plan.md, "Ribbons").
//!
//! A ribbon emitter lays an edge behind its node at its emission rate: a line from `height_above` to `height_below` along the node's Y
//! axis, in world space. The quad between two edges is one 64-byte record the CPU writes once into a ring per texture and blend; the
//! vertex shader ages it from the clock, so it falls by gravity, slides along the texture and is clipped at the end of its life. Each
//! running emitter owns one small record rewritten every scene with its colour, alpha and texture cell, which the whole strip takes; an
//! emitter whose pose is gone, hidden or parked at scale zero gives its record up, and every quad that named it stops drawing at once.
//! The quad from the newest edge to the node, and the strips the map lays itself (the scene's `strips`), go each scene into a tail
//! after each ring, so one instanced draw per ring draws both.

use std::collections::HashMap;
use std::mem::size_of;

use bytemuck::{Pod, Zeroable};

use super::emission::Tick;
use super::math::Mat4;
use super::model::{Filter, ModelRibbon, RibbonSample};
use super::particles::Particles;
use super::pipelines::{blend_of, entry};
use super::scene::StripPose;
use super::DEPTH;

const RING: usize = 4096;
const TAIL: usize = 512;
const RECORDS: usize = 1024;
/// The records the map's strips use, before the emitters'.
const STRIPS: usize = 8;
const STRIP_EDGES: usize = 32;
const EDGES_PER_STEP: u32 = 32;
/// A node scaled below this is parked, which Warcraft does not hide: its strip is dropped rather than drawn from the park to its next place.
const PARKED_SCALE: f32 = 1e-3;
/// A node that moves this far between two scenes was placed, not flown: its chain is cut so no quad spans the jump.
const JUMP: f32 = 600.0;
const ADDITIVE: u32 = 1;
const KEYED: u32 = 2;
const STRIP: u32 = 4;
const BLENDS: [Filter; 4] = [Filter::Blend, Filter::Additive, Filter::Modulate, Filter::Modulate2x];

/// One quad between two edges: the older edge, the newer, the times each was laid, and the record and its epoch.
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Segment {
    from_above_and_birth: [f32; 4],
    from_below_and_birth: [f32; 4],
    to_above_and_record: [f32; 4],
    to_below_and_epoch: [f32; 4],
}

/// What a running emitter shows now: colour and alpha, then life, gravity, texture cell and flags, then rows, columns and epoch.
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Record {
    color: [f32; 4],
    shape: [f32; 4],
    grid: [f32; 4],
}

#[derive(Clone, Copy)]
struct Edge {
    above: [f32; 3],
    below: [f32; 3],
    birth: f32,
}

struct Ring {
    buffer: wgpu::Buffer,
    group: wgpu::BindGroup,
    blend: usize,
    ends: Vec<f32>,
    head: usize,
    live: usize,
    staged: Vec<Segment>,
    tail: Vec<Segment>,
}

struct Running {
    record: u32,
    last: Option<Edge>,
    previous: Option<([f32; 3], [f32; 3])>,
    owed: f32,
    seen: u64,
}

pub(super) struct Ribbons {
    pipelines: Vec<wgpu::RenderPipeline>,
    ring_layout: wgpu::BindGroupLayout,
    records_buffer: wgpu::Buffer,
    records: Vec<Record>,
    epochs: Vec<u32>,
    free: Vec<u32>,
    rings: Vec<Ring>,
    ring_ids: HashMap<(String, usize), usize>,
    strip_ring: Option<usize>,
    running: HashMap<(u32, u32), Running>,
    released: Vec<u32>,
    /// Whether a record changed since the table was last uploaded.
    changed: bool,
    generation: u64,
    tick: Tick,
    /// The share of each emitter's edges laid, from the graphics preset.
    pub(super) density: f32,
    pub(super) problems: Vec<String>,
}

fn storage() -> wgpu::BindingType {
    wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Storage { read_only: true }, has_dynamic_offset: false, min_binding_size: None }
}

fn blend_index(filter: Filter) -> usize {
    match filter {
        Filter::Additive | Filter::AddAlpha => 1,
        Filter::Modulate => 2,
        Filter::Modulate2x => 3,
        Filter::Opaque | Filter::Cutout | Filter::Blend => 0,
    }
}

fn placed(matrix: &Mat4, point: [f32; 3]) -> [f32; 3] {
    std::array::from_fn(|row| matrix[row] * point[0] + matrix[4 + row] * point[1] + matrix[8 + row] * point[2] + matrix[12 + row])
}

fn mix(from: [f32; 3], to: [f32; 3], at: f32) -> [f32; 3] {
    std::array::from_fn(|axis| from[axis] + (to[axis] - from[axis]) * at)
}

fn distance(from: [f32; 3], to: [f32; 3]) -> f32 {
    (0..3).map(|axis| (to[axis] - from[axis]).powi(2)).sum::<f32>().sqrt()
}

fn segment(from: Edge, to: Edge, record: u32, epoch: u32) -> Segment {
    Segment {
        from_above_and_birth: [from.above[0], from.above[1], from.above[2], from.birth],
        from_below_and_birth: [from.below[0], from.below[1], from.below[2], to.birth],
        to_above_and_record: [to.above[0], to.above[1], to.above[2], f32::from_bits(record)],
        to_below_and_epoch: [to.below[0], to.below[1], to.below[2], f32::from_bits(epoch)],
    }
}

impl Ribbons {
    pub(super) fn new(device: &wgpu::Device, format: wgpu::TextureFormat, particles: &Particles, samples: u32) -> Self {
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("ribbons"), source: wgpu::ShaderSource::Wgsl(include_str!("ribbon.wgsl").into()) });
        let ring_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("ribbon ring"),
            entries: &[
                entry(0, wgpu::ShaderStages::VERTEX, storage()),
                entry(1, wgpu::ShaderStages::FRAGMENT, wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: true }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false }),
                entry(2, wgpu::ShaderStages::FRAGMENT, wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering)),
                entry(3, wgpu::ShaderStages::VERTEX, storage()),
            ],
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: Some("ribbons"), bind_group_layouts: &[Some(particles.frame_layout()), Some(&ring_layout)], immediate_size: 0 });
        let pipelines = BLENDS
            .iter()
            .map(|&filter| {
                device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                    label: Some("ribbons"),
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
                    multisample: wgpu::MultisampleState { count: samples, mask: !0, alpha_to_coverage_enabled: false },
                    multiview_mask: None,
                    cache: None,
                })
            })
            .collect();
        let records_buffer = device.create_buffer(&wgpu::BufferDescriptor { label: Some("ribbon records"), size: (RECORDS * size_of::<Record>()) as u64, usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
        Self {
            pipelines,
            ring_layout,
            records_buffer,
            records: vec![Record::zeroed(); STRIPS],
            epochs: vec![0; RECORDS],
            free: (STRIPS as u32..RECORDS as u32).rev().collect(),
            rings: Vec::new(),
            ring_ids: HashMap::new(),
            strip_ring: None,
            running: HashMap::new(),
            released: Vec::new(),
            changed: false,
            generation: 0,
            tick: Tick::default(),
            density: 1.0,
            problems: Vec::new(),
        }
    }

    /// The ring a ribbon painted with `texture` (its lowercase path and view) and `filter` draws into, made on first use.
    pub(super) fn register(&mut self, device: &wgpu::Device, filter: Filter, texture: (&str, &wgpu::TextureView), sampler: &wgpu::Sampler) -> usize {
        let blend = blend_index(filter);
        let key = (texture.0.to_ascii_lowercase(), blend);
        if let Some(&ring) = self.ring_ids.get(&key) {
            return ring;
        }
        let buffer = device.create_buffer(&wgpu::BufferDescriptor { label: Some("ribbons"), size: ((RING + TAIL) * size_of::<Segment>()) as u64, usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
        let group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("ribbons"),
            layout: &self.ring_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: buffer.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(texture.1) },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(sampler) },
                wgpu::BindGroupEntry { binding: 3, resource: self.records_buffer.as_entire_binding() },
            ],
        });
        self.rings.push(Ring { buffer, group, blend, ends: vec![f32::NEG_INFINITY; RING], head: 0, live: 0, staged: Vec::new(), tail: Vec::new() });
        self.ring_ids.insert(key, self.rings.len() - 1);
        self.rings.len() - 1
    }

    /// Starts a scene at `tick`; a restarted clock drops every strip.
    pub(super) fn begin(&mut self, tick: Tick) {
        self.generation += 1;
        self.tick = tick;
        if tick.restarted {
            for state in std::mem::take(&mut self.running).into_values() {
                self.release(state.record);
            }
            for ring in &mut self.rings {
                ring.live = 0;
                ring.staged.clear();
            }
        }
        for ring in &mut self.rings {
            ring.tail.clear();
        }
    }

    fn release(&mut self, record: u32) {
        let at = record as usize;
        self.epochs[at] = self.epochs[at].wrapping_add(1);
        if let Some(slot) = self.records.get_mut(at) {
            *slot = Record::zeroed();
            slot.grid[2] = f32::from_bits(self.epochs[at]);
        }
        self.free.push(record);
        self.changed = true;
    }

    /// Runs emitter `index` of the pose with game handle `id` for the time since the last scene: lays the edges it owes into `ring` and keeps its record current. `world` places its node in the world; `alpha` is the pose's.
    pub(super) fn emit(&mut self, (id, index): (u32, usize), ring: usize, ribbon: &ModelRibbon, sample: &RibbonSample, world: &Mat4, alpha: f32) {
        let scale = (world[0] * world[0] + world[1] * world[1] + world[2] * world[2]).sqrt();
        if scale < PARKED_SCALE {
            return;
        }
        let key = (id, index as u32);
        if !self.running.contains_key(&key) {
            let Some(record) = self.free.pop() else {
                self.problems.push("more running ribbon emitters than the window has room for".into());
                return;
            };
            self.running.insert(key, Running { record, last: None, previous: None, owed: 1.0, seen: 0 });
        }
        let Tick { now, step, .. } = self.tick;
        let Some(state) = self.running.get_mut(&key) else { return };
        state.seen = self.generation;
        let record = state.record;
        let epoch = self.epochs[record as usize];
        let flags = (u32::from(blend_index(ribbon.filter) == 1) * ADDITIVE) | (u32::from(ribbon.filter == Filter::Cutout) * KEYED);
        let at = record as usize;
        if self.records.len() <= at {
            self.records.resize(at + 1, Record::zeroed());
        }
        self.changed = true;
        self.records[at] = Record {
            color: [sample.color[0], sample.color[1], sample.color[2], sample.alpha * alpha],
            shape: [ribbon.life_span, ribbon.gravity * scale, sample.slot as f32, flags as f32],
            grid: [ribbon.rows as f32, ribbon.columns as f32, f32::from_bits(epoch), 0.0],
        };
        let above = placed(world, [ribbon.pivot[0], ribbon.pivot[1] + sample.above, ribbon.pivot[2]]);
        let below = placed(world, [ribbon.pivot[0], ribbon.pivot[1] - sample.below, ribbon.pivot[2]]);
        if !sample.visible {
            (state.last, state.previous, state.owed) = (None, None, 1.0);
            return;
        }
        if state.previous.is_some_and(|(was, _)| distance(was, above) > JUMP) {
            (state.last, state.previous, state.owed) = (None, None, 1.0);
        }
        let ring = &mut self.rings[ring];
        if step > 0.0 || state.last.is_none() {
            state.owed += ribbon.emission_rate * self.density * step;
            let due = (state.owed as u32).min(EDGES_PER_STEP);
            state.owed = (state.owed - due as f32).min(1.0);
            let (from_above, from_below) = state.previous.unwrap_or((above, below));
            for born in 1..=due {
                let along = born as f32 / due as f32;
                let edge = Edge { above: mix(from_above, above, along), below: mix(from_below, below, along), birth: now - step * (1.0 - along) };
                if let Some(last) = state.last {
                    ring.staged.push(segment(last, edge, record, epoch));
                }
                state.last = Some(edge);
            }
            state.previous = Some((above, below));
        }
        if let Some(last) = state.last.filter(|last| last.birth < now) {
            if ring.tail.len() < TAIL {
                ring.tail.push(segment(last, Edge { above, below, birth: now }, record, epoch));
            }
        }
    }

    /// Lays the map's own strips for this scene into the strip ring, which paints with `white`.
    pub(super) fn strips(&mut self, device: &wgpu::Device, strips: &[StripPose], white: &wgpu::TextureView, sampler: &wgpu::Sampler) {
        if strips.is_empty() {
            return;
        }
        let ring = match self.strip_ring {
            Some(ring) => ring,
            None => {
                let ring = self.register(device, Filter::Additive, ("", white), sampler);
                self.strip_ring = Some(ring);
                ring
            }
        };
        if strips.len() > STRIPS {
            self.problems.push(format!("{} ribbon strips in one scene; the first {STRIPS} draw", strips.len()));
        }
        for (index, strip) in strips.iter().take(STRIPS).enumerate() {
            let epoch = self.epochs[index];
            self.changed = true;
            self.records[index] = Record { color: [strip.color[0], strip.color[1], strip.color[2], 1.0], shape: [1.0, 0.0, 0.0, (STRIP | ADDITIVE) as f32], grid: [1.0, 1.0, f32::from_bits(epoch), 0.0] };
            let edges = &strip.edges[..strip.edges.len().min(STRIP_EDGES)];
            for pair in edges.windows(2) {
                let edge = |values: &[f32; 7]| Edge { above: [values[0], values[1], values[2]], below: [values[3], values[4], values[5]], birth: values[6] };
                let tail = &mut self.rings[ring].tail;
                if tail.len() < TAIL {
                    tail.push(segment(edge(&pair[0]), edge(&pair[1]), index as u32, epoch));
                }
            }
        }
    }

    /// Ends a scene: gives up the records of emitters that were not run, uploads the edges laid and the tails, and the records.
    pub(super) fn finish(&mut self, queue: &wgpu::Queue) {
        let generation = self.generation;
        let mut released = std::mem::take(&mut self.released);
        self.running.retain(|_, state| {
            let kept = state.seen == generation;
            if !kept {
                released.push(state.record);
            }
            kept
        });
        for record in released.drain(..) {
            self.release(record);
        }
        self.released = released;
        let now = self.tick.now;
        for ring in &mut self.rings {
            let staged = ring.staged.len().min(RING);
            let fresh = &ring.staged[ring.staged.len() - staged..];
            let first = staged.min(RING - ring.head);
            queue.write_buffer(&ring.buffer, (ring.head * size_of::<Segment>()) as u64, bytemuck::cast_slice(&fresh[..first]));
            if first < staged {
                queue.write_buffer(&ring.buffer, 0, bytemuck::cast_slice(&fresh[first..]));
            }
            for (at, quad) in fresh.iter().enumerate() {
                let life = self.records.get(quad.to_above_and_record[3].to_bits() as usize).map_or(0.0, |record| record.shape[0]);
                ring.ends[(ring.head + at) % RING] = quad.from_below_and_birth[3] + life;
            }
            ring.head = (ring.head + staged) % RING;
            ring.live = (ring.live + staged).min(RING);
            ring.staged.clear();
            while ring.live > 0 && ring.ends[(ring.head + RING - ring.live) % RING] < now {
                ring.live -= 1;
            }
            if !ring.tail.is_empty() {
                queue.write_buffer(&ring.buffer, (RING * size_of::<Segment>()) as u64, bytemuck::cast_slice(&ring.tail));
            }
        }
        if std::mem::take(&mut self.changed) {
            queue.write_buffer(&self.records_buffer, 0, bytemuck::cast_slice(&self.records));
        }
    }

    /// Draws every ring's live quads and its tail, after the particles, with the particles' frame bound.
    pub(super) fn draw<'a>(&'a self, pass: &mut wgpu::RenderPass<'a>, particles: &'a Particles) {
        let mut bound = false;
        for ring in self.rings.iter().filter(|ring| ring.live > 0 || !ring.tail.is_empty()) {
            if !std::mem::replace(&mut bound, true) {
                pass.set_bind_group(0, particles.frame_group(), &[]);
            }
            pass.set_pipeline(&self.pipelines[ring.blend]);
            pass.set_bind_group(1, &ring.group, &[]);
            let first = (ring.head + RING - ring.live) % RING;
            if ring.live > 0 {
                if first < ring.head {
                    pass.draw(0..6, first as u32..ring.head as u32);
                } else {
                    pass.draw(0..6, first as u32..RING as u32);
                    pass.draw(0..6, 0..ring.head as u32);
                }
            }
            if !ring.tail.is_empty() {
                pass.draw(0..6, RING as u32..(RING + ring.tail.len()) as u32);
            }
        }
    }
}
