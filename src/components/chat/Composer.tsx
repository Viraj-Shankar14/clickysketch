import { useState } from "react";
import { pipeline } from "../../assistant/pipeline";
import { useAssistantStore } from "../../stores/assistantStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { Button } from "../retro/Button";
import { Checkbox, TextField } from "../retro/Fields";
import { PixelIcon } from "../retro/PixelIcon";

export function Composer() {
  const [text, setText] = useState("");
  const useScreen = useSettingsStore((state) => state.useScreen);
  const speakReplies = useSettingsStore((state) => state.speakReplies);
  const update = useSettingsStore((state) => state.update);
  const phase = useAssistantStore((state) => state.phase);

  const recording = phase === "listening";
  const working = phase === "thinking" || phase === "speaking";

  const send = (): void => {
    if (text.trim() === "") return;
    const question = text;
    setText("");
    void pipeline.ask(question);
  };

  return (
    <div className="composer">
      <div className="composer__toggles">
        <Checkbox checked={useScreen} onChange={(value) => update({ useScreen: value })}>
          Look at my screen
        </Checkbox>
        <Checkbox checked={speakReplies} onChange={(value) => update({ speakReplies: value })}>
          Speak answers aloud
        </Checkbox>
      </div>
      <div className="composer__row">
        <div className="composer__grow">
          <TextField
            value={text}
            onChange={setText}
            placeholder={working ? "Working on it..." : "Type a question, or hold the mic and talk"}
            aria-label="Your question"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
          />
        </div>
        <Button tone="blue" glass icon aria-label="Send" title="Send" disabled={text.trim() === ""} onClick={send}>
          <PixelIcon name="send" size={32} />
        </Button>
        <Button
          tone={recording ? "red" : "green"}
          glass
          className={recording ? "mic-btn is-recording" : "mic-btn"}
          aria-label="Hold to talk"
          title="Hold to talk (or use the global hotkey)"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            void pipeline.beginListening();
          }}
          onPointerUp={() => void pipeline.endListening()}
          onPointerCancel={() => void pipeline.endListening()}
          onKeyDown={(event) => {
            if ((event.key === " " || event.key === "Enter") && !event.repeat) {
              event.preventDefault();
              void pipeline.beginListening();
            }
          }}
          onKeyUp={(event) => {
            if (event.key === " " || event.key === "Enter") void pipeline.endListening();
          }}
        >
          <PixelIcon name="mic" size={32} />
          <span>{recording ? "Release to send" : "Hold to talk"}</span>
        </Button>
      </div>
    </div>
  );
}
