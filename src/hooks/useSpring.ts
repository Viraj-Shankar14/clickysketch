import { useEffect, useRef, useState } from "react";

export interface SpringConfig {
  stiffness: number;
  damping: number;
  mass?: number;
}

/**
 * Damped spring that chases `target`. Integrated in fixed 1/240 s sub-steps so a long frame
 * can never make it explode, and it sleeps (no re-renders, no rAF) once it has settled.
 */
export function useSpring(target: number, config: SpringConfig, precision = 0.05): number {
  const { stiffness, damping, mass = 1 } = config;
  const [value, setValue] = useState(target);
  const body = useRef({ x: target, v: 0, target });

  useEffect(() => {
    body.current.target = target;
    let frame = 0;
    let last = performance.now();

    const step = (now: number): void => {
      const s = body.current;
      let remaining = Math.min((now - last) / 1000, 0.05);
      last = now;
      while (remaining > 0) {
        const h = Math.min(1 / 240, remaining);
        const acceleration = (-stiffness * (s.x - s.target) - damping * s.v) / mass;
        s.v += acceleration * h;
        s.x += s.v * h;
        remaining -= h;
      }
      if (Math.abs(s.x - s.target) < precision && Math.abs(s.v) < precision) {
        s.x = s.target;
        s.v = 0;
        setValue(s.x);
        return;
      }
      setValue(s.x);
      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, stiffness, damping, mass, precision]);

  return value;
}
