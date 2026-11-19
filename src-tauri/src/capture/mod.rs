//! Screen capture for "look at my screen".
//!
//! A frame travels to the page as raw bytes: [format u8][width u32 LE][height u32 LE][payload].
//! Format 0 is RGBA pixels (Windows: already scaled down here), format 1 is a JPEG file (macOS).
//! The page scales it to the requested width and JPEG-encodes it for the model.

#[cfg(target_os = "macos")]
mod macos_capture;
#[cfg(windows)]
mod win32_capture;

#[cfg(target_os = "macos")]
use macos_capture as native;
#[cfg(windows)]
use win32_capture as native;

use crate::overlay::{self, OverlayHub};
use std::time::Duration;
use tauri::AppHandle;

#[derive(Clone, Copy, Debug)]
pub enum PixelFormat {
    Rgba = 0,
    Jpeg = 1,
}

pub struct Frame {
    pub format: PixelFormat,
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

impl Frame {
    pub fn into_ipc(self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(9 + self.data.len());
        bytes.push(self.format as u8);
        bytes.extend_from_slice(&self.width.to_le_bytes());
        bytes.extend_from_slice(&self.height.to_le_bytes());
        bytes.extend_from_slice(&self.data);
        bytes
    }
}

/// How long the OS needs to drop a freshly excluded window from what the capture APIs see.
const SETTLE: Duration = Duration::from_millis(90);

/// Captures one display with every ClickySketch window (the HUD overlays and the main window)
/// hidden from the picture, then puts the windows' capture settings back the way they were.
pub fn capture_display(app: &AppHandle, hub: &OverlayHub, index: usize, max_width: u32) -> Result<Frame, String> {
    let rect = hub
        .monitor_rect(index)
        .ok_or_else(|| format!("display {} is not available", index + 1))?;
    overlay::exclude_all_from_capture(app, true);
    std::thread::sleep(SETTLE);
    let frame = native::capture(index, rect, max_width);
    overlay::restore_capture_exclusion(app, hub);
    frame
}
