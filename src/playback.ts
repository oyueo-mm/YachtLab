export const humanAITiming = {
  start: 500,
  firstRoll: 800,
  hold: 700,
  reroll: 850,
  score: 750,
} as const;
export function playbackDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let remaining = ms,
      start = performance.now(),
      timer: number | undefined;
    const cleanup = () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("취소됨", "AbortError"));
    };
    const schedule = () => {
      start = performance.now();
      if (!document.hidden)
        timer = window.setTimeout(() => {
          cleanup();
          resolve();
        }, remaining);
    };
    const visibility = () => {
      clearTimeout(timer);
      if (document.hidden)
        remaining = Math.max(0, remaining - (performance.now() - start));
      else schedule();
    };
    if (signal.aborted) {
      abort();
      return;
    }
    document.addEventListener("visibilitychange", visibility);
    signal.addEventListener("abort", abort, { once: true });
    schedule();
  });
}
