//! Glyph coverage rasterized once per font, glyph and size into one atlas texture; a glyph already there costs a hash lookup.

use std::collections::HashMap;

pub const ATLAS_SIZE: u32 = 2048;
const SIZE_STEPS: f32 = 4.0;
const FALLBACK: &[u8] = include_bytes!("../../assets/DejaVuSans.ttf");

/// The face drawn when the game names no font file, or one that has not arrived or cannot be read.
pub const FALLBACK_FONT: usize = 0;

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct Key {
    font: usize,
    glyph: u16,
    size: u16,
    outline: bool,
}

/// Where a glyph's coverage sits in the atlas and in relation to the pen: `left` and `top` are from the pen at the baseline to the bitmap's top-left corner.
#[derive(Clone, Copy, Default)]
pub struct Slot {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
    pub left: f32,
    pub top: f32,
    pub advance: f32,
}

/// Row-by-row packing: a glyph goes to the right of the last one in the row it fits, else starts a row.
struct Shelves {
    x: u32,
    y: u32,
    row: u32,
}

impl Shelves {
    fn place(&mut self, width: u32, height: u32) -> Option<(u32, u32)> {
        let (width, height) = (width + 1, height + 1);
        if self.x + width > ATLAS_SIZE {
            self.y += self.row;
            self.x = 0;
            self.row = 0;
        }
        if width > ATLAS_SIZE || self.y + height > ATLAS_SIZE {
            return None;
        }
        let at = (self.x, self.y);
        self.x += width;
        self.row = self.row.max(height);
        Some(at)
    }
}

pub struct Glyphs {
    fonts: Vec<fontdue::Font>,
    named: HashMap<String, usize>,
    slots: HashMap<Key, Slot>,
    shelves: Shelves,
    texture: wgpu::Texture,
    queue: wgpu::Queue,
    pub view: wgpu::TextureView,
    pub resets: u32,
}

/// Font files are matched the way assets are: case and slash direction do not matter.
fn key_of(path: &str) -> String {
    path.replace('\\', "/").to_lowercase()
}

pub fn is_font(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0, 1, 0, 0]) || bytes.starts_with(b"OTTO") || bytes.starts_with(b"true") || bytes.starts_with(b"ttcf")
}

impl Glyphs {
    pub fn new(device: &wgpu::Device, queue: wgpu::Queue) -> Self {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("ui glyphs"),
            size: wgpu::Extent3d { width: ATLAS_SIZE, height: ATLAS_SIZE, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::R8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let view = texture.create_view(&Default::default());
        let fallback = fontdue::Font::from_bytes(FALLBACK, fontdue::FontSettings::default()).expect("the embedded fallback face parses");
        Self { fonts: vec![fallback], named: HashMap::new(), slots: HashMap::new(), shelves: Shelves { x: 0, y: 0, row: 0 }, texture, queue, view, resets: 0 }
    }

    /// Registers the face `bytes` holds under the game's `path`; false when the bytes are not a face fontdue reads.
    pub fn add_font(&mut self, path: &str, bytes: &[u8]) -> bool {
        match fontdue::Font::from_bytes(bytes, fontdue::FontSettings::default()) {
            Ok(font) => {
                self.named.insert(key_of(path), self.fonts.len());
                self.fonts.push(font);
                true
            }
            Err(_) => false,
        }
    }

    /// The face for a frame's `font.file`: the registered one, else the fallback.
    pub fn font_for(&self, path: &str) -> usize {
        self.named.get(&key_of(path)).copied().unwrap_or(FALLBACK_FONT)
    }

    /// Empties the atlas; every glyph is rasterized again as it is next asked for.
    pub fn reset(&mut self) {
        self.slots.clear();
        self.shelves = Shelves { x: 0, y: 0, row: 0 };
        self.resets += 1;
    }

    /// The distance from the top of a line to its baseline: the ascent less half of what the face's ascent and descent exceed one em by, which is where the Chrome renderer's top baseline sits.
    pub fn line_ascent(&self, font: usize, size: f32) -> f32 {
        self.fonts[font].horizontal_line_metrics(size).map_or(size * 0.8, |metrics| metrics.ascent - (metrics.ascent - metrics.descent - size) / 2.0)
    }

    pub fn kern(&self, font: usize, left: char, right: char, size: f32) -> f32 {
        self.fonts[font].horizontal_kern(left, right, size).unwrap_or(0.0)
    }

    fn quantized(size: f32) -> u16 {
        (size * SIZE_STEPS).round().clamp(1.0, u16::MAX as f32) as u16
    }

    /// The glyph for `ch`, rasterized into the atlas if it is not there; `None` when the atlas is full.
    pub fn slot(&mut self, font: usize, ch: char, size: f32, outline: bool) -> Option<Slot> {
        let face = &self.fonts[font];
        let glyph = face.lookup_glyph_index(ch);
        let key = Key { font, glyph, size: Self::quantized(size), outline };
        if let Some(slot) = self.slots.get(&key) {
            return Some(*slot);
        }
        let px = key.size as f32 / SIZE_STEPS;
        let (metrics, coverage) = face.rasterize_indexed(glyph, px);
        let mut slot = Slot { left: metrics.xmin as f32, top: (metrics.ymin + metrics.height as i32) as f32, advance: metrics.advance_width, ..Slot::default() };
        let (mut width, mut height, mut bitmap) = (metrics.width, metrics.height, coverage);
        if outline && width > 0 && height > 0 {
            let reach = outline_reach(px);
            (width, height, bitmap) = grow(&bitmap, width, height, px, reach);
            slot.left -= reach as f32;
            slot.top += reach as f32;
        }
        if width > 0 && height > 0 {
            let (x, y) = self.shelves.place(width as u32, height as u32)?;
            self.queue.write_texture(
                wgpu::TexelCopyTextureInfo { texture: &self.texture, mip_level: 0, origin: wgpu::Origin3d { x, y, z: 0 }, aspect: wgpu::TextureAspect::All },
                &bitmap,
                wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(width as u32), rows_per_image: Some(height as u32) },
                wgpu::Extent3d { width: width as u32, height: height as u32, depth_or_array_layers: 1 },
            );
            slot.x = x as u16;
            slot.y = y as u16;
            slot.width = width as u16;
            slot.height = height as u16;
        }
        self.slots.insert(key, slot);
        Some(slot)
    }
}

/// The radius of the Chrome renderer's outline: half its stroke, `max(1, size / 12)` wide, and half a pixel of edge.
fn outline_radius(px: f32) -> f32 {
    (px / 12.0).max(1.0) / 2.0 + 0.5
}

/// The pixels the outline reaches past the glyph.
pub fn outline_reach(px: f32) -> usize {
    outline_radius(px).ceil() as usize
}

/// `coverage` grown by `reach` pixels in every direction: each pixel takes the strongest coverage within the outline's radius.
fn grow(coverage: &[u8], width: usize, height: usize, px: f32, reach: usize) -> (usize, usize, Vec<u8>) {
    let radius = outline_radius(px);
    let (grown_width, grown_height) = (width + 2 * reach, height + 2 * reach);
    let mut offsets = Vec::new();
    for dy in -(reach as i32)..=reach as i32 {
        for dx in -(reach as i32)..=reach as i32 {
            if ((dx * dx + dy * dy) as f32).sqrt() <= radius {
                offsets.push((dx, dy));
            }
        }
    }
    let mut grown = vec![0u8; grown_width * grown_height];
    for y in 0..height {
        for x in 0..width {
            let value = coverage[y * width + x];
            if value == 0 {
                continue;
            }
            for &(dx, dy) in &offsets {
                let at = (y + reach).wrapping_add_signed(dy as isize) * grown_width + (x + reach).wrapping_add_signed(dx as isize);
                grown[at] = grown[at].max(value);
            }
        }
    }
    (grown_width, grown_height, grown)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shelves_fill_a_row_then_start_the_next() {
        let mut shelves = Shelves { x: 0, y: 0, row: 0 };
        assert_eq!(shelves.place(1000, 10), Some((0, 0)));
        assert_eq!(shelves.place(1000, 20), Some((1001, 0)));
        assert_eq!(shelves.place(100, 5), Some((0, 21)));
        assert_eq!(shelves.place(ATLAS_SIZE, 5), None);
        shelves.y = ATLAS_SIZE - 3;
        assert_eq!(shelves.place(10, 5), None);
    }

    #[test]
    fn an_outline_surrounds_a_pixel_by_its_reach() {
        let (width, height, grown) = grow(&[255], 1, 1, 12.0, 1);
        assert_eq!((width, height), (3, 3));
        assert_eq!(grown[4], 255);
        assert_eq!(grown[1], 255);
        assert_eq!(outline_reach(36.0), 2);
        assert_eq!(outline_reach(7.0), 1);
    }

    #[test]
    fn font_magic_is_told_from_images() {
        assert!(is_font(&[0, 1, 0, 0, 9]));
        assert!(is_font(b"OTTO1"));
        assert!(!is_font(b"\x89PNG"));
        assert!(!is_font(b"BLP1"));
    }
}
