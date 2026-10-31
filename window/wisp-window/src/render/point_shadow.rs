//! Point lights and the shadows of the few strongest: each frame the omni lights of the posed models are ranked by brightness and distance from the camera, the best `Features::point_shadows` get a cube depth map of the distance to the nearest caster, and every lit light up to `MAX_LIT` shades what it reaches.

use std::mem::size_of;

use bytemuck::{Pod, Zeroable};

use super::math::{multiply, Mat4, IDENTITY};
use super::pipelines;
use super::uniforms::{PointLights, SceneFrame, MAX_LIT};
use super::{GpuModel, Group};

const FACES: usize = 6;
pub(super) const MAX_SHADOWED: usize = 4;
const NEAR: f32 = 8.0;
/// A light that holds a shadow map keeps it until another outscores it by this factor, so two lights close in rank do not trade places from frame to frame.
const KEEP: f32 = 1.25;

/// A cube face's side in texels.
const FACE_SIDE: u32 = 512;

/// One omni light of one posed model.
#[derive(Clone, Copy, Debug)]
pub(super) struct Light {
    /// The same light from one frame to the next: its model's game handle and its place in the model.
    pub key: u64,
    pub position: [f32; 3],
    pub start: f32,
    pub end: f32,
    pub color: [f32; 3],
    /// The instance whose model carries the light; it casts none of the light's shadows, because the light sits inside it.
    pub owner: u32,
}

impl Light {
    /// How much the light matters to the camera: its brightness, less the further it is from the eye in lengths of its own reach.
    pub fn score(&self, eye: [f32; 3]) -> f32 {
        let brightness = self.color[0].max(self.color[1]).max(self.color[2]);
        let away = (0..3).map(|axis| (self.position[axis] - eye[axis]).powi(2)).sum::<f32>().sqrt() / self.end.max(1.0);
        brightness / (1.0 + away * away)
    }
}

/// Which lights hold a shadow map, remembered across frames.
#[derive(Default)]
pub(super) struct Selector {
    held: Vec<u64>,
}

impl Selector {
    /// The candidates in the order they are used: the `shadowed` that hold maps first, then the rest by score. A light that held a map last frame counts `KEEP` times its score.
    pub fn choose(&mut self, candidates: &[(u64, f32)], shadowed: usize) -> Vec<usize> {
        let boosted = |index: usize| candidates[index].1 * if self.held.contains(&candidates[index].0) { KEEP } else { 1.0 };
        let by = |score: &dyn Fn(usize) -> f32| {
            let mut order: Vec<usize> = (0..candidates.len()).collect();
            order.sort_by(|&a, &b| score(b).total_cmp(&score(a)).then(candidates[a].0.cmp(&candidates[b].0)));
            order
        };
        let mut order = by(&boosted);
        order[shadowed.min(candidates.len())..].sort_by(|&a, &b| candidates[b].1.total_cmp(&candidates[a].1).then(candidates[a].0.cmp(&candidates[b].0)));
        self.held = order.iter().take(shadowed).map(|&index| candidates[index].0).collect();
        order
    }
}

/// The matrix that puts a world point on face `face` of a cube map centred on `light`, in the layout Vulkan, Direct3D and Metal share: clip x and y are the face's s and t, clip w the major axis, and depth runs from `NEAR` to `end`.
pub(super) fn face_matrix(light: [f32; 3], end: f32, face: usize) -> Mat4 {
    let (x, y, w): ([f32; 3], [f32; 3], [f32; 3]) = match face {
        0 => ([0.0, 0.0, -1.0], [0.0, 1.0, 0.0], [1.0, 0.0, 0.0]),
        1 => ([0.0, 0.0, 1.0], [0.0, 1.0, 0.0], [-1.0, 0.0, 0.0]),
        2 => ([1.0, 0.0, 0.0], [0.0, 0.0, -1.0], [0.0, 1.0, 0.0]),
        3 => ([1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.0, -1.0, 0.0]),
        4 => ([1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]),
        _ => ([-1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, -1.0]),
    };
    let span = end - NEAR;
    let (depth_scale, depth_shift) = (end / span, -end * NEAR / span);
    let z = w.map(|component| component * depth_scale);
    let behind = |row: [f32; 3]| -(row[0] * light[0] + row[1] * light[1] + row[2] * light[2]);
    let mut out = IDENTITY;
    for (row, (values, shift)) in [(x, behind(x)), (y, behind(y)), (z, behind(z) + depth_shift), (w, behind(w))].into_iter().enumerate() {
        for column in 0..3 {
            out[column * 4 + row] = values[column];
        }
        out[12 + row] = shift;
    }
    out
}

pub(super) struct Maps<'a> {
    pub sun: &'a wgpu::TextureView,
    pub compare: &'a wgpu::Sampler,
    pub points: &'a wgpu::TextureView,
}

pub(super) struct Points {
    /// Lights with a cube, from the graphics settings.
    pub capacity: usize,
    side: u32,
    cube: wgpu::TextureView,
    faces: Vec<wgpu::TextureView>,
    frames: Vec<wgpu::Buffer>,
    groups: Vec<wgpu::BindGroup>,
    pipeline: wgpu::RenderPipeline,
    selector: Selector,
    shadowed: Vec<Light>,
    /// The lights lit this frame, shadowed first.
    pub lit: usize,
    pub candidates: Vec<Light>,
}

fn texture(device: &wgpu::Device, lights: usize, side: u32) -> (wgpu::TextureView, Vec<wgpu::TextureView>) {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("point depth"),
        size: wgpu::Extent3d { width: side, height: side, depth_or_array_layers: (lights.max(1) * FACES) as u32 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: super::shadow::FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    });
    let cube = texture.create_view(&wgpu::TextureViewDescriptor { dimension: Some(wgpu::TextureViewDimension::CubeArray), ..Default::default() });
    let faces = (0..lights * FACES)
        .map(|layer| texture.create_view(&wgpu::TextureViewDescriptor { dimension: Some(wgpu::TextureViewDimension::D2), base_array_layer: layer as u32, array_layer_count: Some(1), ..Default::default() }))
        .collect();
    (cube, faces)
}

fn pipeline(device: &wgpu::Device, frame_layout: &wgpu::BindGroupLayout, layer_layout: &wgpu::BindGroupLayout) -> wgpu::RenderPipeline {
    let source = format!("{}\n{}", include_str!("shader.wgsl"), include_str!("point_shadow.wgsl"));
    let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("point shadow"), source: wgpu::ShaderSource::Wgsl(pipelines::shader_source(&source).into()) });
    let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: Some("point shadow"), bind_group_layouts: &[Some(frame_layout), Some(layer_layout)], immediate_size: 0 });
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("point shadow"),
        layout: Some(&layout),
        vertex: wgpu::VertexState {
            module: &module,
            entry_point: Some("point_shadow_vertex"),
            compilation_options: Default::default(),
            buffers: &[
                Some(wgpu::VertexBufferLayout { array_stride: size_of::<super::Vertex>() as u64, step_mode: wgpu::VertexStepMode::Vertex, attributes: &pipelines::VERTEX_ATTRIBUTES }),
                Some(wgpu::VertexBufferLayout { array_stride: size_of::<super::Instance>() as u64, step_mode: wgpu::VertexStepMode::Instance, attributes: &pipelines::INSTANCE_ATTRIBUTES }),
            ],
        },
        fragment: Some(wgpu::FragmentState { module: &module, entry_point: Some("point_shadow_fragment"), compilation_options: Default::default(), targets: &[] }),
        primitive: wgpu::PrimitiveState::default(),
        depth_stencil: Some(wgpu::DepthStencilState { format: super::shadow::FORMAT, depth_write_enabled: Some(true), depth_compare: Some(wgpu::CompareFunction::LessEqual), stencil: Default::default(), bias: Default::default() }),
        multisample: wgpu::MultisampleState::default(),
        multiview_mask: None,
        cache: None,
    })
}

impl Points {
    pub fn new(device: &wgpu::Device, frame_layout: &wgpu::BindGroupLayout, layer_layout: &wgpu::BindGroupLayout, buffers: [&wgpu::Buffer; 3], capacity: usize) -> Self {
        let capacity = capacity.min(MAX_SHADOWED);
        let side = if capacity == 0 { 1 } else { FACE_SIDE };
        let (cube, faces) = texture(device, capacity, side);
        let frames: Vec<wgpu::Buffer> = (0..capacity * FACES)
            .map(|_| device.create_buffer(&wgpu::BufferDescriptor { label: Some("point face"), size: size_of::<SceneFrame>() as u64, usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false }))
            .collect();
        let groups = Self::bind(device, frame_layout, &frames, buffers);
        Self { capacity, side, cube, faces, frames, groups, pipeline: pipeline(device, frame_layout, layer_layout), selector: Selector::default(), shadowed: Vec::new(), lit: 0, candidates: Vec::new() }
    }

    fn bind(device: &wgpu::Device, layout: &wgpu::BindGroupLayout, frames: &[wgpu::Buffer], buffers: [&wgpu::Buffer; 3]) -> Vec<wgpu::BindGroup> {
        fn bound(binding: u32, buffer: &wgpu::Buffer) -> wgpu::BindGroupEntry<'_> {
            wgpu::BindGroupEntry { binding, resource: buffer.as_entire_binding() }
        }
        frames.iter().map(|frame| device.create_bind_group(&wgpu::BindGroupDescriptor { label: Some("point face"), layout, entries: &[bound(0, frame), bound(1, buffers[0]), bound(2, buffers[1]), bound(3, buffers[2])] })).collect()
    }

    pub fn rebind(&mut self, device: &wgpu::Device, layout: &wgpu::BindGroupLayout, buffers: [&wgpu::Buffer; 3]) {
        self.groups = Self::bind(device, layout, &self.frames, buffers);
    }

    pub fn maps<'a>(&'a self, sun: &'a wgpu::TextureView, compare: &'a wgpu::Sampler) -> Maps<'a> {
        Maps { sun, compare, points: &self.cube }
    }

    /// Ranks the frame's candidate lights, gives the best `capacity` a cube and writes their faces' frames; the result is what the model shader reads.
    pub fn stage(&mut self, queue: &wgpu::Queue, eye: [f32; 3]) -> PointLights {
        let scored: Vec<(u64, f32)> = self.candidates.iter().map(|light| (light.key, light.score(eye))).collect();
        let order = self.selector.choose(&scored, self.capacity);
        let mut out = PointLights::zeroed();
        self.shadowed.clear();
        for (slot, &index) in order.iter().take(MAX_LIT).enumerate() {
            let light = self.candidates[index];
            out.position[slot] = [light.position[0], light.position[1], light.position[2], light.end];
            out.color[slot] = [light.color[0], light.color[1], light.color[2], light.start];
            if slot < self.capacity {
                self.shadowed.push(light);
                for face in 0..FACES {
                    let frame = SceneFrame { base: super::FrameUniform { view_projection: face_matrix(light.position, light.end, face), ..bytemuck::Zeroable::zeroed() }, eye: [light.position[0], light.position[1], light.position[2], 0.0], camera: [NEAR, light.end, 0.0, 0.0], ..SceneFrame::zeroed() };
                    queue.write_buffer(&self.frames[slot * FACES + face], 0, bytemuck::bytes_of(&frame));
                }
            }
        }
        self.lit = order.len().min(MAX_LIT);
        out.counts = [self.lit as f32, self.shadowed.len() as f32, 2.0 / self.side as f32, NEAR];
        out
    }

    /// Draws every solid layer of every group but the light's own instance into each face of each shadowed light's cube.
    pub fn draw(&self, encoder: &mut wgpu::CommandEncoder, models: &[GpuModel], groups: &[Group], instances: &wgpu::Buffer) {
        for (slot, light) in self.shadowed.iter().enumerate() {
            for face in 0..FACES {
                let mut pass = encoder
                    .begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some("point light"),
                        color_attachments: &[],
                        depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment { view: &self.faces[slot * FACES + face], depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(1.0), store: wgpu::StoreOp::Store }), stencil_ops: None }),
                        timestamp_writes: None,
                        occlusion_query_set: None,
                        multiview_mask: None,
                    })
                    .forget_lifetime();
                pass.set_pipeline(&self.pipeline);
                pass.set_bind_group(0, &self.groups[slot * FACES + face], &[]);
                for group in groups {
                    let model = &models[group.model];
                    pass.set_vertex_buffer(0, model.vertices.slice(..));
                    pass.set_vertex_buffer(1, instances.slice(..));
                    pass.set_index_buffer(model.indices.slice(..), wgpu::IndexFormat::Uint32);
                    let (end, owner) = (group.first + group.count, light.owner);
                    let ranges = if (group.first..end).contains(&owner) { [group.first..owner, owner + 1..end] } else { [group.first..end, 0..0] };
                    for draw in model.draws.iter().filter(|draw| draw.filter.writes_depth()) {
                        let Some(layer) = &draw.bind_group else { continue };
                        pass.set_bind_group(1, layer, &[]);
                        for range in ranges.iter().filter(|range| !range.is_empty()) {
                            pass.draw_indexed(draw.first_index..draw.first_index + draw.index_count, 0, range.clone());
                        }
                    }
                }
            }
        }
    }

    /// Lights lit this frame whose shadows are drawn, in the order of their cubes.
    #[cfg(test)]
    pub fn shadowed(&self) -> &[Light] {
        &self.shadowed
    }
}

impl super::Renderer {
    /// Follows the graphics settings: a different count of shadowed lights remakes the cube maps and the groups that bind them.
    pub(super) fn set_point_shadows(&mut self, capacity: usize) {
        if capacity.min(MAX_SHADOWED) == self.points.capacity {
            return;
        }
        self.points = Points::new(&self.device, &self.shadow.layout, &self.layer_layout, [&self.bone_buffer, &self.color_buffer, &self.uv_buffer], capacity);
        self.bind_frames();
    }

}

/// Adds the omni lights of one posed model to the frame's candidates.
pub(super) fn gather(candidates: &mut Vec<Light>, model: &GpuModel, pose: &super::Pose, bones: &[Mat4], index: usize, owner: u32) {
    for (number, light) in model.rig.lights().iter().enumerate() {
        let Some(bone) = bones.get(light.node) else { continue };
        let local = multiply(&pose.matrix, bone);
        let [x, y, z] = light.pivot;
        let position = [0, 1, 2].map(|row| local[row] * x + local[4 + row] * y + local[8 + row] * z + local[12 + row]);
        let key = if pose.id != 0 { u64::from(pose.id) << 16 } else { (1 << 48) | ((index as u64) << 16) } | number as u64;
        candidates.push(Light { key, position, start: light.start, end: light.end, color: light.color, owner });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(order: &[usize], candidates: &[(u64, f32)]) -> Vec<u64> {
        order.iter().map(|&index| candidates[index].0).collect()
    }

    #[test]
    fn the_best_lights_hold_the_maps_and_the_rest_cast_none() {
        let mut selector = Selector::default();
        let candidates = [(1, 0.2), (2, 0.9), (3, 0.5), (4, 0.7)];
        let order = selector.choose(&candidates, 2);
        assert_eq!(keys(&order, &candidates), vec![2, 4, 3, 1]);
        assert_eq!(selector.choose(&candidates, 0).len(), 4, "with no maps every light is still lit");
        assert_eq!(selector.held, Vec::<u64>::new());
    }

    #[test]
    fn two_lights_close_in_rank_do_not_trade_places_from_frame_to_frame() {
        let mut selector = Selector::default();
        let mut held = Vec::new();
        for frame in 0..200 {
            let wobble = (frame as f32 * 0.7).sin() * 0.08;
            let candidates = [(1, 1.0 + wobble), (2, 1.0 - wobble), (3, 0.1)];
            let order = selector.choose(&candidates, 1);
            held.push(candidates[order[0]].0);
        }
        assert!(held.windows(2).all(|pair| pair[0] == pair[1]), "the held light never changed: {held:?}");
    }

    #[test]
    fn a_light_that_clearly_outranks_the_held_one_takes_the_map() {
        let mut selector = Selector::default();
        assert_eq!(selector.choose(&[(1, 1.0), (2, 0.9)], 1)[0], 0);
        assert_eq!(selector.choose(&[(1, 1.0), (2, 1.4)], 1)[0], 1, "a light 40% brighter takes over");
        assert_eq!(selector.choose(&[(1, 1.0), (2, 1.3)], 1)[0], 1, "and keeps it when the margin shrinks inside the hysteresis");
    }

    #[test]
    fn brightness_and_nearness_rank_a_light() {
        let light = |x: f32, brightness: f32| Light { key: 0, position: [x, 0.0, 0.0], start: 50.0, end: 400.0, color: [brightness; 3], owner: 0 };
        let eye = [0.0; 3];
        assert!(light(100.0, 1.0).score(eye) > light(900.0, 1.0).score(eye));
        assert!(light(100.0, 2.0).score(eye) > light(100.0, 1.0).score(eye));
    }

    #[test]
    fn a_face_matrix_puts_a_point_along_its_axis_in_the_middle_of_the_face_at_the_depth_of_its_distance() {
        let light = [10.0, -20.0, 5.0];
        for (face, axis, sign) in [(0, 0, 1.0), (1, 0, -1.0), (2, 1, 1.0), (3, 1, -1.0), (4, 2, 1.0), (5, 2, -1.0)] {
            let mut point = light;
            point[axis] += sign * 100.0;
            let m = face_matrix(light, 500.0, face);
            let clip = [0, 1, 2, 3].map(|row| m[row] * point[0] + m[4 + row] * point[1] + m[8 + row] * point[2] + m[12 + row]);
            assert!(clip[0].abs() < 1e-3 && clip[1].abs() < 1e-3, "face {face} centres the axis: {clip:?}");
            assert!((clip[3] - 100.0).abs() < 1e-3, "face {face} has the axis distance as w: {clip:?}");
            let depth = clip[2] / clip[3];
            assert!((0.0..1.0).contains(&depth), "face {face} depth {depth}");
        }
    }
}
