//! Real-CUGAN 2x conservative (bilibili, MIT) on the window's own wgpu device: the player's texture goes through the network one tile at a time, with the network's 18 pixels of context taken from the texture itself where it has neighbours and mirrored where it does not; a tiling texture is wrapped by 16 pixels first.

mod network;
#[cfg(test)]
mod reference;
mod weights;

use crate::texture::Image;
use network::{widest_activation, Network, CONTEXT};

pub use network::device_limits;
pub use weights::NOTICE;

/// Names the model and its weights, so a cache entry made by other weights is never read.
pub const MODEL: &str = "real-cugan-se-up2x-conservative-20220728";

/// How a texture continues past its edge.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Edges {
    /// Mirrored without repeating the edge row, which is what the reference tool does.
    Mirror,
    /// Wrapped, for textures that tile.
    Wrap,
}

/// Pixels a tiling texture is wrapped by before the network sees it, and the reference tool was given the same; the network reaches 18, so the outermost two of its context come from mirroring the wrapped picture.
const WRAP: usize = 16;

/// Pixels a tile has inside its context at the least: the network rejects a tile of 40 or fewer across, so a smaller one is extended with more of its own context and the extra output is dropped.
const MIN_INNER: usize = 6;

/// Columns and rows of tiles, as few as possible, so that no tile's widest activation exceeds `floats`; the longer side of a tile is split first. The squeeze-excitation gates are computed per tile, so a texture that fits stays one tile.
fn tiling(width: usize, height: usize, floats: u64) -> (usize, usize) {
    let (mut columns, mut rows) = (1, 1);
    while widest_activation(width.div_ceil(columns).max(MIN_INNER), height.div_ceil(rows).max(MIN_INNER)) > floats && (columns < width || rows < height) {
        if width.div_ceil(columns) >= height.div_ceil(rows) {
            columns += 1;
        } else {
            rows += 1;
        }
    }
    (columns, rows)
}

pub struct Cugan {
    network: Network,
}

impl Cugan {
    pub fn new(device: wgpu::Device, queue: wgpu::Queue) -> Result<Self, String> {
        Ok(Self { network: Network::new(device, queue)? })
    }

    /// Doubles the colour of `image`; the result is opaque, and its alpha is the caller's to fill.
    pub fn upscale(&mut self, image: &Image, edges: Edges) -> Result<Image, String> {
        match edges {
            Edges::Mirror => self.upscale_mirrored(image),
            Edges::Wrap => {
                let doubled = self.upscale_mirrored(&wrapped(image, WRAP))?;
                Ok(cropped(&doubled, 2 * WRAP, (image.width as usize * 2, image.height as usize * 2)))
            }
        }
    }

    fn upscale_mirrored(&mut self, image: &Image) -> Result<Image, String> {
        let floats = self.network.tensor_floats();
        self.upscale_within(image, floats)
    }

    fn upscale_within(&mut self, image: &Image, floats: u64) -> Result<Image, String> {
        let (width, height) = (image.width as usize, image.height as usize);
        if width == 0 || height == 0 {
            return Err("an empty texture".into());
        }
        let (columns, rows) = tiling(width, height, floats);
        let (tile_width, tile_height) = (width.div_ceil(columns), height.div_ceil(rows));
        let mut rgba = vec![255u8; width * height * 4 * 4];
        for row in 0..rows {
            for column in 0..columns {
                let (x0, y0) = (column * tile_width, row * tile_height);
                let (x1, y1) = ((x0 + tile_width).min(width), (y0 + tile_height).min(height));
                let (inner_width, inner_height) = ((x1 - x0 + (x1 - x0) % 2).max(MIN_INNER), (y1 - y0 + (y1 - y0) % 2).max(MIN_INNER));
                let planes = gather(image, (x0, y0), (inner_width, inner_height));
                let context = 2 * CONTEXT as usize;
                let colour = self.network.run(&planes, (inner_width + context) as u32, (inner_height + context) as u32)?;
                let plane = 4 * inner_width * inner_height;
                for y in 0..(y1 - y0) * 2 {
                    for x in 0..(x1 - x0) * 2 {
                        let out = ((y0 * 2 + y) * width * 2 + x0 * 2 + x) * 4;
                        for channel in 0..3 {
                            rgba[out + channel] = to_byte(colour[channel * plane + y * inner_width * 2 + x]);
                        }
                    }
                }
            }
        }
        Ok(Image { width: image.width * 2, height: image.height * 2, rgba })
    }
}

/// Where context pixel `index` of a side `length` pixels long comes from: the pixel itself inside, else mirrored without repeating the edge.
fn source_index(index: i64, length: usize) -> usize {
    let length = length as i64;
    if length == 1 {
        return 0;
    }
    let period = 2 * (length - 1);
    let folded = index.rem_euclid(period);
    (if folded < length { folded } else { period - folded }) as usize
}

/// `image` with `by` pixels of itself wrapped around every side.
fn wrapped(image: &Image, by: usize) -> Image {
    let (width, height) = (image.width as usize, image.height as usize);
    let (out_width, out_height) = (width + 2 * by, height + 2 * by);
    let mut rgba = Vec::with_capacity(out_width * out_height * 4);
    for y in 0..out_height {
        let row = (y + height * (by.div_ceil(height) + 1) - by) % height * width;
        for x in 0..out_width {
            let at = (row + (x + width * (by.div_ceil(width) + 1) - by) % width) * 4;
            rgba.extend_from_slice(&image.rgba[at..at + 4]);
        }
    }
    Image { width: out_width as u32, height: out_height as u32, rgba }
}

/// The `size` rectangle of `image` that starts `by` pixels in from the top left.
fn cropped(image: &Image, by: usize, size: (usize, usize)) -> Image {
    let mut rgba = Vec::with_capacity(size.0 * size.1 * 4);
    for y in 0..size.1 {
        let start = ((y + by) * image.width as usize + by) * 4;
        rgba.extend_from_slice(&image.rgba[start..start + size.0 * 4]);
    }
    Image { width: size.0 as u32, height: size.1 as u32, rgba }
}

/// The tile's three colour planes in `[0, 1]`, `inner` pixels from `origin` with the network's context around them.
fn gather(image: &Image, origin: (usize, usize), inner: (usize, usize)) -> Vec<f32> {
    let context = CONTEXT as usize;
    let (width, height) = (inner.0 + 2 * context, inner.1 + 2 * context);
    let xs: Vec<usize> = (0..width).map(|x| source_index((origin.0 + x) as i64 - context as i64, image.width as usize)).collect();
    let mut planes = vec![0.0; 3 * width * height];
    for y in 0..height {
        let row = source_index((origin.1 + y) as i64 - context as i64, image.height as usize) * image.width as usize;
        for (x, source) in xs.iter().enumerate() {
            let at = (row + source) * 4;
            for channel in 0..3 {
                planes[channel * width * height + y * width + x] = f32::from(image.rgba[at + channel]) / 255.0;
            }
        }
    }
    planes
}

/// The reference tool's output rule: scale to 255, add a half and truncate.
fn to_byte(value: f32) -> u8 {
    (value * 255.0 + 0.5).floor().clamp(0.0, 255.0) as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device() -> Option<(wgpu::Device, wgpu::Queue)> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions::default())).ok()?;
        pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default())).ok()
    }

    fn texture(width: u32, height: u32) -> Image {
        let rgba = (0..width * height).flat_map(|index| [(index * 53 % 251) as u8, (index * 29 % 241) as u8, (index * 7 % 233) as u8, 255]).collect();
        Image { width, height, rgba }
    }

    #[test]
    fn odd_and_tiny_textures_double_exactly_with_either_edge_rule() {
        let Some((device, queue)) = device() else { return };
        let mut cugan = Cugan::new(device, queue).unwrap();
        for (width, height) in [(1, 1), (2, 2), (3, 5), (4, 4), (5, 7), (1, 40), (37, 38), (38, 38), (41, 43), (100, 3)] {
            for edges in [Edges::Mirror, Edges::Wrap] {
                let doubled = cugan.upscale(&texture(width, height), edges).unwrap_or_else(|error| panic!("{width}x{height} {edges:?}: {error}"));
                assert_eq!((doubled.width, doubled.height), (width * 2, height * 2), "{width}x{height} {edges:?}");
                assert_eq!(doubled.rgba.len(), (width * height * 16) as usize);
            }
        }
    }

    #[test]
    fn a_flat_tiny_texture_stays_flat() {
        let Some((device, queue)) = device() else { return };
        let mut cugan = Cugan::new(device, queue).unwrap();
        let flat = Image { width: 3, height: 1, rgba: [90, 120, 150, 255].repeat(3) };
        let doubled = cugan.upscale(&flat, Edges::Mirror).unwrap();
        assert!(doubled.rgba.chunks_exact(4).all(|pixel| pixel[..3].iter().zip([90u8, 120, 150]).all(|(got, want)| got.abs_diff(want) <= 3)), "{:?}", &doubled.rgba[..12]);
    }

    #[test]
    fn tiles_of_37_and_38_pixels_at_the_texture_edge_run() {
        let Some((device, queue)) = device() else { return };
        let mut cugan = Cugan::new(device, queue).unwrap();
        let image = texture(75, 38);
        let budget = widest_activation(38, 38);
        assert_eq!(tiling(75, 38, budget), (2, 1));
        let doubled = cugan.upscale_within(&image, budget).unwrap();
        assert_eq!((doubled.width, doubled.height), (150, 76));
    }

    #[test]
    fn context_mirrors_without_repeating_the_edge() {
        let mirrored: Vec<usize> = (-3..7).map(|index| source_index(index, 4)).collect();
        assert_eq!(mirrored, [3, 2, 1, 0, 1, 2, 3, 2, 1, 0]);
        assert_eq!(source_index(-5, 1), 0);
    }

    #[test]
    fn wrapping_pads_with_the_texture_itself_and_cropping_undoes_it() {
        let image = Image { width: 3, height: 2, rgba: (0..6).flat_map(|value| [value, 0, 0, 255]).collect() };
        let padded = wrapped(&image, 4);
        let first_row: Vec<u8> = padded.rgba.chunks_exact(4).take(11).map(|pixel| pixel[0]).collect();
        assert_eq!((padded.width, padded.height), (11, 10));
        assert_eq!(first_row, [2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0]);
        assert_eq!(cropped(&padded, 4, (3, 2)).rgba, image.rgba);
    }

    #[test]
    fn a_texture_splits_only_when_its_widest_activation_exceeds_the_budget() {
        let budget = (160u64 << 20) / 4;
        assert_eq!(tiling(256, 256, budget), (1, 1));
        assert_eq!(tiling(512, 256, budget), (1, 1));
        assert_eq!(tiling(1023, 1023, budget), (3, 3));
        assert_eq!(tiling(512, 256, (128u64 << 20) / 4), (2, 1));
        assert_eq!(tiling(1, 1, 1), (1, 1));
    }
}
