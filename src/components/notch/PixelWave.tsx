import { useEffect, useRef, useState } from "react";
import { useVoiceStore } from "../../stores/voiceStore";
import { evenPx } from "./islandMetrics";

const MIN_HEIGHT = 4;
const MAX_HEIGHT = 28;

/** Seven chunky bars; each breathes at its own pace so the group never moves in lockstep. */
const BARS = [
  { factor: 0.5, speed: 5.1, phase: 0.0 },
  { factor: 0.72, speed: 6.4, phase: 1.3 },
  { factor: 0.9, speed: 4.6, phase: 2.4 },
  { factor: 1.0, speed: 7.2, phase: 3.1 },
  { factor: 0.9, speed: 5.8, phase: 4.2 },
  { factor: 0.72, speed: 6.9, phase: 5.0 },
  { factor: 0.5, speed: 4.9, phase: 5.8 },
] as const;

/**
 * Real-time audio visualiser (spec 6.1) fed by the microphone loudness that the main window
 * broadcasts. Bars chase the level so irregular updates still look smooth; heights snap to even
 * pixel steps to stay on the pixel grid.
 */
export function PixelWave() {
  const level = useVoiceStore((state) => state.level);
  const levelRef = useRef(level);
  const [heights, setHeights] = useState<number[]>(() => BARS.map(() => MIN_HEIGHT));

  useEffect(() => {
    levelRef.current = level;
  }, [level]);

  useEffect(() => {
    let frame = 0;
    let current: number[] = BARS.map(() => MIN_HEIGHT);
    const tick = (now: number): void => {
      const t = now / 1000;
      current = BARS.map((bar, index) => {
        const previous = current[index] ?? MIN_HEIGHT;
        const breathing = 0.7 + 0.3 * Math.sin(t * bar.speed + bar.phase);
        const drive = Math.min(1, levelRef.current * bar.factor * breathing * 1.25);
        const target = MIN_HEIGHT + (MAX_HEIGHT - MIN_HEIGHT) * drive;
        return previous + (target - previous) * 0.35;
      });
      setHeights(current.map(evenPx));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="wave" aria-hidden="true">
      {heights.map((height, index) => (
        <i key={index} style={{ height }} />
      ))}
    </div>
  );
}
