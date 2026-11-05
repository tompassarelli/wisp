use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use super::*;
use crate::clock::LibraryClock;
use crate::frame::{FrameLoop, Mailbox, Surface};
use crate::metrics::Metrics;
use crate::stepper::{Mode, Stepper};

const IDLE: &str = "Validation Error: In Surface::configure: Failed to wait for GPU to come idle before reconfiguring the Surface";

/// A surface that answers each configure and acquire from a script, repeating the script's last answer once the rest are used.
struct Scripted {
    configures: RefCell<VecDeque<Result<(), String>>>,
    acquires: RefCell<VecDeque<Acquired<u32>>>,
    configured: Cell<u32>,
    acquired: Cell<u32>,
}

fn next<T: Clone>(script: &RefCell<VecDeque<T>>) -> T {
    let mut script = script.borrow_mut();
    if script.len() > 1 { script.pop_front() } else { script.front().cloned() }.expect("a scripted answer")
}

impl Presentable for Scripted {
    type Image = u32;

    fn configure(&self, _: &wgpu::SurfaceConfiguration) -> Result<(), String> {
        self.configured.set(self.configured.get() + 1);
        next(&self.configures)
    }

    fn acquire(&self) -> Acquired<u32> {
        self.acquired.set(self.acquired.get() + 1);
        next(&self.acquires)
    }
}

impl<T: Clone> Clone for Acquired<T> {
    fn clone(&self) -> Self {
        match self {
            Self::Image(image) => Self::Image(image.clone()),
            Self::Suboptimal(image) => Self::Suboptimal(image.clone()),
            Self::Skipped => Self::Skipped,
            Self::Outdated => Self::Outdated,
            Self::Lost => Self::Lost,
            Self::Failed(error) => Self::Failed(error.clone()),
        }
    }
}

fn swapchain(configures: Vec<Result<(), String>>, acquires: Vec<Acquired<u32>>) -> Swapchain<Scripted> {
    let config = wgpu::SurfaceConfiguration {
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        format: wgpu::TextureFormat::Bgra8Unorm,
        width: 320,
        height: 200,
        present_mode: wgpu::PresentMode::Mailbox,
        desired_maximum_frame_latency: 1,
        alpha_mode: wgpu::CompositeAlphaMode::Auto,
        color_space: wgpu::SurfaceColorSpace::Auto,
        view_formats: Vec::new(),
    };
    let surface = Scripted { configures: RefCell::new(configures.into()), acquires: RefCell::new(acquires.into()), configured: Cell::new(0), acquired: Cell::new(0) };
    Swapchain::new(surface, config)
}

/// Acquires at each retry time until an image comes or the swapchain gives up, returning the tries' times from the first and the outcome.
fn until_settled(chain: &mut Swapchain<Scripted>) -> (Vec<u64>, Result<u32, SurfaceError>) {
    let mut tries = Vec::new();
    let mut now = 0;
    loop {
        tries.push(now);
        match chain.acquire(now) {
            Ok(Some(image)) => return (tries, Ok(image)),
            Err(error) => return (tries, Err(error)),
            Ok(None) => {
                assert_eq!(chain.acquire(chain.retry_at_ns.saturating_sub(1).max(now)), Ok(None), "nothing is tried before the backoff ends");
                now = chain.retry_at_ns.max(now + 1);
            }
        }
    }
}

#[test]
fn a_failed_first_configure_is_retried_after_a_backoff_and_the_next_image_comes() {
    let mut chain = swapchain(vec![Err(IDLE.into()), Ok(())], vec![Acquired::Image(7)]);
    let (tries, image) = until_settled(&mut chain);
    assert_eq!(image, Ok(7));
    assert_eq!(tries, vec![0, FIRST_BACKOFF_NS]);
    assert_eq!((chain.surface().configured.get(), chain.surface().acquired.get()), (2, 1), "no acquire on an unconfigured surface");
}

#[test]
fn a_configure_that_keeps_failing_is_reported_by_name_after_the_bounded_backoff() {
    let mut chain = swapchain(vec![Err(IDLE.into())], vec![Acquired::Image(7)]);
    let (tries, outcome) = until_settled(&mut chain);
    let error = outcome.expect_err("the swapchain gives up");
    assert_eq!(error, SurfaceError { tries: RETRIES + 1, last: format!("configure: {IDLE}") });
    assert!(error.to_string().starts_with("surface error: 9 tries in a row failed, the last at configure: Validation Error"), "{error}");
    let waits: Vec<u64> = tries.windows(2).map(|pair| (pair[1] - pair[0]) / 1_000_000).collect();
    assert_eq!(waits, vec![16, 32, 64, 128, 256, 512, 1000, 1000]);
    assert_eq!(chain.surface().acquired.get(), 0);
}

#[test]
fn a_timeout_or_hidden_window_skips_the_frame_and_the_next_acquire_tries_again_without_configuring() {
    let mut chain = swapchain(vec![Ok(())], vec![Acquired::Skipped, Acquired::Image(3)]);
    assert_eq!(chain.acquire(0), Ok(None));
    assert_eq!(chain.acquire(1), Ok(Some(3)));
    assert_eq!(chain.surface().configured.get(), 1);
}

#[test]
fn an_outdated_or_suboptimal_surface_is_configured_again_at_the_next_acquire_with_no_backoff() {
    for stale in [Acquired::Outdated, Acquired::Suboptimal(1)] {
        let mut chain = swapchain(vec![Ok(())], vec![stale, Acquired::Image(2)]);
        assert_eq!(chain.acquire(0), Ok(None));
        assert_eq!(chain.acquire(1), Ok(Some(2)));
        assert_eq!(chain.surface().configured.get(), 2);
    }
}

#[test]
fn a_lost_surface_or_a_device_error_at_acquire_is_reconfigured_after_a_backoff_and_reported_when_it_persists() {
    let out_of_memory = "Out of Memory".to_string();
    for (failure, last) in [(Acquired::Lost, "acquire: the surface was lost".to_string()), (Acquired::Failed(out_of_memory.clone()), format!("acquire: {out_of_memory}"))] {
        let mut chain = swapchain(vec![Ok(())], vec![failure.clone(), Acquired::Image(4)]);
        let (tries, image) = until_settled(&mut chain);
        assert_eq!((tries, image), (vec![0, FIRST_BACKOFF_NS], Ok(4)));
        assert_eq!(chain.surface().configured.get(), 2, "the surface is configured again before the retry");

        let mut chain = swapchain(vec![Ok(())], vec![failure]);
        assert_eq!(until_settled(&mut chain).1, Err(SurfaceError { tries: RETRIES + 1, last }));
    }
}

#[test]
fn an_image_resets_the_count_of_failed_tries() {
    let mut script: Vec<Acquired<u32>> = std::iter::repeat_with(|| Acquired::Lost).take(RETRIES as usize).collect();
    script.push(Acquired::Image(5));
    script.extend(std::iter::repeat_with(|| Acquired::Lost).take(RETRIES as usize));
    script.push(Acquired::Image(6));
    let mut chain = swapchain(vec![Ok(())], script);
    assert_eq!(until_settled(&mut chain).1, Ok(5));
    chain.retry_at_ns = 0;
    assert_eq!(until_settled(&mut chain).1, Ok(6));
}

/// The window's surface in the render thread, over a scripted swapchain.
struct Window {
    swapchain: Swapchain<Scripted>,
    drawn: u32,
}

impl Surface for Window {
    type Image = u32;

    fn acquire(&mut self) -> Option<u32> {
        let image = self.swapchain.acquire(crate::clock::now_ns()).expect("the swapchain retries within its bound");
        if image.is_none() {
            thread::sleep(Duration::from_millis(4));
        }
        image
    }

    fn draw(&mut self, _: &u32, _: u64) {
        self.drawn += 1;
    }

    fn present(&self, _: u32) {}
}

#[test]
fn the_render_thread_outlives_a_failed_first_configure_and_draws_its_first_frame() {
    let began = Instant::now();
    let render = thread::spawn(|| {
        let window = Window { swapchain: swapchain(vec![Err(IDLE.into()), Ok(())], vec![Acquired::Image(1)]), drawn: 0 };
        let mut frames = FrameLoop::new(window, LibraryClock, Arc::new(Mailbox::default()), Arc::new(Mutex::new(Metrics::default())), Arc::new(Stepper::default()));
        let mut shown = 0;
        while !frames.frame(Mode::Loading) {
            shown += 1;
        }
        shown
    });
    let unshown = render.join().expect("the render thread did not panic");
    assert!(unshown >= 1, "the first frame had no image while the configure waited out its backoff");
    assert!(began.elapsed() < Duration::from_secs(1), "the first frame drew {:?} after the failed configure", began.elapsed());
}
