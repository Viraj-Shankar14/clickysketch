/**
 * Typed bridge to the Rust core and to the other windows.
 *
 * Outside Tauri (plain `npm run dev` in a browser) every call degrades to a harmless demo, and
 * events travel over an in-page bus, so both UIs can still be iterated on with `?view=main` and
 * `?view=overlay`.
 */
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { HitRegion, HotkeyStatus, OverlayInfo, RawCapture } from "../types/ipc";

export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type WindowKind = "main" | "overlay";

/** Which UI this webview renders: the main app window, or one of the per-display overlays. */
export function windowKind(): WindowKind {
  if (isTauri()) {
    return getCurrentWindow().label === "main" ? "main" : "overlay";
  }
  return new URLSearchParams(window.location.search).get("view") === "overlay" ? "overlay" : "main";
}

const demoBus = new EventTarget();

const DEMO_INFO: OverlayInfo = {
  label: "overlay-0",
  index: 0,
  isPrimary: true,
  monitorCount: 1,
  hudMonitor: 0,
  scaleFactor: 1,
  width: 1920,
  height: 1080,
  platform: "windows",
  outlines: false,
  hotkey: {
    backend: "browser demo",
    ok: true,
    needsPermission: false,
    chord: "Ctrl + Alt",
    message: "Hold Ctrl + Alt to talk",
  },
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The overlay is registered natively a moment before its page finishes loading; retry briefly. */
export async function getOverlayInfo(): Promise<OverlayInfo> {
  if (!isTauri()) return DEMO_INFO;
  let lastError: unknown = new Error("overlay_get_info was never attempted");
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await invoke<OverlayInfo>("overlay_get_info");
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** State of the push-to-talk listener (which backend runs, and whether it needs a permission). */
export async function getHotkeyStatus(): Promise<HotkeyStatus> {
  if (!isTauri()) return DEMO_INFO.hotkey;
  return invoke<HotkeyStatus>("hotkey_get_status");
}

/** Tells the native layer which rectangles (CSS px) must receive the mouse. Everything else is click-through. */
export async function setHitRegions(regions: HitRegion[]): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("overlay_set_regions", { regions });
  } catch (error) {
    console.warn("[clicky] overlay_set_regions failed", error);
  }
}

/** Subscribes to an event. Returns a synchronous unsubscribe function (safe under React StrictMode). */
export function subscribe<T>(event: string, handler: (payload: T) => void): () => void {
  if (!isTauri()) {
    const listener = (message: Event): void => handler((message as CustomEvent<T>).detail);
    demoBus.addEventListener(event, listener);
    return () => demoBus.removeEventListener(event, listener);
  }
  let disposed = false;
  let unlisten: (() => void) | null = null;
  listen<T>(event, (message) => handler(message.payload))
    .then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    })
    .catch((error: unknown) => console.warn(`[clicky] could not listen to "${event}"`, error));
  return () => {
    disposed = true;
    if (unlisten) unlisten();
    unlisten = null;
  };
}

/** Broadcasts an event to every window (the main window tells the overlays what the assistant is doing). */
export async function emitEvent(event: string, payload: unknown): Promise<void> {
  if (!isTauri()) {
    demoBus.dispatchEvent(new CustomEvent(event, { detail: payload }));
    return;
  }
  try {
    await emit(event, payload);
  } catch (error) {
    console.warn(`[clicky] could not emit "${event}"`, error);
  }
}

export async function openMainWindow(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("open_main_window");
  } catch (error) {
    console.warn("[clicky] open_main_window failed", error);
  }
}

export async function openExternal(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, "_blank", "noopener");
    return;
  }
  try {
    await openUrl(url);
  } catch (error) {
    console.warn("[clicky] could not open the link", error);
  }
}

export type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

async function withWindow(action: (win: ReturnType<typeof getCurrentWindow>) => Promise<unknown>): Promise<void> {
  if (!isTauri()) return;
  try {
    await action(getCurrentWindow());
  } catch (error) {
    console.warn("[clicky] window action failed", error);
  }
}

/** The main window has no native title bar, so its own controls drive the window. */
export const windowControls = {
  minimize: (): Promise<void> => withWindow((win) => win.minimize()),
  toggleMaximize: (): Promise<void> => withWindow((win) => win.toggleMaximize()),
  /** Close hides to the tray; the assistant keeps listening for the hotkey. */
  hide: (): Promise<void> => withWindow((win) => win.hide()),
  startDragging: (): Promise<void> => withWindow((win) => win.startDragging()),
  startResizeDragging: (direction: ResizeDirection): Promise<void> =>
    withWindow((win) => win.startResizeDragging(direction)),
};

/**
 * Native screen capture of the display under the mouse, with all ClickySketch windows hidden from it.
 * Wire format: [format u8: 0 = RGBA, 1 = JPEG][width u32 LE][height u32 LE][payload].
 */
export async function captureScreenRaw(maxWidth: number): Promise<RawCapture> {
  if (!isTauri()) return demoCapture();
  const buffer = await invoke<ArrayBuffer>("capture_screen", { maxWidth });
  const view = new DataView(buffer);
  const kind = view.getUint8(0) === 1 ? "jpeg" : "rgba";
  return {
    kind,
    width: view.getUint32(1, true),
    height: view.getUint32(5, true),
    data: new Uint8Array(buffer, 9),
  };
}

/** A synthetic gradient so the screenshot path can be exercised in a browser. */
function demoCapture(): RawCapture {
  const width = 640;
  const height = 360;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data[i] = (x * 255) / width;
      data[i + 1] = (y * 255) / height;
      data[i + 2] = 200;
      data[i + 3] = 255;
    }
  }
  return { kind: "rgba", width, height, data };
}
