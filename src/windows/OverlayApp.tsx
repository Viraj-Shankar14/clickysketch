import { useCallback, useEffect, useState } from "react";
import { OverlayOutline } from "../components/debug/OverlayOutline";
import { DynamicIsland } from "../components/notch/DynamicIsland";
import { useHitRegions } from "../hooks/useHitRegions";
import { getOverlayInfo, isTauri, subscribe } from "../services/desktopBridge";
import { useVoiceStore } from "../stores/voiceStore";
import type {
  AssistantStateEvent,
  AudioLevelEvent,
  HotkeyStatus,
  HudMonitorEvent,
  OutlineEvent,
  OverlayInfo,
  PointerStateEvent,
  PttEvent,
} from "../types/ipc";

/** A hotkey press the main window never confirms (it is closed or still starting) must not leave the HUD stuck. */
const UNCONFIRMED_TIMEOUT_MS = 6000;

/**
 * Browser-only stand-in for the native layer, so the HUD can be tuned with plain `npm run dev`:
 * hold Ctrl + Alt to "talk" and hover the pill to peek. Inside Tauri this does nothing.
 */
function useBrowserDemo(): void {
  useEffect(() => {
    if (isTauri()) return undefined;
    const store = useVoiceStore.getState();
    let frame = 0;
    const animate = (now: number): void => {
      store.setLevel(Math.min(1, Math.max(0, 0.5 + 0.28 * Math.sin(now / 370) + 0.18 * Math.sin(now / 163 + 1.3))));
      frame = requestAnimationFrame(animate);
    };
    const onKey = (event: KeyboardEvent): void => {
      const talking = event.ctrlKey && event.altKey;
      if (talking && useVoiceStore.getState().phase !== "listening") {
        store.pressed();
        frame = requestAnimationFrame(animate);
      } else if (!talking && useVoiceStore.getState().phase === "listening") {
        cancelAnimationFrame(frame);
        store.reset();
      }
    };
    const onMove = (event: PointerEvent): void => {
      const target = event.target;
      store.setPointerInside(target instanceof Element && target.closest("[data-hit]") !== null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("pointermove", onMove);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);
}

export function OverlayApp() {
  const [info, setInfo] = useState<OverlayInfo | null>(null);
  const [outlines, setOutlines] = useState(false);
  const hudMonitor = useVoiceStore((state) => state.hudMonitor);
  const phase = useVoiceStore((state) => state.phase);
  const optimistic = useVoiceStore((state) => state.optimistic);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await getOverlayInfo();
      const store = useVoiceStore.getState();
      store.setHudMonitor(next.hudMonitor);
      store.setHotkey(next.hotkey);
      setOutlines(next.outlines);
      setInfo(next);
    } catch (error) {
      console.error("[clicky] could not load overlay info", error);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const unsubscribers = [
      subscribe<PttEvent>("ptt-state", (event) => {
        const store = useVoiceStore.getState();
        if (event.phase === "pressed") {
          store.setHudMonitor(event.monitor);
          store.pressed();
        } else if (event.phase === "released") {
          store.released();
        } else {
          store.reset();
        }
      }),
      subscribe<AssistantStateEvent>("assistant-state", (event) => useVoiceStore.getState().applyAssistant(event)),
      subscribe<AudioLevelEvent>("audio-level", (event) => useVoiceStore.getState().setLevel(event.level)),
      subscribe<HudMonitorEvent>("hud-monitor", (event) => useVoiceStore.getState().setHudMonitor(event.monitor)),
      subscribe<PointerStateEvent>("overlay-pointer", (event) => useVoiceStore.getState().setPointerInside(event.inside)),
      subscribe<HotkeyStatus>("hotkey-status", (status) => useVoiceStore.getState().setHotkey(status)),
      subscribe<OutlineEvent>("overlay-debug", (event) => setOutlines(event.outlines)),
      subscribe<unknown>("overlay-layout", () => {
        void refresh();
      }),
    ];
    return () => unsubscribers.forEach((stop) => stop());
  }, [refresh]);

  // Watchdog: forget a hotkey-only phase the main window never took over.
  useEffect(() => {
    if (!optimistic || phase === "idle") return undefined;
    const timer = window.setTimeout(() => useVoiceStore.getState().reset(), UNCONFIRMED_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [optimistic, phase]);

  useHitRegions();
  useBrowserDemo();

  if (info === null) return null;

  return (
    <div className="overlay-root">
      {outlines ? <OverlayOutline info={info} /> : null}
      {hudMonitor === info.index ? <DynamicIsland /> : null}
    </div>
  );
}
