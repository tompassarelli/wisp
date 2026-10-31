//! The scene pass's attachments: half-float colour and depth with the units' stencil at the scene's samples per pixel, and the single-sample colour they resolve into,
//! which with one sample is the colour itself.

use super::{Renderer, DEPTH, HDR};
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

/// The device features that let a device draw the scene at the sample counts its adapter offers past WebGPU's guaranteed 1 and 4.
pub fn multisample_features(offered: wgpu::Features) -> wgpu::Features {
    offered & wgpu::Features::TEXTURE_ADAPTER_SPECIFIC_FORMAT_FEATURES
}

/// The sample counts of 2, 4 and 8 the device accepts for both the scene's colour and depth, as a mask of the counts.
fn offered_samples(device: &wgpu::Device) -> u32 {
    let accepts = |samples: u32| {
        let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
        for format in [HDR, DEPTH] {
            let size = wgpu::Extent3d { width: 1, height: 1, depth_or_array_layers: 1 };
            drop(device.create_texture(&wgpu::TextureDescriptor { label: Some("sample count probe"), size, mip_level_count: 1, sample_count: samples, dimension: wgpu::TextureDimension::D2, format, usage: wgpu::TextureUsages::RENDER_ATTACHMENT, view_formats: &[] }));
        }
        pollster::block_on(scope.pop()).is_none()
    };
    [2, 4, 8].into_iter().filter(|&samples| accepts(samples)).fold(0, |mask, samples| mask | samples)
}

/// The sample counts the device offers, and the samples per pixel `features` draw the scene at on it.
pub(super) fn sample_counts(device: &wgpu::Device, features: Features) -> (u32, u32) {
    let offered = offered_samples(device);
    (offered, samples_of(features, offered))
}

/// The samples per pixel the scene draws at: the `msaa` setting's count when the device offers it, else 4, which every adapter offers.
pub(super) fn samples_of(features: Features, offered: u32) -> u32 {
    let wanted = features.msaa.clamp(1, 8).next_power_of_two();
    [wanted, 4].into_iter().find(|&samples| samples == 1 || offered & samples != 0).unwrap_or(1)
}

pub(crate) fn depth_shader(source: &str, samples: u32) -> String {
    if samples > 1 {
        source.to_string()
    } else {
        source.replace("texture_depth_multisampled_2d", "texture_depth_2d").replace("texture_multisampled_2d<u32>", "texture_2d<u32>")
    }
}

/// The scene's size at `percent` of the window's sides.
pub fn scaled(window: (u32, u32), percent: u8) -> (u32, u32) {
    let side = |edge: u32| (edge * u32::from(percent) / 100).max(1);
    (side(window.0), side(window.1))
}

impl Renderer {
    /// Sizes the scene's and the final-image pass's targets to the scene drawn in a `window`-sized surface at the current render scale, and returns that size.
    pub(super) fn fit_targets(&mut self, window: (u32, u32)) -> (u32, u32) {
        let size = scaled(window, self.resolution.percent());
        if self.targets.as_ref().is_some_and(|targets| targets.size == size) {
            return size;
        }
        if self.targets.is_some() || size != window {
            eprintln!("wisp window: the scene draws at {}% of the window, {}x{} of {}x{}", self.resolution.percent(), size.0, size.1, window.0, window.1);
        }
        let targets = Targets::new(&self.device, size, self.samples);
        self.post.fit(size, &targets.resolved, &targets.depth_only, &targets.stencil);
        self.targets = Some(targets);
        size
    }

    /// Feeds one frame's GPU span to the automatic render scale, held to the budget of a display of `refresh_ms`, which may resize the next frame's scene.
    pub fn observe_gpu(&mut self, span_ms: f64, refresh_ms: Option<f64>) {
        self.resolution.observe(span_ms, super::resolution::budget_ms(refresh_ms));
    }

    /// The scene's current scale, in percent of the window's sides.
    pub fn render_scale(&self) -> u8 {
        self.resolution.percent()
    }
}

