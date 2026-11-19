import { create } from "zustand";

export interface Settings {
  /** OpenRouter key (bring your own). Stored on this computer only. */
  apiKey: string;
  baseUrl: string;
  chatModel: string;
  sttModel: string;
  /** ISO code such as "en"; empty = detect automatically. */
  sttLanguage: string;
  /** Send a screenshot of the display under the mouse with every question. */
  useScreen: boolean;
  screenMaxWidth: number;
  speakReplies: boolean;
  /** SpeechSynthesisVoice.voiceURI; empty = the system default voice. */
  voiceUri: string;
  speechRate: number;
  /** How many earlier question/answer pairs travel with each request. */
  historyTurns: number;
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  baseUrl: "https://openrouter.ai/api/v1",
  chatModel: "google/gemma-4-26b-a4b-it:free",
  sttModel: "openai/whisper-large-v3-turbo",
  sttLanguage: "en",
  useScreen: true,
  screenMaxWidth: 1280,
  speakReplies: true,
  voiceUri: "",
  speechRate: 1.05,
  historyTurns: 4,
};

const STORAGE_KEY = "clickysketch.settings.v1";

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Accepts whatever is in storage and returns a complete, in-range Settings object. */
export function sanitizeSettings(input: unknown): Settings {
  const source = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const text = (key: "apiKey" | "baseUrl" | "chatModel" | "sttModel" | "sttLanguage" | "voiceUri"): string => {
    const value = source[key];
    return typeof value === "string" ? value : DEFAULT_SETTINGS[key];
  };
  const flag = (key: "useScreen" | "speakReplies"): boolean => {
    const value = source[key];
    return typeof value === "boolean" ? value : DEFAULT_SETTINGS[key];
  };
  const number = (key: "screenMaxWidth" | "speechRate" | "historyTurns", min: number, max: number): number => {
    const value = source[key];
    return typeof value === "number" && Number.isFinite(value) ? clamp(value, min, max) : DEFAULT_SETTINGS[key];
  };
  return {
    apiKey: text("apiKey").trim(),
    baseUrl: text("baseUrl"),
    chatModel: text("chatModel"),
    sttModel: text("sttModel"),
    sttLanguage: text("sttLanguage"),
    useScreen: flag("useScreen"),
    screenMaxWidth: number("screenMaxWidth", 640, 2048),
    speakReplies: flag("speakReplies"),
    voiceUri: text("voiceUri"),
    speechRate: number("speechRate", 0.6, 1.6),
    historyTurns: number("historyTurns", 0, 10),
  };
}

function readStorage(): Settings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === null ? { ...DEFAULT_SETTINGS } : sanitizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeStorage(settings: Settings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage may be unavailable (private mode); settings then last for this session only.
  }
}

function pick(state: Settings): Settings {
  return {
    apiKey: state.apiKey,
    baseUrl: state.baseUrl,
    chatModel: state.chatModel,
    sttModel: state.sttModel,
    sttLanguage: state.sttLanguage,
    useScreen: state.useScreen,
    screenMaxWidth: state.screenMaxWidth,
    speakReplies: state.speakReplies,
    voiceUri: state.voiceUri,
    speechRate: state.speechRate,
    historyTurns: state.historyTurns,
  };
}

interface SettingsState extends Settings {
  update: (patch: Partial<Settings>) => void;
}

/**
 * Text fields are stored exactly as typed (an empty model box must be allowed while you retype it);
 * the pipeline falls back to DEFAULT_SETTINGS at the moment of use.
 */
export const useSettingsStore = create<SettingsState>()((set, get) => ({
  ...readStorage(),
  update: (patch) => {
    const merged: Settings = { ...pick(get()), ...patch };
    merged.screenMaxWidth = clamp(merged.screenMaxWidth, 640, 2048);
    merged.speechRate = clamp(merged.speechRate, 0.6, 1.6);
    merged.historyTurns = clamp(Math.round(merged.historyTurns), 0, 10);
    writeStorage(merged);
    set(merged);
  },
}));
