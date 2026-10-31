//! Feeds one unpacked map's textures to the remaster bake the way the window does and prints what the F10 screen shows, with the count of textures in the cache, every few seconds.
//! Usage: `bake_progress --cache DIR [--every SECONDS] [--play FROM:TO] [--classical] MAP_IMPORTS_DIR`. `--play` is a match from second FROM to second TO, during which the bake waits.
//! `DIR` is an empty or filled remaster cache that this run owns; it exits when the bake is ready.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use wisp_window::menu::Bake;
use wisp_window::remaster::{device_limits, Baker, Cache, Quality, Upscaler};

const TEXTURE_EXTENSIONS: [&str; 4] = [".blp", ".dds", ".tga", ".png"];

fn upscaler(classical: bool) -> Upscaler {
    if classical {
        return Upscaler::classical();
    }
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions { power_preference: wgpu::PowerPreference::HighPerformance, ..Default::default() })).expect("an adapter");
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor { required_limits: device_limits(&adapter.limits()), ..Default::default() })).expect("a device");
    Upscaler::on(device, queue, &adapter.get_info())
}

fn textures(folder: &Path) -> Vec<(String, PathBuf)> {
    let entries = std::fs::read_to_string(folder.join("entries.tsv")).expect("entries.tsv in the imports folder");
    entries
        .lines()
        .filter_map(|line| line.rsplit_once('\t'))
        .filter(|(name, _)| TEXTURE_EXTENSIONS.iter().any(|extension| name.to_ascii_lowercase().ends_with(extension)))
        .map(|(name, index)| (name.replacen("war3.w3mod_", "", 1).replacen('_', "/", 1), folder.join(index)))
        .collect()
}

fn cached(cache: &Path) -> usize {
    std::fs::read_dir(cache).map_or(0, |entries| entries.flatten().filter(|entry| entry.file_name().to_string_lossy().ends_with(".albedo.png")).count())
}

fn main() {
    let (mut cache, mut every, mut play, mut classical, mut folder) = (None, 10, None, false, None);
    let mut arguments = std::env::args().skip(1);
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--cache" => cache = arguments.next().map(PathBuf::from),
            "--every" => every = arguments.next().expect("--every needs seconds").parse().expect("seconds"),
            "--play" => {
                let span = arguments.next().expect("--play needs FROM:TO");
                let (from, to) = span.split_once(':').expect("FROM:TO");
                play = Some((from.parse::<u64>().expect("seconds"), to.parse::<u64>().expect("seconds")));
            }
            "--classical" => classical = true,
            other => folder = Some(PathBuf::from(other)),
        }
    }
    let (cache_directory, folder) = (cache.expect("--cache DIR"), folder.expect("a MAP_IMPORTS_DIR"));
    let cache = Arc::new(Cache::at(cache_directory.clone()).expect("a cache folder"));
    let upscaler = Arc::new(upscaler(classical));
    let baker = Baker::start(Quality::Standard, cache, upscaler);
    for (path, file) in textures(&folder) {
        baker.add(&path, std::fs::read(file).expect("a texture").into());
    }
    let began = Instant::now();
    let mut playing = false;
    loop {
        let second = began.elapsed().as_secs();
        let now_playing = play.is_some_and(|(from, to)| (from..to).contains(&second));
        if now_playing != playing {
            playing = now_playing;
            baker.set_playing(playing);
        }
        let progress = baker.progress();
        let bake = Bake { progress, filter: false, playing, pending: false };
        println!("{second:>5} s  {}  ({}/{} textures, {} in the cache)", bake.label(), progress.done, progress.total, cached(&cache_directory));
        if progress.ready() {
            break;
        }
        std::thread::sleep(Duration::from_secs(every));
    }
}
