//! Global push-to-talk: hold Ctrl + Alt (Windows) or Ctrl + Option (macOS).
//!
//! Layers, from the OS up:
//!   1. a platform backend (`win32_hook` / `macos_tap`) turns raw keyboard activity into `RawInput`;
//!   2. a dispatcher thread feeds those into the `PttMachine` (`monitor`), which debounces, detects
//!      combos and recovers from lost key-ups;
//!   3. state changes are emitted to every overlay webview as the `ptt-state` event.

pub mod monitor;

#[cfg(target_os = "macos")]
mod macos_tap;
#[cfg(windows)]
mod win32_hook;

#[cfg(target_os = "macos")]
use macos_tap as platform;
#[cfg(windows)]
use win32_hook as platform;

use crate::overlay::OverlayHub;
use monitor::{PttMachine, PttPhase, RawInput, HOLD_DELAY, RECONCILE_INTERVAL};
use serde::Serialize;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

/// Label of the chord as shown to the user.
const CHORD_LABEL: &str = if cfg!(target_os = "macos") { "Ctrl + Option" } else { "Ctrl + Alt" };

/// With nothing to do the dispatcher sleeps until an input arrives; this only bounds a single wait.
const IDLE_WAIT: Duration = Duration::from_secs(3600);

/// What a platform backend reports about itself after it started.
pub struct BackendInfo {
    pub name: &'static str,
    pub needs_permission: bool,
    pub note: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyStatus {
    pub backend: String,
    pub ok: bool,
    pub needs_permission: bool,
    pub chord: String,
    pub message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PttEvent {
    phase: &'static str,
    monitor: usize,
    at_ms: u64,
}

/// Owns the keyboard listener for the lifetime of the app. Lives in Tauri's managed state.
pub struct HotkeyService {
    status: HotkeyStatus,
    _backend: Option<platform::Backend>,
}

impl HotkeyService {
    pub fn start(app: AppHandle, hub: Arc<OverlayHub>) -> Self {
        let (tx, rx) = mpsc::channel::<RawInput>();
        match platform::start(tx) {
            Ok((backend, info)) => {
                spawn_dispatcher(rx, app, hub);
                let message = info.note.unwrap_or_else(|| format!("Hold {CHORD_LABEL} to talk"));
                eprintln!("[clicky] push-to-talk listener: {}", info.name);
                Self {
                    status: HotkeyStatus {
                        backend: info.name.to_string(),
                        ok: true,
                        needs_permission: info.needs_permission,
                        chord: CHORD_LABEL.to_string(),
                        message,
                    },
                    _backend: Some(backend),
                }
            }
            Err(error) => {
                eprintln!("[clicky] push-to-talk is unavailable: {error}");
                Self {
                    status: HotkeyStatus {
                        backend: "none".to_string(),
                        ok: false,
                        needs_permission: false,
                        chord: CHORD_LABEL.to_string(),
                        message: format!("Hotkey unavailable: {error}"),
                    },
                    _backend: None,
                }
            }
        }
    }

    pub fn status(&self) -> HotkeyStatus {
        self.status.clone()
    }
}

fn spawn_dispatcher(rx: Receiver<RawInput>, app: AppHandle, hub: Arc<OverlayHub>) {
    let spawned = thread::Builder::new().name("clicky-ptt-dispatch".into()).spawn(move || {
        let mut machine = PttMachine::new(HOLD_DELAY);
        loop {
            // Wake for the next hold deadline; while a hold is active also wake periodically to
            // double-check the real keyboard state.
            let wait = match machine.next_deadline() {
                Some(deadline) => deadline.saturating_duration_since(Instant::now()).min(RECONCILE_INTERVAL),
                None if machine.is_holding() => RECONCILE_INTERVAL,
                None => IDLE_WAIT,
            };

            let mut phases: Vec<PttPhase> = Vec::new();
            match rx.recv_timeout(wait) {
                Ok(input) => {
                    // Settle an elapsed hold delay first so Pressed always precedes a Released.
                    phases.extend(machine.tick(Instant::now()));
                    phases.extend(machine.on_input(input, Instant::now()));
                }
                Err(RecvTimeoutError::Timeout) => {
                    phases.extend(machine.tick(Instant::now()));
                    if machine.is_holding() {
                        if let Some(physical) = platform::poll_modifiers() {
                            phases.extend(machine.reconcile_release(physical, Instant::now()));
                        }
                    }
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }

            for phase in phases {
                emit_phase(&app, &hub, phase);
            }
        }
    });
    if let Err(error) = spawned {
        eprintln!("[clicky] could not start the push-to-talk dispatcher: {error}");
    }
}

fn emit_phase(app: &AppHandle, hub: &OverlayHub, phase: PttPhase) {
    let (name, monitor) = match phase {
        PttPhase::Pressed => {
            // The HUD jumps to the display the pointer is on the moment you start talking.
            let monitor = hub.monitor_under_cursor();
            hub.focus_hud(app, monitor);
            ("pressed", monitor)
        }
        PttPhase::Released => ("released", hub.hud_monitor()),
        PttPhase::Cancelled => ("cancelled", hub.hud_monitor()),
    };
    let at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0);
    if let Err(error) = app.emit("ptt-state", PttEvent { phase: name, monitor, at_ms }) {
        eprintln!("[clicky] could not send ptt-state: {error}");
    }
}
