//! Remasters a Classic texture on the player's machine: an upscaled albedo, plus a tangent-space normal map with roughness in its alpha, both derived from the player's own file. Results are cached under the player's cache directory and never leave it.

mod bake;
mod cache;
pub mod check;
mod cugan;
mod relief;
mod upscale;
mod upscaler;

use std::str::FromStr;

use crate::texture::Image;

pub use bake::{Baker, Progress};
pub use cache::Cache;
pub use cugan::{device_limits, Edges, NOTICE as REAL_CUGAN_NOTICE};
pub use upscaler::{Upscaler, FILTER};

/// Textures this large or larger are already high resolution (backdrops, loading screens) and are left as they are.
pub const LARGEST_SOURCE: u32 = 1024;

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum Quality {
    #[default]
    Off,
    Standard,
    High,
}

impl Quality {
    /// Doublings of the texture's resolution.
    pub fn upscale_steps(self) -> u32 {
        match self {
            Quality::Off => 0,
            Quality::Standard => 1,
            Quality::High => 2,
        }
    }

    /// Midpoint subdivisions of a model's triangles.
    pub fn tessellation_levels(self) -> u32 {
        self.upscale_steps()
    }

    fn name(self) -> &'static str {
        match self {
            Quality::Off => "off",
            Quality::Standard => "standard",
            Quality::High => "high",
        }
    }
}

impl FromStr for Quality {
    type Err = String;

    fn from_str(text: &str) -> Result<Self, String> {
        match text.to_ascii_lowercase().as_str() {
            "off" | "0" | "" => Ok(Quality::Off),
            "standard" | "1" => Ok(Quality::Standard),
            "high" | "2" => Ok(Quality::High),
            other => Err(format!("remaster quality {other:?} is not off, standard or high")),
        }
    }
}

/// What a remastered texture gives the renderer: `albedo` straight-alpha RGBA, and `relief` whose RGB is a tangent-space normal (x toward +u, y toward +v, which is down the image, z out of the surface; each stored as `n * 0.5 + 0.5`) and whose alpha is roughness.
pub struct Maps {
    pub albedo: Image,
    pub relief: Image,
}

/// Bumped whenever the output of `enhance` changes, so stale cache entries are never read.
const ALGORITHM: u32 = 2;

/// Names the source, the quality, how the texture continues past its edges and the method that made it (the model and weights, or the edge-directed filter), so a change to any of them refills the cache.
pub fn cache_key(source: &[u8], quality: Quality, upscaler: &Upscaler, edges: Edges) -> String {
    cache::digest(source, &format!("{}-v{ALGORITHM}-{}-{edges:?}", quality.name(), upscaler.method()))
}

impl Edges {
    /// Terrain tiles repeat across the ground, so their context wraps; every other texture is mirrored at its edge.
    pub fn for_path(path: &str) -> Self {
        if path.replace('\\', "/").to_ascii_lowercase().starts_with("terrainart/") {
            Edges::Wrap
        } else {
            Edges::Mirror
        }
    }
}

/// A decoded texture and, when the remaster ran, the relief maps derived from it.
pub struct Prepared {
    pub albedo: Image,
    pub relief: Option<Image>,
}

/// Decodes a texture file and remasters it, reading the result from `cache` when this file and quality were seen before and storing it there when not.
pub fn prepare(bytes: &[u8], quality: Quality, cache: Option<&Cache>, upscaler: &Upscaler, edges: Edges) -> Result<Prepared, String> {
    let key = (quality != Quality::Off).then(|| cache_key(bytes, quality, upscaler, edges));
    if let (Some(cache), Some(key)) = (cache, &key) {
        if let Some(maps) = cache.load(key) {
            return Ok(Prepared { albedo: maps.albedo, relief: Some(maps.relief) });
        }
    }
    let decoded = crate::texture::decode(bytes)?;
    let enhanced = enhance(&decoded, quality, upscaler, edges);
    upscaler.announce(&mut std::io::stderr());
    match enhanced {
        Some(maps) => {
            if let (Some(cache), Some(key)) = (cache, &key) {
                cache.store(key, &maps);
            }
            Ok(Prepared { albedo: maps.albedo, relief: Some(maps.relief) })
        }
        None => Ok(Prepared { albedo: decoded, relief: None }),
    }
}

/// What the art on screen draws a texture with: its remastered maps from `cache` when the bake made them, else the decoded original with `unbaked` set when the bake has yet to reach it. It never runs the upscaler, so drawing never waits on it.
pub fn load(bytes: &[u8], quality: Quality, cache: Option<&Cache>, upscaler: &Upscaler, edges: Edges) -> Result<Loaded, String> {
    if quality != Quality::Off {
        if let Some(cache) = cache {
            let key = cache_key(bytes, quality, upscaler, edges);
            if let Some(maps) = cache.load(&key) {
                return Ok(Loaded { prepared: Prepared { albedo: maps.albedo, relief: Some(maps.relief) }, unbaked: false });
            }
            let decoded = crate::texture::decode(bytes)?;
            let unbaked = decoded.width.max(decoded.height) < LARGEST_SOURCE && !cache.holds(&key);
            return Ok(Loaded { prepared: Prepared { albedo: decoded, relief: None }, unbaked });
        }
    }
    Ok(Loaded { prepared: Prepared { albedo: crate::texture::decode(bytes)?, relief: None }, unbaked: false })
}

pub struct Loaded {
    pub prepared: Prepared,
    pub unbaked: bool,
}

/// Upscales `image` (the first doubling by `upscaler`, any further ones by the edge-directed filter) and derives its relief, or returns `None` when the quality is off or the texture is already large.
pub fn enhance(image: &Image, quality: Quality, upscaler: &Upscaler, edges: Edges) -> Option<Maps> {
    if quality == Quality::Off || image.width.max(image.height) >= LARGEST_SOURCE {
        return None;
    }
    let steps = quality.upscale_steps();
    let albedo = upscaler.doubled(image, edges);
    let albedo = if steps > 1 { upscale::steps(&albedo, steps - 1) } else { albedo };
    let relief = relief::derive(&albedo);
    Some(Maps { albedo, relief })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn checker(size: u32) -> Image {
        let rgba = (0..size * size).flat_map(|index| if (index % size / 2 + index / size / 2) % 2 == 0 { [220, 40, 40, 255] } else { [30, 30, 200, 255] }).collect();
        Image { width: size, height: size, rgba }
    }

    #[test]
    fn quality_parses_names_and_digits() {
        assert_eq!("High".parse(), Ok(Quality::High));
        assert_eq!("1".parse(), Ok(Quality::Standard));
        assert_eq!("".parse(), Ok(Quality::Off));
        assert!("ultra".parse::<Quality>().is_err());
    }

    #[test]
    fn off_and_large_textures_are_left_alone() {
        assert!(enhance(&checker(8), Quality::Off, &Upscaler::classical(), Edges::Mirror).is_none());
        assert!(enhance(&Image { width: 1024, height: 4, rgba: vec![0; 1024 * 16] }, Quality::Standard, &Upscaler::classical(), Edges::Mirror).is_none());
    }

    #[test]
    fn each_step_doubles_both_sides_and_relief_matches_the_albedo() {
        let standard = enhance(&checker(8), Quality::Standard, &Upscaler::classical(), Edges::Mirror).unwrap();
        assert_eq!((standard.albedo.width, standard.albedo.height), (16, 16));
        let high = enhance(&checker(8), Quality::High, &Upscaler::classical(), Edges::Mirror).unwrap();
        assert_eq!((high.albedo.width, high.relief.height), (32, 32));
        assert_eq!(high.relief.rgba.len(), 32 * 32 * 4);
    }

    #[test]
    fn a_flat_texture_stays_flat_and_its_normals_point_out() {
        let flat = Image { width: 6, height: 6, rgba: [90, 120, 150, 255].repeat(36) };
        let maps = enhance(&flat, Quality::Standard, &Upscaler::classical(), Edges::Mirror).unwrap();
        assert!(maps.albedo.rgba.chunks_exact(4).all(|pixel| pixel.iter().zip([90u8, 120, 150, 255]).all(|(got, want)| got.abs_diff(want) <= 1)));
        assert!(maps.relief.rgba.chunks_exact(4).all(|pixel| pixel[0].abs_diff(128) <= 1 && pixel[1].abs_diff(128) <= 1 && pixel[2] >= 254));
    }

    #[test]
    fn upscaling_stays_within_the_source_range() {
        let maps = enhance(&checker(8), Quality::High, &Upscaler::classical(), Edges::Mirror).unwrap();
        assert!(maps.albedo.rgba.chunks_exact(4).all(|pixel| (30..=220).contains(&pixel[0]) && (30..=200).contains(&pixel[2])));
    }

    #[test]
    fn the_cache_key_follows_the_bytes_the_quality_and_the_edges() {
        let key = |source: &[u8], quality, edges| cache_key(source, quality, &Upscaler::classical(), edges);
        assert_ne!(key(b"a", Quality::Standard, Edges::Mirror), key(b"b", Quality::Standard, Edges::Mirror));
        assert_ne!(key(b"a", Quality::Standard, Edges::Mirror), key(b"a", Quality::High, Edges::Mirror));
        assert_ne!(key(b"a", Quality::High, Edges::Mirror), key(b"a", Quality::High, Edges::Wrap));
        assert_eq!(key(b"a", Quality::High, Edges::Wrap), key(b"a", Quality::High, Edges::Wrap));
    }

    #[test]
    fn only_terrain_art_wraps() {
        assert_eq!(Edges::for_path("TerrainArt\\LordaeronSummer\\Lords_Grass.blp"), Edges::Wrap);
        assert_eq!(Edges::for_path("terrainart/lordaeronsummer/lords_dirt.blp"), Edges::Wrap);
        assert_eq!(Edges::for_path("Units\\Human\\Footman\\Footman.blp"), Edges::Mirror);
    }
}
