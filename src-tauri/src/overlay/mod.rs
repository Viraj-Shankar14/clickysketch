//! Multi-monitor transparent overlay: window lifecycle, layout and the selective click-through engine.
//!
//! One frameless, transparent, always-on-top window covers each display. Tauri has no equivalent of
//! Electron's `setIgnoreMouseEvents(true, { forward: true })`: once a window ignores the cursor its
//! webview never sees another mouse move, so it cannot tell when the pointer comes back over the HUD.
//! So the webview reports its interactive rectangles (`overlay_set_regions`) and a native poller
//! watches the real cursor, flipping each window between "ignore the mouse" and "receive the mouse"
//! the instant the pointer crosses one of those rectangles. Every window starts and stays
//! click-through unless the pointer is over a reported region, so a failure anywhere in this chain
//! can never trap the user's clicks.

mod geometry;
#[cfg(target_os = "macos")]
mod macos_overlay;
#[cfg(windows)]
mod win32_overlay;

#[cfg(target_os = "macos")]
use macos_overlay as native;
#[cfg(windows)]
use win32_overlay as native;

pub use geometry::CssRect;
use geometry::{cursor_over_regions, index_of_frame_containing, SpaceRect};

use serde::Serialize;
use std::fmt;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const LABEL_PREFIX: &str = "overlay-";
const MAX_REGIONS: usize = 64;
const PLATFORM: &str = if cfg!(windows) { "windows" } else { "macos" };

/// ~60 Hz: the HUD must wake up the moment the pointer touches it.
const POLL_INTERVAL: Duration = Duration::from_millis(16);
const HOUSEKEEPING_INTERVAL: Duration = Duration::from_millis(500);
/// How long the cursor must rest on another display before the HUD moves there.
const HUD_DWELL: Duration = Duration::from_millis(350);
/// Give up re-applying a frame the OS keeps adjusting (e.g. a menu-bar inset) after this many tries.
const MAX_FIX_ATTEMPTS: u8 = 4;

#[derive(Debug)]
pub enum OverlayError {
    Tauri(tauri::Error),
    NoMonitors,
    Native(String),
}

impl fmt::Display for OverlayError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Tauri(error) => write!(f, "tauri error: {error}"),
            Self::NoMonitors => write!(f, "the operating system reported no displays"),
            Self::Native(message) => write!(f, "native overlay error: {message}"),
        }
    }
}

impl std::error::Error for OverlayError {}

impl From<tauri::Error> for OverlayError {
    fn from(error: tauri::Error) -> Self {
        Self::Tauri(error)
    }
}

/// What a freshly loaded overlay page needs to know about the window it lives in.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayInfo {
    pub label: String,
    pub index: usize,
    pub is_primary: bool,
    pub monitor_count: usize,
    pub hud_monitor: usize,
    pub scale_factor: f64,
    pub width: u32,
    pub height: u32,
    pub platform: &'static str,
    pub outlines: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LayoutPayload {
    monitor_count: usize,
}

#[derive(Clone, Serialize)]
struct PointerPayload {
    inside: bool,
}

#[derive(Clone, Serialize)]
struct HudMonitorPayload {
    monitor: usize,
}

/// A display's rectangle in physical pixels on the virtual desktop.
#[derive(Clone, Copy, Debug)]
pub struct MonitorRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// A display as reported by the OS, in physical pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
struct MonitorSpec {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale: f64,
}

struct Overlay {
    label: String,
    index: usize,
    spec: MonitorSpec,
    /// The window's real frame in hit-test space (read back from the OS, not assumed).
    frame: SpaceRect,
    /// CSS pixels -> hit-test space.
    factor: f64,
    regions: Vec<CssRect>,
    /// Whether the window is currently click-through. Starts true: fail safe.
    ignoring: bool,
    fix_attempts: u8,
}

#[derive(Default)]
struct HubState {
    overlays: Vec<Overlay>,
    specs: Vec<MonitorSpec>,
}

/// Shared state of all overlay windows. Lives in Tauri's managed state as `Arc<OverlayHub>`.
pub struct OverlayHub {
    state: Mutex<HubState>,
    hud_monitor: AtomicUsize,
    outlines: AtomicBool,
    capture_excluded: AtomicBool,
}

impl OverlayHub {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(HubState::default()),
            hud_monitor: AtomicUsize::new(0),
            outlines: AtomicBool::new(false),
            capture_excluded: AtomicBool::new(false),
        }
    }

    fn lock(&self) -> MutexGuard<'_, HubState> {
        // A poisoned lock only means another thread panicked mid-update; the data is still usable.
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Index of the display that currently hosts the Dynamic Island.
    pub fn hud_monitor(&self) -> usize {
        self.hud_monitor.load(Ordering::SeqCst)
    }

    /// Moves the Dynamic Island to another display and tells every overlay about it.
    pub fn focus_hud(&self, app: &AppHandle, index: usize) {
        if self.hud_monitor.swap(index, Ordering::SeqCst) != index {
            if let Err(error) = app.emit("hud-monitor", HudMonitorPayload { monitor: index }) {
                eprintln!("[clicky] could not announce the HUD move: {error}");
            }
        }
    }

    pub fn outlines(&self) -> bool {
        self.outlines.load(Ordering::SeqCst)
    }

    pub fn set_outlines(&self, on: bool) {
        self.outlines.store(on, Ordering::SeqCst);
    }

    /// Replaces the interactive regions of one overlay (CSS pixels).
    pub fn set_regions(&self, label: &str, mut regions: Vec<CssRect>) {
        regions.retain(CssRect::is_usable);
        regions.truncate(MAX_REGIONS);
        if let Some(overlay) = self.lock().overlays.iter_mut().find(|overlay| overlay.label == label) {
            overlay.regions = regions;
        }
    }

    pub fn info_for(&self, label: &str) -> Option<OverlayInfo> {
        let state = self.lock();
        let overlay = state.overlays.iter().find(|overlay| overlay.label == label)?;
        Some(OverlayInfo {
            label: overlay.label.clone(),
            index: overlay.index,
            is_primary: overlay.index == 0,
            monitor_count: state.overlays.len(),
            hud_monitor: self.hud_monitor(),
            scale_factor: overlay.spec.scale,
            width: overlay.spec.width,
            height: overlay.spec.height,
            platform: PLATFORM,
            outlines: self.outlines(),
        })
    }

    /// The rectangle (physical pixels) of display `index`, for the screen capture.
    pub fn monitor_rect(&self, index: usize) -> Option<MonitorRect> {
        let state = self.lock();
        state.overlays.iter().find(|overlay| overlay.index == index).map(|overlay| MonitorRect {
            x: overlay.spec.x,
            y: overlay.spec.y,
            width: overlay.spec.width,
            height: overlay.spec.height,
        })
    }

    /// The display the mouse pointer is on right now (falls back to the HUD's current display).
    pub fn monitor_under_cursor(&self) -> usize {
        match native::cursor_position() {
            Some(cursor) => self.monitor_at(cursor).unwrap_or_else(|| self.hud_monitor()),
            None => self.hud_monitor(),
        }
    }

    fn monitor_at(&self, cursor: (f64, f64)) -> Option<usize> {
        let state = self.lock();
        let frames: Vec<SpaceRect> = state.overlays.iter().map(|overlay| overlay.frame).collect();
        index_of_frame_containing(&frames, cursor).map(|position| state.overlays[position].index)
    }

    /// Decides which windows must change click-through state for this cursor position and records
    /// the decision. Returns `(label, ignore)` pairs for the windows that need flipping.
    fn decide(&self, cursor: (f64, f64), button_down: bool) -> Vec<(String, bool)> {
        let mut changes = Vec::new();
        for overlay in self.lock().overlays.iter_mut() {
            let inside = cursor_over_regions(overlay.frame, overlay.factor, &overlay.regions, cursor);
            // A press that started on the HUD keeps the window interactive until the button is
            // released, so drags and text selections survive the pointer leaving the rectangle.
            let want_ignore = if button_down && !overlay.ignoring { false } else { !inside };
            if want_ignore != overlay.ignoring {
                overlay.ignoring = want_ignore;
                changes.push((overlay.label.clone(), want_ignore));
            }
        }
        changes
    }

    /// Undoes a recorded decision whose native side effect failed, so the next tick retries it.
    fn revert_ignoring(&self, label: &str, value: bool) {
        if let Some(overlay) = self.lock().overlays.iter_mut().find(|overlay| overlay.label == label) {
            overlay.ignoring = value;
        }
    }
}

fn label_for(index: usize) -> String {
    format!("{LABEL_PREFIX}{index}")
}

fn index_from_label(label: &str) -> Option<usize> {
    label.strip_prefix(LABEL_PREFIX)?.parse().ok()
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------------------------

/// Windows hit-tests in physical pixels; the CSS-to-space factor is the display scale factor.
#[cfg(windows)]
fn space_from_physical(x: f64, y: f64, w: f64, h: f64, scale: f64) -> (SpaceRect, f64) {
    (SpaceRect { x, y, w, h }, scale)
}

/// macOS hit-tests in points (CGEvent coordinates); one CSS pixel is one point.
#[cfg(target_os = "macos")]
fn space_from_physical(x: f64, y: f64, w: f64, h: f64, scale: f64) -> (SpaceRect, f64) {
    (SpaceRect { x: x / scale, y: y / scale, w: w / scale, h: h / scale }, 1.0)
}

/// Reads the window's real frame back from the OS.
fn measure(window: &WebviewWindow) -> Result<(SpaceRect, f64), OverlayError> {
    let position = window.inner_position()?;
    let size = window.inner_size()?;
    let scale = window.scale_factor()?;
    Ok(space_from_physical(
        f64::from(position.x),
        f64::from(position.y),
        f64::from(size.width),
        f64::from(size.height),
        scale,
    ))
}

fn expected_frame(spec: &MonitorSpec) -> SpaceRect {
    space_from_physical(
        f64::from(spec.x),
        f64::from(spec.y),
        f64::from(spec.width),
        f64::from(spec.height),
        spec.scale,
    )
    .0
}

fn frames_match(a: &SpaceRect, b: &SpaceRect) -> bool {
    (a.x - b.x).abs() <= 2.0 && (a.y - b.y).abs() <= 2.0 && (a.w - b.w).abs() <= 2.0 && (a.h - b.h).abs() <= 2.0
}

/// Positions a window over its display. Windows works in physical pixels; macOS in points, because
/// tao reports each macOS display's origin in that display's own pixels.
fn place(window: &WebviewWindow, spec: &MonitorSpec) -> Result<(), OverlayError> {
    #[cfg(windows)]
    {
        window.set_position(tauri::PhysicalPosition::new(spec.x, spec.y))?;
        window.set_size(tauri::PhysicalSize::new(spec.width, spec.height))?;
    }
    #[cfg(target_os = "macos")]
    {
        let scale = spec.scale;
        window.set_position(tauri::LogicalPosition::new(f64::from(spec.x) / scale, f64::from(spec.y) / scale))?;
        window.set_size(tauri::LogicalSize::new(f64::from(spec.width) / scale, f64::from(spec.height) / scale))?;
    }
    Ok(())
}

/// Lists the displays, primary first, then left-to-right, top-to-bottom.
fn read_monitors(window: &WebviewWindow) -> Result<Vec<MonitorSpec>, OverlayError> {
    let mut specs: Vec<MonitorSpec> = window
        .available_monitors()?
        .iter()
        .map(|monitor| MonitorSpec {
            x: monitor.position().x,
            y: monitor.position().y,
            width: monitor.size().width,
            height: monitor.size().height,
            scale: monitor.scale_factor(),
        })
        .collect();
    specs.sort_by_key(|spec| (spec.x, spec.y));

    let primary = window.primary_monitor()?.map(|monitor| MonitorSpec {
        x: monitor.position().x,
        y: monitor.position().y,
        width: monitor.size().width,
        height: monitor.size().height,
        scale: monitor.scale_factor(),
    });
    if let Some(primary) = primary {
        let found = specs.iter().position(|spec| {
            spec.x == primary.x && spec.y == primary.y && spec.width == primary.width && spec.height == primary.height
        });
        if let Some(position) = found {
            let first = specs.remove(position);
            specs.insert(0, first);
        }
    }
    Ok(specs)
}

// ---------------------------------------------------------------------------------------------
// Window lifecycle
// ---------------------------------------------------------------------------------------------

fn build_window(app: &AppHandle, index: usize) -> Result<WebviewWindow, OverlayError> {
    let builder = WebviewWindowBuilder::new(app, label_for(index), WebviewUrl::App("index.html".into()))
        .title("ClickySketch Overlay")
        .inner_size(800.0, 600.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        // Never grab focus from the app the user is working in.
        .focused(false);
    // Without this the first click on an inactive macOS panel is swallowed instead of reaching the page.
    #[cfg(target_os = "macos")]
    let builder = builder.accept_first_mouse(true);
    Ok(builder.build()?)
}

/// Brings the set of overlay windows in line with the displays: creates missing windows, removes
/// surplus ones, positions every window, applies the native flags and re-measures the real frames.
fn apply_layout(app: &AppHandle, hub: &OverlayHub, specs: Vec<MonitorSpec>) -> Result<(), OverlayError> {
    for index in 0..specs.len() {
        if app.get_webview_window(&label_for(index)).is_none() {
            build_window(app, index)?;
        }
    }
    for (label, window) in app.webview_windows() {
        if index_from_label(&label).is_some_and(|index| index >= specs.len()) {
            if let Err(error) = window.destroy() {
                eprintln!("[clicky] could not remove the overlay for a disconnected display: {error}");
            }
        }
    }

    let excluded = hub.capture_excluded.load(Ordering::SeqCst);
    let mut overlays = Vec::with_capacity(specs.len());
    for (index, spec) in specs.iter().enumerate() {
        let label = label_for(index);
        let window = app
            .get_webview_window(&label)
            .ok_or_else(|| OverlayError::Native(format!("window {label} disappeared while laying out")))?;
        place(&window, spec)?;
        native::prepare_window(app, &window).map_err(OverlayError::Native)?;
        // Fail safe: start click-through; the poller opens the window only while the pointer is on the HUD.
        native::set_click_through(app, &window, true).map_err(OverlayError::Native)?;
        if excluded {
            if let Err(error) = native::set_capture_exclusion(app, &window, true) {
                eprintln!("[clicky] {error}");
            }
        }
        let (frame, factor) = measure(&window)?;
        let regions = hub
            .lock()
            .overlays
            .iter()
            .find(|overlay| overlay.label == label)
            .map(|overlay| overlay.regions.clone())
            .unwrap_or_default();
        overlays.push(Overlay { label, index, spec: *spec, frame, factor, regions, ignoring: true, fix_attempts: 0 });
    }

    let count = overlays.len();
    {
        let mut state = hub.lock();
        state.overlays = overlays;
        state.specs = specs;
    }
    if hub.hud_monitor() >= count {
        hub.hud_monitor.store(0, Ordering::SeqCst);
    }
    if let Err(error) = app.emit("overlay-layout", LayoutPayload { monitor_count: count }) {
        eprintln!("[clicky] could not announce the new layout: {error}");
    }
    Ok(())
}

/// Creates one overlay per display. Called once from Tauri's `setup`, before the event loop starts.
pub fn bootstrap(app: &AppHandle, hub: &OverlayHub) -> Result<(), OverlayError> {
    // The first window doubles as the probe that lists the displays.
    let first = build_window(app, 0)?;
    let specs = read_monitors(&first)?;
    if specs.is_empty() {
        return Err(OverlayError::NoMonitors);
    }
    apply_layout(app, hub, specs)
}

/// Hides the overlays from screenshots and screen shares (tray toggle; the capture pipeline in
/// Milestone 2 also uses it to keep the HUD out of the pictures it sends to the model).
pub fn set_capture_exclusion(app: &AppHandle, hub: &OverlayHub, excluded: bool) -> Result<(), String> {
    hub.capture_excluded.store(excluded, Ordering::SeqCst);
    for (label, window) in app.webview_windows() {
        if index_from_label(&label).is_some() {
            native::set_capture_exclusion(app, &window, excluded)?;
        }
    }
    Ok(())
}

/// Hides every ClickySketch window (the HUD overlays and the main window) from screen capture.
/// Used around a screenshot so the model sees the user's screen, not our own interface.
pub fn exclude_all_from_capture(app: &AppHandle, excluded: bool) {
    for (_, window) in app.webview_windows() {
        if let Err(error) = native::set_capture_exclusion(app, &window, excluded) {
            eprintln!("[clicky] {error}");
        }
    }
}

/// Puts capture exclusion back the way the tray setting wants it: the overlays follow the setting,
/// every other window is visible to capture again.
pub fn restore_capture_exclusion(app: &AppHandle, hub: &OverlayHub) {
    let keep = hub.capture_excluded.load(Ordering::SeqCst);
    for (label, window) in app.webview_windows() {
        let wanted = keep && index_from_label(&label).is_some();
        if let Err(error) = native::set_capture_exclusion(app, &window, wanted) {
            eprintln!("[clicky] {error}");
        }
    }
}

// ---------------------------------------------------------------------------------------------
// The poller: selective click-through, HUD following the cursor, display hot-plug
// ---------------------------------------------------------------------------------------------

pub fn start_poller(app: AppHandle, hub: Arc<OverlayHub>) {
    let spawned = thread::Builder::new()
        .name("clicky-overlay-poller".into())
        .spawn(move || poller_loop(&app, &hub));
    if let Err(error) = spawned {
        // The overlays then simply stay click-through: the desktop is never blocked.
        eprintln!("[clicky] could not start the overlay poller: {error}");
    }
}

fn poller_loop(app: &AppHandle, hub: &OverlayHub) {
    let mut last_housekeeping = Instant::now();
    let mut hud_candidate: Option<(usize, Instant)> = None;

    loop {
        thread::sleep(POLL_INTERVAL);

        if let Some(cursor) = native::cursor_position() {
            for (label, ignore) in hub.decide(cursor, native::mouse_button_down()) {
                apply_click_through(app, hub, &label, ignore);
            }
            follow_cursor_with_hud(app, hub, cursor, &mut hud_candidate);
        }

        if last_housekeeping.elapsed() >= HOUSEKEEPING_INTERVAL {
            last_housekeeping = Instant::now();
            if let Err(error) = housekeeping(app, hub) {
                eprintln!("[clicky] overlay housekeeping failed: {error}");
            }
        }
    }
}

fn apply_click_through(app: &AppHandle, hub: &OverlayHub, label: &str, ignore: bool) {
    let Some(window) = app.get_webview_window(label) else {
        hub.revert_ignoring(label, !ignore);
        return;
    };
    match native::set_click_through(app, &window, ignore) {
        Ok(()) => {
            // The page cannot observe hover itself while the window ignores the mouse, so it is told.
            if let Err(error) = app.emit_to(label, "overlay-pointer", PointerPayload { inside: !ignore }) {
                eprintln!("[clicky] could not send the pointer state to {label}: {error}");
            }
        }
        Err(error) => {
            eprintln!("[clicky] could not switch click-through for {label}: {error}");
            hub.revert_ignoring(label, !ignore);
        }
    }
}

/// Moves the Dynamic Island to the display the cursor has been resting on.
fn follow_cursor_with_hud(
    app: &AppHandle,
    hub: &OverlayHub,
    cursor: (f64, f64),
    candidate: &mut Option<(usize, Instant)>,
) {
    let Some(under) = hub.monitor_at(cursor) else {
        *candidate = None;
        return;
    };
    if under == hub.hud_monitor() {
        *candidate = None;
        return;
    }
    match *candidate {
        Some((index, since)) if index == under => {
            if since.elapsed() >= HUD_DWELL {
                hub.focus_hud(app, under);
                *candidate = None;
            }
        }
        _ => *candidate = Some((under, Instant::now())),
    }
}

/// Twice a second: notice displays being plugged in or out, keep every window glued to its display
/// (a DPI change can resize a window after we positioned it) and keep the native flags intact.
fn housekeeping(app: &AppHandle, hub: &OverlayHub) -> Result<(), OverlayError> {
    let Some(anchor) = app.get_webview_window(&label_for(0)) else {
        return Ok(());
    };
    let specs = read_monitors(&anchor)?;
    let known = hub.lock().specs.clone();
    if !specs.is_empty() && specs != known {
        return apply_layout(app, hub, specs);
    }

    let snapshot: Vec<(String, MonitorSpec, u8)> = hub
        .lock()
        .overlays
        .iter()
        .map(|overlay| (overlay.label.clone(), overlay.spec, overlay.fix_attempts))
        .collect();
    for (label, spec, previous_attempts) in snapshot {
        let Some(window) = app.get_webview_window(&label) else {
            continue;
        };
        let mut attempts = previous_attempts;
        let (mut frame, mut factor) = measure(&window)?;
        if frames_match(&frame, &expected_frame(&spec)) {
            attempts = 0;
        } else if attempts < MAX_FIX_ATTEMPTS {
            place(&window, &spec)?;
            attempts += 1;
            (frame, factor) = measure(&window)?;
        }
        native::maintain(app, &window);
        if let Some(overlay) = hub.lock().overlays.iter_mut().find(|overlay| overlay.label == label) {
            overlay.frame = frame;
            overlay.factor = factor;
            overlay.fix_attempts = attempts;
        }
    }
    Ok(())
}
