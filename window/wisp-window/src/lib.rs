//! The native window Wisp's standalone play opens (wisp:docs/native-window-plan.md).
//!
//! Bun loads this library with `bun:ffi`. Every exported function is `catch_unwind`-guarded, because a Rust panic must not
//! unwind into Bun. A window handle is a counted reference to the host: `wisp_window_attach` gives another thread its own, and
//! `wisp_window_stop` joins both library threads, so a thread that outlives the stop reaches a stopped host, never freed memory.

mod capture;
mod clock;
pub mod decode_pool;
mod draw;
mod frame;
mod host;
mod input;
mod metrics;
pub mod model;
pub mod render;
mod mailbox;
mod pacing;
mod present;
mod pad;
mod pad_sdl;
mod surface_target;
mod sync;
mod timer;
pub mod remaster;
pub mod texture;
pub mod ui;

use std::ffi::{c_char, c_void};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::ptr;
use std::slice;
use std::sync::Arc;
use std::time::Duration;

use frame::{End, Event};
use host::Host;

fn guard<T>(fallback: T, body: impl FnOnce() -> T) -> T {
    catch_unwind(AssertUnwindSafe(body)).unwrap_or(fallback)
}

unsafe fn text<'a>(pointer: *const c_char, length: usize) -> &'a str {
    if pointer.is_null() {
        return "";
    }
    std::str::from_utf8(slice::from_raw_parts(pointer as *const u8, length)).unwrap_or("")
}

unsafe fn host<'a>(handle: *mut c_void) -> Option<&'a Host> {
    (handle as *const Host).as_ref()
}

const EVENT_TIMEOUT: u32 = 0;
const EVENT_FRAME: u32 = 1;
const EVENT_CLOSED: u32 = 2;
const EVENT_FAILED: u32 = 3;
const EVENT_STOPPED: u32 = 4;

/// Nanoseconds on the library's monotonic clock, the clock every sample time is on.
#[no_mangle]
pub extern "C" fn wisp_window_now_ns() -> f64 {
    guard(0.0, || clock::now_ns() as f64)
}

/// Opens the window and its threads. Returns a handle, or null with the reason readable through `wisp_window_open_error`.
///
/// # Safety
/// `title` must point to `title_length` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn wisp_window_open(title: *const c_char, title_length: usize, width: u32, height: u32) -> *mut c_void {
    guard(ptr::null_mut(), || {
        match Host::open(text(title, title_length), width, height) {
            Ok(host) => Arc::into_raw(Arc::new(host)) as *mut c_void,
            Err(error) => {
                *OPEN_ERROR.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = error;
                ptr::null_mut()
            }
        }
    })
}

static OPEN_ERROR: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());

/// Copies up to `capacity` bytes of the last `wisp_window_open` failure; returns its full length.
///
/// # Safety
/// `out` must point to `capacity` writable bytes.
#[no_mangle]
pub unsafe extern "C" fn wisp_window_open_error(out: *mut u8, capacity: usize) -> usize {
    guard(0, || copy_text(&OPEN_ERROR.lock().unwrap_or_else(|poisoned| poisoned.into_inner()), out, capacity))
}

unsafe fn copy_text(value: &str, out: *mut u8, capacity: usize) -> usize {
    let length = value.len().min(capacity);
    if !out.is_null() {
        ptr::copy_nonoverlapping(value.as_ptr(), out, length);
    }
    value.len()
}

/// Starts the frame wakes; until then the window shows its loading state and Bun is never woken.
///
/// # Safety
/// `handle` comes from `wisp_window_open` and is not yet closed.
#[no_mangle]
pub unsafe extern "C" fn wisp_window_start(handle: *mut c_void) {
    guard((), || {
        if let Some(host) = host(handle) {
            host.start();
        }
    })
}

/// Starts the frames with no game: the render thread submits a canned scene at each sample point, which measures the display path alone.
///
/// # Safety
/// `handle` comes from `wisp_window_open` and is not yet closed.
#[no_mangle]
pub unsafe extern "C" fn wisp_window_start_baseline(handle: *mut c_void) {
    guard((), || {
        if let Some(host) = host(handle) {
            host.start_baseline();
        }
    })
}

/// Shows `text` as the window's status line (its title for now).
///
/// # Safety
/// `handle` is live and `text` points to `length` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn wisp_window_status(handle: *mut c_void, status: *const c_char, length: usize) {
    guard((), || {
        if let Some(host) = host(handle) {
            host.set_status(text(status, length));
        }
    })
}

/// Queues a model or texture file, named by its Warcraft path, for the render thread to upload before it draws its next scene.
///
/// # Safety
/// `handle` is live; `path` and `bytes` point to `path_length` and `length` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn wisp_window_asset(handle: *mut c_void, path: *const c_char, path_length: usize, bytes: *const u8, length: usize) {
    guard((), || {
        if let (Some(host), false) = (host(handle), bytes.is_null()) {
            host.asset(text(path, path_length), slice::from_raw_parts(bytes, length));
        }
    })
}

/// How many files pushed with `wisp_window_asset` the render thread has not finished with; the game steps only once it is zero for the first scene.
///
/// # Safety
/// `handle` is live.
#[no_mangle]
pub unsafe extern "C" fn wisp_window_assets_pending(handle: *mut c_void) -> u64 {
    guard(0, || host(handle).map_or(0, |host| host.assets_pending()))
}

/// Hands the render thread the scene for the sample with frame number `frame`.
///
/// # Safety
/// `handle` is live and `scene` points to `length` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn wisp_window_submit(handle: *mut c_void, scene: *const u8, length: usize, step: f64, frame: u32) {
    guard((), || {
        if let (Some(host), false) = (host(handle), scene.is_null()) {
            host.submit(slice::from_raw_parts(scene, length), step as u64, frame);
        }
    })
}

/// Waits up to `timeout_ms` (zero never waits) for the next event and returns its kind: `EVENT_TIMEOUT`, `EVENT_FRAME` with the oldest
/// queued sample in `out` as (frame, sampleNs, buttons, axisX, axisY), or `EVENT_CLOSED`, `EVENT_FAILED` or `EVENT_STOPPED` when the stream has ended.
/// The calling thread runs no JavaScript while it waits; `wisp_window_stop` wakes it.
///
/// # Safety
/// `handle` is live and `out` has room for five f64s.
#[no_mangle]
pub unsafe extern "C" fn wisp_window_next_event(handle: *mut c_void, out: *mut f64, timeout_ms: u32) -> u32 {
    guard(EVENT_FAILED, || match host(handle).map(|host| host.next_event(Duration::from_millis(timeout_ms as u64))) {
        None => EVENT_STOPPED,
        Some(Event::Timeout) => EVENT_TIMEOUT,
        Some(Event::Ended(End::Closed)) => EVENT_CLOSED,
        Some(Event::Ended(End::Failed)) => EVENT_FAILED,
        Some(Event::Ended(End::Stopped)) => EVENT_STOPPED,
        Some(Event::Frame(sample)) => {
            if !out.is_null() {
                ptr::copy_nonoverlapping([sample.frame as f64, sample.sampled_ns as f64, sample.input.buttons as f64, sample.input.axis_x as f64, sample.input.axis_y as f64].as_ptr(), out, 5);
            }
            EVENT_FRAME
        }
    })
}

/// Asks for a present mode (0 Fifo, 1 Mailbox, 2 Immediate); a mode the surface does not offer leaves `Fifo`, which `wisp_window_info` reports.
///
/// # Safety
/// `handle` is live.
#[no_mangle]
pub unsafe extern "C" fn wisp_window_set_present(handle: *mut c_void, mode: u32) {
    guard((), || {
        if let Some(host) = host(handle) {
            host.set_present(mode as u8);
        }
    })
}

/// Turns borderless fullscreen on or off.
///
/// # Safety
/// `handle` is live.
#[no_mangle]
pub unsafe extern "C" fn wisp_window_set_fullscreen(handle: *mut c_void, on: u32) {
    guard((), || {
        if let Some(host) = host(handle) {
            host.set_fullscreen(on != 0);
        }
    })
}

/// Selects the pad at slot `slot` (the browser's `gamepadIndex`); a negative slot takes the first connected pad.
///
/// # Safety
/// `handle` is live.
#[no_mangle]
pub unsafe extern "C" fn wisp_window_select_pad(handle: *mut c_void, slot: i32) {
    guard((), || {
        if let Some(host) = host(handle) {
            host.select_pad(slot);
        }
    })
}

/// Copies a metric series (see `metrics::SERIES`) as f64s into `out`; returns how many there are in all.
///
/// # Safety
/// `handle` is live and `out` has room for `capacity` f64s.
#[no_mangle]
pub unsafe extern "C" fn wisp_window_metric(handle: *mut c_void, which: u32, out: *mut f64, capacity: usize) -> usize {
    guard(0, || {
        let Some(host) = host(handle) else { return 0 };
        let series = host.metric(which);
        if !out.is_null() {
            ptr::copy_nonoverlapping(series.as_ptr(), out, series.len().min(capacity));
        }
        series.len()
    })
}

/// The adapter, backend and present mode as JSON; returns its full length.
///
/// # Safety
/// `handle` is live and `out` has room for `capacity` bytes.
#[no_mangle]
pub unsafe extern "C" fn wisp_window_info(handle: *mut c_void, out: *mut u8, capacity: usize) -> usize {
    guard(0, || host(handle).map_or(0, |host| copy_text(&host.info(), out, capacity)))
}

/// The error that closed the window, if any; returns its full length.
///
/// # Safety
/// `handle` is live and `out` has room for `capacity` bytes.
#[no_mangle]
pub unsafe extern "C" fn wisp_window_error(handle: *mut c_void, out: *mut u8, capacity: usize) -> usize {
    guard(0, || host(handle).and_then(|host| host.error()).map_or(0, |error| copy_text(&error, out, capacity)))
}

/// Stops both library threads and waits for them, and wakes a thread blocked in `wisp_window_next_event` with a stop. Safe to call again, from any thread holding a reference, and on a window that has already closed; a `wisp_window_submit` after it is ignored.
///
/// # Safety
/// `handle` is live.
#[no_mangle]
pub unsafe extern "C" fn wisp_window_stop(handle: *mut c_void) {
    guard((), || {
        if let Some(host) = host(handle) {
            host.stop();
        }
    })
}

/// Takes another reference to the window for a thread that makes its own calls; the thread gives it back with `wisp_window_release`. Returns the handle to use.
///
/// # Safety
/// `handle` is live.
#[no_mangle]
pub unsafe extern "C" fn wisp_window_attach(handle: *mut c_void) -> *mut c_void {
    guard(ptr::null_mut(), || {
        if !handle.is_null() {
            Arc::increment_strong_count(handle as *const Host);
        }
        handle
    })
}

/// Gives back one reference from `wisp_window_open` or `wisp_window_attach`; the last one frees the host, stopping it first if nobody has. The handle is not used again.
///
/// # Safety
/// `handle` holds a reference that is released once.
#[no_mangle]
pub unsafe extern "C" fn wisp_window_release(handle: *mut c_void) {
    guard((), || {
        if !handle.is_null() {
            Arc::decrement_strong_count(handle as *const Host);
        }
    })
}

/// The button names (by bit of the next_event mask) and metric names (by number) as JSON; returns its full length.
///
/// # Safety
/// `out` has room for `capacity` bytes.
#[no_mangle]
pub unsafe extern "C" fn wisp_window_vocabulary(out: *mut u8, capacity: usize) -> usize {
    guard(0, || copy_text(&format!("{{\"buttons\":{:?},\"metrics\":{:?}}}", input::BUTTONS, metrics::SERIES), out, capacity))
}
