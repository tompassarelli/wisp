//! Weather the map adds with `AddWeatherEffect`: snow, rain, wind, fog and rays of light, drawn as GPU particles in a box that follows the camera's target.
//! Every particle is a pure function of its index and the clock, so nothing is stored per flake: the vertex shader wraps each one around the box, drifts it with the gusting
//! wind, and stretches it along its screen-space motion over a shutter time, which is the motion blur of a fast flake. The scene's depth buffer hides what stands in front.
//! The shapes are procedural and original; a weather's `id` is the four letters of Warcraft's weather table.

use std::mem::size_of;

use bytemuck::{Pod, Zeroable};

use super::particles::Particles;
use super::pipelines::{blend_of, entry};
use super::scene::{Camera, WeatherPose};
use crate::settings::Features;
use super::model::Filter;
use super::{DEPTH, SAMPLES};

const SLOTS: usize = 8;
const STRIDE: u32 = 16 * 1024;
const TARGET_DISTANCE: f32 = 1650.0;

#[derive(Clone, Copy, PartialEq, Debug)]
pub(super) enum Shape {
    Flakes,
    Fog,
    Rays,
}

/// One kind of weather: how many particles fill the box, how big they are and how they move.
#[derive(Clone, Copy, Debug)]
pub(super) struct Preset {
    pub shape: Shape,
    pub count: u32,
    pub color: [f32; 4],
    pub size: f32,
    pub fall: f32,
    pub wind: [f32; 2],
    pub sway: f32,
    pub shutter: f32,
}

const SNOW: [f32; 4] = [0.93, 0.96, 1.0, 0.85];
const RAIN: [f32; 4] = [0.72, 0.82, 0.95, 0.5];
const DUST: [f32; 4] = [0.85, 0.78, 0.62, 0.3];

const fn flakes(count: u32, color: [f32; 4], size: f32, fall: f32, wind: [f32; 2], sway: f32, shutter: f32) -> Preset {
    Preset { shape: Shape::Flakes, count, color, size, fall, wind, sway, shutter }
}

const fn fog(count: u32, color: [f32; 3], alpha: f32) -> Preset {
    Preset { shape: Shape::Fog, count, color: [color[0], color[1], color[2], alpha], size: 650.0, fall: 40.0, wind: [35.0, 12.0], sway: 0.0, shutter: 0.0 }
}

const fn rays(count: u32, color: [f32; 3], alpha: f32, lean: [f32; 2]) -> Preset {
    Preset { shape: Shape::Rays, count, color: [color[0], color[1], color[2], alpha], size: 170.0, fall: 0.0, wind: lean, sway: 0.0, shutter: 0.0 }
}

/// Warcraft's weather table: each id and the preset that draws it.
pub(super) const TABLE: [(&str, Preset); 20] = [
    ("RAlr", flakes(3000, RAIN, 1.6, 1500.0, [120.0, 0.0], 0.0, 0.025)),
    ("RAhr", flakes(7000, RAIN, 1.9, 1900.0, [220.0, 40.0], 0.0, 0.03)),
    ("RLlr", flakes(3000, RAIN, 1.6, 1500.0, [100.0, 0.0], 0.0, 0.025)),
    ("RLhr", flakes(7000, RAIN, 1.9, 1900.0, [200.0, 30.0], 0.0, 0.03)),
    ("SNls", flakes(1800, SNOW, 4.5, 120.0, [40.0, 10.0], 14.0, 0.02)),
    ("SNhs", flakes(5000, SNOW, 5.0, 180.0, [70.0, 20.0], 18.0, 0.025)),
    ("SNbs", flakes(9000, SNOW, 5.5, 260.0, [520.0, 140.0], 10.0, 0.045)),
    ("WOlw", flakes(700, DUST, 2.5, 20.0, [500.0, 80.0], 4.0, 0.06)),
    ("WOcw", flakes(1800, DUST, 2.8, 30.0, [1100.0, 200.0], 6.0, 0.07)),
    ("WNcw", flakes(1800, DUST, 2.8, 30.0, [1100.0, 200.0], 6.0, 0.07)),
    ("FDbl", fog(70, [0.35, 0.5, 1.0], 0.04)),
    ("FDbh", fog(110, [0.35, 0.5, 1.0], 0.07)),
    ("FDgl", fog(70, [0.4, 1.0, 0.5], 0.04)),
    ("FDgh", fog(110, [0.4, 1.0, 0.5], 0.07)),
    ("FDrl", fog(70, [1.0, 0.35, 0.3], 0.04)),
    ("FDrh", fog(110, [1.0, 0.35, 0.3], 0.07)),
    ("FDwl", fog(70, [0.9, 0.9, 0.95], 0.04)),
    ("FDwh", fog(110, [0.9, 0.9, 0.95], 0.07)),
    ("LRaa", rays(14, [1.0, 0.88, 0.58], 0.34, [0.28, 0.12])),
    ("LRma", rays(14, [0.55, 0.7, 1.0], 0.3, [0.22, 0.1])),
];

pub(super) fn preset(id: &str) -> Option<Preset> {
    TABLE.iter().find(|(known, _)| *known == id).map(|(_, preset)| *preset)
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct GpuWeather {
    center: [f32; 4],
    rect: [f32; 4],
    color: [f32; 4],
    shape: [f32; 4],
    wind: [f32; 4],
    volume: [f32; 4],
}

pub(super) struct Weather {
    flakes: wgpu::RenderPipeline,
    rays: wgpu::RenderPipeline,
    buffer: wgpu::Buffer,
    group: wgpu::BindGroup,
    staged: Vec<GpuWeather>,
    draws: Vec<(Shape, u32, u32)>,
}

impl Weather {
    pub(super) fn new(device: &wgpu::Device, format: wgpu::TextureFormat, particles: &Particles) -> Self {
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("weather"), source: wgpu::ShaderSource::Wgsl(include_str!("weather.wgsl").into()) });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("weather"),
            entries: &[entry(0, wgpu::ShaderStages::VERTEX, wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Storage { read_only: true }, has_dynamic_offset: false, min_binding_size: None })],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: Some("weather"), bind_group_layouts: &[Some(particles.frame_layout()), Some(&layout)], immediate_size: 0 });
        let pipeline = |filter| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("weather"),
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState { module: &module, entry_point: Some("vertex_main"), compilation_options: Default::default(), buffers: &[] },
                fragment: Some(wgpu::FragmentState {
                    module: &module,
                    entry_point: Some("fragment_main"),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState { format, blend: blend_of(filter), write_mask: wgpu::ColorWrites::ALL })],
                }),
                primitive: wgpu::PrimitiveState { topology: wgpu::PrimitiveTopology::TriangleStrip, ..Default::default() },
                depth_stencil: Some(wgpu::DepthStencilState { format: DEPTH, depth_write_enabled: Some(false), depth_compare: Some(wgpu::CompareFunction::LessEqual), stencil: Default::default(), bias: Default::default() }),
                multisample: wgpu::MultisampleState { count: SAMPLES, mask: !0, alpha_to_coverage_enabled: false },
                multiview_mask: None,
                cache: None,
            })
        };
        let buffer = device.create_buffer(&wgpu::BufferDescriptor { label: Some("weathers"), size: (SLOTS * size_of::<GpuWeather>()) as u64, usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
        let group = device.create_bind_group(&wgpu::BindGroupDescriptor { label: Some("weathers"), layout: &layout, entries: &[wgpu::BindGroupEntry { binding: 0, resource: buffer.as_entire_binding() }] });
        Self { flakes: pipeline(Filter::Blend), rays: pipeline(Filter::AddAlpha), buffer, group, staged: Vec::with_capacity(SLOTS), draws: Vec::with_capacity(SLOTS) }
    }

    /// Stages the scene's weathers whose rect holds the camera's target; an id outside the table draws nothing, the graphics setting scales the particle count, and fog and light shafts draw only with volumetrics.
    pub(super) fn stage(&mut self, queue: &wgpu::Queue, camera: &Camera, weathers: &[WeatherPose], features: &Features) {
        self.staged.clear();
        self.draws.clear();
        let view = &camera.view;
        let center = [0, 1, 2].map(|axis| camera.eye[axis] - view[axis * 4 + 2] * TARGET_DISTANCE);
        for weather in weathers.iter().take(SLOTS) {
            let Some(preset) = preset(&weather.id) else { continue };
            if preset.shape != Shape::Flakes && !features.volumetrics {
                continue;
            }
            let [min_x, min_y, max_x, max_y] = weather.rect;
            if center[0] < min_x || center[0] > max_x || center[1] < min_y || center[1] > max_y {
                continue;
            }
            let slot = self.staged.len() as u32;
            let shape = match preset.shape {
                Shape::Flakes => 0.0,
                Shape::Fog => 1.0,
                Shape::Rays => 2.0,
            };
            let (box_xy, box_z) = (TARGET_DISTANCE * 2.6, TARGET_DISTANCE * 1.5);
            self.staged.push(GpuWeather {
                center: [center[0], center[1], center[2], 0.0],
                rect: weather.rect,
                color: preset.color,
                shape: [shape, preset.size, preset.fall, 0.0],
                wind: [preset.wind[0], preset.wind[1], preset.sway, preset.shutter],
                volume: [box_xy, box_z, 120.0, TARGET_DISTANCE * 3.4],
            });
            self.draws.push((preset.shape, slot * STRIDE, (preset.count * u32::from(features.weather_percent) / 100).min(STRIDE)));
        }
        queue.write_buffer(&self.buffer, 0, bytemuck::cast_slice(&self.staged));
    }

    pub(super) fn draw<'a>(&'a self, pass: &mut wgpu::RenderPass<'a>, particles: &'a Particles) {
        if self.draws.is_empty() {
            return;
        }
        pass.set_bind_group(0, particles.frame_group(), &[]);
        pass.set_bind_group(1, &self.group, &[]);
        for &(shape, first, count) in &self.draws {
            pass.set_pipeline(if shape == Shape::Rays { &self.rays } else { &self.flakes });
            pass.draw(0..4, first..first + count);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_weather_id_maps_to_its_preset() {
        let listing: Vec<String> = TABLE.iter().map(|(id, preset)| format!("{id} -> {:?} x{}", preset.shape, preset.count)).collect();
        println!("{}", listing.join("\n"));
        assert_eq!(
            listing.join("\n"),
            "RAlr -> Flakes x3000\nRAhr -> Flakes x7000\nRLlr -> Flakes x3000\nRLhr -> Flakes x7000\nSNls -> Flakes x1800\nSNhs -> Flakes x5000\nSNbs -> Flakes x9000\nWOlw -> Flakes x700\nWOcw -> Flakes x1800\nWNcw -> Flakes x1800\nFDbl -> Fog x70\nFDbh -> Fog x110\nFDgl -> Fog x70\nFDgh -> Fog x110\nFDrl -> Fog x70\nFDrh -> Fog x110\nFDwl -> Fog x70\nFDwh -> Fog x110\nLRaa -> Rays x14\nLRma -> Rays x14"
        );
        for (id, _) in &TABLE {
            assert!(preset(id).is_some(), "{id}");
        }
        assert!(preset("XXXX").is_none());
    }
}
