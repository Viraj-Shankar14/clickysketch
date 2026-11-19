//! Windows backend: a `WH_KEYBOARD_LL` low-level keyboard hook.
//!
//! The hook runs on its own thread with its own message loop (the hook procedure is invoked from
//! that loop, so it must keep pumping). The callback does the bare minimum, translating key events
//! into `RawInput` values and passing them over a channel; Windows removes a hook whose callback is
//! slow, so no decisions are made here. Keys are never swallowed: Ctrl+Alt keeps working for every
//! other app, and push-to-talk simply listens in.
//!
//! The Win32 functions are declared by hand to stay independent of `windows-rs` versions.

use super::monitor::{Modifiers, RawInput};
use super::BackendInfo;
use std::cell::RefCell;
use std::ffi::c_void;
use std::sync::mpsc::{self, Sender};
use std::thread;
use std::time::Duration;

type Hhook = *mut c_void;
type Hinstance = *mut c_void;
type Wparam = usize;
type Lparam = isize;
type Lresult = isize;
type HookProc = unsafe extern "system" fn(i32, Wparam, Lparam) -> Lresult;

const WH_KEYBOARD_LL: i32 = 13;
const HC_ACTION: i32 = 0;
const WM_QUIT: u32 = 0x0012;
const WM_KEYDOWN: usize = 0x0100;
const WM_KEYUP: usize = 0x0101;
const WM_SYSKEYDOWN: usize = 0x0104;
const WM_SYSKEYUP: usize = 0x0105;

const VK_SHIFT: u32 = 0x10;
const VK_CONTROL: u32 = 0x11;
const VK_MENU: u32 = 0x12;
const VK_LWIN: u32 = 0x5B;
const VK_RWIN: u32 = 0x5C;
const VK_LSHIFT: u32 = 0xA0;
const VK_RSHIFT: u32 = 0xA1;
const VK_LCONTROL: u32 = 0xA2;
const VK_RCONTROL: u32 = 0xA3;
const VK_LMENU: u32 = 0xA4;
const VK_RMENU: u32 = 0xA5;

/// On keyboard layouts with an AltGr key, Windows sends a phantom Left-Ctrl before Right-Alt. Real
/// Ctrl presses never carry this scan code, so it is the tell for "not really Ctrl+Alt".
const ALTGR_PHANTOM_CTRL_SCAN_CODE: u32 = 0x021D;

// Mirrors the Win32 layout; not every field is read.
#[allow(dead_code)]
#[repr(C)]
struct KbdLlHookStruct {
    vk_code: u32,
    scan_code: u32,
    flags: u32,
    time: u32,
    extra_info: usize,
}

// Mirrors the Win32 layout; only ever filled in by GetMessageW.
#[allow(dead_code)]
#[repr(C)]
struct Msg {
    hwnd: *mut c_void,
    message: u32,
    w_param: Wparam,
    l_param: Lparam,
    time: u32,
    pt_x: i32,
    pt_y: i32,
}

#[link(name = "user32")]
extern "system" {
    fn SetWindowsHookExW(id_hook: i32, hook_proc: Option<HookProc>, module: Hinstance, thread_id: u32) -> Hhook;
    fn UnhookWindowsHookEx(hook: Hhook) -> i32;
    fn CallNextHookEx(hook: Hhook, code: i32, w_param: Wparam, l_param: Lparam) -> Lresult;
    fn GetMessageW(msg: *mut Msg, hwnd: *mut c_void, filter_min: u32, filter_max: u32) -> i32;
    fn TranslateMessage(msg: *const Msg) -> i32;
    fn DispatchMessageW(msg: *const Msg) -> Lresult;
    fn PostThreadMessageW(thread_id: u32, message: u32, w_param: Wparam, l_param: Lparam) -> i32;
    fn GetAsyncKeyState(virtual_key: i32) -> i16;
}

#[link(name = "kernel32")]
extern "system" {
    fn GetModuleHandleW(module_name: *const u16) -> Hinstance;
    fn GetCurrentThreadId() -> u32;
    fn GetLastError() -> u32;
}

fn physically_down(virtual_key: u32) -> bool {
    // SAFETY: GetAsyncKeyState has no preconditions.
    let state = unsafe { GetAsyncKeyState(virtual_key as i32) };
    (state as u16 & 0x8000) != 0
}

/// Which modifier keys the hook believes are down, tracked per physical key (left and right).
#[derive(Default)]
struct KeyState {
    lctrl: bool,
    rctrl: bool,
    lalt: bool,
    ralt: bool,
    lshift: bool,
    rshift: bool,
    lwin: bool,
    rwin: bool,
}

impl KeyState {
    fn modifiers(&self) -> Modifiers {
        Modifiers {
            ctrl: self.lctrl || self.rctrl,
            alt: self.lalt || self.ralt,
            shift: self.lshift || self.rshift,
            meta: self.lwin || self.rwin,
        }
    }

    /// Records a modifier key event. Returns false when `vk` is not a modifier at all.
    fn apply(&mut self, vk: u32, scan_code: u32, down: bool) -> bool {
        match vk {
            VK_LCONTROL | VK_CONTROL => {
                if scan_code != ALTGR_PHANTOM_CTRL_SCAN_CODE {
                    self.lctrl = down;
                }
                true
            }
            VK_RCONTROL => {
                self.rctrl = down;
                true
            }
            VK_LMENU | VK_MENU => {
                self.lalt = down;
                true
            }
            VK_RMENU => {
                self.ralt = down;
                true
            }
            VK_LSHIFT | VK_SHIFT => {
                self.lshift = down;
                true
            }
            VK_RSHIFT => {
                self.rshift = down;
                true
            }
            VK_LWIN => {
                self.lwin = down;
                true
            }
            VK_RWIN => {
                self.rwin = down;
                true
            }
            _ => false,
        }
    }

    /// Windows never delivers the key-up for keys released while the secure desktop (Ctrl+Alt+Del,
    /// UAC) or the lock screen had the keyboard. Before trusting a key as "down", ask the OS, so a
    /// lost key-up cannot leave a phantom modifier behind. The key being processed right now is
    /// exempt: the OS only updates its state after the hook returns.
    fn drop_stale_keys(&mut self, current_vk: u32) {
        let stale = |held: bool, keys: &[u32]| held && !keys.iter().any(|&key| key == current_vk || physically_down(key));
        if stale(self.lctrl, &[VK_LCONTROL]) {
            self.lctrl = false;
        }
        if stale(self.rctrl, &[VK_RCONTROL]) {
            self.rctrl = false;
        }
        if stale(self.lalt, &[VK_LMENU]) {
            self.lalt = false;
        }
        if stale(self.ralt, &[VK_RMENU]) {
            self.ralt = false;
        }
        if stale(self.lshift, &[VK_LSHIFT]) {
            self.lshift = false;
        }
        if stale(self.rshift, &[VK_RSHIFT]) {
            self.rshift = false;
        }
        if stale(self.lwin, &[VK_LWIN]) {
            self.lwin = false;
        }
        if stale(self.rwin, &[VK_RWIN]) {
            self.rwin = false;
        }
    }
}

struct HookSink {
    tx: Sender<RawInput>,
    keys: KeyState,
}

thread_local! {
    // The hook procedure always runs on the thread that installed the hook, so thread-local state
    // is exactly the right scope: no locks inside the callback.
    static SINK: RefCell<Option<HookSink>> = const { RefCell::new(None) };
}

fn handle_key(vk: u32, scan_code: u32, down: bool) {
    SINK.with(|cell| {
        let mut slot = cell.borrow_mut();
        let Some(sink) = slot.as_mut() else {
            return;
        };
        let before = sink.keys.modifiers();
        sink.keys.drop_stale_keys(vk);
        let is_modifier = sink.keys.apply(vk, scan_code, down);
        let after = sink.keys.modifiers();
        if after != before {
            let _ = sink.tx.send(RawInput::Modifiers(after));
        }
        if !is_modifier && down {
            let _ = sink.tx.send(RawInput::OtherKeyDown);
        }
    });
}

unsafe extern "system" fn keyboard_proc(code: i32, w_param: Wparam, l_param: Lparam) -> Lresult {
    if code == HC_ACTION {
        // SAFETY: for WH_KEYBOARD_LL with HC_ACTION, lParam points to a valid KBDLLHOOKSTRUCT.
        let info = &*(l_param as *const KbdLlHookStruct);
        let down = matches!(w_param, WM_KEYDOWN | WM_SYSKEYDOWN);
        let up = matches!(w_param, WM_KEYUP | WM_SYSKEYUP);
        if down || up {
            handle_key(info.vk_code, info.scan_code, down);
        }
    }
    CallNextHookEx(std::ptr::null_mut(), code, w_param, l_param)
}

/// Keeps the hook thread alive; dropping it ends the message loop and removes the hook.
pub struct Backend {
    thread_id: u32,
}

impl Drop for Backend {
    fn drop(&mut self) {
        // SAFETY: posting WM_QUIT to our own hook thread is always valid; failure is harmless.
        unsafe {
            PostThreadMessageW(self.thread_id, WM_QUIT, 0, 0);
        }
    }
}

pub fn start(tx: Sender<RawInput>) -> Result<(Backend, BackendInfo), String> {
    let (ready_tx, ready_rx) = mpsc::channel::<Result<u32, String>>();
    thread::Builder::new()
        .name("clicky-keyboard-hook".into())
        .spawn(move || run_hook_thread(tx, ready_tx))
        .map_err(|error| format!("could not start the keyboard hook thread: {error}"))?;

    match ready_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(thread_id)) => Ok((
            Backend { thread_id },
            BackendInfo { name: "Windows low-level keyboard hook", needs_permission: false, note: None },
        )),
        Ok(Err(message)) => Err(message),
        Err(_) => Err("the keyboard hook thread did not report back in time".to_string()),
    }
}

fn run_hook_thread(tx: Sender<RawInput>, ready: Sender<Result<u32, String>>) {
    SINK.with(|cell| {
        *cell.borrow_mut() = Some(HookSink { tx, keys: KeyState::default() });
    });
    // SAFETY: standard hook installation and message pump; every pointer passed is valid for the call.
    unsafe {
        let module = GetModuleHandleW(std::ptr::null());
        let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), module, 0);
        if hook.is_null() {
            let _ = ready.send(Err(format!("SetWindowsHookExW failed (Win32 error {})", GetLastError())));
            return;
        }
        let _ = ready.send(Ok(GetCurrentThreadId()));

        let mut msg: Msg = std::mem::zeroed();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        UnhookWindowsHookEx(hook);
    }
}

/// The real keyboard state, used to recover from a key-up the hook never saw.
pub fn poll_modifiers() -> Option<Modifiers> {
    Some(Modifiers {
        ctrl: physically_down(VK_LCONTROL) || physically_down(VK_RCONTROL),
        alt: physically_down(VK_LMENU) || physically_down(VK_RMENU),
        shift: physically_down(VK_LSHIFT) || physically_down(VK_RSHIFT),
        meta: physically_down(VK_LWIN) || physically_down(VK_RWIN),
    })
}
