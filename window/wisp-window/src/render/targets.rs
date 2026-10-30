//! The scene pass's attachments: multisampled half-float colour and depth, and the single-sample colour they resolve into.

use super::{DEPTH, HDR, SAMPLES};

pub struct Targets {
    pub size: (u32, u32),
    pub color: wgpu::TextureView,
    pub depth: wgpu::TextureView,
    pub resolved: wgpu::TextureView,
    #[cfg(test)]
    pub resolved_texture: wgpu::Texture,
}

impl Targets {
    pub fn new(device: &wgpu::Device, size: (u32, u32)) -> Self {
        let make = |format, label, samples, usage| {
            device.create_texture(&wgpu::TextureDescriptor {
                label: Some(label),
                size: wgpu::Extent3d { width: size.0, height: size.1, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: samples,
                dimension: wgpu::TextureDimension::D2,
                format,
                usage,
                view_formats: &[],
            })
        };
        let attachment = wgpu::TextureUsages::RENDER_ATTACHMENT;
        let sampled = attachment | wgpu::TextureUsages::TEXTURE_BINDING;
        let view = |texture: &wgpu::Texture| texture.create_view(&Default::default());
        let resolved = make(HDR, "scene resolved", 1, sampled | wgpu::TextureUsages::COPY_SRC);
        Self {
            size,
            color: view(&make(HDR, "scene colour", SAMPLES, attachment)),
            depth: view(&make(DEPTH, "scene depth", SAMPLES, sampled)),
            resolved: view(&resolved),
            #[cfg(test)]
            resolved_texture: resolved,
        }
    }
}
