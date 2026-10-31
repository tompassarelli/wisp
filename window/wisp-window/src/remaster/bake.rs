//! The one place the remaster's upscaler runs: a background thread that fills the cache with every texture the window has been sent, newest first, and waits while the game is playing, so a match never shares the GPU with the upscaler and the art on screen only ever reads the cache.

use std::collections::HashSet;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use super::{cache_key, prepare, Cache, Edges, Quality, Role, Upscaler};

/// Rest between two upscaled textures, so the render thread's frames are not queued behind one network run after another.
const BETWEEN: Duration = Duration::from_millis(16);

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct Progress {
    pub done: usize,
    pub total: usize,
}

impl Progress {
    pub fn ready(self) -> bool {
        self.done == self.total
    }

    pub fn percent(self) -> usize {
        if self.total == 0 {
            100
        } else {
            self.done * 100 / self.total
        }
    }
}

struct Job {
    path: String,
    bytes: Arc<[u8]>,
}

#[derive(Default)]
struct State {
    queue: Vec<Job>,
    seen: HashSet<String>,
    progress: Progress,
    playing: bool,
    stopped: bool,
    began: Option<Instant>,
    upscaled: usize,
    upscaled_while_playing: usize,
}

struct Shared {
    state: Mutex<State>,
    wake: Condvar,
}

pub struct Baker {
    shared: Arc<Shared>,
    quality: Quality,
}

impl Baker {
    pub fn start(quality: Quality, cache: Arc<Cache>, upscaler: Arc<Upscaler>) -> Self {
        let shared = Arc::new(Shared { state: Mutex::new(State::default()), wake: Condvar::new() });
        let worker = Arc::clone(&shared);
        thread::Builder::new().name("wisp-remaster-bake".into()).spawn(move || run(&worker, quality, &cache, &upscaler)).expect("spawn the remaster bake");
        Self { shared, quality }
    }

    pub fn quality(&self) -> Quality {
        self.quality
    }

    /// Queues a texture file once per path; the newest is baked first, because it is what the game is about to show.
    pub fn add(&self, path: &str, bytes: Arc<[u8]>) {
        let mut state = lock(&self.shared);
        if !state.seen.insert(path.to_ascii_lowercase()) {
            return;
        }
        state.began.get_or_insert_with(Instant::now);
        state.progress.total += 1;
        state.queue.push(Job { path: path.to_string(), bytes });
        self.shared.wake.notify_all();
    }

    /// While the game is playing, no texture starts baking.
    pub fn set_playing(&self, playing: bool) {
        let mut state = lock(&self.shared);
        if state.playing && !playing && state.upscaled_while_playing > 0 {
            eprintln!("wisp remaster: {} textures were upscaled during play", state.upscaled_while_playing);
            state.upscaled_while_playing = 0;
        }
        state.playing = playing;
        self.shared.wake.notify_all();
    }

    pub fn progress(&self) -> Progress {
        lock(&self.shared).progress
    }
}

impl Drop for Baker {
    fn drop(&mut self) {
        lock(&self.shared).stopped = true;
        self.shared.wake.notify_all();
    }
}

fn lock(shared: &Shared) -> MutexGuard<'_, State> {
    shared.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn run(shared: &Shared, quality: Quality, cache: &Cache, upscaler: &Upscaler) {
    loop {
        let job = {
            let mut state = lock(shared);
            while !state.stopped && (state.playing || state.queue.is_empty()) {
                state = shared.wake.wait(state).unwrap_or_else(|poisoned| poisoned.into_inner());
            }
            if state.stopped {
                return;
            }
            state.queue.pop().expect("the queue is not empty")
        };
        let (edges, role) = (Edges::for_path(&job.path), Role::for_path(&job.path));
        let key = cache_key(&job.bytes, quality, upscaler, edges, role);
        let baked = !cache.holds(&key);
        if baked {
            match prepare(&job.bytes, quality, Some(cache), upscaler, edges, role, &job.path) {
                Ok(prepared) if prepared.relief.is_none() => cache.keep_as_is(&key),
                Ok(_) => {}
                Err(error) => {
                    eprintln!("wisp remaster: {}: {error}", job.path);
                    cache.keep_as_is(&key);
                }
            }
        }
        let mut state = lock(shared);
        state.progress.done += 1;
        if baked {
            state.upscaled += 1;
            if state.playing {
                state.upscaled_while_playing += 1;
            }
        }
        if state.queue.is_empty() {
            let elapsed = state.began.take().map_or(0, |began| began.elapsed().as_millis());
            eprintln!("wisp remaster: {} textures ready ({} baked now, the rest from the cache) in {elapsed} ms", state.progress.total, state.upscaled);
            state.upscaled = 0;
        }
        drop(state);
        if baked {
            thread::sleep(BETWEEN);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::ImageEncoder;

    fn png(seed: u8) -> Arc<[u8]> {
        let pixels: Vec<u8> = (0..8 * 8).flat_map(|index| [index as u8 ^ seed, 40, 200, 255]).collect();
        let mut bytes = Vec::new();
        image::codecs::png::PngEncoder::new(&mut bytes).write_image(&pixels, 8, 8, image::ExtendedColorType::Rgba8).unwrap();
        bytes.into()
    }

    fn until_ready(baker: &Baker) -> Progress {
        for _ in 0..2000 {
            if baker.progress().ready() {
                break;
            }
            thread::sleep(Duration::from_millis(1));
        }
        baker.progress()
    }

    #[test]
    fn nothing_bakes_while_playing_and_everything_bakes_once_play_stops() {
        let directory = std::env::temp_dir().join(format!("wisp-bake-test-{}", std::process::id()));
        let cache = Arc::new(Cache::at(directory.clone()).unwrap());
        let upscaler = Arc::new(Upscaler::classical());
        let baker = Baker::start(Quality::Standard, cache.clone(), upscaler.clone());
        baker.set_playing(true);
        baker.add("a.png", png(1));
        baker.add("b.png", png(2));
        baker.add("A.PNG", png(3));
        thread::sleep(Duration::from_millis(100));
        assert_eq!(baker.progress(), Progress { done: 0, total: 2 }, "a path is queued once and nothing bakes during play");
        baker.set_playing(false);
        assert!(until_ready(&baker).ready());
        for seed in [1, 2] {
            assert!(cache.holds(&cache_key(&png(seed), Quality::Standard, &upscaler, Edges::Mirror, Role::Figure)));
        }
        let _ = std::fs::remove_dir_all(directory);
    }
}
