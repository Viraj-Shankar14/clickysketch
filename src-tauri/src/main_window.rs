//! The main application window. It has no native frame: the page draws a Windows 95 style title bar
//! and resize strips, and asks us (through the window API) to minimise, maximise or hide.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const MAIN_LABEL: &str = "main";

pub fn build(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let window = WebviewWindowBuilder::new(app, MAIN_LABEL, WebviewUrl::App("index.html".into()))
        .title("ClickySketch")
        .inner_size(960.0, 680.0)
        .min_inner_size(760.0, 560.0)
        .decorations(false)
        .shadow(true)
        .resizable(true)
        .center()
        .build()?;

    // Closing (the title-bar X, Alt+F4) only hides the window: the assistant lives in the tray and
    // keeps answering the push-to-talk hotkey. "Quit" in the tray menu really exits.
    let handle = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = handle.hide();
        }
    });
    Ok(window)
}

/// Brings the main window to the front, restoring it if it was hidden or minimised.
pub fn show(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_LABEL)
        .ok_or_else(|| "the main window is not available".to_string())?;
    window.unminimize().map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}
