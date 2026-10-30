use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex};
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
use crate::input::Held;
use crate::metrics::{ms, Metrics};

/// Why Bun is being woken: a frame to step, the window going away, or the library failing.
pub const WAKE_FRAME: u32 = 0;
pub const WAKE_CLOSED: u32 = 1;
pub const WAKE_ERROR: u32 = 2;

pub type Wake = extern "C" fn(kind: u32, frame: u32, sample_ns: f64, buttons: u32);

const SCENE_WAIT: Duration = Duration::from_millis(100);
const WINDOW_WAIT: Duration = Duration::from_secs(10);

enum Command {
    Status(String),
    Exit,
}

struct Submission {
    bytes: Vec<u8>,
    step: u64,
}

struct Shared {
    held: Held,
    running: AtomicBool,
    closed: AtomicBool,
    stopping: AtomicBool,
    size: AtomicU64,
    scene: Mutex<Option<Submission>>,
    arrived: Condvar,
    metrics: Mutex<Metrics>,
    info: Mutex<String>,
    error: Mutex<Option<String>>,
}

fn pack(size: PhysicalSize<u32>) -> u64 {
    (size.width as u64) << 32 | size.height as u64
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
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
            WindowEvent::Focused(false) => self.shared.held.clear(),
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
            running: AtomicBool::new(false),
            closed: AtomicBool::new(false),
            stopping: AtomicBool::new(false),
            size: AtomicU64::new(0),
            scene: Mutex::new(None),
            arrived: Condvar::new(),
            metrics: Mutex::new(Metrics::default()),
            info: Mutex::new(String::new()),
            error: Mutex::new(None),
        });
        let mut builder = EventLoop::<Command>::with_user_event();
        any_thread(&mut builder);
        let (proxy_in, proxy_out) = mpsc::channel();
        let (handoff, windows) = mpsc::channel();
        let window_thread = {
            let app_shared = shared.clone();
            let title = title.to_string();
            guarded(&shared, wake, move || {
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
        self.shared.running.store(true, Ordering::Release);
    }

    pub fn set_status(&self, text: &str) {
        let _ = self.proxy.send_event(Command::Status(text.to_string()));
    }

    pub fn submit(&self, bytes: &[u8], step: u64) {
        *lock(&self.shared.scene) = Some(Submission { bytes: bytes.to_vec(), step });
        self.shared.arrived.notify_one();
    }

    pub fn metric(&self, which: u32) -> Vec<f64> {
        lock(&self.shared.metrics).series(which).to_vec()
    }

    pub fn missed_scenes(&self) -> u64 {
        lock(&self.shared.metrics).missed_scenes
    }

    pub fn info(&self) -> String {
        lock(&self.shared.info).clone()
    }

    pub fn error(&self) -> Option<String> {
        lock(&self.shared.error).clone()
    }

    /// Stops both threads and waits for them, so the wake callback is never called again once this returns.
    pub fn close(mut self) {
        self.shared.stopping.store(true, Ordering::Release);
        self.shared.arrived.notify_all();
        let _ = self.proxy.send_event(Command::Exit);
        if let Some(thread) = self.render_thread.take() {
            let _ = thread.join();
        }
        if let Some(thread) = self.window_thread.take() {
            let _ = thread.join();
        }
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
    let mut gpu = match Gpu::new(window.clone()) {
        Ok(gpu) => gpu,
        Err(error) => {
            *lock(&shared.error) = Some(error);
            shared.closed.store(true, Ordering::Release);
            wake(WAKE_ERROR, 0, 0.0, 0);
            return;
        }
    };
    *lock(&shared.info) = format!("{{\"adapter\":{:?},\"backend\":{:?},\"presentMode\":\"Fifo\",\"desiredMaximumFrameLatency\":1}}", gpu.adapter, gpu.backend);
    let (mut frame, mut step, mut previous_acquire) = (0u32, 0u64, None::<u64>);
    while !shared.stopping.load(Ordering::Acquire) {
        if shared.closed.load(Ordering::Acquire) {
            wake(WAKE_CLOSED, frame, 0.0, 0);
            wait_for_stop(&shared);
            return;
        }
        let size = shared.size.load(Ordering::Acquire);
        gpu.resize((size >> 32) as u32, size as u32);
        let asked = now_ns();
        let Some(texture) = gpu.acquire() else {
            thread::sleep(Duration::from_millis(4));
            continue;
        };
        let acquired = now_ns();
        let mut parse = None;
        let mut sampled = acquired;
        if shared.running.load(Ordering::Acquire) {
            sampled = now_ns();
            *lock(&shared.scene) = None;
            wake(WAKE_FRAME, frame, sampled as f64, shared.held.sample());
            frame += 1;
            match wait_for_scene(&shared) {
                Some(submission) => {
                    let began = now_ns();
                    let valid = serde_json::from_slice::<serde_json::Value>(&submission.bytes).is_ok();
                    parse = Some(ms(began, now_ns()));
                    if valid {
                        step = submission.step;
                    } else {
                        *lock(&shared.error) = Some("the scene was not JSON".into());
                    }
                }
                None => lock(&shared.metrics).missed_scenes += 1,
            }
        }
        let drawing = now_ns();
        gpu.draw(&texture, step);
        let drawn = now_ns();
        window.pre_present_notify();
        gpu.present(texture);
        let presented = now_ns();
        let mut metrics = lock(&shared.metrics);
        if let Some(before) = previous_acquire {
            metrics.presented_ms.push(ms(before, acquired));
        }
        metrics.acquire_ms.push(ms(asked, acquired));
        if let Some(parse) = parse {
            metrics.parse_ms.push(parse);
            metrics.sample_to_present_ms.push(ms(sampled, presented));
        }
        metrics.draw_ms.push(ms(drawing, drawn));
        previous_acquire = Some(acquired);
    }
}

fn wait_for_stop(shared: &Arc<Shared>) {
    while !shared.stopping.load(Ordering::Acquire) {
        thread::sleep(Duration::from_millis(5));
    }
}

fn wait_for_scene(shared: &Arc<Shared>) -> Option<Submission> {
    let guard = lock(&shared.scene);
    let (mut guard, _) = shared
        .arrived
        .wait_timeout_while(guard, SCENE_WAIT, |scene| scene.is_none() && !shared.stopping.load(Ordering::Acquire))
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    guard.take()
}
