import { PixelIcon } from "./PixelIcon";
import type { IconName } from "./icons";

export interface StatusCell {
  text: string;
  icon?: IconName;
  tone?: "ok" | "warn" | "bad";
  grow?: boolean;
}

/** Row of sunken cells along the bottom edge of the window (Windows 95 status bar). */
export function StatusBar({ cells }: { cells: ReadonlyArray<StatusCell> }) {
  return (
    <footer className="statusbar">
      {cells.map((cell, index) => (
        <span
          key={index}
          className={`statusbar__cell px px--sunken${cell.grow ? " statusbar__cell--grow" : ""}${cell.tone ? ` is-${cell.tone}` : ""}`}
        >
          {cell.icon ? <PixelIcon name={cell.icon} size={16} /> : null}
          <span className="statusbar__text">{cell.text}</span>
        </span>
      ))}
    </footer>
  );
}
