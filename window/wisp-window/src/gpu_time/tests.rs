use super::*;

#[test]
fn a_frame_adds_the_passes_of_one_kind_and_spans_from_the_first_stamp_to_the_last() {
    let passes = [Pass::Shadow, Pass::Post, Pass::Post, Pass::Ui];
    let stamps = [100, 300, 400, 450, 450, 600, 700, 1100];
    let frame = frame_of(&passes, &stamps, 1e6).expect("stamps run forwards");
    assert_eq!(frame.passes, vec![(Pass::Shadow, 200.0), (Pass::Post, 200.0), (Pass::Ui, 400.0)]);
    assert_eq!(frame.span_ms, 1000.0);
    assert_eq!(frame_of(&[Pass::Scene], &[500, 400], 1.0), None, "a stamp that went backwards drops the frame");
}

fn timed_frame(device: &wgpu::Device, queue: &wgpu::Queue, clock: &mut GpuClock, target: &wgpu::TextureView) -> bool {
    let mut timer = clock.begin();
    let mut encoder = device.create_command_encoder(&Default::default());
    let writes = timer.writes(Pass::Scene);
    let timed = writes.is_some();
    drop(encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
        label: Some("scene"),
        color_attachments: &[Some(wgpu::RenderPassColorAttachment { view: target, depth_slice: None, resolve_target: None, ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store } })],
        depth_stencil_attachment: None,
        timestamp_writes: writes,
        occlusion_query_set: None,
        multiview_mask: None,
    }));
    clock.finish(&mut encoder, timer);
    queue.submit([encoder.finish()]);
    clock.submitted();
    timed
}

#[test]
fn a_frame_goes_untimed_rather_than_wait_when_every_slot_is_still_mapping() {
    let Some((device, queue)) = crate::test_gpu::device() else { return };
    let mut clock = match GpuClock::new(&device, &queue) {
        Ok(clock) => clock,
        Err(why) => return eprintln!("skipped: {why}"),
    };
    let target = device.create_texture(&wgpu::TextureDescriptor {
        label: None,
        size: wgpu::Extent3d { width: 64, height: 64, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    });
    let view = target.create_view(&Default::default());
    let timed: Vec<bool> = (0..SLOTS + 2).map(|_| timed_frame(&device, &queue, &mut clock, &view)).collect();
    assert_eq!(timed, [vec![true; SLOTS], vec![false; 2]].concat(), "frames past the ring's size go untimed instead of waiting on a map");
    assert_eq!(clock.untimed(), 2);

    device.poll(wgpu::PollType::wait_indefinitely()).expect("the test's own wait");
    let frames = clock.collect();
    assert_eq!(frames.len(), SLOTS, "every timed frame came back once its map finished");
    assert!(frames.iter().all(|frame| frame.passes.len() == 1 && frame.passes[0].0 == Pass::Scene && frame.span_ms >= 0.0), "{frames:?}");
    assert!(clock.collect().is_empty(), "a frame is read once");
    assert!(timed_frame(&device, &queue, &mut clock, &view), "a read slot is free again");
}
