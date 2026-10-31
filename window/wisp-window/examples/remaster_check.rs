//! Runs the remaster's measured gates over texture files and reports, per texture, palette drift, wrap-edge seam error, and detail kept and added against the Classic original.
//! Usage: `remaster_check --out DIR [--quality standard|high] [--worst N] [--classical] (--imports MAP_IMPORTS_DIR | TEXTURE...)`.
//! It measures the upscaler the window would run: Real-CUGAN on the machine's GPU, or the edge-directed filter with `--classical` or when only a software adapter exists.
//! `MAP_IMPORTS_DIR` is one unpacked map under `$XDG_CACHE_HOME/wisp/map-imports`. Terrain art (`terrainart/` paths, or `war3.w3mod_terrainart_*` file names from an install extract) is sampled with wrap, which turns on the seam gate.
//! Side-by-side crops of the worst N textures are written to DIR as `remaster-check-NAME.png`, outside any repository. Exits 1 when a texture fails.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use image::imageops::{resize, FilterType};
use image::RgbaImage;
use wisp_window::remaster::check::{fold, measure, most_changed_block, Report, LIMITS};
use wisp_window::remaster::{device_limits, enhance, Edges, Quality, Upscaler};
use wisp_window::texture::{decode, Image};

const THREADS: usize = 4;
const CROP: usize = 32;
const PANEL: u32 = 256;
const TEXTURE_EXTENSIONS: [&str; 4] = [".blp", ".dds", ".tga", ".png"];

struct Row {
    name: String,
    size: (u32, u32),
    report: Report,
    path: PathBuf,
    edges: Edges,
}

enum Outcome {
    Measured(Row),
    Left,
    Unreadable(String, String),
}

struct Arguments {
    out: PathBuf,
    quality: Quality,
    worst: usize,
    classical: bool,
    inputs: Vec<(String, PathBuf)>,
}

fn arguments() -> Arguments {
    let mut out = None;
    let (mut quality, mut worst, mut classical) = (Quality::Standard, 10, false);
    let mut inputs = Vec::new();
    let mut arguments = std::env::args().skip(1);
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--out" => out = arguments.next().map(PathBuf::from),
            "--quality" => quality = arguments.next().expect("--quality needs a value").parse().expect("a quality"),
            "--worst" => worst = arguments.next().expect("--worst needs a count").parse().expect("a count"),
            "--classical" => classical = true,
            "--imports" => inputs.extend(imported(Path::new(&arguments.next().expect("--imports needs a folder")))),
            file => inputs.push((Path::new(file).file_name().map_or_else(|| file.into(), |name| name.to_string_lossy().into_owned()), PathBuf::from(file))),
        }
    }
    Arguments { out: out.expect("--out DIR"), quality, worst, classical, inputs }
}

fn imported(folder: &Path) -> Vec<(String, PathBuf)> {
    let entries = std::fs::read_to_string(folder.join("entries.tsv")).expect("entries.tsv in the imports folder");
    entries
        .lines()
        .filter_map(|line| line.rsplit_once('\t'))
        .filter(|(name, _)| TEXTURE_EXTENSIONS.iter().any(|extension| name.to_ascii_lowercase().ends_with(extension)))
        .map(|(name, index)| (name.to_string(), folder.join(index)))
        .collect()
}

fn logical_path(name: &str) -> String {
    match name.strip_prefix("war3.w3mod_") {
        Some(rest) => rest.replacen('_', "/", 1),
        None => name.to_string(),
    }
}

fn upscaler(classical: bool) -> Upscaler {
    if classical {
        return Upscaler::classical();
    }
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions { power_preference: wgpu::PowerPreference::HighPerformance, ..Default::default() })).expect("an adapter");
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor { required_limits: device_limits(&adapter.limits()), ..Default::default() })).expect("a device");
    Upscaler::on(device, queue, &adapter.get_info())
}

fn check(name: &str, path: &Path, quality: Quality, upscaler: &Upscaler) -> Outcome {
    let source = match std::fs::read(path).map_err(|error| error.to_string()).and_then(|bytes| decode(&bytes)) {
        Ok(source) => source,
        Err(error) => return Outcome::Unreadable(name.into(), error),
    };
    let edges = Edges::for_path(&logical_path(name));
    let Some(maps) = enhance(&source, quality, upscaler, edges) else { return Outcome::Left };
    match measure(&source, &maps.albedo, edges == Edges::Wrap) {
        Ok(report) => Outcome::Measured(Row { name: name.into(), size: (source.width, source.height), report, path: path.into(), edges }),
        Err(error) => Outcome::Unreadable(name.into(), error),
    }
}

fn run(inputs: &[(String, PathBuf)], quality: Quality, upscaler: &Upscaler) -> Vec<Outcome> {
    let next = AtomicUsize::new(0);
    let results = Mutex::new(Vec::new());
    std::thread::scope(|scope| {
        for _ in 0..THREADS {
            scope.spawn(|| loop {
                let Some((name, path)) = inputs.get(next.fetch_add(1, Ordering::Relaxed)) else { break };
                let outcome = check(name, path, quality, upscaler);
                results.lock().expect("results lock").push(outcome);
            });
        }
    });
    results.into_inner().expect("results lock")
}

fn roll(image: &Image, dx: usize, dy: usize) -> Image {
    let (width, height) = (image.width as usize, image.height as usize);
    let mut rgba = Vec::with_capacity(image.rgba.len());
    for y in 0..height {
        for x in 0..width {
            let at = (((y + dy) % height) * width + (x + dx) % width) * 4;
            rgba.extend_from_slice(&image.rgba[at..at + 4]);
        }
    }
    Image { width: image.width, height: image.height, rgba }
}

fn over_grey(image: &Image, region: (usize, usize, usize)) -> RgbaImage {
    let (x0, y0, size) = region;
    let mut shown = RgbaImage::new(size as u32, size as u32);
    for y in 0..size {
        for x in 0..size {
            let at = ((y0 + y) * image.width as usize + x0 + x) * 4;
            let alpha = u32::from(image.rgba[at + 3]);
            let pixel = [0, 1, 2].map(|channel| ((u32::from(image.rgba[at + channel]) * alpha + 128 * (255 - alpha)) / 255) as u8);
            shown.put_pixel(x as u32, y as u32, image::Rgba([pixel[0], pixel[1], pixel[2], 255]));
        }
    }
    shown
}

fn error_panel(source: &RgbaImage, folded: &RgbaImage) -> RgbaImage {
    let mut panel = RgbaImage::new(source.width(), source.height());
    for (target, (a, b)) in panel.pixels_mut().zip(source.pixels().zip(folded.pixels())) {
        let difference = (0..3).map(|channel| u32::from(a[channel].abs_diff(b[channel]))).sum::<u32>() / 3;
        let level = (difference * 4).min(255) as u8;
        *target = image::Rgba([level, level, level, 255]);
    }
    panel
}

fn write_crop(row: &Row, quality: Quality, upscaler: &Upscaler, out: &Path) -> Result<PathBuf, String> {
    let source = decode(&std::fs::read(&row.path).map_err(|error| error.to_string())?)?;
    let upscaled = enhance(&source, quality, upscaler, row.edges).ok_or("left alone")?.albedo;
    let factor = (upscaled.width / source.width) as usize;
    let seam_worst = row.report.worst(&LIMITS).name == "seam";
    let (source, upscaled) = if seam_worst { (roll(&source, source.width as usize / 2, source.height as usize / 2), roll(&upscaled, upscaled.width as usize / 2, upscaled.height as usize / 2)) } else { (source, upscaled) };
    let folded = fold(&upscaled, source.width, source.height)?;
    let size = CROP.min(source.width as usize).min(source.height as usize);
    let (x, y) = if seam_worst { ((source.width as usize - size) / 2, (source.height as usize - size) / 2) } else { most_changed_block(&source, &folded, size) };
    let panel = |image: &RgbaImage| resize(image, PANEL, PANEL, FilterType::Nearest);
    let original = over_grey(&source, (x, y, size));
    let remastered = over_grey(&upscaled, (x * factor, y * factor, size * factor));
    let error = error_panel(&original, &over_grey(&folded, (x, y, size)));
    let mut sheet = RgbaImage::new(PANEL * 3 + 8, PANEL);
    for (index, part) in [panel(&original), panel(&remastered), panel(&error)].iter().enumerate() {
        image::imageops::replace(&mut sheet, part, i64::from(index as u32 * (PANEL + 4)), 0);
    }
    let file: String = row.name.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect();
    let path = out.join(format!("remaster-check-{file}.png"));
    sheet.save(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

fn describe(report: &Report) -> String {
    let seam = report.seam.map_or("   -  ".into(), |seam| format!("{seam:6.4}"));
    format!("{:5.2} {:6.4} {seam} {:6.4} {:6.2} {:6.4}", report.hue_degrees, report.saturation, report.detail_kept, report.detail_added, report.alpha_moved)
}

fn main() {
    let Arguments { out, quality, worst, classical, inputs } = arguments();
    let upscaler = upscaler(classical);
    std::fs::create_dir_all(&out).expect("create the output folder");
    let outcomes = run(&inputs, quality, &upscaler);
    upscaler.announce(&mut std::io::stderr());
    println!("upscaler: {}", upscaler.method());
    let mut rows = Vec::new();
    let (mut left, mut unreadable) = (0, 0);
    for outcome in outcomes {
        match outcome {
            Outcome::Measured(row) => rows.push(row),
            Outcome::Left => left += 1,
            Outcome::Unreadable(name, error) => {
                unreadable += 1;
                eprintln!("unreadable {name}: {error}");
            }
        }
    }
    rows.sort_by(|a, b| b.report.worst(&LIMITS).ratio().total_cmp(&a.report.worst(&LIMITS).ratio()).then_with(|| a.name.cmp(&b.name)));
    println!("limits: hue {}deg, saturation {}, seam {}, detail kept >= {}, detail added <= {}x, alpha moved {}", LIMITS.hue_degrees, LIMITS.saturation, LIMITS.seam, LIMITS.detail_kept, LIMITS.detail_added, LIMITS.alpha_moved);
    println!("{:<48} {:>9}  {:>5} {:>6} {:>6} {:>6} {:>6} {:>6}  verdict", "texture", "size", "hue", "sat", "seam", "kept", "added", "alpha");
    let mut failing = 0;
    let mut by_gate = std::collections::BTreeMap::<&str, usize>::new();
    for row in &rows {
        let failures = row.report.failures(&LIMITS);
        failing += usize::from(!failures.is_empty());
        for gate in &failures {
            *by_gate.entry(gate.name).or_default() += 1;
        }
        let verdict = if failures.is_empty() { "ok".into() } else { format!("FAIL {}", failures.iter().map(|gate| gate.name).collect::<Vec<_>>().join(", ")) };
        println!("{:<48} {:>4}x{:<4}  {}  {verdict}", row.name, row.size.0, row.size.1, describe(&row.report));
    }
    println!("\n{} textures measured, {failing} fail, {left} left alone, {unreadable} unreadable; failures by gate: {by_gate:?}", rows.len());
    println!("\nworst {worst} (crops: original | remaster | colour error x4):");
    for row in rows.iter().take(worst) {
        let gate = row.report.worst(&LIMITS);
        match write_crop(row, quality, &upscaler, &out) {
            Ok(path) => println!("{:<48} {} {:.3} against {:.3}  {}", row.name, gate.name, gate.value, gate.limit, path.display()),
            Err(error) => eprintln!("crop for {} failed: {error}", row.name),
        }
    }
    if failing > 0 {
        std::process::exit(1);
    }
}
