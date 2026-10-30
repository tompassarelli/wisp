use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU64, AtomicU8, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use winit::application::ApplicationHandler;
use winit::dpi::PhysicalSize;
use winit::event::{ElementState, WindowEvent};
use winit::event_loop::{ActiveEventLoop, EventLoop, EventLoopProxy};
use winit::keyboard::PhysicalKey;
use winit::window::{Window, WindowId};

use crate::clock::now_ns;
use crate::draw::Gpu;
use crate::frame::{Clock, FrameLoop, Mailbox, Mode, Sample, Seam, Submission, Surface};
use crate::input::{Held, Input};
use crate::metrics::Metrics;
use crate::pad::Pads;
use crate::sync::lock;

/// Why Bun is being woken: a frame to step, the window going away, or the library failing.
pub const WAKE_FRAME: u32 = 0;
pub const WAKE_CLOSED: u32 = 1;
pub const WAKE_ERROR: u32 = 2;

pub type Wake = extern "C" fn(kind: u32, frame: u32, sample_ns: f64, buttons: u32);

const WINDOW_WAIT: Duration = Duration::from_secs(10);

enum Command {
    Status(String),
    Exit,
}

struct Shared {
    held: Held,
    focused: AtomicBool,
    pad_slot: AtomicI32,
    mode: AtomicU8,
    closed: AtomicBool,
    size: AtomicU64,
    mailbox: Arc<Mailbox>,
    metrics: Arc<Mutex<Metrics>>,
    info: Mutex<String>,
    error: Mutex<Option<String>>,
}

fn pack(size: PhysicalSize<u32>) -> u64 {
    (size.width as u64) << 32 | size.height as u64
}

pub struct Host {
    shared: Arc<Shared>,
    proxy: EventLoopProxy<Command>,
    window_thread: Option<JoinHandle<()>>,
    render_thread: Option<JoinHandle<()>>,
}

struct App {
    shared: Arc<Shared>,
    title: String,
    size: (u32, u32),
    window: Option<Arc<Window>>,
    handoff: mpsc::Sender<Arc<Window>>,
}

impl ApplicationHandler<Command> for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let attributes = Window::default_attributes().with_title(self.title.clone()).with_inner_size(winit::dpi::LogicalSize::new(self.size.0, self.size.1));
        match event_loop.create_window(attributes) {
            Ok(window) => {
                let window = Arc::new(window);
                self.shared.size.store(pack(window.inner_size()), Ordering::Release);
                self.shared.focused.store(window.has_focus(), Ordering::Release);
                self.window = Some(window.clone());
                let _ = self.handoff.send(window);
            }
            Err(error) => {
                *lock(&self.shared.error) = Some(format!("window: {error}"));
                self.shared.closed.store(true, Ordering::Release);
                event_loop.exit();
            }
        }
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => {
                self.shared.closed.store(true, Ordering::Release);
                event_loop.exit();
            }
            WindowEvent::Focused(focused) => {
                self.shared.focused.store(focused, Ordering::Release);
                if !focused {
                    self.shared.held.clear();
                }
            }
            WindowEvent::Resized(size) => self.shared.size.store(pack(size), Ordering::Release),
            WindowEvent::KeyboardInput { event, .. } if !event.repeat => {
                if let PhysicalKey::Code(code) = event.physical_key {
                    self.shared.held.press(code, event.state == ElementState::Pressed);
                }
            }
            _ => {}
        }
    }

    fn user_event(&mut self, event_loop: &ActiveEventLoop, command: Command) {
        match command {
            Command::Status(text) => {
                if let Some(window) = &self.window {
                    window.set_title(&text);
                }
            }
            Command::Exit => event_loop.exit(),
        }
    }
}

fn any_thread(builder: &mut winit::event_loop::EventLoopBuilder<Command>) {
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        use winit::platform::{wayland::EventLoopBuilderExtWayland, x11::EventLoopBuilderExtX11};
        EventLoopBuilderExtX11::with_any_thread(builder, true);
        EventLoopBuilderExtWayland::with_any_thread(builder, true);
    }
    #[cfg(windows)]
    {
        use winit::platform::windows::EventLoopBuilderExtWindows;
        builder.with_any_thread(true);
    }
}

/// Spawns `body` and turns a panic into the error text, so no Rust panic ever unwinds toward Bun.
fn guarded(shared: &Arc<Shared>, wake: Wake, body: impl FnOnce() + Send + 'static) -> JoinHandle<()> {
    let shared = shared.clone();
    thread::spawn(move || {
        if let Err(panic) = catch_unwind(AssertUnwindSafe(body)) {
            let text = panic.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| panic.downcast_ref::<String>().cloned()).unwrap_or_else(|| "panic".into());
            *lock(&shared.error) = Some(text);
            shared.closed.store(true, Ordering::Release);
            wake(WAKE_ERROR, 0, 0.0, 0);
        }
    })
}

impl Host {
    pub fn open(title: &str, width: u32, height: u32, wake: Wake) -> Result<Self, String> {
        let shared = Arc::new(Shared {
            held: Held::default(),
            focused: AtomicBool::new(true),
            pad_slot: AtomicI32::new(-1),
            mode: AtomicU8::new(Mode::Loading as u8),
            closed: AtomicBool::new(false),
            size: AtomicU64::new(0),
            mailbox: Arc::new(Mailbox::default()),
            metrics: Arc::new(Mutex::new(Metrics::default())),
            info: Mutex::new(String::new()),
            error: Mutex::new(None),
        });
        let (proxy_in, proxy_out) = mpsc::channel();
        let (handoff, windows) = mpsc::channel();
        let window_thread = {
            let app_shared = shared.clone();
            let title = title.to_string();
            guarded(&shared, wake, move || {
                let mut builder = EventLoop::<Command>::with_user_event();
                any_thread(&mut builder);
                let event_loop = match builder.build() {
                    Ok(event_loop) => event_loop,
                    Err(error) => {
                        *lock(&app_shared.error) = Some(format!("event loop: {error}"));
                        app_shared.closed.store(true, Ordering::Release);
                        let _ = proxy_in.send(None);
                        return;
                    }
                };
                let _ = proxy_in.send(Some(event_loop.create_proxy()));
                let mut app = App { shared: app_shared, title, size: (width, height), window: None, handoff };
                let _ = event_loop.run_app(&mut app);
            })
        };
        let Some(proxy) = proxy_out.recv().map_err(|_| "window thread ended".to_string())? else {
            let _ = window_thread.join();
            return Err(lock(&shared.error).clone().unwrap_or_else(|| "no event loop".into()));
        };
        let render_thread = {
            let shared = shared.clone();
            guarded(&shared.clone(), wake, move || render_loop(shared, windows, wake))
        };
        Ok(Self { shared, proxy, window_thread: Some(window_thread), render_thread: Some(render_thread) })
    }

    pub fn start(&self) {
        self.shared.mode.store(Mode::Game as u8, Ordering::Release);
    }

    pub fn start_baseline(&self) {
        self.shared.mode.store(Mode::Baseline as u8, Ordering::Release);
    }

    pub fn select_pad(&self, slot: i32) {
        self.shared.pad_slot.store(slot, Ordering::Release);
    }

    pub fn set_status(&self, text: &str) {
        let _ = self.proxy.send_event(Command::Status(text.to_string()));
    }

    pub fn submit(&self, bytes: &[u8], step: u64, frame: u32) {
        self.shared.mailbox.submit(Submission { bytes: bytes.to_vec(), step, frame });
    }

    pub fn next_sample(&self, timeout: Duration) -> Option<Sample> {
        self.shared.mailbox.next_sample(timeout)
    }

    pub fn metric(&self, which: u32) -> Vec<f64> {
        lock(&self.shared.metrics).series(which).to_vec()
    }

    pub fn info(&self) -> String {
        lock(&self.shared.info).clone()
    }

    pub fn error(&self) -> Option<String> {
        lock(&self.shared.error).clone()
    }

    /// Stops both threads and waits for them, so the wake callback is never called again once this returns.
    pub fn close(mut self) {
        self.shared.mailbox.stop();
        let _ = self.proxy.send_event(Command::Exit);
        if let Some(thread) = self.render_thread.take() {
            let _ = thread.join();
        }
        if let Some(thread) = self.window_thread.take() {
            let _ = thread.join();
        }
    }
}

struct WindowSurface {
    gpu: Gpu,
    window: Arc<Window>,
    shared: Arc<Shared>,
}

impl Surface for WindowSurface {
    type Image = wgpu::SurfaceTexture;

    fn acquire(&mut self) -> Option<Self::Image> {
        let size = self.shared.size.load(Ordering::Acquire);
        self.gpu.resize((size >> 32) as u32, size as u32);
        let image = self.gpu.acquire();
        if image.is_none() {
            thread::sleep(Duration::from_millis(4));
        }
        image
    }

    fn draw(&self, image: &Self::Image, step: u64) {
        self.gpu.draw(image, step);
    }

    fn present(&self, image: Self::Image) {
        self.window.pre_present_notify();
        self.gpu.present(image);
    }
}

struct LibraryClock;

impl Clock for LibraryClock {
    fn now_ns(&self) -> u64 {
        now_ns()
    }
}

struct WakeSeam {
    shared: Arc<Shared>,
    pads: Mutex<Pads>,
    wake: Wake,
}

impl Seam for WakeSeam {
    fn input(&self) -> Input {
        let slot = usize::try_from(self.shared.pad_slot.load(Ordering::Acquire)).ok();
        lock(&self.pads).sample(slot, self.shared.focused.load(Ordering::Acquire), self.shared.held.sample())
    }

    fn wake(&self, sample: &Sample) {
        (self.wake)(WAKE_FRAME, sample.frame, sample.sampled_ns as f64, sample.input.buttons);
    }
}

fn mode_of(shared: &Shared) -> Mode {
    match shared.mode.load(Ordering::Acquire) {
        1 => Mode::Game,
        2 => Mode::Baseline,
        _ => Mode::Loading,
    }
}

fn render_loop(shared: Arc<Shared>, windows: mpsc::Receiver<Arc<Window>>, wake: Wake) {
    let Ok(window) = windows.recv_timeout(WINDOW_WAIT) else {
        if !shared.closed.swap(true, Ordering::AcqRel) {
            lock(&shared.error).get_or_insert_with(|| "no window appeared".into());
        }
        wake(WAKE_ERROR, 0, 0.0, 0);
        return;
    };
    let gpu = match Gpu::new(window.clone()) {
        Ok(gpu) => gpu,
        Err(error) => {
            *lock(&shared.error) = Some(error);
            shared.closed.store(true, Ordering::Release);
            wake(WAKE_ERROR, 0, 0.0, 0);
            return;
        }
    };
    *lock(&shared.info) = format!("{{\"adapter\":{:?},\"backend\":{:?},\"presentMode\":\"Fifo\",\"desiredMaximumFrameLatency\":1}}", gpu.adapter, gpu.backend);
    let surface = WindowSurface { gpu, window, shared: shared.clone() };
    let mut frames = FrameLoop::new(surface, LibraryClock, shared.mailbox.clone(), shared.metrics.clone());
    let seam = WakeSeam { shared: shared.clone(), pads: Mutex::new(Pads::open()), wake };
    while !shared.mailbox.is_stopping() {
        if shared.closed.load(Ordering::Acquire) {
            wake(WAKE_CLOSED, 0, 0.0, 0);
            wait_for_stop(&shared);
            return;
        }
        frames.frame(mode_of(&shared), &seam);
        if let Some(problem) = frames.problem.take() {
            *lock(&shared.error) = Some(problem);
        }
    }
}

fn wait_for_stop(shared: &Arc<Shared>) {
    while !shared.mailbox.is_stopping() {
        thread::sleep(Duration::from_millis(5));
    }
}
