//! Real-CUGAN on wgpu against the ncnn port's outputs for the twelve bake-off textures (wisp:docs/remaster-upscaler.md). The port tiles at 400 pixels and approximates the squeeze-excitation means across tiles, which the five textures wider than 400 pixels (with their wrap padding) trigger; their references in `out-exact` come from the same tool with `-t 1200`, one exact tile. The textures come from a player's install and stay outside Git, in `$WISP_BAKEOFF` or `~/.local/state/wisp/remaster-bakeoff`; without them, or without a hardware adapter, each test fails when run with `--ignored`.

use std::path::PathBuf;

use image::RgbaImage;
use wisp_window::remaster::{Edges, Role, Upscaler};
use wisp_window::texture::Image;

const TEXTURES: [&str; 12] = ["footman", "heropaladin", "herodeathknight", "rifleman", "lords_grass", "lords_dirt", "lords_rock", "ashen_rock", "clouds8x8fire", "dust5a", "flare", "shockwave10"];

fn folder() -> Option<PathBuf> {
    let folder = std::env::var_os("WISP_BAKEOFF").map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/state/wisp/remaster-bakeoff")))?;
    folder.join("png").is_dir().then_some(folder)
}

fn upscaler() -> Option<Upscaler> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions { power_preference: wgpu::PowerPreference::HighPerformance, ..Default::default() })).ok()?;
    let info = adapter.get_info();
    if info.device_type == wgpu::DeviceType::Cpu {
        return None;
    }
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor { required_limits: wisp_window::remaster::device_limits(&adapter.limits()), ..Default::default() })).ok()?;
    println!("adapter {} on {:?}", info.name, info.backend);
    let upscaler = Upscaler::on(device, queue, &info);
    upscaler.announce(&mut std::io::stderr());
    Some(upscaler)
}

fn load(path: &std::path::Path) -> Image {
    let decoded = image::open(path).unwrap_or_else(|error| panic!("{}: {error}", path.display())).into_rgba8();
    Image { width: decoded.width(), height: decoded.height(), rgba: decoded.into_raw() }
}

fn edges(name: &str) -> Edges {
    if name.starts_with("lords_") || name.starts_with("ashen_") {
        Edges::Wrap
    } else {
        Edges::Mirror
    }
}

/// Mean absolute difference, in bytes, of the colour of pixels `a` marks visible.
fn colour_error(ours: &Image, theirs: &Image) -> f64 {
    let (mut sum, mut count) = (0u64, 0u64);
    for (a, b) in ours.rgba.chunks_exact(4).zip(theirs.rgba.chunks_exact(4)) {
        if a[3] > 0 {
            sum += (0..3).map(|channel| u64::from(a[channel].abs_diff(b[channel]))).sum::<u64>();
            count += 3;
        }
    }
    sum as f64 / count.max(1) as f64
}

#[test]
#[ignore = "needs the bake-off textures in $WISP_BAKEOFF and a hardware adapter"]
fn rgb_is_within_one_level_of_the_ncnn_port_and_alpha_is_todays_filter() {
    let (Some(folder), Some(upscaler)) = (folder(), upscaler()) else { panic!("the bake-off textures or a hardware adapter are missing") };
    let classical = Upscaler::classical();
    for name in TEXTURES {
        let source = load(&folder.join("png").join(format!("{name}.png")));
        let exact = folder.join("out-exact").join(format!("{name}.cugan.x2.png"));
        let reference = load(&if exact.exists() { exact } else { folder.join("out").join(format!("{name}.cugan.x2.png")) });
        let ours = upscaler.doubled(&source, edges(name), Role::Figure, name).0;
        let saved = folder.join("cugan-wgpu");
        std::fs::create_dir_all(&saved).unwrap();
        RgbaImage::from_raw(ours.width, ours.height, ours.rgba.clone()).unwrap().save(saved.join(format!("{name}.x2.png"))).unwrap();
        assert_eq!((ours.width, ours.height), (reference.width, reference.height), "{name}");
        let error = colour_error(&ours, &reference);
        let todays = classical.doubled(&source, edges(name), Role::Figure, name).0;
        assert!(ours.rgba.chunks_exact(4).zip(todays.rgba.chunks_exact(4)).all(|(a, b)| a[3] == b[3]), "{name}: alpha differs from today's filter");
        println!("{name}: colour error {error:.3} of 255");
        assert!(error <= 1.0, "{name}: colour error {error:.3} of 255 against the ncnn port");
    }
}

/// Mean absolute difference, on a 0 to 1 scale, between the first and last column and between the first and last row of the `width` x `height` rectangle at the top left.
fn seam(image: &Image, width: u32, height: u32) -> (f64, f64) {
    let at = |x: u32, y: u32| (y * image.width + x) as usize * 4;
    let mean = |pairs: &mut dyn Iterator<Item = (usize, usize)>| {
        let (mut sum, mut count) = (0.0, 0.0);
        for (a, b) in pairs {
            sum += (0..3).map(|channel| f64::from(image.rgba[a + channel].abs_diff(image.rgba[b + channel]))).sum::<f64>() / 255.0;
            count += 3.0;
        }
        sum / count
    };
    (mean(&mut (0..height).map(|y| (at(0, y), at(width - 1, y)))), mean(&mut (0..width).map(|x| (at(x, 0), at(x, height - 1)))))
}

#[test]
#[ignore = "needs the bake-off textures in $WISP_BAKEOFF and a hardware adapter"]
fn lords_grass_tiled_three_by_three_has_no_seam_the_source_lacks() {
    let (Some(folder), Some(upscaler)) = (folder(), upscaler()) else { panic!("the bake-off textures or a hardware adapter are missing") };
    let source = load(&folder.join("png/lords_grass.png"));
    let ours = upscaler.doubled(&source, Edges::Wrap, Role::Figure, "wrap").0;
    let (source_cell, our_cell) = (seam(&source, 64, 64), seam(&ours, 128, 128));
    let (source_whole, our_whole) = (seam(&source, source.width, source.height), seam(&ours, ours.width, ours.height));
    println!("first cell seam (columns, rows): source {source_cell:.3?}, upscaled {our_cell:.3?}; whole texture: source {source_whole:.3?}, upscaled {our_whole:.3?}");
    let sheet_folder = folder.join("cugan-wgpu");
    std::fs::create_dir_all(&sheet_folder).unwrap();
    let mut sheet = RgbaImage::new(ours.width * 3, ours.height * 3);
    let tile = RgbaImage::from_raw(ours.width, ours.height, ours.rgba.clone()).unwrap();
    for (row, column) in (0..3).flat_map(|row| (0..3).map(move |column| (row, column))) {
        image::imageops::replace(&mut sheet, &tile, i64::from(column * ours.width), i64::from(row * ours.height));
    }
    let path = sheet_folder.join("lords_grass.3x3.png");
    sheet.save(&path).unwrap();
    println!("sheet {}", path.display());
    assert!(our_cell.0 <= source_cell.0 + 1e-3 && our_cell.1 <= source_cell.1 + 1e-3, "the first cell gained a seam");
    assert!(our_whole.0 <= source_whole.0 + 1e-3 && our_whole.1 <= source_whole.1 + 1e-3, "the tiled texture gained a seam");
}
