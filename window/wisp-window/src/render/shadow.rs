//! The stage light's shadow map: an orthographic depth view down the light, fitted to the camera's frustum slice so a fighter's shadow lands on the stage.

use std::mem::size_of;

use bytemuck::Zeroable;

use super::math::{multiply, Mat4, IDENTITY};
use super::pipelines;
use super::uniforms::{FrameUniform, SceneFrame, Sun};
use super::{GpuModel, Group};

pub(super) const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;

/// How far toward the light a caster can stand and still shadow the slice.
const CASTER_REACH: f32 = 6000.0;
/// The map's square covers a whole number of these, so its texels sit on a fixed grid while the camera pans.
const SNAP: f32 = 64.0;

fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

fn normalized(v: [f32; 3]) -> [f32; 3] {
    let length = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    if length > 0.0 { [v[0] / length, v[1] / length, v[2] / length] } else { [0.0, 0.0, 1.0] }
}

/// World to light space with z along `toward`, as host/browser/passes.ts's `basis`.
fn light_view(toward: [f32; 3]) -> Mat4 {
    let forward = normalized(toward);
    let up = if forward[2].abs() > 0.99 { [0.0, 1.0, 0.0] } else { [0.0, 0.0, 1.0] };
    let x = normalized(cross(up, forward));
    let y = cross(forward, x);
    let mut out = IDENTITY;
    for axis in 0..3 {
        out[axis * 4] = x[axis];
        out[axis * 4 + 1] = y[axis];
        out[axis * 4 + 2] = forward[axis];
    }
    out
}

/// Light-space box (x, y) to wgpu clip space, with the light-space heights `highest` down to `lowest` mapped to depths 0 to 1, so what is nearer the light is smaller.
fn orthographic(left: f32, right: f32, bottom: f32, top: f32, highest: f32, lowest: f32) -> Mat4 {
    let mut out = [0.0; 16];
    out[0] = 2.0 / (right - left);
    out[5] = 2.0 / (top - bottom);
    out[10] = -1.0 / (highest - lowest);
    out[12] = -(right + left) / (right - left);
    out[13] = -(top + bottom) / (top - bottom);
    out[14] = highest / (highest - lowest);
    out[15] = 1.0;
    out
}

fn transform(m: &Mat4, p: [f32; 3]) -> [f32; 3] {
    [0, 1, 2].map(|row| m[row] * p[0] + m[4 + row] * p[1] + m[8 + row] * p[2] + m[12 + row])
}

/// World units of penumbra per world unit between a caster and what it shades: a sun some four degrees wide, broader than the real one so the edge reads at match zoom.
pub(super) const LIGHT_TAN: f32 = 0.07;

/// How many taps filter the shadow edge: the map's size sets the budget, since a smaller map is the cheaper preset.
fn taps(map: u32) -> f32 {
    match map {
        0..=1024 => 8.0,
        1025..=2048 => 16.0,
        _ => 24.0,
    }
}

/// The view-projection of the sun looking along `-toward` over the camera's slice, `corners` from `Camera::sun_corners`.
pub(super) fn sun(corners: [[f32; 3]; 8], toward: [f32; 3], map: u32) -> Sun {
    let view = light_view(toward);
    let local = corners.map(|corner| transform(&view, corner));
    let extent = |axis: usize| local.iter().fold((f32::MAX, f32::MIN), |(low, high), point| (low.min(point[axis]), high.max(point[axis])));
    let ((x_low, x_high), (y_low, y_high), (z_low, z_high)) = (extent(0), extent(1), extent(2));
    let side = ((x_high - x_low).max(y_high - y_low) / SNAP).ceil().max(1.0) * SNAP;
    let texel = side / map as f32;
    let snap = |centre: f32| (centre / texel).round() * texel;
    let (cx, cy) = (snap((x_low + x_high) * 0.5), snap((y_low + y_high) * 0.5));
    let (highest, lowest) = (z_high + CASTER_REACH, z_low);
    let projection = orthographic(cx - side * 0.5, cx + side * 0.5, cy - side * 0.5, cy + side * 0.5, highest, lowest);
    Sun { view_projection: multiply(&projection, &view), texel: 1.0 / map as f32, offset: texel * 0.5, texel_world: texel, depth_range: highest - lowest, light_tan: LIGHT_TAN, taps: taps(map) }
}


/// The sun's depth map with the pipeline and bindings that draw into it, and the comparison sampler the model shader reads it through.
pub(super) struct Shadow {
    /// Texels a side, or zero when the graphics settings draw no shadows.
    pub side: u32,
    pub view: wgpu::TextureView,
    pub compare: wgpu::Sampler,
    pub frame: wgpu::Buffer,
    pub layout: wgpu::BindGroupLayout,
    pub pipeline: wgpu::RenderPipeline,
    group: wgpu::BindGroup,
}

fn entry(binding: u32, buffer: &wgpu::Buffer) -> wgpu::BindGroupEntry<'_> {
    wgpu::BindGroupEntry { binding, resource: buffer.as_entire_binding() }
}

impl Shadow {
    pub fn new(device: &wgpu::Device, layer_layout: &wgpu::BindGroupLayout, buffers: [&wgpu::Buffer; 3], side: u32) -> Self {
        let view = map(device, side);
        let compare = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("sun compare"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            compare: Some(wgpu::CompareFunction::LessEqual),
            ..Default::default()
        });
        let frame = device.create_buffer(&wgpu::BufferDescriptor { label: Some("shadow frame"), size: size_of::<SceneFrame>() as u64, usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
        let (layout, pipeline) = pipelines::shadow(device, layer_layout);
        let group = Self::bind(device, &layout, &frame, buffers);
        Self { side, view, compare, frame, layout, pipeline, group }
    }

    fn bind(device: &wgpu::Device, layout: &wgpu::BindGroupLayout, frame: &wgpu::Buffer, buffers: [&wgpu::Buffer; 3]) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor { label: Some("shadow frame"), layout, entries: &[entry(0, frame), entry(1, buffers[0]), entry(2, buffers[1]), entry(3, buffers[2])] })
    }

    /// The map and its comparison sampler, as `frame_group` binds them.
    pub fn bound(&self) -> (&wgpu::TextureView, &wgpu::Sampler) {
        (&self.view, &self.compare)
    }

    pub fn rebind(&mut self, device: &wgpu::Device, buffers: [&wgpu::Buffer; 3]) {
        self.group = Self::bind(device, &self.layout, &self.frame, buffers);
    }

    pub fn resize(&mut self, device: &wgpu::Device, side: u32) {
        self.side = side;
        self.view = map(device, side);
    }

    pub fn write(&self, queue: &wgpu::Queue, sun: &Sun) {
        let frame = SceneFrame { base: FrameUniform { view_projection: sun.view_projection, ..FrameUniform::zeroed() }, ..SceneFrame::zeroed() };
        queue.write_buffer(&self.frame, 0, bytemuck::bytes_of(&frame));
    }

    /// Draws every solid layer of every group into the depth map.
    pub fn draw(&self, encoder: &mut wgpu::CommandEncoder, models: &[GpuModel], groups: &[Group], instances: &wgpu::Buffer) {
        let mut pass = encoder
            .begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("sun"),
                color_attachments: &[],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment { view: &self.view, depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(1.0), store: wgpu::StoreOp::Store }), stencil_ops: None }),
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            })
            .forget_lifetime();
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.group, &[]);
        for group in groups {
            let model = &models[group.model];
            pass.set_vertex_buffer(0, model.vertices.slice(..));
            pass.set_vertex_buffer(1, instances.slice(..));
            pass.set_index_buffer(model.indices.slice(..), wgpu::IndexFormat::Uint32);
            for draw in model.draws.iter().filter(|draw| draw.filter.writes_depth()) {
                let Some(layer) = &draw.bind_group else { continue };
                pass.set_bind_group(1, layer, &[]);
                pass.draw_indexed(draw.first_index..draw.first_index + draw.index_count, 0, group.first..group.first + group.count);
            }
        }
    }
}

impl super::Renderer {
    /// Follows the graphics settings: a different map size remakes the depth map and the groups that bind it, and zero draws no shadows.
    pub(super) fn set_shadow_side(&mut self, side: u32) {
        if side == self.shadow.side {
            return;
        }
        self.shadow.resize(&self.device, side);
        self.bind_frames();
    }
}

fn map(device: &wgpu::Device, side: u32) -> wgpu::TextureView {
    device
        .create_texture(&wgpu::TextureDescriptor {
            label: Some("sun depth"),
            size: wgpu::Extent3d { width: side.max(1), height: side.max(1), depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        })
        .create_view(&Default::default())
}
