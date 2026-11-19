import type { OverlayInfo } from "../../types/ipc";
import "./outline.css";

/**
 * Debug aid (tray menu: "Show overlay outlines"): a dashed frame around the whole overlay so you can
 * see that every display is covered and which one this is. Purely visual, clicks still fall through.
 */
export function OverlayOutline({ info }: { info: OverlayInfo }) {
  const scale = Math.round(info.scaleFactor * 100);
  return (
    <div className="outline-layer" aria-hidden="true">
      <div className="outline-layer__frame" />
      <div className="outline-layer__chip px">
        Display {info.index + 1} of {info.monitorCount}
        {info.isPrimary ? " (primary)" : ""}: {info.width} x {info.height} at {scale}% scale, window {info.label}
      </div>
    </div>
  );
}
