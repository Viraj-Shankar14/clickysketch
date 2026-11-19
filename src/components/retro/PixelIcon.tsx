import { useMemo } from "react";
import { ICON_GRID, ICONS, PALETTE, type IconName } from "./icons";

interface Run {
  x: number;
  y: number;
  width: number;
  color: string;
}

/** Collapses each row into horizontal runs of one colour: far fewer SVG nodes than one rect per pixel. */
function runsFor(name: IconName): Run[] {
  const runs: Run[] = [];
  ICONS[name].forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const key = row.charAt(x);
      if (key === ".") {
        x += 1;
        continue;
      }
      let end = x + 1;
      while (end < row.length && row.charAt(end) === key) end += 1;
      runs.push({ x, y, width: end - x, color: PALETTE[key] ?? "#ff00ff" });
      x = end;
    }
  });
  return runs;
}

/**
 * Crisp pixel icon. Pass a multiple of 16 for `size` so every art pixel covers a whole number of
 * screen pixels (16 = 1x, 32 = 2x, 48 = 3x).
 */
export function PixelIcon({ name, size = 16, title }: { name: IconName; size?: number; title?: string }) {
  const runs = useMemo(() => runsFor(name), [name]);
  return (
    <svg
      className="pixel-icon"
      width={size}
      height={size}
      viewBox={`0 0 ${ICON_GRID} ${ICON_GRID}`}
      shapeRendering="crispEdges"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ display: "block", flex: "none" }}
    >
      {runs.map((run, index) => (
        <rect key={index} x={run.x} y={run.y} width={run.width} height={1} fill={run.color} />
      ))}
    </svg>
  );
}
