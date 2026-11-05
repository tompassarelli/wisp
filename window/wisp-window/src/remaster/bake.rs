//! The one place the remaster's upscaler runs: a background thread that fills the cache with every texture the window has been sent, newest first, so the art on screen only ever reads the cache. During a match it rests four times as long as each texture took before the next, so the upscaler holds at most a fifth of the GPU and the progress still reaches 100%.

use std::collections::HashSet;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use super::{cache_key, prepare, Cache, Edges, Quality, Role, Upscaler};

/// Rest between two upscaled textures, so the render thread's frames are not queued behind one network run after another.
const BETWEEN: Duration = Duration::from_millis(16);

/// During a match, the rest after a texture is this many times what it took to bake.
const IN_PLAY_REST: u32 = 4;

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
            (self.done * 100).checked_div(self.total).unwrap_or(100)
        }
    }
}

struct Job {
    path: String,
    bytes: Arc<[u8]>,
}

struct Missing {
    job: Job,
    key: String,
}

enum Step {
    Check(Job),
    Bake(Missing),
}

#[derive(Default)]
struct State {
    unchecked: Vec<Job>,
    queue: Vec<Missing>,
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
        state.unchecked.push(Job { path: path.to_string(), bytes });
        self.shared.wake.notify_all();
    }

    /// While the game is playing, the bake rests longer between textures, so the match keeps most of the GPU.
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
        let step = {
            let mut state = lock(shared);
            while !state.stopped && state.unchecked.is_empty() && state.queue.is_empty() {
                state = shared.wake.wait(state).unwrap_or_else(|poisoned| poisoned.into_inner());
            }
            if state.stopped {
                return;
            }
            match state.unchecked.pop() {
                Some(job) => Step::Check(job),
                None => Step::Bake(state.queue.pop().expect("a texture is waiting to bake")),
            }
        };
        let baked = match step {
            Step::Check(job) => {
                let key = cache_key(&job.bytes, quality, upscaler, Edges::for_path(&job.path), Role::for_path(&job.path));
                if cache.holds(&key) {
                    finish(shared, false);
                } else {
                    lock(shared).queue.push(Missing { job, key });
                }
                None
            }
            Step::Bake(missing) => {
                let began = Instant::now();
                bake(&missing, quality, cache, upscaler);
                let took = began.elapsed();
                finish(shared, true);
                Some(took)
            }
        };
        if let Some(took) = baked {
            rest_after(shared, took);
        }
    }
}

/// Upscales one texture into the cache. Whatever happens, the cache holds its key afterwards, so the progress counts it and no later bake queues it again: a texture the remaster leaves alone, cannot read, or could not store maps for (Real-CUGAN failed on it alone, or the write failed) is marked to be drawn with its original art, and said so once.
fn bake(Missing { job, key }: &Missing, quality: Quality, cache: &Cache, upscaler: &Upscaler) {
    let (edges, role) = (Edges::for_path(&job.path), Role::for_path(&job.path));
    let failure = match catch_unwind(AssertUnwindSafe(|| prepare(&job.bytes, quality, Some(cache), upscaler, edges, role, &job.path))) {
        Ok(Ok(prepared)) if prepared.relief.is_none() => None,
        Ok(Ok(_)) => (!cache.holds(key)).then(|| "its remastered maps were not stored".to_string()),
        Ok(Err(error)) => Some(error),
        Err(_) => Some("the upscaler panicked".to_string()),
    };
    if let Some(failure) = failure {
        eprintln!("wisp remaster: {}: {failure}, so it keeps its original art", job.path);
    }
    if !cache.holds(key) {
        cache.keep_as_is(key);
    }
}

/// Rests after a texture that took `took` to bake: `BETWEEN`, or during a match `IN_PLAY_REST` times `took`, cut short when the match ends or the bake stops.
fn rest_after(shared: &Shared, took: Duration) {
    thread::sleep(BETWEEN);
    let state = lock(shared);
    let rest = (took * IN_PLAY_REST).saturating_sub(BETWEEN);
    let _ = shared.wake.wait_timeout_while(state, rest, |state| state.playing && !state.stopped);
}

/// Counts one texture as ready, and reports once the last of the queue is.
fn finish(shared: &Shared, baked: bool) {
    let mut state = lock(shared);
    state.progress.done += 1;
    if baked {
        state.upscaled += 1;
        if state.playing {
            state.upscaled_while_playing += 1;
        }
    }
    if state.unchecked.is_empty() && state.queue.is_empty() {
        let elapsed = state.began.take().map_or(0, |began| began.elapsed().as_millis());
        eprintln!("wisp remaster: {} textures ready ({} baked now, the rest from the cache) in {elapsed} ms", state.progress.total, state.upscaled);
        state.upscaled = 0;
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
    fn a_match_does_not_hold_the_bake_and_every_texture_is_baked_once() {
        let directory = std::env::temp_dir().join(format!("wisp-bake-test-{}", std::process::id()));
        let cache = Arc::new(Cache::at(directory.clone()).unwrap());
        let upscaler = Arc::new(Upscaler::classical());
        let baker = Baker::start(Quality::Standard, cache.clone(), upscaler.clone());
        baker.set_playing(true);
        baker.add("a.png", png(1));
        baker.add("b.png", png(2));
        baker.add("A.PNG", png(3));
        assert_eq!(until_ready(&baker), Progress { done: 2, total: 2 }, "a path is queued once, and the match does not stop the bake");
        for seed in [1, 2] {
            assert!(cache.holds(&cache_key(&png(seed), Quality::Standard, &upscaler, Edges::Mirror, Role::Figure)));
        }
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn a_texture_that_cannot_be_baked_counts_as_done_and_is_not_queued_again() {
        let directory = std::env::temp_dir().join(format!("wisp-bake-failure-test-{}", std::process::id()));
        let cache = Arc::new(Cache::at(directory.clone()).unwrap());
        let upscaler = Arc::new(Upscaler::classical());
        let unreadable: Arc<[u8]> = Arc::from(&b"not a texture"[..]);
        let unstored = png(9);
        let key = |bytes: &[u8]| cache_key(bytes, Quality::Standard, &upscaler, Edges::Mirror, Role::Figure);
        std::fs::create_dir_all(directory.join(format!("{}.albedo.tmp", key(&unstored)))).unwrap();
        let baker = Baker::start(Quality::Standard, cache.clone(), upscaler.clone());
        baker.set_playing(true);
        baker.add("broken.blp", unreadable.clone());
        baker.add("unstored.png", unstored.clone());
        assert_eq!(until_ready(&baker), Progress { done: 2, total: 2 }, "both count as done");
        assert!(cache.holds(&key(&unreadable)) && cache.holds(&key(&unstored)), "both are marked, so the next bake counts them from the cache");
        let _ = std::fs::remove_dir_all(directory);
    }
}
