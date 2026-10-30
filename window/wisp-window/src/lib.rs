//! The native window Wisp's standalone play opens (wisp:docs/native-window-plan.md).
//!
//! Bun loads this library with `bun:ffi`. Every exported function is `catch_unwind`-guarded, because a Rust panic must not
//! unwind into Bun, and `wisp_window_close` joins both threads, so the wake callback is never called after it returns.

mod clock;
mod draw;
mod frame;
mod host;
mod input;
mod metrics;
mod pad;
#[cfg(target_os = "linux")]
mod pad_gilrs;
#[cfg(windows)]
mod pad_windows;
mod sync;

use std::ffi::{c_char, c_void};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::ptr;
use std::slice;
use std::time::Duration;

use host::{Host, Wake};

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

/// Nanoseconds on the library's monotonic clock, the clock every sample time is on.
#[no_mangle]
pub extern "C" fn wisp_window_now_ns() -> f64 {
    guard(0.0, || clock::now_ns() as f64)
}

/// Opens the window and its threads. `wake` is called from the render thread with (kind, frame, sampleNs, buttons).
/// Returns a handle, or null with the reason readable through `wisp_window_open_error`.
///
/// # Safety
/// `title` must point to `title_length` readable bytes; `wake` must stay callable until `wisp_window_close` returns.
#[no_mangle]
pub unsafe extern "C" fn wisp_window_open(title: *const c_char, title_length: usize, width: u32, height: u32, wake: *const c_void) -> *mut c_void {
    guard(ptr::null_mut(), || {
        let wake: Wake = std::mem::transmute(wake);
        match Host::open(text(title, title_length), width, height, wake) {
            Ok(host) => Box::into_raw(Box::new(host)) as *mut c_void,
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

/// Takes the oldest queued sample into `out` as (frame, sampleNs, buttons, axisX, axisY) and returns 1, or returns 0 when there is none within `timeout_ms`; a zero timeout never waits.
///
/// # Safety
/// `handle` is live and `out` has room for five f64s.
#[no_mangle]
pub unsafe extern "C" fn wisp_window_next_event(handle: *mut c_void, out: *mut f64, timeout_ms: u32) -> u32 {
    guard(0, || {
        let Some(sample) = host(handle).and_then(|host| host.next_sample(Duration::from_millis(timeout_ms as u64))) else { return 0 };
        if !out.is_null() {
            ptr::copy_nonoverlapping([sample.frame as f64, sample.sampled_ns as f64, sample.input.buttons as f64, sample.input.axis_x as f64, sample.input.axis_y as f64].as_ptr(), out, 5);
        }
        1
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

/// Stops the threads and frees the handle. Not to be called from inside `wake`.
///
/// # Safety
/// `handle` comes from `wisp_window_open` and is passed here once.
#[no_mangle]
pub unsafe extern "C" fn wisp_window_close(handle: *mut c_void) {
    guard((), || {
        if !handle.is_null() {
            Box::from_raw(handle as *mut Host).close();
        }
    })
}

/// The button names (by bit of the frame callback's mask) and metric names (by number) as JSON; returns its full length.
///
/// # Safety
/// `out` has room for `capacity` bytes.
#[no_mangle]
pub unsafe extern "C" fn wisp_window_vocabulary(out: *mut u8, capacity: usize) -> usize {
    guard(0, || copy_text(&format!("{{\"buttons\":{:?},\"metrics\":{:?}}}", input::BUTTONS, metrics::SERIES), out, capacity))
}
