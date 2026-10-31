//! The scene pass's attachments: half-float colour and depth with the units' stencil at the scene's samples per pixel, and the single-sample colour they resolve into,
//! which with one sample is the colour itself.

use super::{DEPTH, HDR};
use crate::settings::Features;

pub struct Targets {
    pub size: (u32, u32),
    pub samples: u32,
    pub color: wgpu::TextureView,
    /// Depth and stencil together, as the scene passes write them.
    pub depth: wgpu::TextureView,
    /// The depth alone, as the water and the final-image pass read it.
    pub depth_only: wgpu::TextureView,
    /// The stencil alone, where a unit's solid layers wrote `UNIT`.
    pub stencil: wgpu::TextureView,
    pub resolved: wgpu::TextureView,
    pub resolved_texture: wgpu::Texture,
}

impl Targets {
    pub fn new(device: &wgpu::Device, size: (u32, u32), samples: u32) -> Self {
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
        let aspect = |texture: &wgpu::Texture, aspect| texture.create_view(&wgpu::TextureViewDescriptor { aspect, ..Default::default() });
        let resolved = make(HDR, "scene resolved", 1, sampled | wgpu::TextureUsages::COPY_SRC);
        let color = if samples > 1 { view(&make(HDR, "scene colour", samples, attachment)) } else { view(&resolved) };
        let depth = make(DEPTH, "scene depth", samples, sampled);
        let (depth_only, stencil) = (aspect(&depth, wgpu::TextureAspect::DepthOnly), aspect(&depth, wgpu::TextureAspect::StencilOnly));
        Self { size, samples, color, depth: view(&depth), depth_only, stencil, resolved: view(&resolved), resolved_texture: resolved }
    }

    pub fn resolving<'a>(&self, target: &'a wgpu::TextureView) -> Option<&'a wgpu::TextureView> {
        (self.samples > 1).then_some(target)
    }
}

pub(super) fn samples_of(features: Features) -> u32 {
    if features.msaa > 1 {
        4
    } else {
        1
    }
}

pub(crate) fn depth_shader(source: &str, samples: u32) -> String {
    if samples > 1 {
        source.to_string()
    } else {
        source.replace("texture_depth_multisampled_2d", "texture_depth_2d").replace("texture_multisampled_2d<u32>", "texture_2d<u32>")
    }
}
