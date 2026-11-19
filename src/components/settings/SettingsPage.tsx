import { useRef, useState } from "react";
import { checkKey } from "../../ai/openrouter";
import { ApiError } from "../../ai/errors";
import { pipeline } from "../../assistant/pipeline";
import { openExternal } from "../../services/desktopBridge";
import { useAssistantStore } from "../../stores/assistantStore";
import { DEFAULT_SETTINGS, useSettingsStore } from "../../stores/settingsStore";
import { Button } from "../retro/Button";
import { Checkbox, SelectField, Slider, TextField } from "../retro/Fields";
import { Chord } from "../retro/Keycap";
import { Panel } from "../retro/Panel";
import { PixelIcon } from "../retro/PixelIcon";
import { useVoices } from "./useVoices";

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "", label: "Detect automatically" },
];

interface Outcome {
  ok: boolean;
  text: string;
}

function Link({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        void openExternal(href);
      }}
    >
      {children}
    </a>
  );
}

const MIC_TEXT = {
  unknown: "Not checked yet",
  granted: "Allowed",
  denied: "Blocked. Turn it on in Windows Settings, Privacy, Microphone.",
  missing: "No microphone found",
} as const;

export function SettingsPage() {
  const settings = useSettingsStore();
  const mic = useAssistantStore((state) => state.mic);
  const hotkey = useAssistantStore((state) => state.hotkey);
  const voices = useVoices();
  const [showKey, setShowKey] = useState(false);
  const [checking, setChecking] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const controller = useRef<AbortController | null>(null);

  const testConnection = async (): Promise<void> => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setChecking(true);
    setOutcome(null);
    try {
      const info = await checkKey(settings.baseUrl.trim() || DEFAULT_SETTINGS.baseUrl, settings.apiKey.trim(), abort.signal);
      const tier = info.isFreeTier === null ? "" : info.isFreeTier ? " Free tier: you have not bought credits yet (50 free requests a day)." : " Credits found: the free-model limit is 1,000 requests a day.";
      setOutcome({ ok: true, text: `Key works.${tier}` });
    } catch (error) {
      setOutcome({ ok: false, text: error instanceof ApiError ? error.message : "That didn't work. Check the key and your connection." });
    } finally {
      setChecking(false);
    }
  };

  const voiceOptions = [
    { value: "", label: "System default" },
    ...voices.map((voice) => ({ value: voice.voiceURI, label: `${voice.name} (${voice.lang})` })),
  ];

  return (
    <div className="page">
      <div className="settings">
        <Panel title="AI" accent="blue">
          <div className="panel__row">
            <label htmlFor="api-key">OpenRouter key</label>
            <div className="settings__inline">
              <TextField
                id="api-key"
                mono
                type={showKey ? "text" : "password"}
                value={settings.apiKey}
                onChange={(value) => settings.update({ apiKey: value.trim() })}
                placeholder="sk-or-v1-..."
              />
              <Button small onClick={() => setShowKey(!showKey)}>
                {showKey ? "Hide" : "Show"}
              </Button>
            </div>
          </div>
          <p className="panel__hint">
            No key yet? <Link href="https://openrouter.ai/keys">Create one</Link>. It stays on this computer and is only sent to OpenRouter.
          </p>
          <div className="panel__row">
            <label htmlFor="chat-model">Answer model</label>
            <TextField id="chat-model" mono value={settings.chatModel} onChange={(value) => settings.update({ chatModel: value })} />
          </div>
          <p className="panel__hint">
            Default: Google Gemma 4 26B A4B (free). It reads screenshots. Free models are rate limited (20 a minute, 50 a day; 1,000 a day after a one-time $10 credit purchase).
          </p>
          <div className="settings__inline">
            <Button tone="blue" glass disabled={checking || settings.apiKey.trim() === ""} onClick={() => void testConnection()}>
              {checking ? "Checking..." : "Test connection"}
            </Button>
          </div>
          {outcome ? <p className={outcome.ok ? "settings__result is-ok" : "settings__result is-bad"}>{outcome.text}</p> : null}
        </Panel>

        <Panel title="Voice" accent="green">
          <div className="panel__row">
            <label htmlFor="stt-model">Speech to text</label>
            <TextField id="stt-model" mono value={settings.sttModel} onChange={(value) => settings.update({ sttModel: value })} />
          </div>
          <p className="panel__hint">Whisper large-v3-turbo through OpenRouter: about 0.0015 cents for a 5 second question. It needs a small credit balance.</p>
          <div className="panel__row">
            <label htmlFor="stt-language">I speak</label>
            <SelectField id="stt-language" value={settings.sttLanguage} onChange={(value) => settings.update({ sttLanguage: value })} options={LANGUAGES} />
          </div>
          <div className="panel__row">
            <span className="panel__label">Microphone</span>
            <div className="settings__inline">
              <span>{MIC_TEXT[mic]}</span>
              <Button small tone="green" glass onClick={() => void pipeline.testMicrophone()}>
                <PixelIcon name="mic" size={16} /> Test
              </Button>
            </div>
          </div>
          <div className="panel__row">
            <span className="panel__label">Spoken answers</span>
            <Checkbox checked={settings.speakReplies} onChange={(value) => settings.update({ speakReplies: value })}>
              Read answers aloud
            </Checkbox>
          </div>
          <div className="panel__row">
            <label htmlFor="voice">Voice</label>
            <SelectField id="voice" value={settings.voiceUri} onChange={(value) => settings.update({ voiceUri: value })} options={voiceOptions} />
          </div>
          <div className="panel__row">
            <span className="panel__label">Speed</span>
            <div className="slider-row">
              <Slider label="Speaking speed" min={0.6} max={1.6} step={0.05} value={settings.speechRate} onChange={(value) => settings.update({ speechRate: value })} />
              <output>{settings.speechRate.toFixed(2)}x</output>
            </div>
          </div>
        </Panel>

        <Panel title="Screen" accent="yellow">
          <div className="panel__row">
            <span className="panel__label">Screenshot</span>
            <Checkbox checked={settings.useScreen} onChange={(value) => settings.update({ useScreen: value })}>
              Look at my screen when I ask
            </Checkbox>
          </div>
          <p className="panel__hint">
            One picture of the display your mouse is on is sent with each question. ClickySketch's own windows are hidden from it. Free models may log what they receive, so turn this off when something private is on screen.
          </p>
          <div className="panel__row">
            <span className="panel__label">Picture size</span>
            <div className="slider-row">
              <Slider label="Screenshot width" min={640} max={2048} step={64} value={settings.screenMaxWidth} onChange={(value) => settings.update({ screenMaxWidth: value })} />
              <output>{settings.screenMaxWidth}px</output>
            </div>
          </div>
        </Panel>

        <Panel title="Hotkey" accent="red">
          <div className="panel__row">
            <span className="panel__label">Push to talk</span>
            <span>
              Hold <Chord label={hotkey?.chord ?? "Ctrl + Alt"} /> anywhere
            </span>
          </div>
          <p className="panel__hint">{hotkey ? `${hotkey.backend}. ${hotkey.message}` : "Starting up..."}</p>
        </Panel>

        <Panel title="Advanced" accent="purple">
          <div className="panel__row">
            <label htmlFor="base-url">API address</label>
            <TextField id="base-url" mono value={settings.baseUrl} onChange={(value) => settings.update({ baseUrl: value })} />
          </div>
          <div className="panel__row">
            <span className="panel__label">Memory</span>
            <div className="slider-row">
              <Slider label="Earlier exchanges to remember" min={0} max={10} step={1} value={settings.historyTurns} onChange={(value) => settings.update({ historyTurns: value })} />
              <output>{settings.historyTurns}</output>
            </div>
          </div>
          <p className="panel__hint">How many of your earlier questions and my answers I keep in mind. Screenshots are never re-sent.</p>
        </Panel>
      </div>
    </div>
  );
}
