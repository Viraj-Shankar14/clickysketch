import { useEffect } from "react";
import { setHitRegions } from "../services/desktopBridge";
import type { HitRegion } from "../types/ipc";

/**
 * Selective click-through, frontend half.
 *
 * Any element marked `data-hit` is interactive; the rest of the overlay lets clicks fall through
 * to the desktop. This hook reports the rectangles of all such elements to Rust, which toggles the
 * native window between "ignore the mouse" and "receive the mouse" as the cursor crosses them.
 * `data-hit-pad="N"` grows the target by N px on every side (a 12 px pill is hard to hit).
 */
const SELECTOR = "[data-hit]";

function collectRegions(): HitRegion[] {
  const regions: HitRegion[] = [];
  document.querySelectorAll<HTMLElement>(SELECTOR).forEach((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const pad = Number(element.dataset["hitPad"] ?? 0) || 0;
    regions.push({
      x: rect.left - pad,
      y: rect.top - pad,
      width: rect.width + pad * 2,
      height: rect.height + pad * 2,
    });
  });
  return regions;
}

const fingerprint = (regions: HitRegion[]): string =>
  regions.map((r) => `${r.x.toFixed(1)},${r.y.toFixed(1)},${r.width.toFixed(1)},${r.height.toFixed(1)}`).join("|");

export function useHitRegions(): void {
  useEffect(() => {
    let frame = 0;
    let last = "";
    let disposed = false;

    const flush = (): void => {
      frame = 0;
      const regions = collectRegions();
      const next = fingerprint(regions);
      if (next === last) return;
      last = next;
      void setHitRegions(regions);
    };
    const schedule = (): void => {
      if (frame === 0 && !disposed) frame = requestAnimationFrame(flush);
    };

    const resizeObserver = new ResizeObserver(schedule);
    const observed = new Set<Element>();
    const rescan = (): void => {
      document.querySelectorAll(SELECTOR).forEach((element) => {
        if (!observed.has(element)) {
          observed.add(element);
          resizeObserver.observe(element);
        }
      });
      observed.forEach((element) => {
        if (!element.isConnected) {
          observed.delete(element);
          resizeObserver.unobserve(element);
        }
      });
      schedule();
    };

    const mutationObserver = new MutationObserver(rescan);
    mutationObserver.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-hit", "data-hit-pad", "style", "class"],
    });
    window.addEventListener("resize", schedule);
    rescan();

    return () => {
      disposed = true;
      if (frame !== 0) cancelAnimationFrame(frame);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("resize", schedule);
      void setHitRegions([]);
    };
  }, []);
}
