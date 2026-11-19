/** Shapes exchanged with the Rust core and between windows. Names match serde(rename_all = "camelCase"). */

export type Platform = "windows" | "macos";

export interface HotkeyStatus {
  /** Human-readable name of the listener backend that is running. */
  backend: string;
  ok: boolean;
  /** macOS only: the preferred event tap needs Input Monitoring permission. */
  needsPermission: boolean;
  /** Display label of the push-to-talk chord, e.g. "Ctrl + Alt" or "Ctrl + Option". */
  chord: string;
  message: string;
}

export interface OverlayInfo {
  label: string;
  /** 0 is always the primary display. */
  index: number;
  isPrimary: boolean;
  monitorCount: number;
  /** Index of the display that currently hosts the Dynamic Island. */
  hudMonitor: number;
  scaleFactor: number;
  /** Physical pixel size of the display this overlay covers. */
  width: number;
  height: number;
  platform: Platform;
  outlines: boolean;
  hotkey: HotkeyStatus;
}

export type PttPhaseName = "pressed" | "released" | "cancelled";

export interface PttEvent {
  phase: PttPhaseName;
  monitor: number;
  atMs: number;
}

export interface HudMonitorEvent {
  monitor: number;
}

export interface PointerStateEvent {
  /** True while the cursor is over one of this window's interactive regions. */
  inside: boolean;
}

export interface OutlineEvent {
  outlines: boolean;
}

/** A rectangle in CSS pixels relative to the overlay viewport. */
export interface HitRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the assistant (running in the main window) is doing; the HUD in the overlays mirrors it. */
export type AssistantPhase = "idle" | "listening" | "thinking" | "speaking" | "error";

export interface AssistantStateEvent {
  phase: AssistantPhase;
  /** Subtitle: what is being said, or a short status line such as "Transcribing". */
  text?: string;
  /** True when a screenshot is part of this request (the HUD shows an eye). */
  screen?: boolean;
}

export interface AudioLevelEvent {
  /** Microphone loudness, 0..1. */
  level: number;
}

/** A frame returned by the native screen capture, before it is scaled and JPEG-encoded. */
export interface RawCapture {
  kind: "rgba" | "jpeg";
  width: number;
  height: number;
  data: Uint8Array;
}
