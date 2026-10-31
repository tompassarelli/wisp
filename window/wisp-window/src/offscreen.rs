//! The native renderer with no window: one scene drawn into a texture and read back as a PNG, for captures and `bun wisp render compare` (wisp:docs/native-window-plan.md, W3).

use crate::capture;
use crate::remaster::{device_limits, Quality};
use crate::render::{DrawScene, Renderer};
use crate::settings::Preset;

const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

pub struct Offscreen {
    device: wgpu::Device,
    queue: wgpu::Queue,
    renderer: Renderer,
    size: (u32, u32),
    ingested: u64,
    finished: u64,
    picture: Vec<u8>,
    pub adapter: String,
    pub backend: String,
}

impl Offscreen {
    pub fn new(width: u32, height: u32) -> Result<Self, String> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions { power_preference: wgpu::PowerPreference::HighPerformance, ..Default::default() })).map_err(|error| format!("adapter: {error}"))?;
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor { required_limits: device_limits(&adapter.limits()), ..Default::default() })).map_err(|error| format!("device: {error}"))?;
        Ok(Self::with_device(adapter.get_info(), device, queue, width, height))
    }

    pub fn with_device(info: wgpu::AdapterInfo, device: wgpu::Device, queue: wgpu::Queue, width: u32, height: u32) -> Self {
        let renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, Quality::Off, Preset::Low.features());
        Self { device, queue, renderer, size: (width.max(1), height.max(1)), ingested: 0, finished: 0, picture: Vec::new(), adapter: info.name, backend: format!("{:?}", info.backend) }
    }

    pub fn ingest(&mut self, path: &str, bytes: &[u8]) {
        self.ingested += 1;
        self.renderer.ingest(path, bytes.to_vec());
    }

    /// Uploads what finished decoding; returns how many ingested files the renderer has not finished with.
    pub fn pending(&mut self) -> u64 {
        self.finished += self.renderer.pump();
        self.ingested.saturating_sub(self.finished)
    }

    /// The adapter, its backend and the problems the renderer found with the files it was given (drained), as JSON.
    pub fn info(&mut self) -> String {
        serde_json::json!({ "adapter": self.adapter, "backend": self.backend, "problems": self.renderer.problems.drain(..).collect::<Vec<_>>() }).to_string()
    }

    /// The PNG of the last scene drawn.
    pub fn picture(&self) -> &[u8] {
        &self.picture
    }

    /// Draws `scene` (the JSON Bun sends the window) and keeps the image as a PNG.
    pub fn render(&mut self, scene: &[u8]) -> Result<(), String> {
        let scene = DrawScene::parse(scene)?;
        self.renderer.set_playing(scene.playing);
        let (width, height) = self.size;
        let target = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("offscreen"),
            size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let row = (width * 4).next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
        let buffer = self.device.create_buffer(&wgpu::BufferDescriptor { label: Some("offscreen readback"), size: (row * height) as u64, usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false });
        let mut encoder = self.device.create_command_encoder(&Default::default());
        self.renderer.draw(&mut encoder, &target.create_view(&Default::default()), self.size, width as f32 / height as f32, &scene);
        encoder.copy_texture_to_buffer(
            target.as_image_copy(),
            wgpu::TexelCopyBufferInfo { buffer: &buffer, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row), rows_per_image: Some(height) } },
            wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        );
        self.queue.submit([encoder.finish()]);
        buffer.slice(..).map_async(wgpu::MapMode::Read, |_| ());
        self.device.poll(wgpu::PollType::wait_indefinitely()).map_err(|error| format!("poll: {error}"))?;
        let mapped = buffer.slice(..).get_mapped_range().map_err(|error| format!("readback: {error}"))?;
        let mut rgba = Vec::with_capacity((width * height * 4) as usize);
        for line in mapped.chunks(row as usize).take(height as usize) {
            for pixel in line[..(width * 4) as usize].chunks(4) {
                rgba.extend_from_slice(&[pixel[0], pixel[1], pixel[2], 255]);
            }
        }
        self.picture = capture::png(width, height, &rgba);
        Ok(())
    }
}
