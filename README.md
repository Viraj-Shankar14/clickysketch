# ClickySketch

A screen-aware AI tutor you talk to. Hold a key anywhere, ask a question out loud, and it looks at
your screen, answers, and speaks the answer back. Windows and macOS, built with Tauri v2, React 18
and strict TypeScript. The look is "Pixel Windows": Windows 95 structure, a pixel-art skin and glass
buttons (see `docs/DESIGN_ANALYSIS.md`).

**Status: Milestone 2 of 5.** Voice in, AI out, real main window. Next: the annotation canvas (3).

## Run it

Prerequisites (once): Node.js 20+, Rust (stable), and the C++ build tools (Windows: Visual Studio
2022 Build Tools with "Desktop development with C++"; macOS: `xcode-select --install`).

```bash
npm install                      # downloads the Pixelify Sans font through npm, nothing else
cd src-tauri && cargo check      # optional: compile the Rust side on its own first
cd .. && npm run tauri dev
```

Quit from the tray icon. Closing the main window only hides it; the hotkey keeps working.

## First use (about two minutes)

1. **Get an OpenRouter key** at https://openrouter.ai/keys and paste it in Settings, AI.
2. **Add a few dollars of credit** at https://openrouter.ai/credits. Your answers come from the free
   Gemma 4 model, but voice transcription (Whisper) is billed per second of audio: about 0.0015 cents
   for a 5 second question. A one-time $10 also lifts the free-model limit from 50 to 1,000 requests a day.
3. Click **Test connection**, then **Allow microphone** on the Chat page.
4. Hold **Ctrl + Alt** (Ctrl + Option on macOS), ask, and let go.

Typing works without any credit: type a question in the chat box.

## What happens when you let go of the keys

```
hold keys -> microphone opens, HUD shows a live waveform
let go    -> [ upload audio for transcription | grab a screenshot ]   (in parallel)
          -> the question and screenshot go to the model, the answer streams back
          -> the HUD shows subtitles and the answer is read aloud sentence by sentence
```

Pressing the keys again at any point interrupts whatever is still going on.

## Where things are

```
src/windows/          MainApp (the window you read) and OverlayApp (the HUD, one per display)
src/assistant/        pipeline.ts: the whole hold-ask-answer flow, prompts.ts: the tutor's personality
src/audio/            recorder (16 kHz mono + level meter), wav, speech (spoken replies)
src/ai/               OpenRouter streaming chat, Whisper transcription, friendly error messages
src/components/retro/ pixel UI kit: buttons, fields, tabs, panels, title bar, 19 original pixel icons
src-tauri/src/        overlay/ (click-through windows), hotkey/ (push-to-talk), capture/ (screenshots)
```

## Privacy

- The API key is stored on this computer (webview local storage) and only ever sent to OpenRouter.
- With "Look at my screen" on, one screenshot of the display under your mouse is sent with each
  question; ClickySketch's own windows are hidden from it. **Free models may log what they receive**, so
  switch it off (Chat page checkbox) when something private is on screen.
- Nothing is sent while you are not holding the hotkey or sending a typed question.

## Troubleshooting

- **"The free model is rate limited"**: free models allow 20 requests a minute and 50 a day on a new
  account. Wait, or buy $10 of credit once for 1,000 a day.
- **"No credits" / voice fails but typing works**: transcription needs a small balance.
- **Microphone blocked**: Windows Settings, Privacy & security, Microphone, allow desktop apps.
- **The answer is not spoken**: Settings, Voice, pick a voice (it needs a system speech voice).
- **macOS**: allow Screen Recording and Microphone when asked; for the lowest-latency hotkey enable
  Input Monitoring from the tray menu.
- **Windows: the hotkey ignores elevated ("Administrator") windows** unless ClickySketch is elevated too.
- If `cargo check` fails, send the first `error[...]` block with its file and line.

## Roadmap

1. Foundation, overlay, push-to-talk, HUD
2. **Voice, AI, main window, pixel UI** *(this milestone)*
3. Screen annotation canvas (Rough.js), pointing at things, onboarding tour
4. Three.js 3D stage with dynamic callouts
5. Task drawer, Google sync, full settings hub, MSI/DMG installers, optional Cloudflare Worker proxy
