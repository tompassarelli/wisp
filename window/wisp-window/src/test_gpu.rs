use std::sync::OnceLock;

type Shared = Option<(wgpu::AdapterInfo, wgpu::Device, wgpu::Queue)>;

/// The one device every GPU test in the process uses: tests that each open their own run their devices at once, which crashes WARP (STATUS_ACCESS_VIOLATION on Windows CI, wisp#143). `WISP_GPU` names the adapter to use.
pub(crate) fn with_info() -> Shared {
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
            let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default())).ok()?;
            Some((adapter.get_info(), device, queue))
        })
        .clone()
}

pub(crate) fn device() -> Option<(wgpu::Device, wgpu::Queue)> {
    with_info().map(|(_, device, queue)| (device, queue))
}
