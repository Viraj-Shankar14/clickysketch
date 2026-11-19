import { windowControls, type ResizeDirection } from "../../services/desktopBridge";
import { PixelIcon } from "./PixelIcon";

/** Windows 95 style title bar, in the light pixel skin. The empty space drags the window. */
export function TitleBar({ title }: { title: string }) {
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar__brand">
        <PixelIcon name="logo" size={16} />
        <span>{title}</span>
      </div>
      <div className="titlebar__buttons">
        <button type="button" className="tb-btn px" aria-label="Minimize" title="Minimize" onClick={() => void windowControls.minimize()}>
          <PixelIcon name="minimize" size={16} />
        </button>
        <button type="button" className="tb-btn px" aria-label="Maximize" title="Maximize" onClick={() => void windowControls.toggleMaximize()}>
          <PixelIcon name="maximize" size={16} />
        </button>
        <button
          type="button"
          className="tb-btn tb-btn--close px"
          aria-label="Hide to tray"
          title="Hide to tray (the hotkey keeps working)"
          onClick={() => void windowControls.hide()}
        >
          <PixelIcon name="close" size={16} />
        </button>
      </div>
    </header>
  );
}

const HANDLES: ReadonlyArray<{ direction: ResizeDirection; className: string }> = [
  { direction: "North", className: "resize resize--n" },
  { direction: "South", className: "resize resize--s" },
  { direction: "West", className: "resize resize--w" },
  { direction: "East", className: "resize resize--e" },
  { direction: "NorthWest", className: "resize resize--nw" },
  { direction: "NorthEast", className: "resize resize--ne" },
  { direction: "SouthWest", className: "resize resize--sw" },
  { direction: "SouthEast", className: "resize resize--se" },
];

/** The window has no native frame, so invisible strips along its edges start native resize drags. */
export function ResizeHandles() {
  return (
    <>
      {HANDLES.map((handle) => (
        <div
          key={handle.direction}
          className={handle.className}
          onPointerDown={(event) => {
            if (event.button === 0) void windowControls.startResizeDragging(handle.direction);
          }}
        />
      ))}
    </>
  );
}
