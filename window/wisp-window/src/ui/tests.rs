use super::*;

struct Plain {
    view: wgpu::TextureView,
}

impl UiTextures for Plain {
    fn view(&self, _path: &str) -> Option<&wgpu::TextureView> {
        Some(&self.view)
    }
}

const AREA: Pixels = [0.0, 0.0, 800.0, 600.0];

fn button(hovered: bool) -> String {
    let highlight = if hovered { r#","highlight":"glow.blp""# } else { "" };
    format!(
        r#"{{"ui":[{{"name":"b","template":"ScriptDialogButton","rectangle":[0.1,0.5,0.3,0.45],"text":"Start","alpha":255,"visible":true,
        "backdrop":{{"background":"back.blp","edge":"edge.blp","corner":0.01,"tile":0.256,"insets":[0.005,0.005,0.005,0.005],"corners":"UL|UR|BL|BR|T|L|B|R"}}{highlight}}}]}}"#
    )
}

fn built(hovered: bool) -> Option<(UiRenderer, Vec<(Source, Quad)>)> {
    built_from(&button(hovered))
}

fn built_from(scene_json: &str) -> Option<(UiRenderer, Vec<(Source, Quad)>)> {
    let (device, queue) = crate::test_gpu::device()?;
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: None,
        size: wgpu::Extent3d { width: 8, height: 1, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    });
    let textures = Plain { view: texture.create_view(&Default::default()) };
    let mut ui = UiRenderer::new(device, queue, wgpu::TextureFormat::Rgba8Unorm);
    ui.load_scene(scene_json.as_bytes()).unwrap();
    let scene = std::mem::take(&mut ui.scene);
    assert!(ui.build(&scene, &UiScene::default(), AREA, &textures));
    let mut start = 0;
    let mut quads = Vec::new();
    for run in &ui.runs {
        quads.extend(ui.quads[start..run.end].iter().map(|quad| (run.source, *quad)));
        start = run.end;
    }
    Some((ui, quads))
}

fn image(ui: &UiRenderer, path: &str) -> Source {
    Source::Image(ui.image_index[path].0)
}

#[test]
fn a_control_template_draws_its_background_inside_its_insets_and_its_eight_edge_pieces() {
    let Some((ui, quads)) = built(false) else { return };
    let backs: Vec<&Quad> = quads.iter().filter(|(source, _)| *source == image(&ui, "back.blp")).map(|(_, quad)| quad).collect();
    assert_eq!(backs.len(), 1);
    assert_eq!(backs[0].rect, [105.0, 105.0, 190.0, 40.0]);
    assert!((backs[0].uv[2] - 190.0 / 256.0).abs() < 1e-4 && (backs[0].uv[3] - 40.0 / 256.0).abs() < 1e-4);
    let edges: Vec<&Quad> = quads.iter().filter(|(source, _)| *source == image(&ui, "edge.blp")).map(|(_, quad)| quad).collect();
    assert_eq!(edges.iter().map(|quad| (quad.uv[0] * EDGE_PIECES).floor() as u32).collect::<Vec<_>>(), [0, 1, 2, 3, 4, 5, 6, 7]);
    assert_eq!(edges.iter().map(|quad| quad.coverage).collect::<Vec<_>>(), [IMAGE, IMAGE, IMAGE_TRANSPOSED, IMAGE_TRANSPOSED, IMAGE, IMAGE, IMAGE, IMAGE]);
    assert_eq!(edges[0].rect, [100.0, 110.0, 10.0, 30.0]);
    assert_eq!(edges[2].rect, [110.0, 100.0, 180.0, 10.0]);
    assert_eq!(edges[4].rect, [100.0, 100.0, 10.0, 10.0]);
    assert_eq!(edges[7].rect, [290.0, 140.0, 10.0, 10.0]);
    assert!(quads.iter().all(|(_, quad)| quad.coverage != IMAGE_ADDED));
    let label = quads.iter().position(|(source, _)| *source == Source::Glyphs).expect("the label draws");
    assert!(label > quads.iter().rposition(|(source, _)| *source == image(&ui, "edge.blp")).unwrap(), "the label draws over the backdrop");
}

#[test]
fn a_hovered_control_adds_its_highlight_over_the_whole_frame_under_its_label() {
    let Some((ui, quads)) = built(true) else { return };
    let lit: Vec<&(Source, Quad)> = quads.iter().filter(|(_, quad)| quad.coverage == IMAGE_ADDED).collect();
    assert_eq!(lit.len(), 1);
    assert_eq!(lit[0].0, image(&ui, "glow.blp"));
    assert_eq!(lit[0].1.rect, [100.0, 100.0, 200.0, 50.0]);
    let at = quads.iter().position(|(_, quad)| quad.coverage == IMAGE_ADDED).unwrap();
    assert!(at < quads.iter().position(|(source, _)| *source == Source::Glyphs).unwrap());
}

#[test]
fn a_texture_with_a_region_draws_only_that_sub_rectangle_of_its_image() {
    let scene = r#"{"ui":[{"name":"arch","type":"TEXTURE","rectangle":[0.1,0.5,0.3,0.45],"texture":"tile.blp","uv":[0.5,0,1,0.5],"alpha":255,"visible":true},
        {"name":"whole","type":"BACKDROP","rectangle":[0.4,0.5,0.6,0.45],"texture":"tile.blp","alpha":255,"visible":true}]}"#;
    let Some((_, quads)) = built_from(scene) else { return };
    let uvs: Vec<[f32; 4]> = quads.iter().map(|(_, quad)| quad.uv).collect();
    assert_eq!(uvs, [[0.5, 0.0, 1.0, 0.5], [0.0, 0.0, 1.0, 1.0]]);
}

fn measured(text: &str, size: f32) -> f32 {
    let face = fontdue::Font::from_bytes(include_bytes!("../../assets/DejaVuSans.ttf") as &[u8], fontdue::FontSettings::default()).unwrap();
    let mut before = None;
    text.chars().fold(0.0, |width, ch| {
        let kern = before.and_then(|left| face.horizontal_kern(left, ch, size)).unwrap_or(0.0);
        before = Some(ch);
        width + kern + face.metrics(ch, size).advance_width
    })
}

fn text_rows(text: &str, width_units: f32) -> Option<usize> {
    let scene = format!(r#"{{"ui":[{{"name":"row","type":"TEXT","rectangle":[0.05,0.5,{},0.45],"text":"{text}","alpha":255,"visible":true,"scale":2,"plain":true}}]}}"#, 0.05 + width_units);
    let (_, quads) = built_from(&scene)?;
    let mut tops: Vec<i32> = quads.iter().filter(|(source, _)| *source == Source::Glyphs).map(|(_, quad)| (quad.rect[1] + quad.rect[3]).round() as i32).collect();
    tops.sort_unstable();
    Some(1 + tops.windows(2).filter(|pair| pair[1] - pair[0] > 10).count())
}

#[test]
fn a_plain_text_row_wraps_only_when_its_measured_width_passes_the_frame_width() {
    let text = "This is where to find games, report bugs and contribute.";
    let size = 0.0085 * AREA[3] / 0.6 * 2.0;
    let units = measured(text, size) / (AREA[3] / 0.6);
    let Some(fits) = text_rows(text, units + 0.002) else { return };
    assert_eq!(fits, 1, "a row {units} units wide fits a frame 0.002 wider");
    assert_eq!(text_rows(text, units - 0.002), Some(2), "a row {units} units wide wraps in a frame 0.002 narrower");
}
