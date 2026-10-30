//! Writes a PNG of bright saturated effect colours at 0.5x to 16x intensity under three transforms, top to bottom in each colour's group: Warcraft's own (clip to white at 1.0), AgX per channel, and the hue-keeping curve the window uses. Usage: `post_swatches OUT.png`.

use image::{Rgb, RgbImage};
use wisp_window::post::{agx, srgb_encode, tone_map, Grade};

const COLOURS: [[f32; 3]; 4] = [[1.0, 0.78, 0.2], [0.3, 1.0, 0.1], [1.0, 0.45, 0.05], [0.4, 0.6, 1.0]];
const STEPS: [f32; 6] = [0.5, 1.0, 2.0, 4.0, 8.0, 16.0];
const CELL: u32 = 64;

fn byte(channel: f32) -> u8 {
    (channel.clamp(0.0, 1.0) * 255.0 + 0.5) as u8
}

fn main() {
    let out = std::env::args().nth(1).expect("an output PNG path");
    let rows = COLOURS.len() as u32 * 3;
    let mut image = RgbImage::new(STEPS.len() as u32 * CELL, rows * CELL);
    for (colour, base) in COLOURS.iter().enumerate() {
        for (step, gain) in STEPS.iter().enumerate() {
            let light = base.map(|channel| channel * gain);
            let shown = [light.map(srgb_encode), agx(light).map(srgb_encode), tone_map(light, &Grade::NEUTRAL)];
            for (method, rgb) in shown.iter().enumerate() {
                let row = colour as u32 * 3 + method as u32;
                for y in 0..CELL {
                    for x in 0..CELL {
                        image.put_pixel(step as u32 * CELL + x, row * CELL + y, Rgb(rgb.map(byte)));
                    }
                }
            }
        }
    }
    image.save(&out).expect("the PNG is written");
    println!("wrote {out}");
}
