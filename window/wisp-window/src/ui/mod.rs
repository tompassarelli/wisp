//! The menu and HUD frames of a scene (its `ui` array), drawn over the world: textured backdrops and text from a glyph atlas.
//!
//! One instance buffer holds every quad of a scene, in drawing order, and one draw call covers each run that shares a texture.
//! Scratch vectors and the buffer are reused, and the buffer is written only when the quads differ from the last draw.

mod glyphs;
mod layout;
mod scene;

use std::collections::HashMap;

use wgpu::util::DeviceExt;

pub use glyphs::is_font;
use glyphs::{Glyphs, Slot, ATLAS_SIZE};
use layout::{Line, Pixels};
pub use scene::{Backdrop, Horizontal, UiFrame, UiScene, Vertical};
use crate::render::Shot;

const SHADER: &str = include_str!("shader.wgsl");
const OUTLINE_ALPHA: f32 = 0.9;
const INITIAL_QUADS: usize = 1024;
const IMAGE: u32 = 0;
const IMAGE_TRANSPOSED: u32 = 4;
const IMAGE_ADDED: u32 = 5;
/// An edge file holds eight square pieces side by side: left, right, top, bottom (both stored upright), then the top-left, top-right, bottom-left and bottom-right corners.
const EDGE_PIECES: f32 = 8.0;
/// A sixteenth of a piece kept off each side, so linear filtering never reads the neighbouring piece.
const EDGE_TRIM: f32 = 1.0 / EDGE_PIECES / 32.0;

/// Decoded images by the game's asset path, which the renderer fills as Bun pushes files.
pub trait UiTextures {
    fn view(&self, path: &str) -> Option<&wgpu::TextureView>;
}

#[repr(C)]
#[derive(Clone, Copy, PartialEq, bytemuck::Pod, bytemuck::Zeroable)]
struct Quad {
    rect: [f32; 4],
    uv: [f32; 4],
    color: [f32; 4],
    coverage: u32,
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Source {
    Glyphs,
    Image(usize),
}

/// The quads up to `end` (from the last run's end) draw with `source`.
struct Run {
    source: Source,
    end: usize,
}

pub struct UiRenderer {
    pipeline: wgpu::RenderPipeline,
    screen: wgpu::Buffer,
    screen_group: wgpu::BindGroup,
    texture_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    glyph_group: wgpu::BindGroup,
    image_index: HashMap<String, usize>,
    image_groups: Vec<wgpu::BindGroup>,
    runs: Vec<Run>,
    glyphs: Glyphs,
    scene: UiScene,
    overlay: UiScene,
    quads: Vec<Quad>,
    drawn: Vec<Quad>,
    lines: Vec<Line>,
    buffer: wgpu::Buffer,
    capacity: usize,
    screen_size: (u32, u32),
    device: wgpu::Device,
    queue: wgpu::Queue,
}

fn rgba(color: u32, alpha: f32) -> [f32; 4] {
    [(color >> 16 & 255) as f32 / 255.0, (color >> 8 & 255) as f32 / 255.0, (color & 255) as f32 / 255.0, alpha]
}

impl UiRenderer {
    pub fn new(device: wgpu::Device, queue: wgpu::Queue, format: wgpu::TextureFormat) -> Self {
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("ui"), source: wgpu::ShaderSource::Wgsl(SHADER.into()) });
        let screen_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("ui screen"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX,
                ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None },
                count: None,
            }],
        });
        let texture_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("ui texture"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: true }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry { binding: 1, visibility: wgpu::ShaderStages::FRAGMENT, ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering), count: None },
            ],
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: Some("ui"), bind_group_layouts: &[Some(&screen_layout), Some(&texture_layout)], immediate_size: 0 });
        let pipeline = Self::pipeline(&device, &module, &layout, format);
        let screen = device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: Some("ui screen"), contents: bytemuck::bytes_of(&[1.0f32, 1.0]), usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST });
        let screen_group = device.create_bind_group(&wgpu::BindGroupDescriptor { label: Some("ui screen"), layout: &screen_layout, entries: &[wgpu::BindGroupEntry { binding: 0, resource: screen.as_entire_binding() }] });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor { mag_filter: wgpu::FilterMode::Linear, min_filter: wgpu::FilterMode::Linear, ..Default::default() });
        let glyphs = Glyphs::new(&device, queue.clone());
        let glyph_group = Self::texture_group(&device, &texture_layout, &glyphs.view, &sampler);
        let buffer = Self::quad_buffer(&device, INITIAL_QUADS);
        Self {
            pipeline,
            screen,
            screen_group,
            texture_layout,
            sampler,
            glyph_group,
            image_index: HashMap::new(),
            image_groups: Vec::new(),
            runs: Vec::new(),
            glyphs,
            scene: UiScene::default(),
            overlay: UiScene::default(),
            quads: Vec::with_capacity(INITIAL_QUADS),
            drawn: Vec::with_capacity(INITIAL_QUADS),
            lines: Vec::new(),
            buffer,
            capacity: INITIAL_QUADS,
            screen_size: (0, 0),
            device,
            queue,
        }
    }

    fn pipeline(device: &wgpu::Device, module: &wgpu::ShaderModule, layout: &wgpu::PipelineLayout, format: wgpu::TextureFormat) -> wgpu::RenderPipeline {
        let attributes = wgpu::vertex_attr_array![0 => Float32x4, 1 => Float32x4, 2 => Float32x4, 3 => Uint32];
        device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("ui"),
            layout: Some(layout),
            vertex: wgpu::VertexState {
                module,
                entry_point: Some("vs"),
                compilation_options: Default::default(),
                buffers: &[Some(wgpu::VertexBufferLayout { array_stride: std::mem::size_of::<Quad>() as u64, step_mode: wgpu::VertexStepMode::Instance, attributes: &attributes })],
            },
            fragment: Some(wgpu::FragmentState {
                module,
                entry_point: Some("fs"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState {
                        color: wgpu::BlendComponent { src_factor: wgpu::BlendFactor::One, dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha, operation: wgpu::BlendOperation::Add },
                        alpha: wgpu::BlendComponent { src_factor: wgpu::BlendFactor::One, dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha, operation: wgpu::BlendOperation::Add },
                    }),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState { topology: wgpu::PrimitiveTopology::TriangleStrip, ..Default::default() },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        })
    }

    fn texture_group(device: &wgpu::Device, layout: &wgpu::BindGroupLayout, view: &wgpu::TextureView, sampler: &wgpu::Sampler) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("ui texture"),
            layout,
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(view) }, wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(sampler) }],
        })
    }

    fn quad_buffer(device: &wgpu::Device, capacity: usize) -> wgpu::Buffer {
        device.create_buffer(&wgpu::BufferDescriptor { label: Some("ui quads"), size: (capacity * std::mem::size_of::<Quad>()) as u64, usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false })
    }

    /// Keeps the frames of the next scene to draw.
    pub fn load_scene(&mut self, bytes: &[u8]) -> Result<(), String> {
        self.scene = UiScene::parse(bytes)?;
        Ok(())
    }

    /// Keeps the frames the window draws over the game's own, such as its options screen; empty to draw none.
    pub fn set_overlay(&mut self, overlay: UiScene) {
        self.overlay = overlay;
    }

    /// Calls `draw` for each sprite frame with its index in drawing order, the size of its rectangle in pixels and its pose, so the renderer can have its picture ready for `draw`.
    pub fn each_sprite(&self, area: Pixels, mut draw: impl FnMut(usize, (u32, u32), &Shot)) {
        let sprites = self.scene.frames.iter().filter_map(|frame| frame.sprite.as_ref().map(|shot| (shot, layout::pixels(frame.rectangle, area))));
        for (index, (shot, pixels)) in sprites.enumerate() {
            draw(index, sprite_size(pixels), shot);
        }
    }

    /// Registers a font file Bun pushed; false when `bytes` are not a face.
    pub fn add_font(&mut self, path: &str, bytes: &[u8]) -> bool {
        self.glyphs.add_font(path, bytes)
    }

    /// Records the scene's frames over `target`, with `area` (x, y, width, height in pixels) as the screen the 0.8 x 0.6 units fill.
    pub fn draw(&mut self, encoder: &mut wgpu::CommandEncoder, target: &wgpu::TextureView, target_size: (u32, u32), area: Pixels, textures: &dyn UiTextures) {
        if self.scene.frames.is_empty() && self.overlay.frames.is_empty() {
            return;
        }
        if target_size != self.screen_size {
            self.screen_size = target_size;
            self.queue.write_buffer(&self.screen, 0, bytemuck::bytes_of(&[target_size.0 as f32, target_size.1 as f32]));
        }
        let (scene, overlay) = (std::mem::take(&mut self.scene), std::mem::take(&mut self.overlay));
        if !self.build(&scene, &overlay, area, textures) {
            self.glyphs.reset();
            self.build(&scene, &overlay, area, textures);
        }
        self.scene = scene;
        self.overlay = overlay;
        self.upload();
        if self.quads.is_empty() {
            return;
        }
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("ui"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment { view: target, depth_slice: None, resolve_target: None, ops: wgpu::Operations { load: wgpu::LoadOp::Load, store: wgpu::StoreOp::Store } })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.screen_group, &[]);
        pass.set_vertex_buffer(0, self.buffer.slice(..));
        let mut start = 0;
        for run in &self.runs {
            let group = match run.source {
                Source::Glyphs => &self.glyph_group,
                Source::Image(index) => &self.image_groups[index],
            };
            pass.set_bind_group(1, group, &[]);
            pass.draw(0..4, start as u32..run.end as u32);
            start = run.end;
        }
    }

    /// The bind group for the image at `path`, made the first time the renderer has it; `None` while it is still decoding.
    fn image_group(&mut self, path: &str, textures: &dyn UiTextures) -> Option<usize> {
        if let Some(&index) = self.image_index.get(path) {
            return Some(index);
        }
        let view = textures.view(path)?;
        self.image_groups.push(Self::texture_group(&self.device, &self.texture_layout, view, &self.sampler));
        self.image_index.insert(path.to_string(), self.image_groups.len() - 1);
        Some(self.image_groups.len() - 1)
    }

    fn upload(&mut self) {
        if self.quads == self.drawn {
            return;
        }
        if self.quads.len() > self.capacity {
            self.capacity = self.quads.len().next_power_of_two();
            self.buffer = Self::quad_buffer(&self.device, self.capacity);
        }
        self.queue.write_buffer(&self.buffer, 0, bytemuck::cast_slice(&self.quads));
        self.drawn.clear();
        self.drawn.extend_from_slice(&self.quads);
    }

    fn emit(&mut self, source: Source, quad: Quad) {
        self.quads.push(quad);
        match self.runs.last_mut() {
            Some(run) if run.source == source => run.end = self.quads.len(),
            _ => self.runs.push(Run { source, end: self.quads.len() }),
        }
    }

    /// Fills `quads` and `runs` from the scene; false when the atlas filled up part way, so the caller empties it and builds again.
    fn build(&mut self, scene: &UiScene, overlay: &UiScene, area: Pixels, textures: &dyn UiTextures) -> bool {
        self.quads.clear();
        self.runs.clear();
        let mut sprite = 0;
        for frame in scene.frames.iter().chain(&overlay.frames) {
            let pixels = layout::pixels(frame.rectangle, area);
            if frame.sprite.is_some() {
                let size = sprite_size(pixels);
                if let Some(group) = self.image_group(&format!("sprite/{sprite}/{}x{}", size.0, size.1), textures) {
                    let tint = rgba(0xffff_ffff, frame.alpha as f32 / 255.0);
                    self.emit(Source::Image(group), Quad { rect: [pixels[0].round(), pixels[1].round(), size.0 as f32, size.1 as f32], uv: [0.0, 0.0, 1.0, 1.0], color: tint, coverage: 3 });
                }
                sprite += 1;
            }
            let alpha = frame.alpha as f32 / 255.0;
            self.control(frame, pixels, area[3], alpha, textures);
            if frame.solid {
                if pixels[2] > 0.0 && pixels[3] > 0.0 {
                    self.emit(Source::Glyphs, Quad { rect: pixels, uv: [0.0; 4], color: rgba(frame.color, alpha * (frame.color >> 24) as f32 / 255.0), coverage: 2 });
                }
                continue;
            }
            if !frame.texture.is_empty() && pixels[2] > 0.0 && pixels[3] > 0.0 {
                if let Some(group) = self.image_group(&frame.texture, textures) {
                    let tint = rgba(frame.color, alpha * (frame.color >> 24) as f32 / 255.0);
                    self.emit(Source::Image(group), Quad { rect: pixels, uv: [0.0, 0.0, 1.0, 1.0], color: tint, coverage: 0 });
                }
            }
            if !frame.text.is_empty() && !self.text(frame, pixels, area[3], alpha) {
                return false;
            }
        }
        true
    }

    /// A control template's look under the frame's own texture and text: its backdrop, then its highlight added over the whole frame.
    fn control(&mut self, frame: &UiFrame, pixels: Pixels, area_height: f32, alpha: f32, textures: &dyn UiTextures) {
        if let Some(backdrop) = &frame.backdrop {
            self.backdrop(backdrop, pixels, area_height, alpha, textures);
        }
        if frame.highlight.is_empty() || pixels[2] <= 0.0 || pixels[3] <= 0.0 {
            return;
        }
        if let Some(group) = self.image_group(&frame.highlight, textures) {
            self.emit(Source::Image(group), Quad { rect: pixels, uv: [0.0, 0.0, 1.0, 1.0], color: [1.0, 1.0, 1.0, alpha], coverage: IMAGE_ADDED });
        }
    }

    /// A BACKDROP: its background inside the insets, stretched or tiled from the top-left, then the edge file's sides and corners over it.
    fn backdrop(&mut self, backdrop: &Backdrop, pixels: Pixels, area_height: f32, alpha: f32, textures: &dyn UiTextures) {
        let unit = layout::unit_pixels(area_height);
        let [x, y, width, height] = pixels.map(f32::round);
        if width <= 0.0 || height <= 0.0 {
            return;
        }
        let tint = [1.0, 1.0, 1.0, alpha];
        if let Some(group) = (!backdrop.background.is_empty()).then(|| self.image_group(&backdrop.background, textures)).flatten() {
            let [left, top, right, bottom] = backdrop.insets.map(|inset| (inset * unit).round());
            let inner = [x + left, y + top, width - left - right, height - top - bottom];
            let tile = backdrop.tile * unit;
            if tile <= 0.0 {
                self.emit(Source::Image(group), Quad { rect: inner, uv: [0.0, 0.0, 1.0, 1.0], color: tint, coverage: IMAGE });
            } else {
                let mut down = 0.0;
                while down < inner[3] {
                    let tall = tile.min(inner[3] - down);
                    let mut across = 0.0;
                    while across < inner[2] {
                        let wide = tile.min(inner[2] - across);
                        self.emit(Source::Image(group), Quad { rect: [inner[0] + across, inner[1] + down, wide, tall], uv: [0.0, 0.0, wide / tile, tall / tile], color: tint, coverage: IMAGE });
                        across += tile;
                    }
                    down += tile;
                }
            }
        }
        let Some(group) = (!backdrop.edge.is_empty()).then(|| self.image_group(&backdrop.edge, textures)).flatten() else {
            return;
        };
        let corner = (backdrop.corner * unit).round().min((width / 2.0).floor()).min((height / 2.0).floor());
        let has = |flag: &str| backdrop.corners.is_empty() || backdrop.corners.split('|').any(|each| each == flag);
        let (far_x, far_y, long_x, long_y) = (x + width - corner, y + height - corner, width - 2.0 * corner, height - 2.0 * corner);
        let pieces: [(&str, [f32; 4], u32); 8] = [
            ("L", [x, y + corner, corner, long_y], IMAGE),
            ("R", [far_x, y + corner, corner, long_y], IMAGE),
            ("T", [x + corner, y, long_x, corner], IMAGE_TRANSPOSED),
            ("B", [x + corner, far_y, long_x, corner], IMAGE_TRANSPOSED),
            ("UL", [x, y, corner, corner], IMAGE),
            ("UR", [far_x, y, corner, corner], IMAGE),
            ("BL", [x, far_y, corner, corner], IMAGE),
            ("BR", [far_x, far_y, corner, corner], IMAGE),
        ];
        for (index, (flag, rect, coverage)) in pieces.into_iter().enumerate() {
            if rect[2] <= 0.0 || rect[3] <= 0.0 || !has(flag) {
                continue;
            }
            let start = index as f32 / EDGE_PIECES;
            self.emit(Source::Image(group), Quad { rect, uv: [start + EDGE_TRIM, 0.0, start + 1.0 / EDGE_PIECES - EDGE_TRIM, 1.0], color: tint, coverage });
        }
    }

    /// Lays one frame's text out and emits its glyphs: the outline first when the font has one, then the fill.
    fn text(&mut self, frame: &UiFrame, pixels: Pixels, area_height: f32, alpha: f32) -> bool {
        let [x, y, width, height] = pixels;
        let font = self.glyphs.font_for(&frame.font_file);
        let size = layout::font_size(frame.font_height, frame.scale, frame.plain, height, area_height);
        let plain = layout::plain(&frame.text);
        let mut full = false;
        let mut lines = std::mem::take(&mut self.lines);
        layout::lines(&plain.text, width, frame.horizontal, &mut lines, |slice| {
            let mut total = 0.0;
            let mut before = None;
            for ch in slice.chars() {
                let Some(slot) = self.glyphs.slot(font, ch, size, false) else {
                    full = true;
                    return 0.0;
                };
                total += slot.advance + before.map_or(0.0, |left| self.glyphs.kern(font, left, ch, size));
                before = Some(ch);
            }
            total
        });
        let fill = match plain.code {
            Some([red, green, blue, code_alpha]) => [red as f32 / 255.0, green as f32 / 255.0, blue as f32 / 255.0, code_alpha as f32 / 255.0 * alpha],
            None => rgba(frame.text_color, (frame.text_color >> 24) as f32 / 255.0 * alpha),
        };
        let first = y + layout::first_line_top(frame.vertical, height, lines.len(), size);
        let ascent = self.glyphs.line_ascent(font, size);
        let passes: &[bool] = if frame.outline { &[true, false] } else { &[false] };
        'passes: for &outline in passes {
            let color = if outline { [0.0, 0.0, 0.0, OUTLINE_ALPHA * alpha] } else { fill };
            for (index, line) in lines.iter().enumerate() {
                let baseline = (first + index as f32 * size * layout::LEADING + ascent).round();
                let mut pen = x + line.left;
                let mut before = None;
                for ch in plain.text[line.start..line.end].chars() {
                    let Some(slot) = self.glyphs.slot(font, ch, size, outline) else {
                        full = true;
                        break 'passes;
                    };
                    pen += before.map_or(0.0, |left| self.glyphs.kern(font, left, ch, size));
                    if slot.width > 0 {
                        self.emit(Source::Glyphs, glyph_quad(slot, pen, baseline, color));
                    }
                    pen += slot.advance;
                    before = Some(ch);
                }
            }
        }
        self.lines = lines;
        !full
    }
}

/// A sprite's target holds one texel per screen pixel of its rectangle.
fn sprite_size(pixels: Pixels) -> (u32, u32) {
    ((pixels[2].round() as u32).clamp(1, 4096), (pixels[3].round() as u32).clamp(1, 4096))
}

fn glyph_quad(slot: Slot, pen: f32, baseline: f32, color: [f32; 4]) -> Quad {
    let atlas = ATLAS_SIZE as f32;
    let (u0, v0) = (slot.x as f32 / atlas, slot.y as f32 / atlas);
    Quad {
        rect: [(pen + slot.left).round(), baseline - slot.top, slot.width as f32, slot.height as f32],
        uv: [u0, v0, u0 + slot.width as f32 / atlas, v0 + slot.height as f32 / atlas],
        color,
        coverage: 1,
    }
}

#[cfg(test)]
mod tests;
