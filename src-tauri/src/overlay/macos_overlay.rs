//! macOS glue for the overlay windows.
//!
//! Spec 4.1: each overlay must be a non-activating `NSPanel` at `.screenSaver` level that joins
//! every Space and floats over full-screen apps. Tauri creates plain `NSWindow`s, so this module
//! does what the tauri-nspanel plugin does: re-class the window to an `NSPanel` subclass (the two
//! share the same instance layout), then set the panel flags. It talks to the Objective-C runtime
//! directly through a few hand-declared C functions, which keeps this milestone independent of
//! `objc2` version churn. Everything that touches AppKit runs on the main thread.

use std::ffi::{c_char, c_void, CStr};
use std::sync::OnceLock;
use tauri::{AppHandle, WebviewWindow};

type Id = *mut c_void;
type Sel = *const c_void;
type Class = *mut c_void;

#[repr(C)]
#[derive(Clone, Copy)]
struct CgPoint {
    x: f64,
    y: f64,
}

#[link(name = "objc")]
extern "C" {
    fn objc_getClass(name: *const c_char) -> Class;
    fn sel_registerName(name: *const c_char) -> Sel;
    fn objc_msgSend();
    fn object_setClass(object: Id, class: Class) -> Class;
    fn objc_allocateClassPair(superclass: Class, name: *const c_char, extra_bytes: usize) -> Class;
    fn objc_registerClassPair(class: Class);
    fn class_addMethod(class: Class, selector: Sel, implementation: *const c_void, types: *const c_char) -> u8;
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventCreate(source: *const c_void) -> *mut c_void;
    fn CGEventGetLocation(event: *mut c_void) -> CgPoint;
    fn CGEventSourceButtonState(state_id: i32, button: u32) -> bool;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(object: *const c_void);
}

/// `NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel`.
const STYLE_MASK_NONACTIVATING_PANEL: usize = 1 << 7;
/// `NSScreenSaverWindowLevel` (`.screenSaver`): above the menu bar, the Dock and full-screen apps.
const SCREEN_SAVER_LEVEL: isize = 1000;
/// canJoinAllSpaces | stationary | ignoresCycle | fullScreenAuxiliary.
const COLLECTION_BEHAVIOR: usize = (1 << 0) | (1 << 4) | (1 << 6) | (1 << 8);
/// `NSWindowAnimationBehaviorNone`.
const ANIMATION_NONE: isize = 2;
/// `NSWindowSharingNone` / `NSWindowSharingReadOnly`.
const SHARING_NONE: usize = 0;
const SHARING_READ_ONLY: usize = 1;
/// kCGEventSourceStateCombinedSessionState.
const COMBINED_SESSION_STATE: i32 = 0;

/// Objective-C `BOOL` is `bool` on arm64 and `signed char` on x86-64; this is its type encoding.
const BOOL_METHOD_ENCODING: &CStr = if cfg!(target_arch = "aarch64") { c"B@:" } else { c"c@:" };

fn selector(name: &CStr) -> Sel {
    // SAFETY: `name` is a valid NUL-terminated string.
    unsafe { sel_registerName(name.as_ptr()) }
}

// The objc_msgSend family must be called through a function pointer with the exact signature of the
// target method. Each helper below pins one signature; `Id` returns cover every pointer-sized result.
unsafe fn send(object: Id, sel: Sel) -> Id {
    let f: unsafe extern "C" fn(Id, Sel) -> Id = std::mem::transmute(objc_msgSend as *const c_void);
    f(object, sel)
}
unsafe fn send_returning_usize(object: Id, sel: Sel) -> usize {
    let f: unsafe extern "C" fn(Id, Sel) -> usize = std::mem::transmute(objc_msgSend as *const c_void);
    f(object, sel)
}
unsafe fn send_isize(object: Id, sel: Sel, value: isize) {
    let f: unsafe extern "C" fn(Id, Sel, isize) = std::mem::transmute(objc_msgSend as *const c_void);
    f(object, sel, value)
}
unsafe fn send_usize(object: Id, sel: Sel, value: usize) {
    let f: unsafe extern "C" fn(Id, Sel, usize) = std::mem::transmute(objc_msgSend as *const c_void);
    f(object, sel, value)
}
unsafe fn send_bool(object: Id, sel: Sel, value: bool) {
    let f: unsafe extern "C" fn(Id, Sel, u8) = std::mem::transmute(objc_msgSend as *const c_void);
    f(object, sel, u8::from(value))
}
unsafe fn send_id(object: Id, sel: Sel, value: Id) {
    let f: unsafe extern "C" fn(Id, Sel, Id) = std::mem::transmute(objc_msgSend as *const c_void);
    f(object, sel, value)
}

// The panel never becomes key or main: clicking the HUD must not pull keyboard focus away from the
// app being tutored. (Milestone 3's text tool will flip this on demand.)
extern "C" fn panel_can_become_key(_this: Id, _cmd: Sel) -> u8 {
    0
}
extern "C" fn panel_can_become_main(_this: Id, _cmd: Sel) -> u8 {
    0
}

/// `ClickySketchOverlayPanel`, an `NSPanel` subclass, created once per process.
fn panel_class() -> Class {
    static CLASS: OnceLock<usize> = OnceLock::new();
    let class = *CLASS.get_or_init(|| {
        // SAFETY: plain Objective-C runtime calls with valid, NUL-terminated names.
        unsafe {
            let name = c"ClickySketchOverlayPanel";
            let existing = objc_getClass(name.as_ptr());
            if !existing.is_null() {
                return existing as usize;
            }
            let superclass = objc_getClass(c"NSPanel".as_ptr());
            let created = objc_allocateClassPair(superclass, name.as_ptr(), 0);
            if created.is_null() {
                // Could not subclass: a stock NSPanel is still a non-activating panel.
                return superclass as usize;
            }
            class_addMethod(
                created,
                selector(c"canBecomeKeyWindow"),
                panel_can_become_key as *const c_void,
                BOOL_METHOD_ENCODING.as_ptr(),
            );
            class_addMethod(
                created,
                selector(c"canBecomeMainWindow"),
                panel_can_become_main as *const c_void,
                BOOL_METHOD_ENCODING.as_ptr(),
            );
            objc_registerClassPair(created);
            created as usize
        }
    });
    class as Class
}

/// Turns the window into the overlay panel. Must run on the main thread.
unsafe fn configure_panel(window: Id) {
    object_setClass(window, panel_class());
    send_usize(window, selector(c"setStyleMask:"), STYLE_MASK_NONACTIVATING_PANEL);
    send_isize(window, selector(c"setLevel:"), SCREEN_SAVER_LEVEL);
    send_usize(window, selector(c"setCollectionBehavior:"), COLLECTION_BEHAVIOR);
    send_bool(window, selector(c"setOpaque:"), false);
    let clear = send(objc_getClass(c"NSColor".as_ptr()), selector(c"clearColor"));
    send_id(window, selector(c"setBackgroundColor:"), clear);
    send_bool(window, selector(c"setHasShadow:"), false);
    send_bool(window, selector(c"setHidesOnDeactivate:"), false);
    send_bool(window, selector(c"setFloatingPanel:"), true);
    send_bool(window, selector(c"setBecomesKeyOnlyIfNeeded:"), true);
    send_bool(window, selector(c"setWorksWhenModal:"), true);
    send_isize(window, selector(c"setAnimationBehavior:"), ANIMATION_NONE);
    // Show it without activating the application.
    send(window, selector(c"orderFrontRegardless"));
}

fn ns_window_of(window: &WebviewWindow) -> Result<usize, String> {
    window.ns_window().map(|pointer| pointer as usize).map_err(|error| error.to_string())
}

/// Applies the native panel flags to a freshly created or re-laid-out window.
pub fn prepare_window(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let raw = ns_window_of(window)?;
    app.run_on_main_thread(move || {
        // SAFETY: runs on the main thread, on an NSWindow that Tauri keeps alive for as long as
        // the Tauri window exists.
        unsafe { configure_panel(raw as Id) }
    })
    .map_err(|error| error.to_string())
}

/// Switches a window between "ignore the mouse" and "receive the mouse".
pub fn set_click_through(_app: &AppHandle, window: &WebviewWindow, ignore: bool) -> Result<(), String> {
    window.set_ignore_cursor_events(ignore).map_err(|error| error.to_string())
}

/// Nothing drifts on macOS: the panel flags stick, so there is no periodic upkeep to do.
pub fn maintain(_app: &AppHandle, _window: &WebviewWindow) {}

/// Hides (or re-shows) the overlay in screenshots and screen shares.
pub fn set_capture_exclusion(app: &AppHandle, window: &WebviewWindow, excluded: bool) -> Result<(), String> {
    let raw = ns_window_of(window)?;
    let sharing = if excluded { SHARING_NONE } else { SHARING_READ_ONLY };
    app.run_on_main_thread(move || {
        // SAFETY: main thread, live NSWindow (see prepare_window).
        unsafe { send_usize(raw as Id, selector(c"setSharingType:"), sharing) }
    })
    .map_err(|error| error.to_string())
}

/// Global cursor position in points, origin at the top-left of the primary display, y pointing down.
pub fn cursor_position() -> Option<(f64, f64)> {
    // SAFETY: CGEventCreate(NULL) returns a +1 retained event (or NULL) that we release below.
    unsafe {
        let event = CGEventCreate(std::ptr::null());
        if event.is_null() {
            return None;
        }
        let location = CGEventGetLocation(event);
        CFRelease(event as *const c_void);
        Some((location.x, location.y))
    }
}

/// True while any mouse button is physically held.
pub fn mouse_button_down() -> bool {
    // Buttons: 0 left, 1 right, 2 centre.
    // SAFETY: CGEventSourceButtonState has no preconditions.
    (0u32..3).any(|button| unsafe { CGEventSourceButtonState(COMBINED_SESSION_STATE, button) })
}
