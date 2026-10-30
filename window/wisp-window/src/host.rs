use std::cell::RefCell;
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
use winit::window::{Fullscreen, Window, WindowId};

use crate::clock::now_ns;
use crate::draw::Gpu;
use crate::frame::{Clock, End, Event, FrameLoop, Mailbox, Mode, Seam, Submission, Surface};
use crate::input::{Held, Input};
use crate::menu;
use crate::metrics::Metrics;
use crate::pad::Pads;
use crate::present::PresentSetting;
use crate::sync::lock;

const WINDOW_WAIT: Duration = Duration::from_secs(10);

enum Command {
    Status(String),
    Fullscreen(bool),
    Exit,
}

struct Shared {
    held: Held,
    focused: AtomicBool,
    pad_slot: AtomicI32,
    mode: AtomicU8,
    present: AtomicU8,
    menu: menu::Input,
    closed: AtomicBool,
    size: AtomicU64,
    mailbox: Arc<Mailbox>,
    metrics: Arc<Mutex<Metrics>>,
    info: Mutex<String>,
    error: Mutex<Option<String>>,
    assets: Mutex<Vec<(String, Vec<u8>)>>,
    assets_in: AtomicU64,
    assets_done: AtomicU64,
}

impl Shared {
    /// Marks the window as gone and tells the game's thread why through its next `next_event`.
    fn finish(&self, end: End) {
        self.closed.store(true, Ordering::Release);
        self.mailbox.end(end);
    }
}

fn pack(size: PhysicalSize<u32>) -> u64 {
    (size.width as u64) << 32 | size.height as u64
}

struct Threads {
    window: JoinHandle<()>,
    render: JoinHandle<()>,
}

/// The window's state, shared through `Arc` by every thread that holds the handle; the threads stop with `stop` and are joined once, whichever thread gets there first.
pub struct Host {
    shared: Arc<Shared>,
    proxy: Mutex<EventLoopProxy<Command>>,
    threads: Mutex<Option<Threads>>,
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
        let attributes = named_for_agent(attributes, agent_launched(&|key| std::env::var_os(key)));
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
                self.shared.finish(End::Failed);
                event_loop.exit();
            }
        }
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => {
                self.shared.finish(End::Closed);
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
                    self.shared.menu.key(&self.shared.held, code, event.state == ElementState::Pressed);
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
            Command::Fullscreen(on) => {
                if let Some(window) = &self.window {
                    window.set_fullscreen(on.then_some(Fullscreen::Borderless(None)));
                }
            }
            Command::Exit => event_loop.exit(),
        }
    }
}

const AGENT_APP_ID: &str = "wisp-agent";

fn agent_launched(var: &dyn Fn(&str) -> Option<std::ffi::OsString>) -> bool {
    var("AI_AGENT").is_some_and(|value| !value.is_empty())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn named_for_agent(attributes: winit::window::WindowAttributes, agent: bool) -> winit::window::WindowAttributes {
    use winit::platform::{wayland::WindowAttributesExtWayland, x11::WindowAttributesExtX11};
    if !agent {
        return attributes;
    }
    let attributes = WindowAttributesExtWayland::with_name(attributes, AGENT_APP_ID, AGENT_APP_ID);
    WindowAttributesExtX11::with_name(attributes, AGENT_APP_ID, AGENT_APP_ID)
}

#[cfg(not(all(unix, not(target_os = "macos"))))]
fn named_for_agent(attributes: winit::window::WindowAttributes, _: bool) -> winit::window::WindowAttributes {
    attributes
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
fn guarded(shared: &Arc<Shared>, body: impl FnOnce() + Send + 'static) -> JoinHandle<()> {
    let shared = shared.clone();
    thread::spawn(move || {
        if let Err(panic) = catch_unwind(AssertUnwindSafe(body)) {
            let text = panic.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| panic.downcast_ref::<String>().cloned()).unwrap_or_else(|| "panic".into());
            *lock(&shared.error) = Some(text);
            shared.finish(End::Failed);
        }
    })
}

impl Host {
    pub fn open(title: &str, width: u32, height: u32) -> Result<Self, String> {
        let shared = Arc::new(Shared {
            held: Held::default(),
            focused: AtomicBool::new(true),
            pad_slot: AtomicI32::new(-1),
            mode: AtomicU8::new(Mode::Loading as u8),
            present: AtomicU8::new(PresentSetting::Fifo as u8),
            closed: AtomicBool::new(false),
            size: AtomicU64::new(0),
            mailbox: Arc::new(Mailbox::default()),
            metrics: Arc::new(Mutex::new(Metrics::default())),
            info: Mutex::new(String::new()),
            error: Mutex::new(None),
            assets: Mutex::new(Vec::new()),
            assets_in: AtomicU64::new(0),
            assets_done: AtomicU64::new(0),
            menu: menu::Input::default(),
        });
        let (proxy_in, proxy_out) = mpsc::channel();
        let (handoff, windows) = mpsc::channel();
        let window_thread = {
            let app_shared = shared.clone();
            let title = title.to_string();
            guarded(&shared, move || {
                if std::env::var_os("WISP_WINDOW_FORCE_OPEN_FAILURE").is_some() {
                    panic!("forced open failure (WISP_WINDOW_FORCE_OPEN_FAILURE)");
                }
                let mut builder = EventLoop::<Command>::with_user_event();
                any_thread(&mut builder);
                let event_loop = match builder.build() {
                    Ok(event_loop) => event_loop,
                    Err(error) => {
                        *lock(&app_shared.error) = Some(format!("event loop: {error}"));
                        app_shared.finish(End::Failed);
                        let _ = proxy_in.send(None);
                        return;
                    }
                };
                let _ = proxy_in.send(Some(event_loop.create_proxy()));
                let mut app = App { shared: app_shared, title, size: (width, height), window: None, handoff };
                let _ = event_loop.run_app(&mut app);
            })
        };
        let Ok(Some(proxy)) = proxy_out.recv() else {
            let _ = window_thread.join();
            return Err(lock(&shared.error).clone().unwrap_or_else(|| "no event loop".into()));
        };
        let aspect = width as f32 / height.max(1) as f32;
        let render_thread = {
            let shared = shared.clone();
            guarded(&shared.clone(), move || render_loop(shared, windows, aspect))
        };
        Ok(Self { shared, proxy: Mutex::new(proxy), threads: Mutex::new(Some(Threads { window: window_thread, render: render_thread })) })
    }

    pub fn start(&self) {
        self.shared.mode.store(Mode::Game as u8, Ordering::Release);
    }

    pub fn start_baseline(&self) {
        self.shared.mode.store(Mode::Baseline as u8, Ordering::Release);
    }

    /// Asks for a present mode; the render thread applies it at its next frame, and the surface's offer decides whether it holds.
    pub fn set_present(&self, code: u8) {
        self.shared.present.store(code, Ordering::Release);
    }

    pub fn set_fullscreen(&self, on: bool) {
        let _ = lock(&self.proxy).send_event(Command::Fullscreen(on));
    }

    pub fn select_pad(&self, slot: i32) {
        self.shared.pad_slot.store(slot, Ordering::Release);
    }

    pub fn set_status(&self, text: &str) {
        let _ = lock(&self.proxy).send_event(Command::Status(text.to_string()));
    }

    /// Queues a model or texture file for the render thread to upload before its next scene.
    pub fn asset(&self, path: &str, bytes: &[u8]) {
        self.shared.assets_in.fetch_add(1, Ordering::AcqRel);
        lock(&self.shared.assets).push((path.to_string(), bytes.to_vec()));
    }

    /// How many pushed files the render thread has not yet finished with.
    pub fn assets_pending(&self) -> u64 {
        let done = self.shared.assets_done.load(Ordering::Acquire);
        self.shared.assets_in.load(Ordering::Acquire).saturating_sub(done)
    }

    pub fn submit(&self, bytes: &[u8], step: u64, frame: u32) {
        self.shared.mailbox.submit(Submission { bytes: bytes.to_vec(), step, frame });
    }

    pub fn next_event(&self, timeout: Duration) -> Event {
        self.shared.mailbox.next_event(timeout)
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

    /// Stops both threads and waits for them, and wakes a consumer blocked in `next_event` with a stop; safe to call again, and on a window that has already closed.
    pub fn stop(&self) {
        self.shared.mailbox.stop();
        let _ = lock(&self.proxy).send_event(Command::Exit);
        if let Some(threads) = lock(&self.threads).take() {
            let _ = threads.render.join();
            let _ = threads.window.join();
        }
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        self.stop();
    }
}

struct WindowSurface {
    gpu: Gpu,
    requested: PresentSetting,
    reported: (PresentSetting, usize),
    window: Arc<Window>,
    shared: Arc<Shared>,
}

impl WindowSurface {
    /// Takes the files Bun pushed, builds what is ready and counts what it finished with.
    fn absorb(&mut self) {
        let files = std::mem::take(&mut *lock(&self.shared.assets));
        let finished = self.gpu.absorb(files);
        self.shared.assets_done.fetch_add(finished, Ordering::AcqRel);
        while let Some(problem) = self.gpu.take_problem() {
            eprintln!("wisp-window: {problem}");
        }
    }
}

impl Surface for WindowSurface {
    type Image = wgpu::SurfaceTexture;

    fn acquire(&mut self) -> Option<Self::Image> {
        let size = self.shared.size.load(Ordering::Acquire);
        self.gpu.resize((size >> 32) as u32, size as u32);
        let wanted = PresentSetting::from_code(self.shared.present.load(Ordering::Acquire));
        if wanted != self.requested {
            self.requested = wanted;
            self.gpu.set_present(wanted);
        }
        let image = self.gpu.acquire();
        let shown = (self.gpu.setting(), self.gpu.image_count());
        if shown != self.reported {
            self.reported = shown;
            *lock(&self.shared.info) = info_json(&self.gpu);
        }
        if image.is_none() {
            thread::sleep(Duration::from_millis(4));
        }
        image
    }

    fn draw(&mut self, image: &Self::Image, step: u64) {
        self.gpu.menu_events(self.shared.menu.drain());
        self.gpu.draw(image, step);
    }

    fn load_scene(&mut self, bytes: &[u8]) -> Result<(), String> {
        self.absorb();
        self.gpu.load_scene(bytes)
    }

    fn idle(&mut self) {
        self.absorb();
    }

    fn present(&self, image: Self::Image) {
        self.window.pre_present_notify();
        self.gpu.present(image);
    }

    fn blocks_on_display(&self) -> bool {
        self.gpu.setting() == PresentSetting::Fifo
    }
}

struct LibraryClock;

impl Clock for LibraryClock {
    fn now_ns(&self) -> u64 {
        now_ns()
    }
}

struct InputSeam {
    shared: Arc<Shared>,
    pads: RefCell<Pads>,
}

impl Seam for InputSeam {
    fn input(&self) -> Input {
        let slot = usize::try_from(self.shared.pad_slot.load(Ordering::Acquire)).ok();
        self.pads.borrow_mut().sample(slot, self.shared.focused.load(Ordering::Acquire), self.shared.held.sample())
    }
}

fn info_json(gpu: &Gpu) -> String {
    format!("{{\"adapter\":{:?},\"backend\":{:?},\"presentMode\":{:?},\"desiredMaximumFrameLatency\":1,\"imageCount\":{}}}", gpu.adapter, gpu.backend, gpu.setting().name(), gpu.image_count())
}

fn mode_of(shared: &Shared) -> Mode {
    match shared.mode.load(Ordering::Acquire) {
        1 => Mode::Game,
        2 => Mode::Baseline,
        _ => Mode::Loading,
    }
}

fn render_loop(shared: Arc<Shared>, windows: mpsc::Receiver<Arc<Window>>, aspect: f32) {
    let Ok(window) = windows.recv_timeout(WINDOW_WAIT) else {
        lock(&shared.error).get_or_insert_with(|| "no window appeared".into());
        shared.finish(End::Failed);
        return;
    };
    let gpu = match Gpu::new(window.clone(), aspect) {
        Ok(gpu) => gpu,
        Err(error) => {
            *lock(&shared.error) = Some(error);
            shared.finish(End::Failed);
            return;
        }
    };
    *lock(&shared.info) = info_json(&gpu);
    let reported = (gpu.setting(), gpu.image_count());
    let surface = WindowSurface { gpu, requested: PresentSetting::Fifo, reported, window, shared: shared.clone() };
    let mut frames = FrameLoop::new(surface, LibraryClock, shared.mailbox.clone(), shared.metrics.clone());
    let seam = InputSeam { shared: shared.clone(), pads: RefCell::new(Pads::open()) };
    while !shared.mailbox.is_stopping() {
        if shared.closed.load(Ordering::Acquire) {
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

#[cfg(test)]
mod tests {
    use std::ffi::OsString;

    use super::agent_launched;

    fn env(value: Option<&'static str>) -> impl Fn(&str) -> Option<OsString> {
        move |key| if key == "AI_AGENT" { value.map(OsString::from) } else { None }
    }

    #[test]
    fn an_ai_agent_marker_selects_the_agent_app_id() {
        assert!(agent_launched(&env(Some("claude-code/2.1"))));
        assert!(!agent_launched(&env(Some(""))));
        assert!(!agent_launched(&env(None)));
    }
}
