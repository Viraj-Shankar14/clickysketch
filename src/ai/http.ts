import { ApiError } from "./errors";

export const trimSlash = (url: string): string => url.replace(/\/+$/, "");

/** setTimeout that gives up immediately when the request is cancelled. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ApiError("Cancelled.", "aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new ApiError("Cancelled.", "aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * fetch with one automatic retry for the two failures free providers throw all the time: a dropped
 * connection and a 502/503/504 while a model is waking up.
 */
export async function fetchWithRetry(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(url, init);
      const transient = response.status === 502 || response.status === 503 || response.status === 504;
      if (transient && attempt === 0) {
        await sleep(1200, signal);
        continue;
      }
      return response;
    } catch (error) {
      if (signal.aborted) throw new ApiError("Cancelled.", "aborted");
      if (error instanceof ApiError) throw error;
      if (attempt === 0) {
        await sleep(1200, signal);
        continue;
      }
      throw new ApiError("I couldn't reach OpenRouter. Check your internet connection.", "network");
    }
  }
}
