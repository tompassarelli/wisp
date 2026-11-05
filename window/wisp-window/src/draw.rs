use std::path::PathBuf;
use std::time::Instant;
use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};
use std::sync::Arc;

use winit::window::Window;

use crate::gpu_time::{GpuClock, Pass, PassTimer};
use crate::metrics::Timings;
use crate::menu::{self, Menu};
use crate::present::PresentSetting;
use crate::settings::{self, Settings, Store, PRESETS};
use crate::surface_target::SurfaceTarget;
use crate::swapchain::{SurfaceError, Swapchain, WgpuSurface};
use crate::render::{DrawScene, Renderer};
use crate::ui::{is_font, UiRenderer};

mod cursor;
mod picture;

use picture::Capture;


const COUNTER_BITS: usize = 24;
const VERTICES: usize = COUNTER_BITS * 6;
const IMAGE_CENSUS_LIMIT: usize = 16;

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Vertex {
    position: [f32; 2],
    color: [f32; 3],
}

const SHADER: &str = "
struct In { @location(0) position: vec2<f32>, @location(1) color: vec3<f32> };
struct Out { @builtin(position) position: vec4<f32>, @location(0) color: vec3<f32> };
@vertex fn vs(input: In) -> Out { var out: Out; out.position = vec4<f32>(input.position, 0.0, 1.0); out.color = input.color; return out; }
@fragment fn fs(input: Out) -> @location(0) vec4<f32> { return vec4<f32>(input.color, 1.0); }
";

/// The clear colour for a step: a slow drift so a frozen window is visible, never reaching the counter's colours.
fn clear_color(step: u64) -> [f64; 3] {
    let phase = (step % 600) as f64 / 600.0;
    [0.06 + 0.04 * phase, 0.08 + 0.05 * (1.0 - phase), 0.14]
}

/// The step counter as 24 squares, least significant bit at the left, lit when the bit is set.
fn counter_vertices(step: u64) -> Vec<Vertex> {
    let size = 0.05_f32;
    let gap = 0.015_f32;
    let left = -(COUNTER_BITS as f32 * (size + gap)) / 2.0;
    let mut vertices = Vec::with_capacity(VERTICES);
    for bit in 0..COUNTER_BITS {
        let color = if step >> bit & 1 == 1 { [0.95, 0.85, 0.2] } else { [0.16, 0.18, 0.26] };
        let x = left + bit as f32 * (size + gap);
        let (y, top) = (-0.9_f32, -0.9_f32 + size * 1.6);
        for (cx, cy) in [(x, y), (x + size, y), (x, top), (x, top), (x + size, y), (x + size, top)] {
            vertices.push(Vertex { position: [cx, cy], color });
        }
    }
    vertices
}


/// `WISP_WINDOW_PRESET_SWEEP=DIR` opens the options screen once the scene is ready and, at each preset in turn, draws `SWEEP_FRAMES` frames timed to the GPU finishing them, prints their frame times and saves `DIR/options-PRESET.png`. The player's saved settings are restored afterwards.
struct Sweep {
    directory: PathBuf,
    saved: Settings,
    started: bool,
    next: usize,
    skip: u32,
    millis: Vec<f64>,
}

const SWEEP_AFTER: u32 = 30;
const SWEEP_WARMUP: u32 = 20;
const SWEEP_FRAMES: usize = 120;

impl Sweep {
    fn from_environment(saved: Settings) -> Option<Self> {
        let directory = PathBuf::from(std::env::var_os("WISP_WINDOW_PRESET_SWEEP")?);
        Some(Self { directory, saved, started: false, next: 0, skip: 0, millis: Vec::with_capacity(SWEEP_FRAMES) })
    }
}

fn percentile(sorted: &[f64], fraction: f64) -> f64 {
    sorted[((sorted.len() as f64 * fraction).ceil() as usize).clamp(1, sorted.len()) - 1]
}

pub struct Gpu {
    swapchain: Swapchain<WgpuSurface>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::RenderPipeline,
    vertices: wgpu::Buffer,
    renderer: Renderer,
    ui: UiRenderer,
    aspect: f32,
    scene: Option<DrawScene>,
    capture: Option<Capture>,
    adapter_handle: wgpu::Adapter,
    present: PresentSetting,
    settings: Settings,
    store: Option<Store>,
    menu: Menu,
    sweep: Option<Sweep>,
    images: HashSet<u64>,
    scene_bytes: Vec<u8>,
    clock: Result<GpuClock, String>,
    encode_ms: Option<f64>,
    pub adapter: String,
    pub backend: String,
}

impl Gpu {
    pub fn new(window: Arc<Window>, aspect: f32) -> Result<Self, String> {
        let size = window.inner_size();
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle_from_env());
        let surface = instance.create_surface(SurfaceTarget::new(window)).map_err(|e| format!("surface: {e}"))?;
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: Some(&surface),
            force_fallback_adapter: false,
            apply_limit_buckets: false,
        }))
        .map_err(|e| format!("adapter: {e}"))?;
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor { required_features: GpuClock::features(adapter.features()) | crate::render::multisample_features(adapter.features()), required_limits: crate::remaster::device_limits(&adapter.limits()), ..Default::default() })).map_err(|e| format!("device: {e}"))?;
        let mut config = surface.get_default_config(&adapter, size.width.max(1), size.height.max(1)).ok_or("surface not supported by the adapter")?;
        let formats = surface.get_capabilities(&adapter).formats;
        let plain = config.format.remove_srgb_suffix();
        if formats.contains(&plain) {
            config.format = plain;
        }
        let capture = Capture::from_environment();
        let store = Store::open();
        let settings = store.as_ref().map(Store::load).unwrap_or_default();
        let sweep = Sweep::from_environment(settings);
        if surface.get_capabilities(&adapter).usages.contains(wgpu::TextureUsages::COPY_SRC) {
            config.usage |= wgpu::TextureUsages::COPY_SRC;
        }
        let present = PresentSetting::default().offered(&surface.get_capabilities(&adapter).present_modes);
        config.present_mode = present.mode();
        config.desired_maximum_frame_latency = 1;
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: None, source: wgpu::ShaderSource::Wgsl(SHADER.into()) });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: None, bind_group_layouts: &[], immediate_size: 0 });
        let attributes = wgpu::vertex_attr_array![0 => Float32x2, 1 => Float32x3];
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: None,
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some("vs"),
                compilation_options: Default::default(),
                buffers: &[Some(wgpu::VertexBufferLayout { array_stride: std::mem::size_of::<Vertex>() as u64, step_mode: wgpu::VertexStepMode::Vertex, attributes: &attributes })],
            },
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("fs"),
                compilation_options: Default::default(),
                targets: &[Some(config.format.into())],
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });
        let vertices = device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: (VERTICES * std::mem::size_of::<Vertex>()) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let info = adapter.get_info();
        let upscaler = crate::remaster::Upscaler::on(device.clone(), queue.clone(), &info);
        let mut renderer = Renderer::new(device.clone(), queue.clone(), config.format, crate::remaster::Quality::Off, settings.features()).with_upscaler(Arc::new(upscaler));
        renderer.set_quality(settings.quality(settings::developer_quality()));
        let ui = UiRenderer::new(device.clone(), queue.clone(), config.format);
        let clock = GpuClock::new(&device, &queue);
        let swapchain = Swapchain::new(WgpuSurface::new(surface, device.clone()), config);
        Ok(Self { swapchain, device, queue, pipeline, vertices, renderer, ui, aspect, scene: None, capture, adapter_handle: adapter, present, settings, store, menu: Menu::default(), sweep, images: HashSet::new(), scene_bytes: Vec::new(), clock, encode_ms: None, adapter: info.name, backend: format!("{:?}", info.backend) })
    }

    /// Applies what the player did at the options screen since the last frame, saving a change.
    pub fn menu_events(&mut self, events: Vec<menu::Event>) {
        let mut settings = self.settings;
        let mut changed = false;
        for event in events {
            changed |= self.menu.handle(event, &mut settings);
        }
        if changed {
            self.apply(settings);
        }
    }

    /// Applies and saves the player's choice: the features take effect at the next frame, and the art is rebuilt beside the one on screen.
    pub fn apply(&mut self, settings: Settings) {
        self.settings = settings;
        self.renderer.set_features(settings.features());
        self.renderer.set_quality(settings.quality(settings::developer_quality()));
        if let Some(Err(error)) = self.store.as_ref().map(|store| store.save(&settings)) {
            eprintln!("wisp-window: settings not saved: {error}");
        }
    }

    pub fn setting(&self) -> PresentSetting {
        self.present
    }

    /// How many distinct images `Fifo` has handed back so far: once the acquires have cycled, the swapchain's image count, which wgpu clamps from `desired_maximum_frame_latency` and does not report.
    pub fn image_count(&self) -> usize {
        self.images.len()
    }

    /// Reconfigures the surface to `setting`, or to `Fifo` when the surface does not offer it.
    pub fn set_present(&mut self, setting: PresentSetting) {
        let offered = setting.offered(&self.swapchain.surface().capabilities(&self.adapter_handle).present_modes);
        if offered != self.present {
            self.present = offered;
            self.images.clear();
            self.swapchain.reconfigure(|config| config.present_mode = offered.mode());
        }
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        let config = self.swapchain.config();
        if width == 0 || height == 0 || (width == config.width && height == config.height) {
            return;
        }
        self.swapchain.reconfigure(|config| (config.width, config.height) = (width, height));
    }

    /// Blocks until the display hands back an image under `Fifo`; `None` when the window shows nothing right now, and the surface error once the swapchain stopped retrying it.
    pub fn acquire(&mut self, now_ns: u64) -> Result<Option<wgpu::SurfaceTexture>, SurfaceError> {
        let texture = self.swapchain.acquire(now_ns)?;
        if let Some(texture) = &texture {
            if self.images.len() < IMAGE_CENSUS_LIMIT {
                let mut hasher = DefaultHasher::new();
                texture.texture.hash(&mut hasher);
                self.images.insert(hasher.finish());
            }
        }
        Ok(texture)
    }

    fn config(&self) -> &wgpu::SurfaceConfiguration {
        self.swapchain.config()
    }

    pub fn present(&self, texture: wgpu::SurfaceTexture) {
        self.queue.present(texture);
    }

    /// Hands the renderer the files Bun pushed, and returns how many files it finished with.
    pub fn absorb(&mut self, files: Vec<(String, Vec<u8>)>) -> u64 {
        let mut finished = 0;
        for (path, contents) in files {
            if is_font(&contents) {
                finished += 1;
                if !self.ui.add_font(&path, &contents) {
                    self.renderer.problems.push(format!("{path}: not a font face"));
                }
            } else {
                self.renderer.ingest(&path, contents);
            }
        }
        finished + self.renderer.pump()
    }

    /// Keeps the scene to draw.
    pub fn load_scene(&mut self, bytes: &[u8]) -> Result<(), String> {
        let scene = DrawScene::parse(bytes)?;
        self.scene_bytes.clear();
        self.scene_bytes.extend_from_slice(bytes);
        self.renderer.set_playing(scene.playing);
        self.scene = Some(scene);
        self.ui.load_scene(bytes)
    }

    pub fn take_problem(&mut self) -> Option<String> {
        self.renderer.problems.pop()
    }

    pub fn draw(&mut self, texture: &wgpu::SurfaceTexture, step: u64) {
        let began = Instant::now();
        let view = texture.texture.create_view(&Default::default());
        let mut timer = self.clock.as_mut().map_or_else(|_| PassTimer::off(), GpuClock::begin);
        if let Some(scene) = &self.scene {
            let frame = scene.frame;
            let mut encoder = self.device.create_command_encoder(&Default::default());
            let size = (self.config().width, self.config().height);
            self.renderer.draw_timed(&mut encoder, &mut timer, &view, size, self.aspect, scene);
            let bake = self.renderer.bake_progress().map(|progress| menu::Bake { progress, filter: progress.total > 0 && progress.ready() && self.renderer.upscales_with_filter(), playing: scene.playing, pending: self.renderer.art_pending() });
            self.ui.set_overlay(self.menu.scene(&self.settings, bake));
            let area = ui_area(size);
            self.ui.each_sprite(area, |index, extent, shot| self.renderer.draw_sprite(&mut encoder, &mut timer, index, extent, shot, scene.light.as_ref()));
            self.ui.draw(&mut encoder, &mut timer, &view, size, area, &self.renderer);
            self.encode_ms = Some(submit(&mut self.clock, &self.queue, encoder, timer, began));
            let after = self.capture.as_ref().map_or(u32::MAX, |capture| capture.after);
            let modelled = scene.poses.is_empty() || scene.poses.iter().any(|pose| self.renderer.has_model(&pose.model));
            let ready = scene.pending == 0 && modelled;
            if ready && (scene.frame as u64).max(step) >= after as u64 {
                self.save_capture(&texture.texture);
            }
            if ready && frame >= SWEEP_AFTER {
                self.sweep_step(&texture.texture, began);
            }
            return;
        }
        self.queue.write_buffer(&self.vertices, 0, bytemuck::cast_slice(&counter_vertices(step)));
        let [r, g, b] = clear_color(step);
        let mut encoder = self.device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: None,
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color { r, g, b, a: 1.0 }), store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: timer.writes(Pass::Counter),
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_vertex_buffer(0, self.vertices.slice(..));
            pass.draw(0..VERTICES as u32, 0..1);
        }
        self.encode_ms = Some(submit(&mut self.clock, &self.queue, encoder, timer, began));
    }

    /// The last frame's encode time and the GPU times that came back since the last call, which also steer the automatic render scale against a display of `refresh_ms`.
    pub fn timings(&mut self, refresh_ms: Option<f64>) -> Timings {
        let gpu = self.clock.as_mut().map_or_else(|_| Vec::new(), GpuClock::collect);
        gpu.iter().for_each(|frame| self.renderer.observe_gpu(frame.span_ms, refresh_ms));
        Timings { cpu_encode_ms: self.encode_ms.take(), render_scale: Some(self.renderer.render_scale()), gpu }
    }

    /// Why this window cannot time its passes on the GPU, if it cannot.
    pub fn gpu_timing_unavailable(&self) -> Option<&str> {
        self.clock.as_ref().err().map(String::as_str)
    }
}

impl Gpu {
    /// One frame of the preset sweep: waits for the GPU to finish the frame just submitted, and when a preset has its frames, reports and captures it and moves on.
    fn sweep_step(&mut self, texture: &wgpu::Texture, began: Instant) {
        let Some(mut sweep) = self.sweep.take() else { return };
        if !sweep.started {
            sweep.started = true;
            self.sweep_preset(&mut sweep);
        }
        let _ = self.device.poll(wgpu::PollType::wait_indefinitely());
        let millis = began.elapsed().as_secs_f64() * 1000.0;
        if sweep.skip > 0 {
            sweep.skip -= 1;
        } else {
            sweep.millis.push(millis);
        }
        if sweep.millis.len() == SWEEP_FRAMES {
            let preset = PRESETS[sweep.next];
            let mut sorted = sweep.millis.clone();
            sorted.sort_by(f64::total_cmp);
            let line = format!(
                "preset {} {}x{} on {} ({}): p50 {:.2} ms, p95 {:.2} ms, max {:.2} ms over {} frames",
                preset.name(),
                self.config().width,
                self.config().height,
                self.adapter,
                self.backend,
                percentile(&sorted, 0.5),
                percentile(&sorted, 0.95),
                sorted[sorted.len() - 1],
                sorted.len()
            );
            eprintln!("wisp-window sweep: {line}");
            let _ = std::fs::create_dir_all(&sweep.directory);
            if let Ok(mut log) = std::fs::OpenOptions::new().create(true).append(true).open(sweep.directory.join("frame-times.txt")) {
                let _ = std::io::Write::write_all(&mut log, format!("{line}\n").as_bytes());
            }
            self.write_picture(texture, &sweep.directory.join(format!("options-{}.png", preset.name().to_ascii_lowercase())));
            sweep.next += 1;
            if sweep.next == PRESETS.len() {
                self.menu_events(vec![menu::Event::Close]);
                self.apply(sweep.saved);
                return;
            }
            self.sweep_preset(&mut sweep);
        }
        self.sweep = Some(sweep);
    }

    fn sweep_preset(&mut self, sweep: &mut Sweep) {
        let mut settings = sweep.saved;
        settings.preset = PRESETS[sweep.next];
        self.apply(settings);
        self.menu.handle(menu::Event::Open, &mut settings);
        sweep.skip = SWEEP_WARMUP;
        sweep.millis.clear();
    }
}


/// Resolves the frame's stamps, finishes and submits its commands, and returns the milliseconds from `began` to the finished command buffer, the frame's encode time.
fn submit(clock: &mut Result<GpuClock, String>, queue: &wgpu::Queue, mut encoder: wgpu::CommandEncoder, timer: PassTimer, began: Instant) -> f64 {
    if let Ok(clock) = clock.as_mut() {
        clock.finish(&mut encoder, timer);
    }
    let commands = encoder.finish();
    let encode_ms = began.elapsed().as_secs_f64() * 1000.0;
    queue.submit([commands]);
    if let Ok(clock) = clock.as_mut() {
        clock.submitted();
    }
    encode_ms
}

fn ui_area(size: (u32, u32)) -> [f32; 4] {
    [0.0, 0.0, size.0 as f32, size.1 as f32]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_ui_area_is_the_window_after_a_resize_from_16_9_to_3_2() {
        assert_eq!(ui_area((1280, 720)), [0.0, 0.0, 1280.0, 720.0]);
        assert_eq!(ui_area((2880, 1920)), [0.0, 0.0, 2880.0, 1920.0]);
    }

    #[test]
    fn counter_lights_the_set_bits() {
        let lit = |step: u64| counter_vertices(step).chunks(6).filter(|square| square[0].color[0] > 0.5).count();
        assert_eq!(lit(0), 0);
        assert_eq!(lit(0b1011), 3);
        assert_eq!(counter_vertices(7).len(), VERTICES);
    }
}
