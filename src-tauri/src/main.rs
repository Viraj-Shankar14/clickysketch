// Hide the extra console window that Windows would otherwise show for release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(not(any(windows, target_os = "macos")))]
compile_error!("ClickySketch supports Windows and macOS only.");

mod capture;
mod commands;
mod hotkey;
mod main_window;
mod overlay;
mod tray;

use std::sync::Arc;
use tauri::{Manager, RunEvent};

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::overlay_get_info,
            commands::overlay_set_regions,
            commands::hotkey_get_status,
            commands::open_main_window,
            commands::capture_screen,
        ])
        .setup(|app| {
            let hub = Arc::new(overlay::OverlayHub::new());
            app.manage(Arc::clone(&hub));
            overlay::bootstrap(app.handle(), &hub)?;
            overlay::start_poller(app.handle().clone(), Arc::clone(&hub));

            let hotkeys = Arc::new(hotkey::HotkeyService::start(app.handle().clone(), Arc::clone(&hub)));
            app.manage(hotkeys);

            tray::install(app.handle(), Arc::clone(&hub))?;

            // Created last so it opens on top; the overlays never take focus.
            main_window::build(app.handle())?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build the ClickySketch application");

    app.run(|_app_handle, event| {
        // Closing the last overlay must not end the app: it lives in the tray until "Quit".
        if let RunEvent::ExitRequested { api, code, .. } = event {
            if code.is_none() {
                api.prevent_exit();
            }
        }
    });
}
