//! System tray icon: the only always-reachable control while the overlay is click-through.

use crate::overlay::{self, OverlayHub};
use serde::Serialize;
use std::sync::Arc;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
struct OutlinePayload {
    outlines: bool,
}

#[cfg(target_os = "macos")]
fn open_input_monitoring_settings() {
    let opened = std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent")
        .spawn();
    if let Err(error) = opened {
        eprintln!("[clicky] could not open System Settings: {error}");
    }
}

pub fn install(app: &AppHandle, hub: Arc<OverlayHub>) -> tauri::Result<()> {
    let title = MenuItem::with_id(app, "title", "ClickySketch - Milestone 2", false, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open ClickySketch", true, None::<&str>)?;
    let outlines = CheckMenuItem::with_id(app, "outlines", "Show overlay outlines", true, false, None::<&str>)?;
    let exclude = CheckMenuItem::with_id(
        app,
        "exclude-capture",
        "Hide overlay from screenshots and screen share",
        true,
        false,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit ClickySketch", true, None::<&str>)?;

    #[cfg(target_os = "macos")]
    let menu = {
        let input = MenuItem::with_id(app, "input-monitoring", "Open Input Monitoring settings...", true, None::<&str>)?;
        Menu::with_items(app, &[&title, &open, &outlines, &exclude, &input, &separator, &quit])?
    };
    #[cfg(not(target_os = "macos"))]
    let menu = Menu::with_items(app, &[&title, &open, &outlines, &exclude, &separator, &quit])?;

    let outlines_item = outlines.clone();
    let exclude_item = exclude.clone();

    let mut tray = TrayIconBuilder::with_id("clickysketch-tray")
        .tooltip("ClickySketch")
        .menu(&menu);
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.on_menu_event(move |app, event| match event.id().as_ref() {
        "quit" => app.exit(0),
        "open" => {
            if let Err(error) = crate::main_window::show(app) {
                eprintln!("[clicky] {error}");
            }
        }
        "outlines" => {
            let on = outlines_item.is_checked().unwrap_or(false);
            hub.set_outlines(on);
            if let Err(error) = app.emit("overlay-debug", OutlinePayload { outlines: on }) {
                eprintln!("[clicky] could not toggle outlines: {error}");
            }
        }
        "exclude-capture" => {
            let on = exclude_item.is_checked().unwrap_or(false);
            if let Err(error) = overlay::set_capture_exclusion(app, &hub, on) {
                eprintln!("[clicky] {error}");
                // Show the truth in the menu: the setting did not take.
                let _ = exclude_item.set_checked(!on);
            }
        }
        #[cfg(target_os = "macos")]
        "input-monitoring" => open_input_monitoring_settings(),
        _ => {}
    })
    .build(app)?;
    Ok(())
}
