use crate::adapter;
use crate::capture::{read_picture, Picture};
use crate::render::{DrawScene, Renderer};

const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

pub struct Offscreen {
    device: wgpu::Device,
    queue: wgpu::Queue,
    renderer: Renderer,
    pub adapter: String,
    pub backend: String,
    pub device_type: wgpu::DeviceType,
}

impl Offscreen {
    pub fn new() -> Result<Self, String> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let adapter = adapter::pick(&instance, None)?;
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default())).map_err(|e| format!("device: {e}"))?;
        let info = adapter.get_info();
        let renderer = Renderer::new(device.clone(), queue.clone(), FORMAT);
        Ok(Self { device, queue, renderer, adapter: info.name, backend: format!("{:?}", info.backend), device_type: info.device_type })
    }

    pub fn draw(&mut self, scene: &DrawScene, size: (u32, u32), aspect: f32) -> Option<Picture> {
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("offscreen"),
            size: wgpu::Extent3d { width: size.0, height: size.1, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&Default::default());
        let mut encoder = self.device.create_command_encoder(&Default::default());
        self.renderer.draw(&mut encoder, &view, size, aspect, scene);
        self.queue.submit([encoder.finish()]);
        read_picture(&self.device, &self.queue, &texture, size, false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn offscreen() -> Offscreen {
        let offscreen = Offscreen::new().expect("an adapter that can draw");
        eprintln!("adapter: {} ({}, {:?})", offscreen.adapter, offscreen.backend, offscreen.device_type);
        offscreen
    }

    #[test]
    fn the_adapter_is_the_one_wisp_gpu_names() {
        let offscreen = offscreen();
        if let Some(wanted) = std::env::var("WISP_GPU").ok().filter(|name| !name.is_empty()) {
            assert!(offscreen.adapter.to_lowercase().contains(&wanted.to_lowercase()), "{} is not {wanted}", offscreen.adapter);
        }
    }

    #[test]
    fn an_empty_scene_is_the_scenes_clear_colour_at_every_pixel() {
        let mut offscreen = offscreen();
        let scene = DrawScene { clear: [0.2, 0.4, 0.6], ..Default::default() };
        let picture = offscreen.draw(&scene, (64, 48), 64.0 / 48.0).expect("read back");
        assert_eq!((picture.width, picture.height), (64, 48));
        assert_eq!(picture.rgba.len(), 64 * 48 * 4);
        for pixel in picture.rgba.chunks(4) {
            assert!(pixel[0].abs_diff(51) <= 1 && pixel[1].abs_diff(102) <= 1 && pixel[2].abs_diff(153) <= 1 && pixel[3] == 255, "{pixel:?}");
        }
    }
}
