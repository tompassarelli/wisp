use std::cell::{Cell, RefCell};
use std::collections::VecDeque;

use super::*;

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

