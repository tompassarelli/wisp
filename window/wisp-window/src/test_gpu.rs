use std::cell::OnceCell;
use std::sync::{Mutex, MutexGuard, OnceLock};

type Shared = Option<(wgpu::AdapterInfo, wgpu::Device, wgpu::Queue)>;

static TURN: Mutex<()> = Mutex::new(());

thread_local! {
    static HELD: OnceCell<MutexGuard<'static, ()>> = const { OnceCell::new() };
}

/// The one device every GPU test in the process uses, held by one test at a time: WARP fails and corrupts its heap when tests open their own devices at once (STATUS_ACCESS_VIOLATION, wisp#143) or build pipelines on the shared one at once (E_FAIL from CreatePipelineState, then STATUS_HEAP_CORRUPTION, wisp#236). The turn lasts until the test's thread ends. `WISP_GPU` names the adapter to use.
fn with_info() -> Shared {
    HELD.with(|held| {
        held.get_or_init(|| crate::sync::lock(&TURN));
    });
    static SHARED: OnceLock<Shared> = OnceLock::new();
    SHARED
        .get_or_init(|| {
            let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
            let wanted = std::env::var("WISP_GPU").ok();
            let named = wanted.and_then(|name| pollster::block_on(instance.enumerate_adapters(wgpu::Backends::all())).into_iter().find(|adapter| adapter.get_info().name.contains(&name)));
            let adapter = match named {
                Some(adapter) => adapter,
                None => pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions { power_preference: wgpu::PowerPreference::HighPerformance, force_fallback_adapter: false, ..Default::default() })).ok()?,
            };
            eprintln!("adapter: {}", adapter.get_info().name);
            let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor { required_features: crate::gpu_time::GpuClock::features(adapter.features()) | crate::render::multisample_features(adapter.features()), ..Default::default() })).ok()?;
            Some((adapter.get_info(), device, queue))
        })
        .clone()
}

pub(crate) fn device() -> Option<(wgpu::Device, wgpu::Queue)> {
    with_info().map(|(_, device, queue)| (device, queue))
}
