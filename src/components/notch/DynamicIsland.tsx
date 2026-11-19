import { useEffect, useState } from "react";
import { useSpring } from "../../hooks/useSpring";
import { openMainWindow } from "../../services/desktopBridge";
import { useVoiceStore } from "../../stores/voiceStore";
import { Chord } from "../retro/Keycap";
import { PixelIcon } from "../retro/PixelIcon";
import { ISLAND_SIZES, ISLAND_SPRING, evenPx, measureTextWidth, subtitleTail, type IslandMode } from "./islandMetrics";
import { PixelWave } from "./PixelWave";
import "./notch.css";

/** Re-render once the pixel font has loaded, so text measurements use the real glyph widths. */
function useFontsReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void document.fonts.ready.then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  return ready;
}

/**
 * The notch HUD (spec 6.1): a floating pixel-window pill at the top centre of the active display.
 * It is a quiet 72 x 14 sliver while idle and springs open for each thing the assistant is doing:
 * listening (live waveform), thinking, speaking (subtitles) or reporting a problem.
 */
export function DynamicIsland() {
  const phase = useVoiceStore((state) => state.phase);
  const pointerInside = useVoiceStore((state) => state.pointerInside);
  const text = useVoiceStore((state) => state.text);
  const screen = useVoiceStore((state) => state.screen);
  const hotkey = useVoiceStore((state) => state.hotkey);
  const fontsReady = useFontsReady();

  const chord = hotkey?.chord ?? "Ctrl + Alt";
  const hotkeyBroken = hotkey !== null && !hotkey.ok;
  const mode: IslandMode =
    phase === "listening" || phase === "thinking" || phase === "speaking" || phase === "error"
      ? phase
      : pointerInside
        ? "peek"
        : "idle";

  const peekText = hotkeyBroken ? hotkey.message : `Hold ${chord} to talk`;
  const thinkingText = text !== "" ? text : "Thinking...";
  const errorText = text !== "" ? text : "Something went wrong";
  const errorWide = measureTextWidth(errorText) > 380;

  let targetWidth = ISLAND_SIZES[mode].w;
  let targetHeight = ISLAND_SIZES[mode].h;
  if (mode === "peek") targetWidth = Math.min(560, measureTextWidth(peekText) + (hotkeyBroken ? 64 : 100));
  if (mode === "thinking") targetWidth = Math.max(180, measureTextWidth(thinkingText) + (screen ? 112 : 84));
  if (mode === "error") {
    targetWidth = errorWide ? 480 : Math.max(240, measureTextWidth(errorText) + 76);
    targetHeight = errorWide ? 74 : 46;
  }
  void fontsReady; // referenced so the measurements above are redone when the font arrives

  const width = evenPx(useSpring(evenPx(targetWidth), ISLAND_SPRING));
  const height = evenPx(useSpring(targetHeight, ISLAND_SPRING));

  let content;
  switch (mode) {
    case "idle":
      content = <span className="hud__led" aria-hidden="true" />;
      break;
    case "peek":
      content = (
        <>
          <PixelIcon name={hotkeyBroken ? "warn" : "mic"} size={16} />
          {hotkeyBroken ? (
            <span className="hud__text">{peekText}</span>
          ) : (
            <span className="hud__text">
              Hold <Chord label={chord} /> to talk
            </span>
          )}
        </>
      );
      break;
    case "listening":
      content = (
        <>
          <span className="hud__rec" aria-hidden="true" />
          <span className="hud__text">Listening</span>
          <PixelWave />
        </>
      );
      break;
    case "thinking":
      content = (
        <>
          <span className="hud__dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="hud__text">{thinkingText}</span>
          {screen ? <PixelIcon name="eye" size={16} title="Looking at your screen" /> : null}
        </>
      );
      break;
    case "speaking":
      content = (
        <>
          <PixelIcon name="speaker" size={16} />
          <span className="hud__subtitle">{subtitleTail(text)}</span>
        </>
      );
      break;
    case "error":
      content = (
        <>
          <PixelIcon name="warn" size={16} />
          <span className="hud__subtitle">{errorText}</span>
        </>
      );
      break;
  }

  return (
    <div className="hud-anchor">
      <div
        className={`hud px hud--${mode}`}
        data-hit
        data-hit-pad={mode === "idle" ? 8 : 6}
        style={{ width, height }}
        role="status"
        aria-live="polite"
        title="Open ClickySketch"
        onClick={() => void openMainWindow()}
      >
        {content}
      </div>
    </div>
  );
}
