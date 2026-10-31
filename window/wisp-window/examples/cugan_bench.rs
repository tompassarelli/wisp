//! Times Real-CUGAN 2x on the window's own adapter: `cargo run --release -p wisp-window --example cugan_bench -- FILES...`. Each file is a PNG, BLP, TGA or DDS texture, and a leading `+` on its name, or `terrainart_` in it, has it wrapped as a tiling texture, and one of 1024 pixels or more on a side is skipped as the remaster skips it; the report gives the start-up (pipelines and weights), each texture's time and the total, then the megapixels per second. Nothing is written.

use std::time::Instant;

use wisp_window::remaster::{self, Cache, Edges, Quality, Upscaler, LARGEST_SOURCE};
use wisp_window::texture::decode;

fn main() {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions { power_preference: wgpu::PowerPreference::HighPerformance, ..Default::default() })).expect("an adapter");
    let info = adapter.get_info();
    let started = Instant::now();
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor { required_limits: wisp_window::remaster::device_limits(&adapter.limits()), ..Default::default() })).expect("a device");
    let upscaler = Upscaler::on(device, queue, &info);
    upscaler.announce(&mut std::io::stderr());
    println!("adapter {} ({:?}, {:?}); method {}; start-up {:.0} ms", info.name, info.device_type, info.backend, upscaler.method(), started.elapsed().as_secs_f64() * 1000.0);
    let (mut pixels, mut total, mut count, mut fallbacks) = (0u64, 0.0, 0, 0);
    let mut textures = Vec::new();
    let mut files = Vec::new();
    for argument in std::env::args().skip(1) {
        let (path, edges) = match argument.strip_prefix('+') {
            Some(path) => (path.to_string(), Edges::Wrap),
            None if argument.contains("terrainart_") => (argument.clone(), Edges::Wrap),
            None => (argument.clone(), Edges::for_path(&argument)),
        };
        let bytes = std::fs::read(&path).unwrap_or_else(|error| panic!("{path}: {error}"));
        let Ok(image) = decode(&bytes) else {
            eprintln!("{path}: not a texture");
            continue;
        };
        if image.width.max(image.height) >= LARGEST_SOURCE {
            continue;
        }
        let started = Instant::now();
        let (doubled, fell_back) = upscaler.doubled(&image, edges, &path);
        upscaler.announce(&mut std::io::stderr());
        fallbacks += usize::from(fell_back);
        let seconds = started.elapsed().as_secs_f64();
        assert_eq!(doubled.width, image.width * 2);
        println!("{path}: {}x{} in {:.0} ms", image.width, image.height, seconds * 1000.0);
        pixels += u64::from(image.width) * u64::from(image.height);
        textures.push((image, edges));
        files.push((path, edges));
        total += seconds;
        count += 1;
    }
    println!("{count} textures, {fallbacks} on the fallback filter, {:.2} Mpx, {:.0} ms, {:.2} Mpx/s", pixels as f64 / 1e6, total * 1000.0, pixels as f64 / 1e6 / total.max(1e-9));
    let filter = Upscaler::classical();
    let started = Instant::now();
    for (image, edges) in &textures {
        filter.doubled(image, *edges, "");
    }
    println!("the edge-directed filter alone on the same textures: {:.0} ms", started.elapsed().as_secs_f64() * 1000.0);
    let folder = std::env::temp_dir().join(format!("cugan-bench-{}", std::process::id()));
    let cache = Cache::at(folder.clone()).expect("a cache folder");
    for pass in ["first run, cache empty", "second run, cache full"] {
        let started = Instant::now();
        for (path, edges) in &files {
            remaster::prepare(&std::fs::read(path).expect("read texture"), Quality::Standard, Some(&cache), &upscaler, *edges, path).expect("prepare");
        }
        println!("remaster load of the same {} files, {pass}: {:.0} ms", files.len(), started.elapsed().as_secs_f64() * 1000.0);
    }
    let _ = std::fs::remove_dir_all(folder);
}
