//! Buffers, bind groups and textures the renderer creates from plain data.

use std::mem::size_of;

use crate::texture::Image;

use super::math::Mat4;
use super::Instance;

/// The rectangle (x, y, width, height) of the largest `aspect` picture centred in `size`.
pub fn fitted(size: (u32, u32), aspect: f32) -> [u32; 4] {
    let width = (size.0 as f32).min(size.1 as f32 * aspect).floor().max(1.0);
    let height = (width / aspect).floor().max(1.0);
    let (width, height) = (width as u32, (height as u32).min(size.1));
    [(size.0 - width) / 2, (size.1 - height) / 2, width, height]
}

pub(super) fn bone_storage(device: &wgpu::Device, count: usize) -> wgpu::Buffer {
    device.create_buffer(&wgpu::BufferDescriptor { label: Some("bones"), size: (count * size_of::<Mat4>()) as u64, usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false })
}

pub(super) fn color_storage(device: &wgpu::Device, count: usize) -> wgpu::Buffer {
    device.create_buffer(&wgpu::BufferDescriptor { label: Some("slot colors"), size: (count * size_of::<[f32; 4]>()) as u64, usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false })
}

pub(super) fn uv_storage(device: &wgpu::Device, slots: usize) -> wgpu::Buffer {
    device.create_buffer(&wgpu::BufferDescriptor { label: Some("uv rows"), size: (slots * 2 * size_of::<[f32; 4]>()) as u64, usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false })
}

pub(super) fn instance_storage(device: &wgpu::Device, count: usize) -> wgpu::Buffer {
    device.create_buffer(&wgpu::BufferDescriptor { label: Some("instances"), size: (count * size_of::<Instance>()) as u64, usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false })
}

pub(super) fn frame_group(device: &wgpu::Device, layout: &wgpu::BindGroupLayout, frame: &wgpu::Buffer, bones: &wgpu::Buffer, colors: &wgpu::Buffer, uv_rows: &wgpu::Buffer) -> wgpu::BindGroup {
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("frame"),
        layout,
        entries: &[wgpu::BindGroupEntry { binding: 0, resource: frame.as_entire_binding() }, wgpu::BindGroupEntry { binding: 1, resource: bones.as_entire_binding() }, wgpu::BindGroupEntry { binding: 2, resource: colors.as_entire_binding() }, wgpu::BindGroupEntry { binding: 3, resource: uv_rows.as_entire_binding() }],
    })
}

/// A texture with its whole mip chain, each level a box filter of the one above.
pub(super) fn upload(device: &wgpu::Device, queue: &wgpu::Queue, image: &Image) -> wgpu::TextureView {
    let levels = 32 - image.width.max(image.height).max(1).leading_zeros();
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("texture"),
        size: wgpu::Extent3d { width: image.width, height: image.height, depth_or_array_layers: 1 },
        mip_level_count: levels,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    let mut level = Image { width: image.width, height: image.height, rgba: Vec::new() };
    for mip in 0..levels {
        let source = if mip == 0 { image } else { &level };
        queue.write_texture(
            wgpu::TexelCopyTextureInfo { texture: &texture, mip_level: mip, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            &source.rgba,
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(source.width * 4), rows_per_image: Some(source.height) },
            wgpu::Extent3d { width: source.width, height: source.height, depth_or_array_layers: 1 },
        );
        level = halved(source);
    }
    texture.create_view(&Default::default())
}

/// The images as the layers of one array texture, each with its whole mip chain; they must share a size.
pub(super) fn upload_layers(device: &wgpu::Device, queue: &wgpu::Queue, images: &[&Image]) -> wgpu::TextureView {
    let first = images[0];
    let levels = 32 - first.width.max(first.height).max(1).leading_zeros();
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("water frames"),
        size: wgpu::Extent3d { width: first.width, height: first.height, depth_or_array_layers: images.len() as u32 },
        mip_level_count: levels,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    for (layer, image) in images.iter().enumerate() {
        let mut level = Image { width: image.width, height: image.height, rgba: Vec::new() };
        for mip in 0..levels {
            let source = if mip == 0 { *image } else { &level };
            queue.write_texture(
                wgpu::TexelCopyTextureInfo { texture: &texture, mip_level: mip, origin: wgpu::Origin3d { x: 0, y: 0, z: layer as u32 }, aspect: wgpu::TextureAspect::All },
                &source.rgba,
                wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(source.width * 4), rows_per_image: Some(source.height) },
                wgpu::Extent3d { width: source.width, height: source.height, depth_or_array_layers: 1 },
            );
            level = halved(source);
        }
    }
    texture.create_view(&wgpu::TextureViewDescriptor { dimension: Some(wgpu::TextureViewDimension::D2Array), ..Default::default() })
}

/// The sampler model layers read with: repeating, linear, trilinear and anisotropic.
pub(super) fn repeat_sampler(device: &wgpu::Device) -> wgpu::Sampler {
    device.create_sampler(&wgpu::SamplerDescriptor {
        address_mode_u: wgpu::AddressMode::Repeat,
        address_mode_v: wgpu::AddressMode::Repeat,
        mag_filter: wgpu::FilterMode::Linear,
        min_filter: wgpu::FilterMode::Linear,
        mipmap_filter: wgpu::MipmapFilterMode::Linear,
        anisotropy_clamp: 16,
        ..Default::default()
    })
}

pub(super) fn white() -> Image {
    Image { width: 1, height: 1, rgba: vec![255; 4] }
}

/// The next mip level, a 2x2 box filter.
pub(super) fn halved(image: &Image) -> Image {
    let (width, height) = ((image.width / 2).max(1), (image.height / 2).max(1));
    let mut rgba = vec![0u8; (width * height * 4) as usize];
    for y in 0..height {
        for x in 0..width {
            for channel in 0..4 {
                let at = |dx: u32, dy: u32| {
                    let (sx, sy) = ((x * 2 + dx).min(image.width - 1), (y * 2 + dy).min(image.height - 1));
                    image.rgba[((sy * image.width + sx) * 4 + channel) as usize] as u32
                };
                rgba[((y * width + x) * 4 + channel) as usize] = ((at(0, 0) + at(1, 0) + at(0, 1) + at(1, 1) + 2) / 4) as u8;
            }
        }
    }
    Image { width, height, rgba }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_picture_is_centred_with_bars_where_the_window_is_taller_or_wider() {
        assert_eq!(fitted((1416, 1840), 16.0 / 9.0), [0, 522, 1416, 796]);
        assert_eq!(fitted((1920, 540), 16.0 / 9.0), [(1920 - 960) / 2, 0, 960, 540]);
        assert_eq!(fitted((1280, 720), 16.0 / 9.0), [0, 0, 1280, 720]);
    }

    #[test]
    fn halving_averages_a_two_by_two_block() {
        let image = Image { width: 2, height: 2, rgba: vec![0, 0, 0, 255, 1, 0, 0, 255, 1, 0, 0, 255, 0, 0, 0, 255] };
        let half = halved(&image);
        assert_eq!((half.width, half.height), (1, 1));
        assert_eq!(half.rgba, vec![1, 0, 0, 255]);
    }
}
