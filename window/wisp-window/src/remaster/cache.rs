//! The remaster cache: one albedo and one relief PNG per source texture, named by a hash of the source's bytes and the settings that made them, under the player's own cache directory.

use std::fs;
use std::path::{Path, PathBuf};

use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{ExtendedColorType, ImageEncoder};
use sha2::{Digest, Sha256};

use super::Maps;
use crate::texture::Image;

pub struct Cache {
    directory: PathBuf,
}

pub fn digest(source: &[u8], settings: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(source);
    hasher.update([0]);
    hasher.update(settings.as_bytes());
    hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect()
}

fn cache_home() -> Option<PathBuf> {
    let from = |name: &str| std::env::var_os(name).filter(|value| !value.is_empty()).map(PathBuf::from);
    from("XDG_CACHE_HOME").or_else(|| from("LOCALAPPDATA")).or_else(|| from("HOME").map(|home| home.join(".cache")))
}

impl Cache {
    pub fn open() -> Option<Self> {
        Self::at(cache_home()?.join("wisp").join("remaster"))
    }

    pub fn at(directory: PathBuf) -> Option<Self> {
        fs::create_dir_all(&directory).ok()?;
        Some(Self { directory })
    }

    fn path(&self, key: &str, part: &str) -> PathBuf {
        self.directory.join(format!("{key}.{part}.png"))
    }

    /// True when the bake has seen this key: its maps are stored, or it was marked to be drawn as it is.
    pub fn holds(&self, key: &str) -> bool {
        self.directory.join(format!("{key}.as-is")).exists() || (self.path(key, "albedo").exists() && self.path(key, "relief").exists())
    }

    /// Marks a texture the remaster leaves as it is (too large, or unreadable), so the next run does not decode it again to find out.
    pub fn keep_as_is(&self, key: &str) {
        let _ = fs::write(self.directory.join(format!("{key}.as-is")), []);
    }

    pub fn load(&self, key: &str) -> Option<Maps> {
        Some(Maps { albedo: read(&self.path(key, "albedo"))?, relief: read(&self.path(key, "relief"))? })
    }

    /// A failed write only costs the next run its remaster, so it is dropped rather than reported.
    pub fn store(&self, key: &str, maps: &Maps) {
        let write = |part: &str, image: &Image| {
            let temporary = self.directory.join(format!("{key}.{part}.tmp"));
            let mut bytes = Vec::new();
            PngEncoder::new_with_quality(&mut bytes, CompressionType::Fast, FilterType::Sub).write_image(&image.rgba, image.width, image.height, ExtendedColorType::Rgba8).ok()?;
            fs::write(&temporary, bytes).ok()?;
            fs::rename(&temporary, self.path(key, part)).ok()
        };
        let _ = write("albedo", &maps.albedo).and_then(|()| write("relief", &maps.relief));
    }
}

fn read(path: &Path) -> Option<Image> {
    let decoded = image::open(path).ok()?.into_rgba8();
    Some(Image { width: decoded.width(), height: decoded.height(), rgba: decoded.into_raw() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stored_maps_read_back_exactly() {
        let directory = std::env::temp_dir().join(format!("wisp-remaster-test-{}", std::process::id()));
        let cache = Cache::at(directory.clone()).unwrap();
        let maps = Maps { albedo: Image { width: 2, height: 1, rgba: vec![1, 2, 3, 4, 5, 6, 7, 8] }, relief: Image { width: 2, height: 1, rgba: vec![9, 8, 7, 6, 5, 4, 3, 2] } };
        assert!(cache.load("key").is_none());
        cache.store("key", &maps);
        let back = cache.load("key").unwrap();
        assert_eq!((back.albedo.rgba, back.relief.rgba), (maps.albedo.rgba, maps.relief.rgba));
        let _ = fs::remove_dir_all(directory);
    }
}
