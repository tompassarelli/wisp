//! Measures the remaster on texture files: the time per texture, and how well each upscaler restores a texture it was given at half size (PSNR against the original), with before and after images written beside it. Usage: `remaster_report OUT_DIR TEXTURE...`. Output stays in OUT_DIR, which belongs outside any repository.

use std::path::Path;
use std::time::Instant;

use image::imageops::{resize, FilterType};
use image::RgbaImage;
use wisp_window::remaster::{enhance, Cache, Quality};
use wisp_window::texture::{decode, Image};

fn rgba(image: &Image) -> RgbaImage {
    RgbaImage::from_raw(image.width, image.height, image.rgba.clone()).expect("a full pixel buffer")
}

fn plain(image: &RgbaImage) -> Image {
    Image { width: image.width(), height: image.height(), rgba: image.as_raw().clone() }
}

fn psnr(a: &RgbaImage, b: &RgbaImage) -> f64 {
    let error: f64 = a.as_raw().iter().zip(b.as_raw()).map(|(x, y)| (f64::from(*x) - f64::from(*y)).powi(2)).sum::<f64>() / a.as_raw().len() as f64;
    10.0 * (255.0f64 * 255.0 / error.max(1e-9)).log10()
}

fn main() {
    let mut arguments = std::env::args().skip(1);
    let out = arguments.next().expect("OUT_DIR");
    std::fs::create_dir_all(&out).expect("create OUT_DIR");
    println!("| texture | size | bilinear dB | bicubic dB | edge-directed dB | x2 ms | x4 ms | cache hit ms |");
    println!("|---|---|---|---|---|---|---|---|");
    for path in arguments {
        let name = Path::new(&path).file_stem().and_then(|stem| stem.to_str()).unwrap_or("texture").to_string();
        let source = decode(&std::fs::read(&path).expect("read texture")).expect("decode texture");
        let original = rgba(&source);
        let (half_w, half_h) = (source.width / 2, source.height / 2);
        let half = resize(&original, half_w, half_h, FilterType::Triangle);
        let (bilinear, bicubic) = (resize(&half, source.width, source.height, FilterType::Triangle), resize(&half, source.width, source.height, FilterType::CatmullRom));
        let edge = enhance(&plain(&half), Quality::Standard).expect("half-size texture is below the size limit");
        let edge = rgba(&edge.albedo);
        let started = Instant::now();
        let standard = enhance(&source, Quality::Standard).expect("below the size limit");
        let standard_ms = started.elapsed().as_secs_f64() * 1000.0;
        let started = Instant::now();
        let high = enhance(&source, Quality::High).expect("below the size limit");
        let high_ms = started.elapsed().as_secs_f64() * 1000.0;
        let cache = Cache::at(Path::new(&out).join("cache")).expect("open the report cache");
        cache.store("probe", &standard);
        let started = Instant::now();
        let loaded = cache.load("probe").expect("read the cache back");
        let hit_ms = started.elapsed().as_secs_f64() * 1000.0;
        assert_eq!(loaded.albedo.rgba, standard.albedo.rgba);
        println!(
            "| {name} | {}x{} | {:.2} | {:.2} | {:.2} | {standard_ms:.0} | {high_ms:.0} | {hit_ms:.0} |",
            source.width, source.height, psnr(&original, &bilinear), psnr(&original, &bicubic), psnr(&original, &edge)
        );
        let save = |suffix: &str, image: &Image| rgba(image).save(Path::new(&out).join(format!("{name}.{suffix}.png"))).expect("write image");
        save("original", &source);
        save("bilinear", &plain(&resize(&original, source.width * 2, source.height * 2, FilterType::Triangle)));
        save("remaster2x", &standard.albedo);
        save("remaster4x", &high.albedo);
        let mut normal = standard.relief.rgba.clone();
        let mut roughness = standard.relief.rgba.clone();
        for (n, r) in normal.chunks_exact_mut(4).zip(roughness.chunks_exact_mut(4)) {
            n[3] = 255;
            r.copy_from_slice(&[r[3], r[3], r[3], 255]);
        }
        save("normal", &Image { width: standard.relief.width, height: standard.relief.height, rgba: normal });
        save("roughness", &Image { width: standard.relief.width, height: standard.relief.height, rgba: roughness });
    }
}
