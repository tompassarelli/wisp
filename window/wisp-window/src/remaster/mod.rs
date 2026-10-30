//! Remasters a Classic texture on the player's machine: an upscaled albedo, plus a tangent-space normal map with roughness in its alpha, both derived from the player's own file. Results are cached under the player's cache directory and never leave it.

mod cache;
mod relief;
mod upscale;

use std::str::FromStr;

use crate::texture::Image;

pub use cache::Cache;

/// Textures this large or larger are already high resolution (backdrops, loading screens) and are left as they are.
const LARGEST_SOURCE: u32 = 1024;

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum Quality {
    #[default]
    Off,
    Standard,
    High,
}

impl Quality {
    pub fn from_environment() -> Self {
        std::env::var("WISP_REMASTER").ok().and_then(|value| value.parse().ok()).unwrap_or_default()
    }

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
const ALGORITHM: u32 = 1;

pub fn cache_key(source: &[u8], quality: Quality) -> String {
    cache::digest(source, &format!("{}-v{ALGORITHM}", quality.name()))
}

/// A decoded texture and, when the remaster ran, the relief maps derived from it.
pub struct Prepared {
    pub albedo: Image,
    pub relief: Option<Image>,
}

/// Decodes a texture file and remasters it, reading the result from `cache` when this file and quality were seen before and storing it there when not.
pub fn prepare(bytes: &[u8], quality: Quality, cache: Option<&Cache>) -> Result<Prepared, String> {
    let key = (quality != Quality::Off).then(|| cache_key(bytes, quality));
    if let (Some(cache), Some(key)) = (cache, &key) {
        if let Some(maps) = cache.load(key) {
            return Ok(Prepared { albedo: maps.albedo, relief: Some(maps.relief) });
        }
    }
    let decoded = crate::texture::decode(bytes)?;
    match enhance(&decoded, quality) {
        Some(maps) => {
            if let (Some(cache), Some(key)) = (cache, &key) {
                cache.store(key, &maps);
            }
            Ok(Prepared { albedo: maps.albedo, relief: Some(maps.relief) })
        }
        None => Ok(Prepared { albedo: decoded, relief: None }),
    }
}

/// Upscales `image` and derives its relief, or returns `None` when the quality is off or the texture is already large.
pub fn enhance(image: &Image, quality: Quality) -> Option<Maps> {
    if quality == Quality::Off || image.width.max(image.height) >= LARGEST_SOURCE {
        return None;
    }
    let albedo = upscale::steps(image, quality.upscale_steps());
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
        assert!(enhance(&checker(8), Quality::Off).is_none());
        assert!(enhance(&Image { width: 1024, height: 4, rgba: vec![0; 1024 * 16] }, Quality::Standard).is_none());
    }

    #[test]
    fn each_step_doubles_both_sides_and_relief_matches_the_albedo() {
        let standard = enhance(&checker(8), Quality::Standard).unwrap();
        assert_eq!((standard.albedo.width, standard.albedo.height), (16, 16));
        let high = enhance(&checker(8), Quality::High).unwrap();
        assert_eq!((high.albedo.width, high.relief.height), (32, 32));
        assert_eq!(high.relief.rgba.len(), 32 * 32 * 4);
    }

    #[test]
    fn a_flat_texture_stays_flat_and_its_normals_point_out() {
        let flat = Image { width: 6, height: 6, rgba: [90, 120, 150, 255].repeat(36) };
        let maps = enhance(&flat, Quality::Standard).unwrap();
        assert!(maps.albedo.rgba.chunks_exact(4).all(|pixel| pixel.iter().zip([90u8, 120, 150, 255]).all(|(got, want)| got.abs_diff(want) <= 1)));
        assert!(maps.relief.rgba.chunks_exact(4).all(|pixel| pixel[0].abs_diff(128) <= 1 && pixel[1].abs_diff(128) <= 1 && pixel[2] >= 254));
    }

    #[test]
    fn upscaling_stays_within_the_source_range() {
        let maps = enhance(&checker(8), Quality::High).unwrap();
        assert!(maps.albedo.rgba.chunks_exact(4).all(|pixel| (30..=220).contains(&pixel[0]) && (30..=200).contains(&pixel[2])));
    }

    #[test]
    fn the_cache_key_follows_the_bytes_and_the_quality() {
        assert_ne!(cache_key(b"a", Quality::Standard), cache_key(b"b", Quality::Standard));
        assert_ne!(cache_key(b"a", Quality::Standard), cache_key(b"a", Quality::High));
        assert_eq!(cache_key(b"a", Quality::High), cache_key(b"a", Quality::High));
    }
}
