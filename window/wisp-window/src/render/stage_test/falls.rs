//! A fall standing behind the stand-in sea: told from standing water by its faces, it keeps off the sea's plane and runs its streaks down at the fall's speed.

use std::time::Duration;

use super::*;
use super::super::passes::Bind;

const FALL: &str = "war3mapImported\\StageFall.mdx";
const SIZE: (u32, u32) = (960, 640);

fn wall() -> (Vec<Vertex>, Vec<u32>) {
    let corner = |x: f32, z: f32| vertex([x, 0.0, z], [0.0, -1.0, 0.0]);
    (vec![corner(-250.0, -400.0), corner(250.0, -400.0), corner(250.0, 900.0), corner(-250.0, 900.0)], vec![0, 1, 2, 0, 2, 3])
}

fn stage_with_fall() -> Option<Stage> {
    let mut stage = Stage::new(SIZE)?;
    stage.renderer.add_model(FALL, model(wall(), Paint::Water, Filter::Blend));
    Some(stage)
}

fn scene_with_fall() -> Scene {
    let mut scene = Stage::scene(1.0, Preset::Water);
    scene.poses.insert(0, placed(FALL, 450.0, 1200.0, 0.0, [1.0; 3]));
    scene
}

fn grey(rgba: &[u8], x: u32, y: u32) -> f32 {
    let [red, green, blue] = pixel(rgba, SIZE.0, x, y);
    0.3 * f32::from(red) + 0.59 * f32::from(green) + 0.11 * f32::from(blue)
}

fn drawn_at(stage: &mut Stage, scene: &Scene, seconds: f32) -> Vec<u8> {
    stage.renderer.started = Instant::now() - Duration::from_secs_f32(seconds);
    stage.draw(scene);
    let rgba = stage.read();
    if let Ok(dir) = std::env::var("WISP_WATER_CAPTURE_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        capture::write(&PathBuf::from(dir).join(format!("fall-{seconds:.1}.png")), SIZE.0, SIZE.1, &rgba).unwrap();
    }
    rgba
}

/// Where the fall's upper body sits on screen: world x 200 to 700 and z 400 to 800 at the wall's depth.
const BODY: (std::ops::Range<u32>, std::ops::Range<u32>) = (500..640, 70..170);

#[test]
fn a_fall_is_told_by_its_faces_and_never_sets_the_seas_plane() {
    let Some(mut stage) = stage_with_fall() else { return };
    let mut scene = scene_with_fall();
    scene.poses[0].matrix[14] = 300.0;
    stage.draw(&scene);
    let (fall, sea) = (&stage.renderer.models[stage.renderer.model_ids[FALL]], &stage.renderer.models[stage.renderer.model_ids[super::sea(Preset::Water)]]);
    assert!(matches!(fall.draws[0].bind, Bind::Fall) && fall.liquid.is_none(), "a water layer standing on end is a fall, not a liquid");
    assert!(matches!(sea.draws[0].bind, Bind::Sea) && sea.liquid.map(|(preset, _)| preset) == Some(Preset::Water));
    assert_eq!(stage.renderer.water_level, Some(0.0), "the sea sets the plane though the fall comes first");
}

#[test]
fn the_streaks_run_down_at_the_falls_speed() {
    let Some(mut stage) = stage_with_fall() else { return };
    let scene = scene_with_fall();
    stage.draw(&scene);
    let (first, later) = (drawn_at(&mut stage, &scene, 10.0), drawn_at(&mut stage, &scene, 10.2));
    let shift_of = |shift: i32| {
        let mut gap = 0.0;
        for y in 80..160i32 {
            for x in BODY.0.clone() {
                gap += (grey(&first, x, y as u32) - grey(&later, x, (y + shift) as u32)).abs();
            }
        }
        gap
    };
    let expected = super::super::water::falls::Fall::WATERFALL.speed * 0.2 * (SIZE.1 as f32 / 2.0) / (0.5 * 2700.0);
    let best = ((expected * 0.5) as i32..=(expected * 1.6).ceil() as i32).min_by(|&a, &b| shift_of(a).total_cmp(&shift_of(b))).unwrap();
    assert!((0.75..1.4).contains(&(best as f32 / expected)), "the pattern moved {best} pixels down in 0.2 s, expected about {expected:.1}");
}
