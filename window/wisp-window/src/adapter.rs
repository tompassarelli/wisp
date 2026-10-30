pub fn pick(instance: &wgpu::Instance, surface: Option<&wgpu::Surface<'_>>) -> Result<wgpu::Adapter, String> {
    let wanted = std::env::var("WISP_GPU").ok().filter(|name| !name.is_empty());
    let Some(wanted) = wanted else {
        return pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: surface,
            force_fallback_adapter: false,
            apply_limit_buckets: false,
        }))
        .map_err(|e| format!("adapter: {e}"));
    };
    let adapters = pollster::block_on(instance.enumerate_adapters(wgpu::Backends::all()));
    let needle = wanted.to_lowercase();
    let found: Vec<String> = adapters.iter().map(|adapter| adapter.get_info().name).collect();
    adapters
        .into_iter()
        .find(|adapter| adapter.get_info().name.to_lowercase().contains(&needle) && surface.map_or(true, |surface| adapter.is_surface_supported(surface)))
        .ok_or_else(|| format!("WISP_GPU={wanted} matches no adapter that can draw here; found {found:?}"))
}
