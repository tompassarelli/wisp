use std::fmt;

/// What one try at the surface's next image gave.
pub enum Acquired<T> {
    Image(T),
    /// An image the surface no longer matches: it goes back unshown and the surface is configured again.
    Suboptimal(T),
    /// No image this frame because the acquire timed out or the window is hidden; the next frame tries again.
    Skipped,
    /// The surface changed size or format and is configured again before the next image.
    Outdated,
    /// The surface was lost; configuring it again is a retry that counts toward the bound.
    Lost,
    /// A validation or out-of-memory error the device raised, caught by its error scope.
    Failed(String),
}

/// The surface a swapchain keeps configured: wgpu's in the window, a scripted one in tests.
pub trait Presentable {
    type Image;
    fn configure(&self, config: &wgpu::SurfaceConfiguration) -> Result<(), String>;
    fn acquire(&self) -> Acquired<Self::Image>;
}

/// How many failed tries in a row the swapchain retries before it reports the surface error.
pub const RETRIES: u32 = 8;
const FIRST_BACKOFF_NS: u64 = 16_000_000;
const LONGEST_BACKOFF_NS: u64 = 1_000_000_000;

/// The surface error a swapchain gave up on, after `tries` failed tries in a row.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SurfaceError {
    pub tries: u32,
    pub last: String,
}

impl fmt::Display for SurfaceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "surface error: {} tries in a row failed, the last at {}", self.tries, self.last)
    }
}

/// Keeps a surface configured to the window's size and present mode. Every configure happens inside `acquire`, so a failed one, or a lost surface or a device error at acquire, is retried after a backoff that doubles from 16 ms to 1 s, and reported as a `SurfaceError` once `RETRIES` retries in a row failed; an image resets the count.
pub struct Swapchain<S> {
    surface: S,
    config: wgpu::SurfaceConfiguration,
    unconfigured: bool,
    failures: u32,
    retry_at_ns: u64,
}

impl<S: Presentable> Swapchain<S> {
    pub fn new(surface: S, config: wgpu::SurfaceConfiguration) -> Self {
        Self { surface, config, unconfigured: true, failures: 0, retry_at_ns: 0 }
    }

    pub fn surface(&self) -> &S {
        &self.surface
    }

    pub fn config(&self) -> &wgpu::SurfaceConfiguration {
        &self.config
    }

    /// Changes the configuration, which the next `acquire` applies.
    pub fn reconfigure(&mut self, change: impl FnOnce(&mut wgpu::SurfaceConfiguration)) {
        change(&mut self.config);
        self.unconfigured = true;
    }

    /// The surface's next image at `now_ns`, configuring the surface first when it changed; none this frame when there is no image or a failed try is waiting out its backoff.
    pub fn acquire(&mut self, now_ns: u64) -> Result<Option<S::Image>, SurfaceError> {
        if now_ns < self.retry_at_ns {
            return Ok(None);
        }
        if self.unconfigured {
            if let Err(error) = self.surface.configure(&self.config) {
                return self.failed(now_ns, format!("configure: {error}"));
            }
            self.unconfigured = false;
        }
        match self.surface.acquire() {
            Acquired::Image(image) => {
                self.failures = 0;
                Ok(Some(image))
            }
            Acquired::Suboptimal(_) | Acquired::Outdated => {
                self.unconfigured = true;
                Ok(None)
            }
            Acquired::Skipped => Ok(None),
            Acquired::Lost => {
                self.unconfigured = true;
                self.failed(now_ns, "acquire: the surface was lost".into())
            }
            Acquired::Failed(error) => {
                self.unconfigured = true;
                self.failed(now_ns, format!("acquire: {error}"))
            }
        }
    }

    fn failed(&mut self, now_ns: u64, last: String) -> Result<Option<S::Image>, SurfaceError> {
        self.failures += 1;
        if self.failures > RETRIES {
            return Err(SurfaceError { tries: self.failures, last });
        }
        eprintln!("wisp-window: surface try {} of {} failed, retrying: {last}", self.failures, RETRIES + 1);
        self.retry_at_ns = now_ns + (FIRST_BACKOFF_NS << (self.failures - 1)).min(LONGEST_BACKOFF_NS);
        Ok(None)
    }
}

/// The window's wgpu surface, each configure and acquire under error scopes so a device error comes back as text instead of reaching wgpu's uncaptured-error handler, which panics.
pub struct WgpuSurface {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    forced_failure: bool,
}

impl WgpuSurface {
    /// `WISP_WINDOW_FORCE_SURFACE_FAILURE` makes every configure fail, so a run can watch the window report a surface error.
    pub fn new(surface: wgpu::Surface<'static>, device: wgpu::Device) -> Self {
        Self { surface, device, forced_failure: std::env::var_os("WISP_WINDOW_FORCE_SURFACE_FAILURE").is_some() }
    }

    pub fn capabilities(&self, adapter: &wgpu::Adapter) -> wgpu::SurfaceCapabilities {
        self.surface.get_capabilities(adapter)
    }
}

impl Presentable for WgpuSurface {
    type Image = wgpu::SurfaceTexture;

    fn configure(&self, config: &wgpu::SurfaceConfiguration) -> Result<(), String> {
        if self.forced_failure {
            return Err("forced surface failure (WISP_WINDOW_FORCE_SURFACE_FAILURE)".into());
        }
        let ((), error) = caught(&self.device, || self.surface.configure(&self.device, config));
        error.map_or(Ok(()), Err)
    }

    fn acquire(&self) -> Acquired<Self::Image> {
        let (current, error) = caught(&self.device, || self.surface.get_current_texture());
        match (current, error) {
            (_, Some(error)) => Acquired::Failed(error),
            (wgpu::CurrentSurfaceTexture::Success(texture), None) => Acquired::Image(texture),
            (wgpu::CurrentSurfaceTexture::Suboptimal(texture), None) => Acquired::Suboptimal(texture),
            (wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded, None) => Acquired::Skipped,
            (wgpu::CurrentSurfaceTexture::Outdated, None) => Acquired::Outdated,
            (wgpu::CurrentSurfaceTexture::Lost, None) => Acquired::Lost,
            (wgpu::CurrentSurfaceTexture::Validation, None) => Acquired::Failed("a validation error no scope caught".into()),
        }
    }
}

/// Runs `body` under an error scope for each filter, and returns its value with the first error any scope caught, on one line.
fn caught<T>(device: &wgpu::Device, body: impl FnOnce() -> T) -> (T, Option<String>) {
    let scopes = [wgpu::ErrorFilter::OutOfMemory, wgpu::ErrorFilter::Validation, wgpu::ErrorFilter::Internal].map(|filter| device.push_error_scope(filter));
    let value = body();
    let errors: Vec<wgpu::Error> = scopes.into_iter().rev().filter_map(|scope| pollster::block_on(scope.pop())).collect();
    let error = errors.first().map(|error| error.to_string().lines().map(str::trim).filter(|line| !line.is_empty()).collect::<Vec<_>>().join(" "));
    (value, error)
}

#[cfg(test)]
mod tests;
