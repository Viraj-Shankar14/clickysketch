import { create } from "zustand";
import type { AssistantPhase, AssistantStateEvent, HotkeyStatus } from "../types/ipc";

/**
 * What the HUD shows. In the overlay windows this store is fed purely by events: the hotkey
 * (for instant feedback) and `assistant-state` / `audio-level` from the main window.
 */
interface VoiceState {
  phase: AssistantPhase;
  /** Subtitle or status line. */
  text: string;
  /** A screenshot is part of the current request. */
  screen: boolean;
  /** Microphone loudness 0..1. */
  level: number;
  /** True while the cursor is over one of this window's interactive regions (reported by Rust). */
  pointerInside: boolean;
  /** Index of the display that currently shows the HUD. */
  hudMonitor: number;
  hotkey: HotkeyStatus | null;
  /** The current phase came from the hotkey alone and has not been confirmed by the main window yet. */
  optimistic: boolean;
  applyAssistant: (event: AssistantStateEvent) => void;
  pressed: () => void;
  released: () => void;
  reset: () => void;
  setLevel: (level: number) => void;
  setPointerInside: (inside: boolean) => void;
  setHudMonitor: (monitor: number) => void;
  setHotkey: (hotkey: HotkeyStatus) => void;
}

export const useVoiceStore = create<VoiceState>()((set, get) => ({
  phase: "idle",
  text: "",
  screen: false,
  level: 0,
  pointerInside: false,
  hudMonitor: 0,
  hotkey: null,
  optimistic: false,
  applyAssistant: (event) =>
    set({
      phase: event.phase,
      text: event.text ?? "",
      screen: event.screen ?? false,
      optimistic: false,
      ...(event.phase === "listening" ? {} : { level: 0 }),
    }),
  pressed: () => set({ phase: "listening", text: "", screen: false, optimistic: true }),
  released: () => {
    if (get().phase === "listening") set({ phase: "thinking", text: "", optimistic: true, level: 0 });
  },
  reset: () => set({ phase: "idle", text: "", screen: false, level: 0, optimistic: false }),
  setLevel: (level) => set({ level }),
  setPointerInside: (pointerInside) => set({ pointerInside }),
  setHudMonitor: (hudMonitor) => set({ hudMonitor }),
  setHotkey: (hotkey) => set({ hotkey }),
}));
