/**
 * Rough.js wrapper with deterministic seeds (spec sections 3 and 4.3).
 *
 * Rough.js wobbles every stroke with pseudo-random offsets. If the seed were re-rolled on each
 * render the pencil lines would shimmer like a shaky camera. Here every shape gets its seed from
 * a stable string key, so the same shape always produces the same lines, even while its width
 * and height are being animated by a spring: the wobble is part of the shape, not of the frame.
 */
import rough from "roughjs";

type Generator = ReturnType<typeof rough.generator>;
export type RoughOptions = NonNullable<Parameters<Generator["path"]>[1]>;
export type RoughPathInfo = ReturnType<Generator["toPaths"]>[number];

/** The Excalidraw "artist" look from the design spec. */
export const ROUGH_STYLE = {
  roughness: 1.0,
  bowing: 1.25,
  fillStyle: "hachure",
  hachureAngle: -41,
} as const;

export interface RoughStyle {
  /** Stable identity of the shape; drives the pseudo-random seed. */
  seedKey: string;
  stroke: string;
  strokeWidth?: number;
  /** Pastel fill, rendered as diagonal hachure unless `fillStyle` says otherwise. */
  fill?: string;
  /** Hachure is the Excalidraw default; tiny shapes (status dots) read better as a solid fill. */
  fillStyle?: "hachure" | "solid";
  /** One pencil pass instead of Excalidraw's double stroke; keeps very small shapes round. */
  singleStroke?: boolean;
  /** Rough.js maxRandomnessOffset; lower it for tiny shapes so they stay legible. */
  maxOffset?: number;
}

const generator: Generator = rough.generator();

/** FNV-1a hash folded into a positive 31-bit integer (Rough.js treats seed 0 as "random"). */
export function seedFor(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % 2147483646) + 1;
}

function toOptions(style: RoughStyle): RoughOptions {
  const options: RoughOptions = {
    roughness: ROUGH_STYLE.roughness,
    bowing: ROUGH_STYLE.bowing,
    seed: seedFor(style.seedKey),
    stroke: style.stroke,
    strokeWidth: style.strokeWidth ?? 1.25,
    fillStyle: ROUGH_STYLE.fillStyle,
    hachureAngle: ROUGH_STYLE.hachureAngle,
  };
  if (style.fill !== undefined) {
    options.fill = style.fill;
    options.fillStyle = style.fillStyle ?? ROUGH_STYLE.fillStyle;
    options.hachureGap = 3;
    options.fillWeight = 1.1;
  }
  if (style.singleStroke) {
    options.disableMultiStroke = true;
  }
  if (style.maxOffset !== undefined) {
    options.maxRandomnessOffset = style.maxOffset;
  }
  return options;
}

const CACHE_LIMIT = 800;
const cache = new Map<string, RoughPathInfo[]>();

function memo(key: string, build: () => RoughPathInfo[]): RoughPathInfo[] {
  const hit = cache.get(key);
  if (hit) return hit;
  const value = build();
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, value);
  return value;
}

/** Sizes are quantised to half pixels so an animating shape reuses cached geometry. */
const quantise = (value: number): number => Math.round(value * 2) / 2;

function styleKey(style: RoughStyle): string {
  return [
    style.seedKey,
    style.stroke,
    style.strokeWidth ?? "",
    style.fill ?? "",
    style.fillStyle ?? "",
    style.singleStroke ? "1" : "",
    style.maxOffset ?? "",
  ].join("|");
}

/** Excalidraw builds rounded rectangles from quadratic corners; so do we. */
export function roundedRectPath(width: number, height: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  return [
    `M ${r} 0`,
    `L ${width - r} 0`,
    `Q ${width} 0, ${width} ${r}`,
    `L ${width} ${height - r}`,
    `Q ${width} ${height}, ${width - r} ${height}`,
    `L ${r} ${height}`,
    `Q 0 ${height}, 0 ${height - r}`,
    `L 0 ${r}`,
    `Q 0 0, ${r} 0`,
  ].join(" ");
}

export function roughRoundedRect(
  width: number,
  height: number,
  radius: number,
  style: RoughStyle,
): RoughPathInfo[] {
  const w = quantise(width);
  const h = quantise(height);
  return memo(`rr|${w}|${h}|${radius}|${styleKey(style)}`, () =>
    generator.toPaths(generator.path(roundedRectPath(w, h, radius), toOptions(style))),
  );
}

/** Rectangle with its top-left corner at the origin; position it with an SVG transform. */
export function roughRect(width: number, height: number, style: RoughStyle): RoughPathInfo[] {
  const w = quantise(width);
  const h = quantise(height);
  return memo(`rect|${w}|${h}|${styleKey(style)}`, () =>
    generator.toPaths(generator.rectangle(0, 0, w, h, toOptions(style))),
  );
}

/** Ellipse inscribed in a width x height box whose top-left corner is the origin. */
export function roughEllipse(width: number, height: number, style: RoughStyle): RoughPathInfo[] {
  const w = quantise(width);
  const h = quantise(height);
  return memo(`ell|${w}|${h}|${styleKey(style)}`, () =>
    generator.toPaths(generator.ellipse(w / 2, h / 2, w, h, toOptions(style))),
  );
}
