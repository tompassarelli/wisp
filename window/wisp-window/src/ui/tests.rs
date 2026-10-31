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
    ui.load_scene(button(hovered).as_bytes()).unwrap();
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
    Source::Image(ui.image_index[path])
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
