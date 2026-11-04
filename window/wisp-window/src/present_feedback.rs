//! The display's report of each present, read beside the swapchain: on X11 (Xwayland included) the Present extension's CompleteNotify for the window, which carries the frame counter and the time the image reached the screen.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use winit::raw_window_handle::{HasWindowHandle, RawWindowHandle};
use winit::window::Window;

use crate::display_lock::Shown;

const POLL: Duration = Duration::from_millis(1);
const QUEUE_LIMIT: usize = 32;

/// Reports read on a thread of their own until dropped.
pub struct PresentFeedback {
    shown: Receiver<Shown>,
    stopping: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl PresentFeedback {
    /// Starts reading the reports of `window`'s presents when `WISP_WINDOW_PACING=display` asks the window to pace from them rather than from the phase of its first frame; none otherwise, or where the window is not an X11 one or the server lacks the Present extension.
    pub fn requested(window: &Window) -> Option<Self> {
        if !std::env::var("WISP_WINDOW_PACING").is_ok_and(|value| value == "display") {
            return None;
        }
        let id = match window.window_handle().ok()?.as_raw() {
            RawWindowHandle::Xlib(handle) => u32::try_from(handle.window).ok()?,
            RawWindowHandle::Xcb(handle) => handle.window.get(),
            _ => return None,
        };
        let source = x11::Source::open(id).map_err(|problem| eprintln!("wisp-window: no present feedback, {problem}")).ok()?;
        let (sender, shown) = mpsc::sync_channel(QUEUE_LIMIT);
        let stopping = Arc::new(AtomicBool::new(false));
        let thread = {
            let stopping = stopping.clone();
            thread::Builder::new().name("wisp-present-feedback".into()).spawn(move || source.run(&sender, &stopping)).ok()?
        };
        eprintln!("wisp-window: pacing from the display's reports of its presents (X Present on window {id:#x})");
        Some(Self { shown, stopping, thread: Some(thread) })
    }

    /// The reports that came since the last call, oldest first.
    pub fn take(&self) -> Vec<Shown> {
        self.shown.try_iter().collect()
    }
}

impl Drop for PresentFeedback {
    fn drop(&mut self) {
        self.stopping.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

mod x11 {
    use super::*;
    use x11rb::connection::{Connection, RequestConnection};
    use x11rb::protocol::present::{self, CompleteKind, CompleteMode, ConnectionExt as _, EventMask};
    use x11rb::protocol::Event;
    use x11rb::rust_connection::RustConnection;

    pub struct Source {
        connection: RustConnection,
        offset_ns: i128,
    }

    impl Source {
        pub fn open(window: u32) -> Result<Self, String> {
            let (connection, _) = x11rb::connect(None).map_err(|error| format!("the X display did not open: {error}"))?;
            if connection.extension_information(present::X11_EXTENSION_NAME).ok().flatten().is_none() {
                return Err("the X server has no Present extension".into());
            }
            connection.present_query_version(1, 2).map_err(|error| error.to_string())?.reply().map_err(|error| error.to_string())?;
            let event = connection.generate_id().map_err(|error| error.to_string())?;
            connection.present_select_input(event, window, EventMask::COMPLETE_NOTIFY).map_err(|error| error.to_string())?;
            connection.flush().map_err(|error| error.to_string())?;
            Ok(Self { connection, offset_ns: monotonic_ns() as i128 - crate::clock::now_ns() as i128 })
        }

        pub fn run(self, shown: &SyncSender<Shown>, stopping: &AtomicBool) {
            while !stopping.load(Ordering::Acquire) {
                match self.connection.poll_for_event() {
                    Ok(Some(Event::PresentCompleteNotify(event))) if event.kind == CompleteKind::PIXMAP => {
                        let shown_ns = (i128::from(event.ust) * 1000 - self.offset_ns).max(0) as u64;
                        if let Err(TrySendError::Disconnected(_)) = shown.try_send(Shown { shown_ns, msc: event.msc, skipped: event.mode == CompleteMode::SKIP }) {
                            return;
                        }
                    }
                    Ok(Some(_)) => {}
                    Ok(None) => thread::sleep(POLL),
                    Err(_) => return,
                }
            }
        }
    }

    // The Present extension stamps UST in microseconds on CLOCK_MONOTONIC.
    fn monotonic_ns() -> u64 {
        let mut now = libc::timespec { tv_sec: 0, tv_nsec: 0 };
        unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut now) };
        now.tv_sec as u64 * 1_000_000_000 + now.tv_nsec as u64
    }
}
