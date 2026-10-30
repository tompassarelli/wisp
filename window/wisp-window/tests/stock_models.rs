//! Models from the player's Warcraft III install, read from the extracted stock folders named by `WISP_STOCK_DIRS` (colon separated);
//! without it these tests have nothing to read and say so.

use std::path::PathBuf;

use wisp_window::model::Model;
use wisp_window::remaster::Quality;
use wisp_window::render::model::Paint;
use wisp_window::render::source;

fn stock_model(path: &str) -> Option<Vec<u8>> {
    let dirs = std::env::var("WISP_STOCK_DIRS").ok()?;
    dirs.split(':').map(PathBuf::from).find_map(|dir| std::fs::read(dir.join(path)).ok())
}

#[test]
fn an_orc_building_samples_its_own_texture_coordinates() {
    let Some(bytes) = stock_model("buildings/orc/watchtower/watchtower.mdx") else {
        println!("WISP_STOCK_DIRS names no folder holding buildings/orc/watchtower/watchtower.mdx");
        return;
    };
    let model = Model::from_mdx(&bytes).expect("the building parses");
    assert_eq!(model.geosets.len(), 10);
    let data = source::model(&bytes, Quality::Off).expect("the building builds");
    let mut first = 0;
    for (index, geoset) in model.geosets.iter().enumerate() {
        assert_eq!(geoset.uvs.len(), geoset.vertices.len(), "geoset {index} has one coordinate per vertex");
        for (at, uv) in geoset.uvs.iter().enumerate() {
            assert!(uv.iter().all(|value| (-0.01..=1.01).contains(value)), "geoset {index} vertex {at} samples {uv:?}, outside its texture");
            assert_eq!(data.vertices[first + at].uv, *uv, "geoset {index} vertex {at} keeps its own coordinates");
        }
        first += geoset.vertices.len();
        let material = &model.materials[geoset.material_id as usize];
        let part = &data.parts[index];
        assert_eq!(part.layers.len(), material.layers.len(), "geoset {index} draws each layer of its material once");
    }
    let painted: Vec<&Paint> = data.parts[6].layers.iter().map(|layer| &layer.paint).collect();
    assert_eq!(painted, [&Paint::TeamGlow], "the full-texture quad is the team glow, not the building's atlas");
}
