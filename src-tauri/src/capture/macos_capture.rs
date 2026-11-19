//! macOS screen capture through the system `screencapture` tool: it works on every macOS version
//! (ScreenCaptureKit needs a much newer deployment target) and honours the Screen Recording
//! permission. The first call makes macOS ask for that permission.

use super::{Frame, PixelFormat};
use crate::overlay::MonitorRect;
use std::process::Command;

pub fn capture(index: usize, _rect: MonitorRect, _max_width: u32) -> Result<Frame, String> {
    let path = std::env::temp_dir().join(format!("clickysketch-capture-{}.jpg", std::process::id()));
    // -x: no shutter sound, -t jpg: JPEG, -D n: display number (1 is the main display).
    let status = Command::new("/usr/sbin/screencapture")
        .args(["-x", "-t", "jpg", "-D"])
        .arg((index + 1).to_string())
        .arg(&path)
        .status()
        .map_err(|error| format!("could not run screencapture: {error}"))?;
    if !status.success() {
        return Err("screencapture failed: allow ClickySketch under System Settings, Privacy & Security, Screen Recording".to_string());
    }
    let bytes = std::fs::read(&path).map_err(|error| format!("could not read the screenshot: {error}"))?;
    let _ = std::fs::remove_file(&path);
    // The page learns the real size when it decodes the JPEG.
    Ok(Frame { format: PixelFormat::Jpeg, width: 0, height: 0, data: bytes })
}
