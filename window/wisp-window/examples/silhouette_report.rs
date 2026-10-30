//! Compares a model's bind-pose silhouette before and after the remaster's tessellation, from the front and the side, as a mask overlay (grey: both, red: only before, green: only after) and counts. Usage: `silhouette_report OUT_DIR MODEL.mdx... ` with `WISP_REMASTER_LEVELS` (default 1) subdivisions. Output stays in OUT_DIR, outside any repository.

use std::path::Path;

use wisp_window::render::model::ModelData;
use wisp_window::render::{source, tessellate::tessellate};
use wisp_window::remaster::Quality;

const SIZE: usize = 512;

fn project(data: &ModelData, side: bool) -> Vec<[f32; 2]> {
    data.vertices.iter().map(|vertex| [vertex.position[if side { 1 } else { 0 }], vertex.position[2]]).collect()
}

fn fill(mask: &mut [bool], points: &[[f32; 2]], indices: &[u32], origin: [f32; 2], scale: f32) {
    let place = |point: [f32; 2]| [(point[0] - origin[0]) * scale + 8.0, (SIZE as f32 - 8.0) - (point[1] - origin[1]) * scale];
    for triangle in indices.chunks_exact(3) {
        let [a, b, c] = [0, 1, 2].map(|corner| place(points[triangle[corner] as usize]));
        let (low_x, high_x) = (a[0].min(b[0]).min(c[0]).floor().max(0.0) as usize, a[0].max(b[0]).max(c[0]).ceil().min(SIZE as f32 - 1.0) as usize);
        let (low_y, high_y) = (a[1].min(b[1]).min(c[1]).floor().max(0.0) as usize, a[1].max(b[1]).max(c[1]).ceil().min(SIZE as f32 - 1.0) as usize);
        let edge = |p: [f32; 2], q: [f32; 2], x: f32, y: f32| (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
        for y in low_y..=high_y {
            for x in low_x..=high_x {
                let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
                let (w0, w1, w2) = (edge(a, b, px, py), edge(b, c, px, py), edge(c, a, px, py));
                if (w0 >= 0.0 && w1 >= 0.0 && w2 >= 0.0) || (w0 <= 0.0 && w1 <= 0.0 && w2 <= 0.0) {
                    mask[y * SIZE + x] = true;
                }
            }
        }
    }
}

fn main() {
    let mut arguments = std::env::args().skip(1);
    let out = arguments.next().expect("OUT_DIR");
    std::fs::create_dir_all(&out).expect("create OUT_DIR");
    let levels: u32 = std::env::var("WISP_REMASTER_LEVELS").ok().and_then(|value| value.parse().ok()).unwrap_or(1);
    println!("| model | view | triangles before | after | silhouette pixels | only before | only after | IoU |");
    println!("|---|---|---|---|---|---|---|---|");
    for path in arguments {
        let name = Path::new(&path).file_stem().and_then(|stem| stem.to_str()).unwrap_or("model").chars().take(24).collect::<String>();
        let bytes = std::fs::read(&path).expect("read model");
        let before = source::model(&bytes, Quality::Off).expect("parse model");
        let mut after = source::model(&bytes, Quality::Off).expect("parse model");
        tessellate(&mut after, levels);
        for side in [false, true] {
            let (flat, round) = (project(&before, side), project(&after, side));
            let bounds = flat.iter().chain(&round).fold([f32::MAX, f32::MAX, f32::MIN, f32::MIN], |b, p| [b[0].min(p[0]), b[1].min(p[1]), b[2].max(p[0]), b[3].max(p[1])]);
            let scale = (SIZE as f32 - 16.0) / (bounds[2] - bounds[0]).max(bounds[3] - bounds[1]).max(1e-3);
            let (mut mask_before, mut mask_after) = (vec![false; SIZE * SIZE], vec![false; SIZE * SIZE]);
            fill(&mut mask_before, &flat, &before.indices, [bounds[0], bounds[1]], scale);
            fill(&mut mask_after, &round, &after.indices, [bounds[0], bounds[1]], scale);
            let (mut both, mut only_before, mut only_after) = (0u32, 0u32, 0u32);
            let mut rgba = vec![255u8; SIZE * SIZE * 4];
            for (pixel, (b, a)) in rgba.chunks_exact_mut(4).zip(mask_before.iter().zip(&mask_after)) {
                let color = match (b, a) {
                    (true, true) => { both += 1; [150, 150, 150] }
                    (true, false) => { only_before += 1; [220, 40, 40] }
                    (false, true) => { only_after += 1; [40, 180, 60] }
                    _ => [255, 255, 255],
                };
                pixel[..3].copy_from_slice(&color);
            }
            let view = if side { "side" } else { "front" };
            image::RgbaImage::from_raw(SIZE as u32, SIZE as u32, rgba).expect("buffer").save(Path::new(&out).join(format!("{name}.{view}.overlay.png"))).expect("write overlay");
            println!(
                "| {name} | {view} | {} | {} | {} | {only_before} | {only_after} | {:.4} |",
                before.indices.len() / 3, after.indices.len() / 3, both + only_before + only_after, f64::from(both) / f64::from((both + only_before + only_after).max(1))
            );
        }
    }
}
