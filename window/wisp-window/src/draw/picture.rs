use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::capture;

use super::Gpu;

/// `WISP_WINDOW_CAPTURE=FILE.png` saves the window's image at the first scene from game frame `WISP_WINDOW_CAPTURE_AFTER` (default 30) on that has every model it names;
/// `WISP_WINDOW_CAPTURE_FRAMES=N` saves that frame and the N - 1 drawn after it as FILE-0000.png on, for flickers a single image misses.
pub(super) struct Capture {
    path: PathBuf,
    pub(super) after: u32,
    frames: u32,
    taken: u32,
}

impl Capture {
    pub(super) fn from_environment() -> Option<Self> {
        let path = PathBuf::from(std::env::var_os("WISP_WINDOW_CAPTURE")?);
        let after = std::env::var("WISP_WINDOW_CAPTURE_AFTER").ok().and_then(|value| value.parse().ok()).unwrap_or(30);
        let frames = std::env::var("WISP_WINDOW_CAPTURE_FRAMES").ok().and_then(|value| value.parse().ok()).unwrap_or(1);
        Some(Self { path, after, frames, taken: 0 })
    }
}

impl Gpu {
    pub(super) fn save_capture(&mut self, texture: &wgpu::Texture) {
        let Some(capture) = self.capture.as_mut() else { return };
        if capture.taken >= capture.frames {
            return;
        }
        let path = if capture.frames == 1 { capture.path.clone() } else { capture.path.with_file_name(format!("{}-{:04}.png", capture.path.file_stem().unwrap_or_default().to_string_lossy(), capture.taken)) };
        capture.taken += 1;
        self.write_picture(texture, &path);
    }

    /// Saves a snapshot into `directory` and says on stderr where it went, or why none was saved.
    pub fn report_snapshot(&self, texture: &wgpu::SurfaceTexture, directory: Option<&Path>, info: &str) {
        let Some(directory) = directory else {
            eprintln!("wisp-window: F12 snapshot skipped: no snapshot folder is set");
            return;
        };
        match self.snapshot(texture, directory, info) {
            Ok(folder) => eprintln!("wisp-window: snapshot saved to {}", folder.display()),
            Err(error) => eprintln!("wisp-window: snapshot not saved in {}: {error}", directory.display()),
        }
    }

    /// Saves the frame just drawn into a new dated folder under `directory`: `picture.png` as the player saw it, `scene.json` (the scene the game sent for it, every pose with its model, place, sequence, alpha, colour and team colour, and the lightning, strips, weather and UI) and `window.json` (the adapter, backend and present mode in `info`, the graphics settings, the size and the game frame). Returns the folder.
    pub fn snapshot(&self, texture: &wgpu::SurfaceTexture, directory: &Path, info: &str) -> std::io::Result<PathBuf> {
        let folder = fresh_folder(directory, SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64)?;
        std::fs::write(folder.join("scene.json"), &self.scene_bytes)?;
        let frame = self.scene.as_ref().map_or(0, |scene| scene.frame);
        let info = if info.is_empty() { "null" } else { info };
        let window = format!(
            "{{\"window\":{info},\"preset\":{:?},\"art\":{:?},\"width\":{},\"height\":{},\"frame\":{frame},\"windowSource\":{:?}}}\n",
            self.settings.preset.name(),
            self.settings.art.name(),
            self.config.width,
            self.config.height,
            env!("WISP_WINDOW_SOURCE")
        );
        std::fs::write(folder.join("window.json"), window)?;
        if self.config.usage.contains(wgpu::TextureUsages::COPY_SRC) {
            self.write_picture(&texture.texture, &folder.join("picture.png"));
        }
        Ok(folder)
    }

    pub(super) fn write_picture(&self, texture: &wgpu::Texture, path: &Path) {
        let (width, height) = (self.config.width, self.config.height);
        let row = (width * 4).next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
        let buffer = self.device.create_buffer(&wgpu::BufferDescriptor { label: Some("capture"), size: (row * height) as u64, usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false });
        let mut encoder = self.device.create_command_encoder(&Default::default());
        encoder.copy_texture_to_buffer(
            texture.as_image_copy(),
            wgpu::TexelCopyBufferInfo { buffer: &buffer, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row), rows_per_image: Some(height) } },
            wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        );
        self.queue.submit([encoder.finish()]);
        buffer.slice(..).map_async(wgpu::MapMode::Read, |_| ());
        let _ = self.device.poll(wgpu::PollType::wait_indefinitely());
        let Ok(mapped) = buffer.slice(..).get_mapped_range() else { return };
        let bgra = matches!(self.config.format, wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Bgra8UnormSrgb);
        let mut rgba = Vec::with_capacity((width * height * 4) as usize);
        for line in mapped.chunks(row as usize).take(height as usize) {
            for pixel in line[..(width * 4) as usize].chunks(4) {
                rgba.extend_from_slice(&if bgra { [pixel[2], pixel[1], pixel[0], 255] } else { [pixel[0], pixel[1], pixel[2], 255] });
            }
        }
        let _ = capture::write(path, width, height, &rgba);
    }
}

/// `window-snapshot-YYYY-MM-DDTHH-MM-SSZ` in UTC under `directory`, with the milliseconds added when a snapshot already took that second.
fn fresh_folder(directory: &Path, unix_ms: u64) -> std::io::Result<PathBuf> {
    let stamp = utc_stamp(unix_ms / 1000);
    let mut folder = directory.join(format!("window-snapshot-{stamp}"));
    if folder.exists() {
        folder = directory.join(format!("window-snapshot-{stamp}-{:03}", unix_ms % 1000));
    }
    std::fs::create_dir_all(&folder)?;
    Ok(folder)
}

fn utc_stamp(unix_seconds: u64) -> String {
    let days = (unix_seconds / 86_400) as i64;
    let rest = unix_seconds % 86_400;
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era = (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 { month_index + 3 } else { month_index - 9 };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}T{:02}-{:02}-{:02}Z", rest / 3600, rest / 60 % 60, rest % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_stamp_is_the_utc_date_and_time() {
        assert_eq!(utc_stamp(0), "1970-01-01T00-00-00Z");
        assert_eq!(utc_stamp(1_793_597_412), "2026-11-02T05-30-12Z");
        assert_eq!(utc_stamp(951_782_400), "2000-02-29T00-00-00Z");
    }

    #[test]
    fn a_second_snapshot_in_the_same_second_gets_its_own_folder() {
        let directory = std::env::temp_dir().join(format!("wisp-snapshot-test-{}", std::process::id()));
        let first = fresh_folder(&directory, 1_793_597_412_250).expect("first folder");
        let second = fresh_folder(&directory, 1_793_597_412_750).expect("second folder");
        assert_eq!(first.file_name().unwrap(), "window-snapshot-2026-11-02T05-30-12Z");
        assert_eq!(second.file_name().unwrap(), "window-snapshot-2026-11-02T05-30-12Z-750");
        std::fs::remove_dir(&first).expect("first is empty");
        std::fs::remove_dir(&second).expect("second is empty");
        std::fs::remove_dir(&directory).expect("directory is empty");
    }
}
