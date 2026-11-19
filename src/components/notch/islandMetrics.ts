/** HUD geometry. Idle and listening sizes follow spec section 6.1; all sizes are even so 2 px outlines stay crisp. */
export type IslandMode = "idle" | "peek" | "listening" | "thinking" | "speaking" | "error";

export const ISLAND_SIZES: Record<IslandMode, { w: number; h: number }> = {
  idle: { w: 72, h: 14 },
  peek: { w: 240, h: 38 },
  listening: { w: 260, h: 46 },
  thinking: { w: 220, h: 46 },
  speaking: { w: 440, h: 74 },
  error: { w: 380, h: 46 },
};

/** Expand and collapse spring (same feel as the task drawer in spec 7.1). */
export const ISLAND_SPRING = { stiffness: 350, damping: 28 } as const;

export const HUD_FONT = '15px "Pixelify Sans", "Segoe UI", system-ui, sans-serif';

let context: CanvasRenderingContext2D | null | undefined;

/** Width of a string in the HUD font, so the pill can be exactly as wide as its message. */
export function measureTextWidth(text: string): number {
  if (context === undefined) context = document.createElement("canvas").getContext("2d");
  if (!context) return text.length * 9;
  context.font = HUD_FONT;
  return context.measureText(text).width;
}

/** Last couple of lines of a streaming answer, cut at a word boundary. */
export function subtitleTail(text: string, maxChars = 104): string {
  if (text.length <= maxChars) return text;
  const tail = text.slice(-maxChars);
  const firstSpace = tail.indexOf(" ");
  return `...${firstSpace >= 0 ? tail.slice(firstSpace + 1) : tail}`;
}

export const evenPx = (value: number): number => Math.max(2, Math.round(value / 2) * 2);
