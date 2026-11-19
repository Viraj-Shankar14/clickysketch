import { useEffect, useState } from "react";
import { pipeline } from "../assistant/pipeline";
import { ChatPage } from "../components/chat/ChatPage";
import { PixelIcon } from "../components/retro/PixelIcon";
import { StatusBar, type StatusCell } from "../components/retro/StatusBar";
import { Tabs, type TabDef } from "../components/retro/Tabs";
import { ResizeHandles, TitleBar } from "../components/retro/TitleBar";
import { AboutPage } from "../components/settings/AboutPage";
import { SettingsPage } from "../components/settings/SettingsPage";
import { getHotkeyStatus, subscribe } from "../services/desktopBridge";
import { useAssistantStore, type MicState } from "../stores/assistantStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { PttEvent } from "../types/ipc";
import "./main-window.css";

type PageId = "chat" | "settings" | "about";

const TABS: ReadonlyArray<TabDef<PageId>> = [
  { id: "chat", label: "Chat", icon: "chat", accent: "blue" },
  { id: "settings", label: "Settings", icon: "gear", accent: "green" },
  { id: "about", label: "About", icon: "info", accent: "yellow" },
];

const MIC_CHIP: Record<MicState, { text: string; tone: string }> = {
  unknown: { text: "Mic not checked", tone: "is-warn" },
  granted: { text: "Mic ready", tone: "is-ok" },
  denied: { text: "Mic blocked", tone: "is-bad" },
  missing: { text: "No mic", tone: "is-bad" },
};

/** "google/gemma-4-26b-a4b-it:free" -> "gemma-4-26b-a4b-it (free)" */
export function shortModel(id: string): string {
  const name = id.includes("/") ? id.slice(id.indexOf("/") + 1) : id;
  return name.endsWith(":free") ? `${name.slice(0, -5)} (free)` : name;
}

function Chips({ hasKey, mic }: { hasKey: boolean; mic: MicState }) {
  const micChip = MIC_CHIP[mic];
  return (
    <div className="tabs__chips">
      <span className={hasKey ? "chip px px--sunken is-ok" : "chip px px--sunken is-warn"}>
        <PixelIcon name="key" size={16} />
        {hasKey ? "Key set" : "No API key"}
      </span>
      <span className={`chip px px--sunken ${micChip.tone}`}>
        <PixelIcon name="mic" size={16} />
        {micChip.text}
      </span>
    </div>
  );
}

export function MainApp() {
  const [page, setPage] = useState<PageId>("chat");
  const apiKey = useSettingsStore((state) => state.apiKey);
  const chatModel = useSettingsStore((state) => state.chatModel);
  const phase = useAssistantStore((state) => state.phase);
  const status = useAssistantStore((state) => state.status);
  const mic = useAssistantStore((state) => state.mic);
  const hotkey = useAssistantStore((state) => state.hotkey);

  // The global hotkey is detected in Rust; this window owns the microphone and the AI pipeline.
  useEffect(
    () =>
      subscribe<PttEvent>("ptt-state", (event) => {
        if (event.phase === "pressed") void pipeline.beginListening();
        else if (event.phase === "released") void pipeline.endListening();
        else pipeline.cancel();
      }),
    [],
  );

  useEffect(() => {
    let alive = true;
    getHotkeyStatus()
      .then((value) => {
        if (alive) useAssistantStore.getState().setHotkey(value);
      })
      .catch((error: unknown) => console.warn("[clicky] could not read the hotkey status", error));
    return () => {
      alive = false;
    };
  }, []);

  // Pick up a microphone permission that was granted in an earlier session.
  useEffect(() => {
    let status: PermissionStatus | null = null;
    const apply = (): void => {
      if (status === null) return;
      if (status.state === "granted") useAssistantStore.getState().setMic("granted");
      else if (status.state === "denied") useAssistantStore.getState().setMic("denied");
    };
    navigator.permissions
      ?.query({ name: "microphone" as unknown as PermissionName })
      .then((result) => {
        status = result;
        result.onchange = apply;
        apply();
      })
      .catch(() => undefined);
    return () => {
      if (status !== null) status.onchange = null;
    };
  }, []);

  const cells: StatusCell[] = [
    { text: status, grow: true, tone: phase === "error" ? "bad" : phase === "idle" ? undefined : "ok", icon: phase === "idle" ? undefined : "eye" },
    { text: shortModel(chatModel.trim() || "google/gemma-4-26b-a4b-it:free"), icon: "bot" },
    { text: hotkey ? `Hotkey: ${hotkey.chord}` : "Hotkey: starting", icon: "mic", tone: hotkey && !hotkey.ok ? "bad" : undefined },
  ];

  return (
    <div className="app">
      <ResizeHandles />
      <TitleBar title="ClickySketch" />
      <Tabs tabs={TABS} active={page} onChange={setPage} trailing={<Chips hasKey={apiKey.trim() !== ""} mic={mic} />} />
      <main className="main">
        {page === "chat" ? <ChatPage onOpenSettings={() => setPage("settings")} /> : null}
        {page === "settings" ? <SettingsPage /> : null}
        {page === "about" ? <AboutPage /> : null}
      </main>
      <StatusBar cells={cells} />
    </div>
  );
}
