/**
 * The assistant, start to finish. Runs in the main window and drives the HUD in the overlays by
 * broadcasting `assistant-state` and `audio-level` events.
 *
 *   hold the hotkey -> record the microphone -> release
 *     -> [ transcribe the audio | grab a screenshot ]   (in parallel)
 *     -> stream the model's answer -> speak it sentence by sentence as it arrives
 *
 * Every step is cancellable: pressing the hotkey again interrupts whatever is still going on.
 */
import { ApiError } from "../ai/errors";
import { sleep } from "../ai/http";
import { streamChat, type ChatMessage } from "../ai/openrouter";
import { transcribeAudio } from "../ai/stt";
import { describeMicError, MicRecorder, probeMicrophone, type Recording } from "../audio/recorder";
import { Speaker, takeSentences } from "../audio/speech";
import { bytesToBase64, encodeWav } from "../audio/wav";
import { captureScreenShot, type ScreenShot } from "../screen/capture";
import { emitEvent, openMainWindow } from "../services/desktopBridge";
import { useAssistantStore, type ChatItem } from "../stores/assistantStore";
import { DEFAULT_SETTINGS, useSettingsStore } from "../stores/settingsStore";
import type { AssistantStateEvent } from "../types/ipc";
import { SYSTEM_PROMPT } from "./prompts";

const MIN_RECORDING_MS = 350;
const MIN_PEAK = 0.015;
const SUBTITLE_INTERVAL_MS = 90;
const ERROR_LINGER_MS = 5000;

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === "string" ? error : "unknown error";

/** The last few finished question/answer pairs, text only (old screenshots are never re-sent). */
export function buildHistory(items: readonly ChatItem[], turns: number): ChatMessage[] {
  if (turns <= 0) return [];
  const usable = items.filter(
    (item): item is ChatItem & { role: "user" | "assistant" } =>
      (item.role === "user" || item.role === "assistant") && item.pending !== true && item.error !== true && item.text.trim() !== "",
  );
  return usable.slice(-turns * 2).map((item) => ({ role: item.role, content: item.text }));
}

class Pipeline {
  private readonly recorder = new MicRecorder();
  private readonly speaker = new Speaker();
  private controller: AbortController | null = null;
  private listening = false;
  private generation = 0;
  private idleTimer: number | null = null;
  private subtitleTimer: number | null = null;
  private subtitleLatest: { text: string; screen: boolean } | null = null;

  /** Push-to-talk went down (hotkey or the on-screen button): start recording. */
  async beginListening(): Promise<void> {
    if (this.listening) return;
    this.interrupt();
    const settings = useSettingsStore.getState();
    if (settings.apiKey.trim() === "") {
      this.fail("Add your OpenRouter API key in Settings first, then try again.", true);
      return;
    }
    const generation = this.generation;
    this.listening = true;
    this.publish({ phase: "listening" });
    try {
      await this.recorder.start((level) => this.onLevel(level));
      if (generation === this.generation) useAssistantStore.getState().setMic("granted");
    } catch (error) {
      if (generation !== this.generation) return;
      this.listening = false;
      const name = error instanceof DOMException ? error.name : "";
      useAssistantStore.getState().setMic(name === "NotFoundError" ? "missing" : "denied");
      this.fail(describeMicError(error), true);
    }
  }

  /** Push-to-talk came up: finish recording and answer. */
  async endListening(): Promise<void> {
    if (!this.listening) return;
    this.listening = false;
    const generation = this.generation;
    const settings = useSettingsStore.getState();

    let recording: Recording;
    try {
      recording = await this.recorder.stop();
    } catch (error) {
      this.fail(describeMicError(error), false);
      return;
    }
    this.onLevel(0);
    if (generation !== this.generation) return;

    if (recording.durationMs < MIN_RECORDING_MS || recording.peak < MIN_PEAK) {
      this.publish({ phase: "idle" });
      this.note("I didn't hear anything. Hold the keys down while you talk, then let go.");
      return;
    }

    const controller = new AbortController();
    this.controller = controller;
    this.publish({ phase: "thinking", text: "Listening to you...", screen: settings.useScreen });
    try {
      const wav = bytesToBase64(encodeWav(recording.samples, recording.sampleRate));
      // The screenshot is taken while the audio is being transcribed, so it adds no waiting time.
      const shotPromise = settings.useScreen ? this.takeScreenshot(settings.screenMaxWidth) : Promise.resolve(null);
      const transcript = await transcribeAudio({
        baseUrl: settings.baseUrl.trim() || DEFAULT_SETTINGS.baseUrl,
        apiKey: settings.apiKey.trim(),
        model: settings.sttModel.trim() || DEFAULT_SETTINGS.sttModel,
        wavBase64: wav,
        language: settings.sttLanguage.trim(),
        signal: controller.signal,
      });
      if (generation !== this.generation) return;
      if (transcript.trim() === "") {
        this.publish({ phase: "idle" });
        this.note("I couldn't make out any words. Try again a little closer to the microphone.");
        return;
      }
      const shot = await shotPromise;
      if (generation !== this.generation) return;
      await this.respond(transcript.trim(), shot, "voice", controller.signal, generation);
    } catch (error) {
      this.handleFailure(error, generation);
    }
  }

  /** A typed question from the chat box. */
  async ask(text: string): Promise<void> {
    const question = text.trim();
    if (question === "") return;
    this.interrupt();
    const settings = useSettingsStore.getState();
    if (settings.apiKey.trim() === "") {
      this.fail("Add your OpenRouter API key in Settings first, then try again.", false);
      return;
    }
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.publish({ phase: "thinking", text: "Thinking...", screen: settings.useScreen });
    try {
      const shot = settings.useScreen ? await this.takeScreenshot(settings.screenMaxWidth) : null;
      if (generation !== this.generation) return;
      await this.respond(question, shot, "text", controller.signal, generation);
    } catch (error) {
      this.handleFailure(error, generation);
    }
  }

  /** The hotkey was pressed together with another key: it was a different shortcut. */
  cancel(): void {
    this.interrupt();
    this.onLevel(0);
    this.publish({ phase: "idle" });
  }

  /** Opens and closes the microphone to trigger the permission prompt (the Settings and welcome buttons). */
  async testMicrophone(): Promise<void> {
    const result = await probeMicrophone();
    useAssistantStore.getState().setMic(result === "granted" ? "granted" : result === "missing" ? "missing" : "denied");
  }

  private async respond(
    userText: string,
    shot: ScreenShot | null,
    via: "voice" | "text",
    signal: AbortSignal,
    generation: number,
  ): Promise<void> {
    const settings = useSettingsStore.getState();
    const store = useAssistantStore.getState();
    const history = buildHistory(store.items, settings.historyTurns);
    const hasScreen = shot !== null;
    store.addItem({ role: "user", text: userText, via, ...(shot ? { screenshot: shot.dataUrl } : {}) });
    const replyId = store.addItem({ role: "assistant", text: "", pending: true });
    this.publish({ phase: "thinking", text: "Thinking...", screen: hasScreen });

    const messagesFor = (withImage: boolean): ChatMessage[] => [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      {
        role: "user",
        content:
          withImage && shot
            ? [
                { type: "text", text: userText },
                { type: "image_url", image_url: { url: shot.dataUrl } },
              ]
            : userText,
      },
    ];

    const speakAloud = settings.speakReplies && this.speaker.supported;
    let reply = "";
    let spokenUpTo = 0;
    const speakNew = (final: boolean): void => {
      const { sentences, rest } = takeSentences(reply.slice(spokenUpTo), final);
      spokenUpTo = reply.length - rest.length;
      for (const sentence of sentences) {
        this.speaker.speak(sentence, { voiceUri: settings.voiceUri, rate: settings.speechRate });
      }
    };
    const onDelta = (delta: string): void => {
      if (generation !== this.generation) return;
      reply += delta;
      useAssistantStore.getState().patchItem(replyId, { text: reply });
      this.queueSubtitle(reply.slice(-220), hasScreen);
      if (speakAloud) speakNew(false);
    };
    const run = (withImage: boolean): Promise<unknown> =>
      streamChat({
        baseUrl: settings.baseUrl.trim() || DEFAULT_SETTINGS.baseUrl,
        apiKey: settings.apiKey.trim(),
        model: settings.chatModel.trim() || DEFAULT_SETTINGS.chatModel,
        messages: messagesFor(withImage),
        signal,
        onDelta,
      });

    try {
      try {
        await run(true);
      } catch (error) {
        const imageRejected = error instanceof ApiError && error.kind === "image" && hasScreen && reply === "";
        if (!imageRejected) throw error;
        this.note("This model can't take screenshots, so I answered without looking at your screen.");
        await run(false);
      }
    } catch (error) {
      if (generation === this.generation) {
        if (reply === "") useAssistantStore.getState().removeItem(replyId);
        else useAssistantStore.getState().patchItem(replyId, { pending: false });
      }
      throw error;
    }
    if (generation !== this.generation) return;

    const finalText = reply.trim();
    if (finalText === "") {
      useAssistantStore.getState().removeItem(replyId);
      this.publish({ phase: "idle" });
      this.note("The model sent back an empty answer. Try asking again.");
      return;
    }
    useAssistantStore.getState().patchItem(replyId, { pending: false, text: finalText });
    if (speakAloud) {
      speakNew(true);
      await this.speaker.whenIdle();
    } else {
      await sleep(Math.min(7000, 1500 + finalText.length * 30), signal);
    }
    if (generation === this.generation) this.publish({ phase: "idle" });
  }

  private async takeScreenshot(maxWidth: number): Promise<ScreenShot | null> {
    try {
      return await captureScreenShot(maxWidth);
    } catch (error) {
      this.note(`I couldn't capture your screen (${describe(error)}). I'll answer without it.`);
      return null;
    }
  }

  /** Stops everything in flight and invalidates any async step that is still running. */
  private interrupt(): void {
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
    this.speaker.cancel();
    this.recorder.cancel();
    this.listening = false;
    if (this.idleTimer !== null) window.clearTimeout(this.idleTimer);
    if (this.subtitleTimer !== null) window.clearTimeout(this.subtitleTimer);
    this.idleTimer = null;
    this.subtitleTimer = null;
    this.subtitleLatest = null;
  }

  private handleFailure(error: unknown, generation: number): void {
    if (generation !== this.generation) return;
    if (error instanceof ApiError && error.kind === "aborted") return;
    const needsAttention = error instanceof ApiError && (error.kind === "auth" || error.kind === "credits");
    const message = error instanceof ApiError ? error.message : `Something went wrong: ${describe(error)}`;
    this.fail(message, needsAttention);
  }

  private fail(message: string, openWindow: boolean): void {
    useAssistantStore.getState().addItem({ role: "note", text: message, error: true });
    this.publish({ phase: "error", text: message });
    if (openWindow) void openMainWindow();
    const generation = this.generation;
    if (this.idleTimer !== null) window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      if (generation === this.generation) this.publish({ phase: "idle" });
    }, ERROR_LINGER_MS);
  }

  private note(text: string): void {
    useAssistantStore.getState().addItem({ role: "note", text });
  }

  private onLevel(level: number): void {
    useAssistantStore.getState().setLevel(level);
    void emitEvent("audio-level", { level });
  }

  private publish(state: AssistantStateEvent): void {
    // The status bar wants a short phrase; the long subtitle and error text live in the HUD and the chat.
    useAssistantStore.getState().setPhase(state.phase, state.phase === "speaking" || state.phase === "error" ? undefined : state.text);
    void emitEvent("assistant-state", state);
  }

  /** Subtitles stream in token by token; send them to the HUD at a calm pace. */
  private queueSubtitle(text: string, screen: boolean): void {
    this.subtitleLatest = { text, screen };
    if (this.subtitleTimer !== null) return;
    this.subtitleTimer = window.setTimeout(() => {
      this.subtitleTimer = null;
      const latest = this.subtitleLatest;
      if (latest) this.publish({ phase: "speaking", text: latest.text, screen: latest.screen });
    }, SUBTITLE_INTERVAL_MS);
  }
}

export const pipeline = new Pipeline();
