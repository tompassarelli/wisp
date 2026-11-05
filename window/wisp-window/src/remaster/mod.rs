//! Remasters a Classic texture on the player's machine: an upscaled albedo, plus a tangent-space normal map with roughness in its alpha, both derived from the player's own file. Results are cached under the player's cache directory and never leave it.

mod bake;
mod cache;
pub mod check;
mod cugan;
mod relief;
mod role;
mod upscale;
mod upscaler;

use std::str::FromStr;

use crate::texture::Image;

pub use bake::{Baker, Progress};
pub use cache::Cache;
pub use cugan::{device_limits, Edges, NOTICE as REAL_CUGAN_NOTICE};
pub use role::Role;
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
    /// Real-CUGAN failed on this texture and the edge-directed filter made its colour, so it is not cached under the Real-CUGAN key.
    pub fallback: bool,
}

/// Bumped whenever the output of `enhance` changes, so stale cache entries are never read.
const ALGORITHM: u32 = 3;

/// Names the source, the quality, how the texture continues past its edges and the method that made it for its role (the model and weights, or the edge-directed filter), so a change to any of them refills the cache.
pub fn cache_key(source: &[u8], quality: Quality, upscaler: &Upscaler, edges: Edges, role: Role) -> String {
    cache::digest(source, &format!("{}-v{ALGORITHM}-{}-{edges:?}", quality.name(), upscaler.method(role)))
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
pub fn prepare(bytes: &[u8], quality: Quality, cache: Option<&Cache>, upscaler: &Upscaler, edges: Edges, role: Role, name: &str) -> Result<Prepared, String> {
    let key = (quality != Quality::Off).then(|| cache_key(bytes, quality, upscaler, edges, role));
    if let (Some(cache), Some(key)) = (cache, &key) {
        if let Some(maps) = cache.load(key) {
            return Ok(Prepared { albedo: maps.albedo, relief: Some(maps.relief) });
        }
    }
    let decoded = crate::texture::decode(bytes)?;
    let enhanced = enhance(&decoded, quality, upscaler, edges, role, name);
    upscaler.announce(&mut std::io::stderr());
    match enhanced {
        Some(maps) => {
            if let (Some(cache), Some(key), false) = (cache, &key, maps.fallback) {
                cache.store(key, &maps);
            }
            Ok(Prepared { albedo: maps.albedo, relief: Some(maps.relief) })
        }
        None => Ok(Prepared { albedo: decoded, relief: None }),
    }
}

/// What the art on screen draws a texture with: its remastered maps from `cache` when the bake made them, else the decoded original with `unbaked` set when the bake has yet to reach it. It never runs the upscaler, so drawing never waits on it.
pub fn load(bytes: &[u8], quality: Quality, cache: Option<&Cache>, upscaler: &Upscaler, edges: Edges, role: Role) -> Result<Loaded, String> {
    if quality != Quality::Off {
        if let Some(cache) = cache {
            let key = cache_key(bytes, quality, upscaler, edges, role);
            let held = cache.holds(&key);
            if let Some(maps) = cache.load(&key) {
                return Ok(Loaded { prepared: Prepared { albedo: maps.albedo, relief: Some(maps.relief) }, unbaked: false });
            }
            let decoded = crate::texture::decode(bytes)?;
            let unbaked = decoded.width.max(decoded.height) < LARGEST_SOURCE && !held;
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
pub fn enhance(image: &Image, quality: Quality, upscaler: &Upscaler, edges: Edges, role: Role, name: &str) -> Option<Maps> {
    if quality == Quality::Off || image.width.max(image.height) >= LARGEST_SOURCE {
        return None;
    }
    let steps = quality.upscale_steps();
    let (albedo, fallback) = upscaler.doubled(image, edges, role, name);
    let albedo = if steps > 1 { upscale::steps(&albedo, steps - 1) } else { albedo };
    let relief = relief::derive(&albedo);
    Some(Maps { albedo, relief, fallback })
}
