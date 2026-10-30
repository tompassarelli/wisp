//! SPRITE frames: a model drawn into the rectangle of a UI frame.
//!
//! Each sprite renders into its own multisampled target the size of its rectangle in screen pixels, so the picture is crisp at the window's
//! resolution, then the UI pass draws the resolved texture as an image quad at its level. A sprite is drawn again only when its pose, its
//! size or the light changes, so a held portrait costs one draw.

use serde::Deserialize;

use super::gpu::{bone_storage, frame_group, instance_storage, opacity_storage, uv_storage};
use super::math::{Mat4, IDENTITY};
use super::scene::{Camera, Light, Scene};
use super::{Instance, Renderer, DEPTH, HDR, SAMPLES};

const MARGIN: f32 = 1.06;
const DISTANCE_PER_EXTENT: f32 = 4.0;
const TURN: f32 = 20.0 * std::f32::consts::PI / 180.0;
const KEY: [f32; 3] = [0.75; 3];
const AMBIENT: [f32; 3] = [0.55; 3];

/// One model pose for a sprite: the sequence and frame to show, the team colour and the box the camera fits.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Shot {
    pub model: String,
    pub sequence: i32,
    pub frame: f32,
    pub clock: f32,
    pub bounds: [f32; 6],
    #[serde(default = "white")]
    pub team: [f32; 3],
}

fn white() -> [f32; 3] {
    [1.0; 3]
}

#[derive(Clone, PartialEq)]
struct Drawn {
    shot: Shot,
    light: Option<([f32; 3], [f32; 3])>,
}

pub(super) struct Slot {
    size: (u32, u32),
    msaa: wgpu::TextureView,
    depth: wgpu::TextureView,
    resolved: wgpu::TextureView,
    frame: wgpu::Buffer,
    bones: wgpu::Buffer,
    bone_capacity: usize,
    opacities: wgpu::Buffer,
    uv_rows: wgpu::Buffer,
    opacity_capacity: usize,
    instance: wgpu::Buffer,
    group: wgpu::BindGroup,
    drawn: Option<Drawn>,
}

fn subtract(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn unit(a: [f32; 3]) -> [f32; 3] {
    let length = dot(a, a).sqrt().max(1e-6);
    [a[0] / length, a[1] / length, a[2] / length]
}

/// The view matrix of a camera at `eye` looking at `target` with +Z up, column-major as the renderer's other matrices.
fn look_at(eye: [f32; 3], target: [f32; 3]) -> Mat4 {
    let forward = unit(subtract(target, eye));
    let right = unit(cross(forward, [0.0, 0.0, 1.0]));
    let up = cross(right, forward);
    let mut out = IDENTITY;
    for (row, axis) in [right, up, [-forward[0], -forward[1], -forward[2]]].into_iter().enumerate() {
        out[row] = axis[0];
        out[4 + row] = axis[1];
        out[8 + row] = axis[2];
        out[12 + row] = -dot(axis, eye);
    }
    out
}

/// The camera and light that frame `bounds` front-on, turned a little toward image left, so its tallest or widest side fills `aspect` with a margin.
fn framing(bounds: [f32; 6], aspect: f32, light: Option<&Light>) -> (Camera, Light) {
    let low = [bounds[0], bounds[1], bounds[2]];
    let high = [bounds[3], bounds[4], bounds[5]];
    let centre = [(low[0] + high[0]) / 2.0, (low[1] + high[1]) / 2.0, (low[2] + high[2]) / 2.0];
    let height = (high[2] - low[2]).max(1.0);
    let width = (high[1] - low[1]).max(high[0] - low[0]).max(1.0);
    let distance = DISTANCE_PER_EXTENT * height.max(width);
    let reach = ((high[0] - low[0]).hypot(high[1] - low[1]) / 2.0).min(distance / 2.0);
    let half = (height / 2.0).max(width / (2.0 * aspect)) * MARGIN * distance / (distance - reach);
    let toward_camera = [TURN.cos(), TURN.sin(), 0.0];
    let eye = [centre[0] + toward_camera[0] * distance, centre[1] + toward_camera[1] * distance, centre[2]];
    let view = look_at(eye, centre);
    let right = [view[0], view[4], view[8]];
    let up = [view[1], view[5], view[9]];
    let toward = unit([toward_camera[0] * 0.8 - right[0] * 0.45 + up[0] * 0.5, toward_camera[1] * 0.8 - right[1] * 0.45 + up[1] * 0.5, toward_camera[2] * 0.8 - right[2] * 0.45 + up[2] * 0.5]);
    let (key, ambient) = light.map_or((KEY, AMBIENT), |light| (light.key, light.ambient));
    let camera = Camera { view, eye, tangent: half * aspect / distance, near: distance * 0.1, far: distance * 3.0, sky_far: distance * 3.0, rise: 0.0 };
    (camera, Light { toward, key, ambient })
}

impl Renderer {
    fn ensure_slot(&mut self, index: usize, size: (u32, u32)) {
        while self.sprites.len() <= index {
            let slot = self.new_slot(size);
            self.sprites.push(slot);
        }
        if self.sprites[index].size != size {
            self.sprites[index] = self.new_slot(size);
        }
    }

    fn new_slot(&self, size: (u32, u32)) -> Slot {
        let make = |format, samples, usage, label| {
            self.device
                .create_texture(&wgpu::TextureDescriptor {
                    label: Some(label),
                    size: wgpu::Extent3d { width: size.0, height: size.1, depth_or_array_layers: 1 },
                    mip_level_count: 1,
                    sample_count: samples,
                    dimension: wgpu::TextureDimension::D2,
                    format,
                    usage,
                    view_formats: &[],
                })
                .create_view(&Default::default())
        };
        let frame = self.device.create_buffer(&wgpu::BufferDescriptor { label: Some("sprite frame"), size: size_of::<super::FrameUniform>() as u64, usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
        let bone_capacity = 256;
        let bones = bone_storage(&self.device, bone_capacity);
        let opacity_capacity = 64;
        let opacities = opacity_storage(&self.device, opacity_capacity);
        let uv_rows = uv_storage(&self.device, opacity_capacity);
        let group = frame_group(&self.device, &self.frame_layout, &frame, &bones, &opacities, &uv_rows);
        Slot {
            size,
            msaa: make(HDR, SAMPLES, wgpu::TextureUsages::RENDER_ATTACHMENT, "sprite colour"),
            depth: make(DEPTH, SAMPLES, wgpu::TextureUsages::RENDER_ATTACHMENT, "sprite depth"),
            resolved: make(HDR, 1, wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING, "sprite"),
            frame,
            bones,
            bone_capacity,
            opacities,
            uv_rows,
            opacity_capacity,
            instance: instance_storage(&self.device, 1),
            group,
            drawn: None,
        }
    }

    /// The finished picture of sprite `index` when it was last drawn at `size`.
    pub(crate) fn sprite_view(&self, index: usize, size: (u32, u32)) -> Option<&wgpu::TextureView> {
        self.sprites.get(index).filter(|slot| slot.size == size && slot.drawn.is_some()).map(|slot| &slot.resolved)
    }

    /// Draws `shot` into sprite `index`'s target of `size`, lit by the scene's light colours from the camera's upper left; a sprite already showing this pose is left as it is.
    pub(crate) fn draw_sprite(&mut self, encoder: &mut wgpu::CommandEncoder, index: usize, size: (u32, u32), shot: &Shot, scene_light: Option<&Light>) {
        let Some(&id) = self.model_ids.get(shot.model.as_str()) else { return };
        let signature = scene_light.map(|light| (light.key, light.ambient));
        let wanted = Drawn { shot: shot.clone(), light: signature };
        let aspect = size.0 as f32 / size.1 as f32;
        let (camera, light) = framing(shot.bounds, aspect, scene_light);
        let far = camera.far;
        let uniform = Self::frame_uniform(&Scene { camera, light: Some(light), ..Scene::default() }, aspect, aspect, far);
        let model = &mut self.models[id];
        let bones = model.bones;
        let mut posed = vec![IDENTITY; bones];
        model.rig.pose(shot.sequence, shot.frame, shot.clock * 1000.0, &mut posed);
        let opacities = model.rig.opacities().to_vec();
        let uv_rows = model.rig.uv_rows().to_vec();
        self.ensure_slot(index, size);
        let slot = &mut self.sprites[index];
        if slot.drawn.as_ref() == Some(&wanted) {
            return;
        }
        if bones > slot.bone_capacity {
            slot.bone_capacity = bones.next_power_of_two();
            slot.bones = bone_storage(&self.device, slot.bone_capacity);
            slot.group = frame_group(&self.device, &self.frame_layout, &slot.frame, &slot.bones, &slot.opacities, &slot.uv_rows);
        }
        if opacities.len() > slot.opacity_capacity {
            slot.opacity_capacity = opacities.len().next_power_of_two();
            slot.opacities = opacity_storage(&self.device, slot.opacity_capacity);
            slot.uv_rows = uv_storage(&self.device, slot.opacity_capacity);
            slot.group = frame_group(&self.device, &self.frame_layout, &slot.frame, &slot.bones, &slot.opacities, &slot.uv_rows);
        }
        let queue = &self.queue;
        let team = [shot.team[0], shot.team[1], shot.team[2], 1.0];
        queue.write_buffer(&slot.bones, 0, bytemuck::cast_slice(&posed));
        queue.write_buffer(&slot.opacities, 0, bytemuck::cast_slice(&opacities));
        queue.write_buffer(&slot.uv_rows, 0, bytemuck::cast_slice(&uv_rows));
        queue.write_buffer(&slot.instance, 0, bytemuck::bytes_of(&Instance { model: IDENTITY, tint: [1.0; 4], team, base: [0, 0] }));
        queue.write_buffer(&slot.frame, 0, bytemuck::bytes_of(&uniform));
        let model = &self.models[id];
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("sprite"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment { view: &slot.msaa, depth_slice: None, resolve_target: Some(&slot.resolved), ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), store: wgpu::StoreOp::Discard } })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment { view: &slot.depth, depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(1.0), store: wgpu::StoreOp::Discard }), stencil_ops: None }),
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_bind_group(0, &slot.group, &[]);
            pass.set_vertex_buffer(0, model.vertices.slice(..));
            pass.set_vertex_buffer(1, slot.instance.slice(..));
            pass.set_index_buffer(model.indices.slice(..), wgpu::IndexFormat::Uint32);
            for draw in &model.draws {
                pass.set_pipeline(&self.pipelines[draw.filter.index()]);
                pass.set_bind_group(1, &draw.bind_group, &[]);
                pass.draw_indexed(draw.first_index..draw.first_index + draw.index_count, 0, 0..1);
            }
        }
        slot.drawn = Some(wanted);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(view: &Mat4, tangent: f32, aspect: f32, point: [f32; 3]) -> (f32, f32) {
        let eye = [view[0] * point[0] + view[4] * point[1] + view[8] * point[2] + view[12], view[1] * point[0] + view[5] * point[1] + view[9] * point[2] + view[13], view[2] * point[0] + view[6] * point[1] + view[10] * point[2] + view[14]];
        (eye[0] / (-eye[2] * tangent), eye[1] * aspect / (-eye[2] * tangent))
    }

    #[test]
    fn the_camera_fits_a_tall_box_inside_the_rectangle_with_a_margin() {
        let bounds = [-40.0, -30.0, 0.0, 40.0, 30.0, 200.0];
        for aspect in [0.5_f32, 1.0, 1.5] {
            let (camera, _) = framing(bounds, aspect, None);
            let (low, high) = ([bounds[0], bounds[1], bounds[2]], [bounds[3], bounds[4], bounds[5]]);
            let mut widest = 0.0_f32;
            let mut tallest = 0.0_f32;
            for corner in 0..8 {
                let point = [if corner & 1 == 0 { low[0] } else { high[0] }, if corner & 2 == 0 { low[1] } else { high[1] }, if corner & 4 == 0 { low[2] } else { high[2] }];
                let (x, y) = project(&camera.view, camera.tangent, aspect, point);
                widest = widest.max(x.abs());
                tallest = tallest.max(y.abs());
            }
            assert!(widest <= 1.0 && tallest <= 1.0, "aspect {aspect}: {widest} {tallest}");
            assert!(widest.max(tallest) > 0.8, "aspect {aspect}: the box fills the frame");
        }
    }

    #[test]
    fn the_key_light_comes_from_the_cameras_side_of_the_model() {
        let (camera, light) = framing([-40.0, -30.0, 0.0, 40.0, 30.0, 200.0], 1.0, None);
        let to_camera = unit(subtract(camera.eye, [0.0, 0.0, 100.0]));
        assert!(dot(light.toward, to_camera) > 0.5);
        assert!(light.toward[2] > 0.0);
    }
}
