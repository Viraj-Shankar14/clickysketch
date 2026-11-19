import { create } from "zustand";
import type { AssistantPhase, HotkeyStatus } from "../types/ipc";

export type MicState = "unknown" | "granted" | "denied" | "missing";

export interface ChatItem {
  id: string;
  /** "note" is a system line (errors, tips) shown in the transcript but never sent to the model. */
  role: "user" | "assistant" | "note";
  text: string;
  at: number;
  pending?: boolean;
  error?: boolean;
  via?: "voice" | "text";
  /** data: URL of the screenshot that went with this question. */
  screenshot?: string;
}

const STATUS_TEXT: Record<AssistantPhase, string> = {
  idle: "Ready",
  listening: "Listening...",
  thinking: "Thinking...",
  speaking: "Answering...",
  error: "Something went wrong",
};

interface AssistantState {
  phase: AssistantPhase;
  status: string;
  /** Microphone loudness 0..1 while recording. */
  level: number;
  mic: MicState;
  hotkey: HotkeyStatus | null;
  items: ChatItem[];
  setHotkey: (hotkey: HotkeyStatus) => void;
  setPhase: (phase: AssistantPhase, status?: string) => void;
  setLevel: (level: number) => void;
  setMic: (mic: MicState) => void;
  addItem: (item: Omit<ChatItem, "id" | "at">) => string;
  patchItem: (id: string, patch: Partial<Omit<ChatItem, "id">>) => void;
  removeItem: (id: string) => void;
  clearItems: () => void;
}

let counter = 0;
const MAX_ITEMS = 200;

export const useAssistantStore = create<AssistantState>()((set) => ({
  phase: "idle",
  status: STATUS_TEXT.idle,
  level: 0,
  mic: "unknown",
  hotkey: null,
  items: [],
  setHotkey: (hotkey) => set({ hotkey }),
  setPhase: (phase, status) => set({ phase, status: status && status.trim() !== "" ? status : STATUS_TEXT[phase] }),
  setLevel: (level) => set({ level }),
  setMic: (mic) => set({ mic }),
  addItem: (item) => {
    counter += 1;
    const id = `m${counter}`;
    set((state) => ({ items: [...state.items, { ...item, id, at: Date.now() }].slice(-MAX_ITEMS) }));
    return id;
  },
  patchItem: (id, patch) =>
    set((state) => ({ items: state.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) })),
  removeItem: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
  clearItems: () => set({ items: [] }),
}));
