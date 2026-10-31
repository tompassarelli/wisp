//! The exports of the window-less renderer (wisp:docs/native-window-plan.md, W3); `lib.rs` holds the window's.

use std::ffi::{c_char, c_void};
use std::ptr;
use std::slice;

use crate::offscreen::Offscreen;
use crate::{copy_text, guard, text};

unsafe fn offscreen<'a>(handle: *mut c_void) -> Option<&'a mut Offscreen> {
    (handle as *mut Offscreen).as_mut()
}

static OFFSCREEN_ERROR: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());

fn offscreen_failed<T>(error: String, fallback: T) -> T {
    *OFFSCREEN_ERROR.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = error;
    fallback
}

/// Opens the renderer with no window, drawing `width` by `height` images. Returns a handle, or null with the reason readable through `wisp_offscreen_error`.
#[no_mangle]
pub extern "C" fn wisp_offscreen_open(width: u32, height: u32) -> *mut c_void {
    guard(ptr::null_mut(), || match Offscreen::new(width, height) {
        Ok(offscreen) => Box::into_raw(Box::new(offscreen)) as *mut c_void,
        Err(error) => offscreen_failed(error, ptr::null_mut()),
    })
}

/// Copies up to `capacity` bytes of the last offscreen failure; returns its full length.
///
/// # Safety
/// `out` must point to `capacity` writable bytes.
#[no_mangle]
pub unsafe extern "C" fn wisp_offscreen_error(out: *mut u8, capacity: usize) -> usize {
    guard(0, || copy_text(&OFFSCREEN_ERROR.lock().unwrap_or_else(|poisoned| poisoned.into_inner()), out, capacity))
}

/// Hands the renderer a model or texture file, named by its Warcraft path.
///
/// # Safety
/// `handle` comes from `wisp_offscreen_open`; `path` and `bytes` point to `path_length` and `length` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn wisp_offscreen_asset(handle: *mut c_void, path: *const c_char, path_length: usize, bytes: *const u8, length: usize) {
    guard((), || {
        if let (Some(offscreen), false) = (offscreen(handle), bytes.is_null()) {
            offscreen.ingest(text(path, path_length), slice::from_raw_parts(bytes, length));
        }
    })
}

/// Uploads what finished decoding and returns how many pushed files the renderer has not finished with.
///
/// # Safety
/// `handle` comes from `wisp_offscreen_open`.
#[no_mangle]
pub unsafe extern "C" fn wisp_offscreen_pending(handle: *mut c_void) -> u64 {
    guard(u64::MAX, || offscreen(handle).map_or(u64::MAX, Offscreen::pending))
}

/// Draws the scene (the JSON `wisp_window_submit` takes) and keeps the image; returns 1, or 0 with the reason readable through `wisp_offscreen_error`.
///
/// # Safety
/// `handle` comes from `wisp_offscreen_open`; `scene` points to `length` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn wisp_offscreen_render(handle: *mut c_void, scene: *const u8, length: usize) -> u32 {
    guard(0, || {
        let (Some(offscreen), false) = (offscreen(handle), scene.is_null()) else { return 0 };
        match offscreen.render(slice::from_raw_parts(scene, length)) {
            Ok(()) => 1,
            Err(error) => offscreen_failed(error, 0),
        }
    })
}

/// Copies up to `capacity` bytes of the last image `wisp_offscreen_render` drew, as a PNG; returns its full length.
///
/// # Safety
/// `handle` comes from `wisp_offscreen_open`; `out` has room for `capacity` bytes.
#[no_mangle]
pub unsafe extern "C" fn wisp_offscreen_picture(handle: *mut c_void, out: *mut u8, capacity: usize) -> usize {
    guard(0, || offscreen(handle).map_or(0, |offscreen| {
        let picture = offscreen.picture();
        let length = picture.len().min(capacity);
        if !out.is_null() {
            ptr::copy_nonoverlapping(picture.as_ptr(), out, length);
        }
        picture.len()
    }))
}

/// The adapter, its backend and the problems found with the files given so far (drained) as JSON; returns the full length.
///
/// # Safety
/// `handle` comes from `wisp_offscreen_open`; `out` has room for `capacity` bytes.
#[no_mangle]
pub unsafe extern "C" fn wisp_offscreen_info(handle: *mut c_void, out: *mut u8, capacity: usize) -> usize {
    guard(0, || offscreen(handle).map_or(0, |offscreen| copy_text(&offscreen.info(), out, capacity)))
}

/// Frees the renderer.
///
/// # Safety
/// `handle` comes from `wisp_offscreen_open` and is passed here once.
#[no_mangle]
pub unsafe extern "C" fn wisp_offscreen_close(handle: *mut c_void) {
    guard((), || {
        if !handle.is_null() {
            drop(Box::from_raw(handle as *mut Offscreen));
        }
    })
}
