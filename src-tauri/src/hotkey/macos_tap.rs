//! macOS backend.
//!
//! Preferred: a listen-only `CGEventTap` on flags-changed and key-down events. It is event driven
//! (zero idle cost) and lets us see when another key joins the chord. macOS gates it behind the
//! Input Monitoring privacy permission; `CGEventTapCreate` simply returns NULL until it is granted.
//!
//! Fallback: polling `CGEventSourceFlagsState` every 8 ms. Reading the modifier flags needs no
//! permission, so push-to-talk keeps working out of the box; the only thing lost is noticing a
//! Ctrl+Option+<key> combo, which the event tap would have cancelled. The tray menu has a shortcut
//! to the Input Monitoring settings, and the HUD reports which mode is active.
//!
//! The Core Graphics / Core Foundation calls are declared by hand to stay independent of crate versions.

use super::monitor::{Modifiers, RawInput};
use super::BackendInfo;
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicPtr, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

type CfRunLoop = *mut c_void;
type CfMachPort = *mut c_void;
type CfRunLoopSource = *mut c_void;
type CfStringRef = *const c_void;
type CgEvent = *mut c_void;
type CgEventTapProxy = *mut c_void;
type TapCallback = extern "C" fn(CgEventTapProxy, u32, CgEvent, *mut c_void) -> CgEvent;

const SESSION_EVENT_TAP: u32 = 1;
const HEAD_INSERT_EVENT_TAP: u32 = 0;
const TAP_OPTION_LISTEN_ONLY: u32 = 1;

const EVENT_KEY_DOWN: u32 = 10;
const EVENT_FLAGS_CHANGED: u32 = 12;
const EVENT_TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFF_FFFE;
const EVENT_TAP_DISABLED_BY_USER_INPUT: u32 = 0xFFFF_FFFF;

const FLAG_SHIFT: u64 = 0x0002_0000;
const FLAG_CONTROL: u64 = 0x0004_0000;
const FLAG_ALTERNATE: u64 = 0x0008_0000;
const FLAG_COMMAND: u64 = 0x0010_0000;

/// kCGEventSourceStateCombinedSessionState.
const COMBINED_SESSION_STATE: i32 = 0;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventTapCreate(
        tap: u32,
        place: u32,
        options: u32,
        events_of_interest: u64,
        callback: TapCallback,
        user_info: *mut c_void,
    ) -> CfMachPort;
    fn CGEventTapEnable(tap: CfMachPort, enable: bool);
    fn CGEventGetFlags(event: CgEvent) -> u64;
    fn CGEventSourceFlagsState(state_id: i32) -> u64;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    #[allow(non_upper_case_globals)]
    static kCFRunLoopCommonModes: CfStringRef;
    fn CFMachPortCreateRunLoopSource(allocator: *const c_void, port: CfMachPort, order: isize) -> CfRunLoopSource;
    fn CFRunLoopGetCurrent() -> CfRunLoop;
    fn CFRunLoopAddSource(run_loop: CfRunLoop, source: CfRunLoopSource, mode: CfStringRef);
    fn CFRunLoopRun();
    fn CFRunLoopStop(run_loop: CfRunLoop);
    fn CFRelease(object: *const c_void);
}

fn modifiers_from_flags(flags: u64) -> Modifiers {
    Modifiers {
        ctrl: flags & FLAG_CONTROL != 0,
        alt: flags & FLAG_ALTERNATE != 0,
        shift: flags & FLAG_SHIFT != 0,
        meta: flags & FLAG_COMMAND != 0,
    }
}

/// The real modifier state. Works without any privacy permission.
pub fn poll_modifiers() -> Option<Modifiers> {
    // SAFETY: CGEventSourceFlagsState has no preconditions.
    let flags = unsafe { CGEventSourceFlagsState(COMBINED_SESSION_STATE) };
    Some(modifiers_from_flags(flags))
}

struct TapContext {
    tx: Sender<RawInput>,
    port: AtomicPtr<c_void>,
}

extern "C" fn tap_callback(_proxy: CgEventTapProxy, event_type: u32, event: CgEvent, user_info: *mut c_void) -> CgEvent {
    // SAFETY: `user_info` is the TapContext leaked to CGEventTapCreate; it outlives the tap.
    let context = unsafe { &*(user_info as *const TapContext) };
    match event_type {
        EVENT_FLAGS_CHANGED => {
            // SAFETY: `event` is valid for the duration of the callback.
            let flags = unsafe { CGEventGetFlags(event) };
            let _ = context.tx.send(RawInput::Modifiers(modifiers_from_flags(flags)));
        }
        EVENT_KEY_DOWN => {
            let _ = context.tx.send(RawInput::OtherKeyDown);
        }
        EVENT_TAP_DISABLED_BY_TIMEOUT | EVENT_TAP_DISABLED_BY_USER_INPUT => {
            // macOS switches a tap off if it ever stalls; switch it straight back on.
            let port = context.port.load(Ordering::SeqCst);
            if !port.is_null() {
                // SAFETY: `port` is the live tap created below.
                unsafe { CGEventTapEnable(port, true) };
            }
        }
        _ => {}
    }
    event
}

/// Keeps the listener threads alive; dropping it stops them.
pub struct Backend {
    stop: Arc<AtomicBool>,
    run_loop: Arc<AtomicUsize>,
}

impl Drop for Backend {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let run_loop = self.run_loop.load(Ordering::SeqCst);
        if run_loop != 0 {
            // SAFETY: stopping a run loop from another thread is explicitly supported.
            unsafe { CFRunLoopStop(run_loop as CfRunLoop) };
        }
    }
}

pub fn start(tx: Sender<RawInput>) -> Result<(Backend, BackendInfo), String> {
    let stop = Arc::new(AtomicBool::new(false));
    let run_loop = Arc::new(AtomicUsize::new(0));
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();

    {
        let tap_tx = tx.clone();
        let tap_stop = Arc::clone(&stop);
        let tap_run_loop = Arc::clone(&run_loop);
        thread::Builder::new()
            .name("clicky-event-tap".into())
            .spawn(move || run_event_tap(tap_tx, tap_stop, tap_run_loop, ready_tx))
            .map_err(|error| format!("could not start the event tap thread: {error}"))?;
    }

    if let Ok(Ok(())) = ready_rx.recv_timeout(Duration::from_secs(5)) {
        return Ok((
            Backend { stop, run_loop },
            BackendInfo { name: "macOS event tap", needs_permission: false, note: None },
        ));
    }

    // No Input Monitoring permission (yet): poll the modifier flags instead.
    let poll_stop = Arc::clone(&stop);
    thread::Builder::new()
        .name("clicky-modifier-poll".into())
        .spawn(move || run_polling(tx, poll_stop))
        .map_err(|error| format!("could not start the modifier polling thread: {error}"))?;
    Ok((
        Backend { stop, run_loop },
        BackendInfo {
            name: "macOS modifier polling",
            needs_permission: true,
            note: Some(
                "Push-to-talk works. Allow Input Monitoring in System Settings (Privacy & Security) for the lowest-latency listener."
                    .to_string(),
            ),
        },
    ))
}

fn run_event_tap(
    tx: Sender<RawInput>,
    stop: Arc<AtomicBool>,
    run_loop_slot: Arc<AtomicUsize>,
    ready: Sender<Result<(), String>>,
) {
    // SAFETY: standard CGEventTap setup; the context is leaked into the tap and reclaimed only
    // after the tap has been disabled and released below.
    unsafe {
        let context = Box::into_raw(Box::new(TapContext { tx, port: AtomicPtr::new(std::ptr::null_mut()) }));
        let mask = (1u64 << EVENT_KEY_DOWN) | (1u64 << EVENT_FLAGS_CHANGED);
        let port = CGEventTapCreate(
            SESSION_EVENT_TAP,
            HEAD_INSERT_EVENT_TAP,
            TAP_OPTION_LISTEN_ONLY,
            mask,
            tap_callback,
            context as *mut c_void,
        );
        if port.is_null() {
            drop(Box::from_raw(context));
            let _ = ready.send(Err("CGEventTapCreate returned NULL: Input Monitoring is not granted".to_string()));
            return;
        }
        (*context).port.store(port, Ordering::SeqCst);

        let source = CFMachPortCreateRunLoopSource(std::ptr::null(), port, 0);
        let run_loop = CFRunLoopGetCurrent();
        CFRunLoopAddSource(run_loop, source, kCFRunLoopCommonModes);
        CGEventTapEnable(port, true);
        run_loop_slot.store(run_loop as usize, Ordering::SeqCst);
        let _ = ready.send(Ok(()));

        if !stop.load(Ordering::SeqCst) {
            CFRunLoopRun();
        }

        CGEventTapEnable(port, false);
        CFRelease(source as *const c_void);
        CFRelease(port as *const c_void);
        drop(Box::from_raw(context));
    }
}

fn run_polling(tx: Sender<RawInput>, stop: Arc<AtomicBool>) {
    let mut last = poll_modifiers().unwrap_or_default();
    while !stop.load(Ordering::SeqCst) {
        thread::sleep(Duration::from_millis(8));
        if let Some(now) = poll_modifiers() {
            if now != last {
                last = now;
                if tx.send(RawInput::Modifiers(now)).is_err() {
                    break;
                }
            }
        }
    }
}
