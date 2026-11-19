import { pipeline } from "../../assistant/pipeline";
import { openExternal } from "../../services/desktopBridge";
import { useAssistantStore } from "../../stores/assistantStore";
import { Button } from "../retro/Button";
import { Chord } from "../retro/Keycap";
import { PixelIcon } from "../retro/PixelIcon";
import { ProgressBar } from "../retro/ProgressBar";

/** First-run card shown over the pixel wallpaper until the three things ClickySketch needs are in place. */
export function Welcome({ hasKey, onOpenSettings }: { hasKey: boolean; onOpenSettings: () => void }) {
  const mic = useAssistantStore((state) => state.mic);
  const chord = useAssistantStore((state) => state.hotkey?.chord ?? "Ctrl + Alt");
  const micDone = mic === "granted";
  const done = (hasKey ? 1 : 0) + (micDone ? 1 : 0);

  return (
    <section className="welcome px">
      <h2>Hi, I'm ClickySketch</h2>
      <p>I can see your screen and talk you through whatever you're working on. Two quick setup steps, then hold a key and ask.</p>
      <ProgressBar value={done / 3} label="Setup progress" />
      <ol className="welcome__steps">
        <li className={hasKey ? "done" : ""}>
          <PixelIcon name={hasKey ? "check" : "key"} size={16} />
          <span>{hasKey ? "OpenRouter key saved" : "Paste your OpenRouter key (free to create)"}</span>
        </li>
        <li className={micDone ? "done" : ""}>
          <PixelIcon name={micDone ? "check" : "mic"} size={16} />
          <span>
            {micDone
              ? "Microphone allowed"
              : mic === "denied"
                ? "Microphone blocked: allow it in Windows privacy settings"
                : mic === "missing"
                  ? "No microphone found"
                  : "Allow the microphone"}
          </span>
        </li>
        <li>
          <PixelIcon name="speaker" size={16} />
          <span>
            Hold <Chord label={chord} /> anywhere and ask
          </span>
        </li>
      </ol>
      <div className="welcome__actions">
        {!hasKey ? (
          <>
            <Button tone="blue" glass onClick={onOpenSettings}>
              <PixelIcon name="gear" size={16} /> Open Settings
            </Button>
            <Button onClick={() => void openExternal("https://openrouter.ai/keys")}>Get a key</Button>
          </>
        ) : null}
        {!micDone ? (
          <Button tone="green" glass onClick={() => void pipeline.testMicrophone()}>
            <PixelIcon name="mic" size={16} /> Allow microphone
          </Button>
        ) : null}
      </div>
    </section>
  );
}
