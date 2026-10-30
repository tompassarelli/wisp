use std::sync::Arc;

use winit::raw_window_handle::{DisplayHandle, HandleError, HasDisplayHandle, HasWindowHandle, WindowHandle};
use winit::window::Window;

pub struct SurfaceTarget(Arc<Window>);

impl SurfaceTarget {
    pub fn new(window: Arc<Window>) -> Self {
        Self(window)
    }
}

impl HasDisplayHandle for SurfaceTarget {
    fn display_handle(&self) -> Result<DisplayHandle<'_>, HandleError> {
        self.0.display_handle()
    }
}

impl HasWindowHandle for SurfaceTarget {
    // winit on Windows refuses a window handle off the thread that made the window, and the render thread creates the swapchain, which DXGI allows from any thread
    fn window_handle(&self) -> Result<WindowHandle<'_>, HandleError> {
        #[cfg(windows)]
        {
            use winit::platform::windows::WindowExtWindows;
            unsafe { self.0.window_handle_any_thread() }
        }
        #[cfg(not(windows))]
        self.0.window_handle()
    }
}
