use crate::render::*;
use crate::render::gpu_tests::FlatRig;

const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

/// A one-geoset model of a triangle in the plane a sprite's camera faces: its apex up when `apex_up`, else down, so a card's picture tells the two apart.
fn card_model(apex_up: bool) -> ModelData {
    let draw = model::Part { color_slot: 0, first_index: 0, index_count: 6, layers: vec![model::Layer { paint: Paint::None, filter: Filter::Opaque, color_slot: 1, unshaded: true, two_sided: true }] };
    let corner = |y: f32, z: f32| Vertex { position: [0.0, y, z], normal: [1.0, 0.0, 0.0], uv: [0.0; 2], bones: [0; 4], weights: [1.0, 0.0, 0.0, 0.0] };
    let (base, apex) = if apex_up { (0.0, 120.0) } else { (120.0, 0.0) };
    ModelData { vertices: vec![corner(-40.0, base), corner(40.0, base), corner(0.0, apex)], indices: vec![0, 1, 2, 0, 2, 1], parts: vec![draw], rig: Box::new(FlatRig::new([1.0; 4])), emitters: Vec::new(), ribbons: Vec::new(), spawners: Vec::new() }
}

#[derive(Debug, PartialEq)]
enum Card {
    Blank,
    ApexUp,
    ApexDown,
}

/// Draws the UI scene of card frames `cards` (left and right halves of the screen, each `None` or a model path) as the window does, and tells what each half shows.
fn draw_cards(renderer: &mut Renderer, ui: &mut crate::ui::UiRenderer, device: &wgpu::Device, queue: &wgpu::Queue, cards: [Option<&str>; 2]) -> [Card; 2] {
    let (width, height) = (128_u32, 96_u32);
    let rows: Vec<String> = cards
        .iter()
        .enumerate()
        .filter_map(|(half, model)| model.map(|model| (half, model)))
        .map(|(half, model)| format!(r#"{{"rectangle":[{},0.6,{},0.0],"alpha":255,"visible":true,"sprite":{{"model":"{model}","sequence":0,"frame":0,"clock":0,"bounds":[-1,-40,0,1,40,120]}}}}"#, 0.4 * half as f32, 0.4 * (half + 1) as f32))
        .collect();
    ui.load_scene(format!(r#"{{"ui":[{}]}}"#, rows.join(",")).as_bytes()).expect("card scene");
    let target = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("cards"),
        size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = target.create_view(&Default::default());
    let mut encoder = device.create_command_encoder(&Default::default());
    encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
        label: Some("clear"),
        color_attachments: &[Some(wgpu::RenderPassColorAttachment { view: &view, depth_slice: None, resolve_target: None, ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), store: wgpu::StoreOp::Store } })],
        depth_stencil_attachment: None,
        timestamp_writes: None,
        occlusion_query_set: None,
        multiview_mask: None,
    });
    let area = [0.0, 0.0, width as f32, height as f32];
    ui.each_sprite(area, |index, extent, shot| renderer.draw_sprite(&mut encoder, &mut crate::gpu_time::PassTimer::off(), index, extent, shot, None));
    ui.draw(&mut encoder, &mut crate::gpu_time::PassTimer::off(), &view, (width, height), area, renderer);
    let buffer = device.create_buffer(&wgpu::BufferDescriptor { label: Some("read"), size: (width * height * 4) as u64, usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false });
    encoder.copy_texture_to_buffer(
        target.as_image_copy(),
        wgpu::TexelCopyBufferInfo { buffer: &buffer, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(width * 4), rows_per_image: Some(height) } },
        wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
    );
    queue.submit([encoder.finish()]);
    buffer.slice(..).map_async(wgpu::MapMode::Read, |_| ());
    let _ = device.poll(wgpu::PollType::wait_indefinitely());
    let pixels = buffer.slice(..).get_mapped_range().expect("mapped").to_vec();
    let covered = |half: u32, rows: std::ops::Range<u32>| {
        let columns = half * width / 2..(half + 1) * width / 2;
        rows.flat_map(|row| columns.clone().map(move |column| (row, column))).filter(|&(row, column)| pixels[((row * width + column) * 4) as usize..][..4].iter().any(|&channel| channel > 8)).count()
    };
    [0, 1].map(|half| {
        let (top, bottom) = (covered(half, 0..height / 3), covered(half, 2 * height / 3..height));
        if top + bottom == 0 {
            Card::Blank
        } else if bottom > top {
            Card::ApexUp
        } else {
            Card::ApexDown
        }
    })
}

#[test]
fn each_card_frame_draws_its_own_model_through_late_models_and_model_changes() {
    let Some((device, queue)) = crate::test_gpu::device() else { return };
    let mut renderer = Renderer::new(device.clone(), queue.clone(), FORMAT, crate::remaster::Quality::Off, crate::settings::Preset::High.features());
    let mut ui = crate::ui::UiRenderer::new(device.clone(), queue.clone(), FORMAT);
    renderer.add_model("up", card_model(true));
    assert_eq!(draw_cards(&mut renderer, &mut ui, &device, &queue, [None, Some("up")]), [Card::Blank, Card::ApexUp], "only the right card shows");
    assert_eq!(draw_cards(&mut renderer, &mut ui, &device, &queue, [Some("down"), Some("up")]), [Card::Blank, Card::ApexUp], "a card whose model is not built yet shows nothing, not the picture its sprite slot last held");
    renderer.add_model("down", card_model(false));
    assert_eq!(draw_cards(&mut renderer, &mut ui, &device, &queue, [Some("down"), Some("up")]), [Card::ApexDown, Card::ApexUp], "two cards given different models draw different models");
    assert_eq!(draw_cards(&mut renderer, &mut ui, &device, &queue, [Some("up"), Some("down")]), [Card::ApexUp, Card::ApexDown], "a card given another model draws the new one");
}
