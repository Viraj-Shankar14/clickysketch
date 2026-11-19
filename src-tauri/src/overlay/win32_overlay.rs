//! Windows glue for the overlay windows.
//!
//! Spec 4.1 asks for `WS_EX_TOPMOST | WS_EX_LAYERED | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT`.
//! Tauri/tao already own two of those: `always_on_top` gives TOPMOST, and flipping click-through
//! with `set_ignore_cursor_events` adds/removes TRANSPARENT | LAYERED together (known-good with a
//! transparent WebView2). What tao does not give us is NOACTIVATE (clicking the HUD must never
//! steal focus from the app you are working in) and TOOLWINDOW (keep the overlay out of Alt+Tab).
//! tao rewrites the whole extended style every time it flips click-through, so those two bits are
//! re-asserted right behind each flip, on the UI thread, and again by the 500 ms housekeeping pass.
//!
//! The handful of Win32 calls are declared by hand rather than pulled in from a bindings crate:
//! it keeps this milestone free of `windows-rs` version coupling, and every unsafe block is tiny.

use std::ffi::c_void;
use tauri::{AppHandle, WebviewWindow};

type Hwnd = *mut c_void;

#[repr(C)]
struct Point {
    x: i32,
    y: i32,
}

const GWL_EXSTYLE: i32 = -20;
const WS_EX_TOPMOST: isize = 0x0000_0008;
const WS_EX_TOOLWINDOW: isize = 0x0000_0080;
const WS_EX_NOACTIVATE: isize = 0x0800_0000;
const SWP_NOSIZE: u32 = 0x0001;
const SWP_NOMOVE: u32 = 0x0002;
const SWP_NOACTIVATE: u32 = 0x0010;
const SWP_FRAMECHANGED: u32 = 0x0020;
const HWND_TOPMOST: isize = -1;
const WDA_NONE: u32 = 0x0000_0000;
const WDA_EXCLUDEFROMCAPTURE: u32 = 0x0000_0011;
const VK_LBUTTON: i32 = 0x01;
const VK_RBUTTON: i32 = 0x02;
const VK_MBUTTON: i32 = 0x04;

#[link(name = "user32")]
extern "system" {
    fn GetCursorPos(point: *mut Point) -> i32;
    fn GetAsyncKeyState(virtual_key: i32) -> i16;
    fn SetWindowPos(hwnd: Hwnd, insert_after: Hwnd, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
    fn SetWindowDisplayAffinity(hwnd: Hwnd, affinity: u32) -> i32;
    #[cfg(target_pointer_width = "64")]
    fn GetWindowLongPtrW(hwnd: Hwnd, index: i32) -> isize;
    #[cfg(target_pointer_width = "64")]
    fn SetWindowLongPtrW(hwnd: Hwnd, index: i32, value: isize) -> isize;
    #[cfg(target_pointer_width = "32")]
    fn GetWindowLongW(hwnd: Hwnd, index: i32) -> i32;
    #[cfg(target_pointer_width = "32")]
    fn SetWindowLongW(hwnd: Hwnd, index: i32, value: i32) -> i32;
}

#[cfg(target_pointer_width = "64")]
unsafe fn ex_style(hwnd: Hwnd) -> isize {
    GetWindowLongPtrW(hwnd, GWL_EXSTYLE)
}
#[cfg(target_pointer_width = "64")]
unsafe fn set_ex_style(hwnd: Hwnd, value: isize) {
    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, value);
}
#[cfg(target_pointer_width = "32")]
unsafe fn ex_style(hwnd: Hwnd) -> isize {
    GetWindowLongW(hwnd, GWL_EXSTYLE) as isize
}
#[cfg(target_pointer_width = "32")]
unsafe fn set_ex_style(hwnd: Hwnd, value: isize) {
    SetWindowLongW(hwnd, GWL_EXSTYLE, value as i32);
}

fn hwnd_of(window: &WebviewWindow) -> Result<Hwnd, String> {
    window.hwnd().map(|handle| handle.0 as Hwnd).map_err(|error| error.to_string())
}

/// Adds TOPMOST | TOOLWINDOW | NOACTIVATE if any of them is missing. Idempotent and cheap.
fn ensure_style(hwnd: Hwnd) {
    // SAFETY: `hwnd` is a window owned by this process; these calls only read and set its styles.
    unsafe {
        let current = ex_style(hwnd);
        let wanted = current | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
        if wanted != current {
            set_ex_style(hwnd, wanted);
            SetWindowPos(
                hwnd,
                HWND_TOPMOST as Hwnd,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
    }
}

/// Applies the native overlay flags to a freshly created or re-laid-out window.
pub fn prepare_window(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let raw = hwnd_of(window)? as isize;
    app.run_on_main_thread(move || ensure_style(raw as Hwnd))
        .map_err(|error| error.to_string())
}

/// Switches a window between "ignore the mouse" and "receive the mouse".
pub fn set_click_through(app: &AppHandle, window: &WebviewWindow, ignore: bool) -> Result<(), String> {
    window.set_ignore_cursor_events(ignore).map_err(|error| error.to_string())?;
    // tao just rewrote the extended style; restore NOACTIVATE/TOOLWINDOW right behind it.
    prepare_window(app, window)
}

/// Periodic upkeep: restore stripped styles and keep the overlay above other topmost windows
/// (clicking the taskbar, for instance, raises it over us).
pub fn maintain(app: &AppHandle, window: &WebviewWindow) {
    let Ok(hwnd) = hwnd_of(window) else { return };
    let raw = hwnd as isize;
    let _ = app.run_on_main_thread(move || {
        let hwnd = raw as Hwnd;
        ensure_style(hwnd);
        // SAFETY: plain Win32 call on a window owned by this process; no activation, move or resize.
        unsafe {
            SetWindowPos(hwnd, HWND_TOPMOST as Hwnd, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
    });
}

/// Hides (or re-shows) the overlay in screenshots and screen shares.
pub fn set_capture_exclusion(_app: &AppHandle, window: &WebviewWindow, excluded: bool) -> Result<(), String> {
    let hwnd = hwnd_of(window)?;
    let affinity = if excluded { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE };
    // SAFETY: `hwnd` belongs to this process, which is the only requirement of the API.
    let ok = unsafe { SetWindowDisplayAffinity(hwnd, affinity) };
    if ok == 0 {
        Err("SetWindowDisplayAffinity failed (excluding a window from capture needs Windows 10 version 2004 or newer)".to_string())
    } else {
        Ok(())
    }
}

/// Global cursor position in physical pixels (the process is per-monitor DPI aware).
pub fn cursor_position() -> Option<(f64, f64)> {
    let mut point = Point { x: 0, y: 0 };
    // SAFETY: `point` is a valid, writable POINT for the duration of the call.
    let ok = unsafe { GetCursorPos(&mut point) };
    if ok != 0 {
        Some((f64::from(point.x), f64::from(point.y)))
    } else {
        None
    }
}

/// True while any mouse button is physically held.
pub fn mouse_button_down() -> bool {
    [VK_LBUTTON, VK_RBUTTON, VK_MBUTTON].iter().any(|&key| {
        // SAFETY: GetAsyncKeyState has no preconditions.
        let state = unsafe { GetAsyncKeyState(key) };
        (state as u16 & 0x8000) != 0
    })
}
