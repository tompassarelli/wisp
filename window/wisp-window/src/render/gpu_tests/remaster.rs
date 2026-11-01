use super::*;
use crate::render::assets::waits_for_match;

const RIG: &[u8] = include_bytes!("../../../tests/fixtures/rig.mdx");

#[test]
fn a_window_that_starts_on_original_art_swaps_the_remaster_in_when_it_is_built() {
    let Some((device, queue)) = device() else { return };
    let mut renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, crate::remaster::Quality::Off, crate::settings::Preset::High.features());
    renderer.set_quality(crate::remaster::Quality::Standard);
    let mut png = Vec::new();
    let pixels: Vec<u8> = (0..8 * 8).flat_map(|index| [index as u8 * 3, 40, 200, 255]).collect();
    image::codecs::png::PngEncoder::new(&mut png).write_image(&pixels, 8, 8, image::ExtendedColorType::Rgba8).unwrap();
    renderer.ingest("art.png", png);
    for _ in 0..4000 {
        renderer.pump();
        if !renderer.art_pending() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
    assert!(!renderer.art_pending() && renderer.incoming.is_idle(), "the remastered set never replaced the Original one");
    assert_eq!(renderer.quality(), crate::remaster::Quality::Standard);
    assert!(renderer.textures.contains_key("art.png") && renderer.reliefs.contains_key("art.png"), "the swapped-in set carries the remastered texture and its relief");
}

#[test]
fn a_texture_that_arrives_mid_match_bakes_in_the_match_and_is_drawn_once_play_stops() {
    if device().is_none() {
        return;
    }
    let mut renderer = baked_remastered();
    renderer.set_playing(true);
    renderer.ingest("fresh.png", seeded_png(8, 201));
    pump_until(&mut renderer, |renderer| renderer.bake_progress().is_some_and(|progress| progress.ready() && progress.total == 2));
    for _ in 0..100 {
        renderer.pump();
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
    assert!(renderer.art_pending() && !renderer.reliefs.contains_key("fresh.png") && renderer.incoming.is_idle(), "the automatic rebuild waits for the match to end");
    renderer.set_playing(false);
    pump_until(&mut renderer, |renderer| renderer.reliefs.contains_key("fresh.png") && !renderer.art_pending());
}

fn seeded_png(side: u32, salt: u8) -> Vec<u8> {
    let seed = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().subsec_nanos().to_le_bytes();
    let pixels: Vec<u8> = (0..side * side).flat_map(|index| [(index % side) as u8 ^ seed[0], (index / side) as u8 ^ seed[1], seed[2] ^ salt, 255]).collect();
    let mut png = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png).write_image(&pixels, side, side, image::ExtendedColorType::Rgba8).unwrap();
    png
}

fn pump_until(renderer: &mut Renderer, mut done: impl FnMut(&Renderer) -> bool) -> u32 {
    for pumps in 1..=60_000 {
        renderer.pump();
        if done(renderer) {
            return pumps;
        }
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
    panic!("the art never settled");
}

/// A renderer on the Original art whose textures are all in the bake cache, so a switch to Remastered finds the cache complete.
fn baked_original(side: u32, count: u8, models: u8) -> Renderer {
    let (device, queue) = device().expect("a device");
    let mut renderer = Renderer::new(device, queue, FORMAT, Quality::Off, crate::settings::Preset::High.features());
    renderer.set_quality(Quality::Standard);
    for index in 0..count {
        renderer.ingest(&format!("art{index}.png"), seeded_png(side, index));
    }
    for index in 0..models {
        renderer.ingest(&format!("model{index}.mdx"), RIG.to_vec());
    }
    pump_until(&mut renderer, |renderer| !renderer.art_pending() && renderer.reliefs.len() == count as usize && renderer.models.len() == models as usize);
    renderer.set_quality(Quality::Off);
    pump_until(&mut renderer, |renderer| renderer.quality == Quality::Off && renderer.incoming.is_idle());
    renderer
}

#[test]
fn the_players_switch_to_remastered_applies_mid_match_when_the_cache_is_complete() {
    if device().is_none() {
        return;
    }
    let mut renderer = baked_original(8, 1, 0);
    renderer.set_playing(true);
    renderer.set_quality(Quality::Standard);
    pump_until(&mut renderer, |renderer| renderer.bake_progress().is_some_and(|progress| progress.ready()));
    renderer.steer();
    assert!(!renderer.incoming.is_idle() || renderer.quality == Quality::Standard, "once the bake has counted the cache, the next steer builds the remastered set mid-match");
    pump_until(&mut renderer, |renderer| renderer.quality == Quality::Standard);
    assert!(renderer.playing && renderer.reliefs.contains_key("art0.png") && !renderer.art_pending(), "the remastered set is on screen while the match plays");
}

/// A renderer drawing the Remastered art, its textures all in the bake cache.
fn baked_remastered() -> Renderer {
    let mut renderer = baked_original(8, 1, 0);
    renderer.set_quality(Quality::Standard);
    pump_until(&mut renderer, |renderer| renderer.quality == Quality::Standard && !renderer.art_pending());
    renderer
}

#[test]
fn remastered_then_original_then_remastered_mid_match_bakes_the_new_textures_and_applies_in_the_match() {
    if device().is_none() {
        return;
    }
    let mut renderer = baked_remastered();
    renderer.set_playing(true);
    renderer.ingest("fresh.png", seeded_png(8, 200));
    renderer.set_quality(Quality::Off);
    pump_until(&mut renderer, |renderer| renderer.quality == Quality::Off && renderer.incoming.is_idle());
    renderer.set_quality(Quality::Standard);
    pump_until(&mut renderer, |renderer| renderer.quality == Quality::Standard && !renderer.art_pending());
    assert!(renderer.playing, "the match never stopped");
    assert_eq!(renderer.bake_progress(), Some(crate::remaster::Progress { done: 2, total: 2 }));
    assert!(renderer.reliefs.contains_key("art0.png") && renderer.reliefs.contains_key("fresh.png"), "the texture that arrived mid-match is baked and drawn remastered");
}

#[test]
fn switching_back_before_original_is_drawn_still_reaches_100_percent_in_the_match() {
    if device().is_none() {
        return;
    }
    let mut renderer = baked_remastered();
    renderer.set_playing(true);
    renderer.ingest("fresh.png", seeded_png(8, 202));
    renderer.set_quality(Quality::Off);
    renderer.pump();
    renderer.set_quality(Quality::Standard);
    pump_until(&mut renderer, |renderer| renderer.bake_progress().is_some_and(|progress| progress.ready() && progress.total == 2));
    assert_eq!(renderer.quality, Quality::Standard, "the drawn art stayed Remastered");
}

#[test]
fn a_rebuild_of_many_models_is_spread_over_frames() {
    if device().is_none() {
        return;
    }
    let mut renderer = baked_original(8, 1, 9);
    renderer.set_playing(true);
    renderer.set_quality(Quality::Standard);
    for _ in 0..4000 {
        renderer.steer();
        if !renderer.incoming.is_idle() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
    assert!(!renderer.incoming.is_idle(), "the switch started building beside the drawn set");
    std::thread::sleep(std::time::Duration::from_millis(1500));
    let mut hand_overs = 0;
    while renderer.hand_over().is_none() {
        hand_overs += 1;
        assert!(hand_overs < 4000, "never swapped");
    }
    assert_eq!(hand_overs, 2, "nine models went up four at a time, so two pumps left the set unfinished");
    assert_eq!((renderer.quality, renderer.models.len()), (Quality::Standard, 9));
}

#[test]
fn only_art_already_drawn_waits_for_the_match() {
    assert!(waits_for_match(true, Quality::Standard, Quality::Standard), "textures that arrived mid-match wait");
    assert!(!waits_for_match(true, Quality::Standard, Quality::Off), "the player's switch to Remastered does not");
    assert!(!waits_for_match(true, Quality::High, Quality::Standard), "nor does a change of level");
    assert!(!waits_for_match(true, Quality::Off, Quality::Standard), "nor the switch to Original");
    assert!(!waits_for_match(false, Quality::Standard, Quality::Standard), "between matches nothing waits");
}
