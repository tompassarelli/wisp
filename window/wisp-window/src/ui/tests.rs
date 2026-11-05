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

#[test]
fn a_texture_with_a_region_draws_only_that_sub_rectangle_of_its_image() {
    let scene = r#"{"ui":[{"name":"arch","type":"TEXTURE","rectangle":[0.1,0.5,0.3,0.45],"texture":"tile.blp","uv":[0.5,0,1,0.5],"alpha":255,"visible":true},
        {"name":"whole","type":"BACKDROP","rectangle":[0.4,0.5,0.6,0.45],"texture":"tile.blp","alpha":255,"visible":true}]}"#;
    let Some((_, quads)) = built_from(scene) else { return };
    let uvs: Vec<[f32; 4]> = quads.iter().map(|(_, quad)| quad.uv).collect();
    assert_eq!(uvs, [[0.5, 0.0, 1.0, 0.5], [0.0, 0.0, 1.0, 1.0]]);
}

