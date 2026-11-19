//! IPC surface between the overlay pages and the Rust core.

use crate::capture;
use crate::hotkey::{HotkeyService, HotkeyStatus};
use crate::main_window;
use crate::overlay::{CssRect, OverlayHub, OverlayInfo};
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, State, WebviewWindow};

/// Everything an overlay page needs to know when it starts up.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayBootstrap {
    #[serde(flatten)]
    overlay: OverlayInfo,
    hotkey: HotkeyStatus,
}

#[tauri::command]
pub fn overlay_get_info(
    window: WebviewWindow,
    hub: State<'_, Arc<OverlayHub>>,
    hotkeys: State<'_, Arc<HotkeyService>>,
) -> Result<OverlayBootstrap, String> {
    let label = window.label().to_string();
    let overlay = hub
        .info_for(&label)
        .ok_or_else(|| format!("no overlay is registered for window '{label}'"))?;
    Ok(OverlayBootstrap { overlay, hotkey: hotkeys.status() })
}

/// The page reports which rectangles (CSS px) must receive the mouse; everything else is click-through.
#[tauri::command]
pub fn overlay_set_regions(window: WebviewWindow, regions: Vec<CssRect>, hub: State<'_, Arc<OverlayHub>>) {
    hub.set_regions(window.label(), regions);
}

#[tauri::command]
pub fn hotkey_get_status(hotkeys: State<'_, Arc<HotkeyService>>) -> HotkeyStatus {
    hotkeys.status()
}

/// Brings the main window to the front (the HUD and the tray call this).
#[tauri::command]
pub fn open_main_window(app: AppHandle) -> Result<(), String> {
    main_window::show(&app)
}

/// A screenshot of one display with every ClickySketch window hidden from it. Defaults to the
/// display under the mouse. Returned as raw bytes in the layout documented in `capture`.
///
/// This is an async command on purpose: it runs on a worker thread, not the UI thread, so it can
/// wait for the windows to be excluded from capture without freezing the interface.
#[tauri::command]
pub async fn capture_screen(
    app: AppHandle,
    hub: State<'_, Arc<OverlayHub>>,
    display: Option<usize>,
    max_width: Option<u32>,
) -> Result<tauri::ipc::Response, String> {
    let index = display.unwrap_or_else(|| hub.monitor_under_cursor());
    let width = max_width.unwrap_or(1280).clamp(320, 3840);
    let frame = capture::capture_display(&app, &hub, index, width)?;
    Ok(tauri::ipc::Response::new(frame.into_ipc()))
}
