//! The render passes of a frame: the sky, the solid scene, and with water the mirrored scene, the water over the refracted solids, and what blends over it.

use crate::post::Look;

use super::scene::Scene;
use super::{fitted, linear_of, Draw, Group, Renderer};

/// Which layers a pass draws: with water, the solid ones first, then the water, then the layers that blend over it.
#[derive(Clone, Copy, PartialEq)]
pub(super) enum Stage {
    Everything,
    Solid,
    Water,
    Soft,
}

impl Draw {
    fn is_water(&self) -> bool {
        self.bind_group.is_none()
    }

    fn in_stage(&self, stage: Stage) -> bool {
        match stage {
            Stage::Everything => !self.is_water(),
            Stage::Solid => !self.is_water() && self.filter.writes_depth(),
            Stage::Water => self.is_water(),
            Stage::Soft => !self.is_water() && !self.filter.writes_depth(),
        }
    }
}

struct Attachments<'a> {
    label: &'a str,
    color: &'a wgpu::TextureView,
    depth: &'a wgpu::TextureView,
    load: wgpu::LoadOp<wgpu::Color>,
    resolve: Option<&'a wgpu::TextureView>,
    depth_ops: Option<wgpu::Operations<f32>>,
    size: (u32, u32),
}

impl Attachments<'_> {
    fn begin(self, encoder: &mut wgpu::CommandEncoder) -> wgpu::RenderPass<'static> {
        let mut pass = encoder
            .begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some(self.label),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment { view: self.color, depth_slice: None, resolve_target: self.resolve, ops: wgpu::Operations { load: self.load, store: wgpu::StoreOp::Store } })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment { view: self.depth, depth_ops: self.depth_ops, stencil_ops: None }),
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            })
            .forget_lifetime();
        pass.set_viewport(0.0, 0.0, self.size.0 as f32, self.size.1 as f32, 0.0, 1.0);
        pass
    }
}

fn fresh(store: wgpu::StoreOp) -> Option<wgpu::Operations<f32>> {
    Some(wgpu::Operations { load: wgpu::LoadOp::Clear(1.0), store })
}

impl Renderer {
    pub(super) fn draw_groups<'a>(&'a self, pass: &mut wgpu::RenderPass<'a>, groups: &[Group], opaque: bool, stage: Stage, water: Option<&'a wgpu::BindGroup>) {
        for group in groups.iter().filter(|group| self.models[group.model].opaque_first == opaque && !self.models[group.model].draws.is_empty()) {
            let model = &self.models[group.model];
            pass.set_vertex_buffer(0, model.vertices.slice(..));
            pass.set_vertex_buffer(1, self.instance_buffer.slice(..));
            pass.set_index_buffer(model.indices.slice(..), wgpu::IndexFormat::Uint32);
            for draw in model.draws.iter().filter(|draw| draw.in_stage(stage)) {
                match (&draw.bind_group, water) {
                    (Some(layer), _) => {
                        pass.set_pipeline(&self.pipelines[draw.filter.index()]);
                        pass.set_bind_group(1, layer, &[]);
                    }
                    (None, Some(images)) => {
                        pass.set_pipeline(&self.water.pipeline);
                        pass.set_bind_group(1, images, &[]);
                    }
                    (None, None) => continue,
                }
                pass.draw_indexed(draw.first_index..draw.first_index + draw.index_count, 0, group.first..group.first + group.count);
            }
        }
    }

    fn draw_both<'a>(&'a self, pass: &mut wgpu::RenderPass<'a>, groups: &[Group], stage: Stage, water: Option<&'a wgpu::BindGroup>) {
        self.draw_groups(pass, groups, true, stage, water);
        self.draw_groups(pass, groups, false, stage, water);
    }

    pub(super) fn bind_frames(&mut self) {
        for set in [&mut self.main, &mut self.sky, &mut self.mirror, &mut self.mirror_sky] {
            set.group = super::frame_group(&self.device, &self.frame_layout, &set.buffer, &self.bone_buffer, &self.color_buffer, &self.uv_buffer);
        }
    }

    /// The sky and the scene seen from under the water plane, at the reflection's size, for the water pass to read.
    fn draw_reflection(&self, encoder: &mut wgpu::CommandEncoder, clear: wgpu::Color) {
        let (Some(water), true) = (self.water.targets.as_ref(), self.water_level.is_some()) else { return };
        let sky = self.sky_group_of.as_ref();
        if let Some(group) = sky {
            let mut pass = Attachments { label: "reflected sky", color: &water.reflect_color, depth: &water.reflect_depth, load: wgpu::LoadOp::Clear(clear), resolve: None, depth_ops: fresh(wgpu::StoreOp::Discard), size: water.reflect_size }.begin(encoder);
            pass.set_bind_group(0, &self.mirror_sky.group, &[]);
            self.draw_both(&mut pass, std::slice::from_ref(group), Stage::Everything, None);
        }
        let load = if sky.is_some() { wgpu::LoadOp::Load } else { wgpu::LoadOp::Clear(clear) };
        let mut pass = Attachments { label: "reflection", color: &water.reflect_color, depth: &water.reflect_depth, load, resolve: Some(&water.reflect_resolved), depth_ops: fresh(wgpu::StoreOp::Discard), size: water.reflect_size }.begin(encoder);
        pass.set_bind_group(0, &self.mirror.group, &[]);
        self.draw_both(&mut pass, &self.groups, Stage::Everything, None);
    }

    /// Draws `scene` into `target`, a surface view of `size` in this renderer's format, in the encoder's order: the sky, then the world.
    /// The world fills the window and keeps the reach of the `aspect` picture (the game's width over its height) in view: a taller or wider window shows more world, never bars.
    pub fn draw(&mut self, encoder: &mut wgpu::CommandEncoder, target: &wgpu::TextureView, size: (u32, u32), aspect: f32, scene: &Scene) {
        self.fit_targets(size);
        self.particles.begin(scene.frame);
        let window = size.0 as f32 / size.1.max(1) as f32;
        self.prepare(scene, aspect, window, size);

        let clear = (if scene.clear == [0.0; 3] { super::CLEAR } else { scene.clear.map(f64::from) }).map(linear_of);
        let clear = wgpu::Color { r: clear[0], g: clear[1], b: clear[2], a: 1.0 };
        let look = Look::of(scene, aspect, fitted(size, aspect).map(|edge| edge as f32), self.post.srgb_surface(), &self.tuning);
        let procedural_sky = scene.sky.is_some() || scene.fog.is_some();
        self.post.prepare(&look);
        if self.water_level.is_some() && self.water.ready() {
            self.water.fit(&self.device, super::HDR, size);
            self.water.write(&self.queue, &scene.water, self.started.elapsed().as_secs_f32());
        } else {
            self.water_level = None;
        }
        let targets = self.targets.as_ref().expect("fit_targets ran");
        let images = self.water_level.and_then(|_| self.water.group(&self.device, &targets.depth));

        self.draw_reflection(encoder, clear);
        if procedural_sky {
            self.post.draw_clouds(encoder);
        }
        {
            let mut pass = Attachments { label: "sky", color: &targets.color, depth: &targets.depth, load: wgpu::LoadOp::Clear(clear), resolve: None, depth_ops: fresh(wgpu::StoreOp::Discard), size }.begin(encoder);
            if procedural_sky {
                self.post.draw_sky(&mut pass);
            } else if let Some(group) = self.sky_group_of.as_ref() {
                pass.set_bind_group(0, &self.sky.group, &[]);
                self.draw_both(&mut pass, std::slice::from_ref(group), Stage::Everything, None);
            }
        }
        let refracted = self.water.targets.as_ref().map(|water| &water.refracted);
        if let (Some(images), Some(refracted)) = (&images, refracted) {
            {
                let mut pass = Attachments { label: "solid", color: &targets.color, depth: &targets.depth, load: wgpu::LoadOp::Load, resolve: Some(refracted), depth_ops: fresh(wgpu::StoreOp::Store), size }.begin(encoder);
                pass.set_bind_group(0, &self.main.group, &[]);
                self.draw_both(&mut pass, &self.groups, Stage::Solid, None);
            }
            let mut pass = Attachments { label: "water", color: &targets.color, depth: &targets.depth, load: wgpu::LoadOp::Load, resolve: Some(&targets.resolved), depth_ops: None, size }.begin(encoder);
            pass.set_bind_group(0, &self.main.group, &[]);
            self.draw_both(&mut pass, &self.groups, Stage::Water, Some(images));
            self.draw_both(&mut pass, &self.groups, Stage::Soft, None);
            self.particles.draw(&mut pass);
            self.lightning.draw(&mut pass, &self.particles);
            self.weather.draw(&mut pass, &self.particles);
            drop(pass);
        } else {
            let mut pass = Attachments { label: "scene", color: &targets.color, depth: &targets.depth, load: wgpu::LoadOp::Load, resolve: Some(&targets.resolved), depth_ops: fresh(wgpu::StoreOp::Store), size }.begin(encoder);
            pass.set_bind_group(0, &self.main.group, &[]);
            self.draw_both(&mut pass, &self.groups, Stage::Everything, None);
            self.particles.draw(&mut pass);
            self.lightning.draw(&mut pass, &self.particles);
            self.weather.draw(&mut pass, &self.particles);
            drop(pass);
        }
        self.post.encode(encoder, target);
    }
}
