/**
 * Cached element rectangle for effect layers. Reading getBoundingClientRect on every presentation event
 * forced a synchronous layout right when a throw starts (React has just changed the DOM), which added
 * tens of ms to the first frame on slow phones. The rect is refreshed at most every 250 ms, and at once
 * after resize / scroll.
 */
export function rectCache(el: Element) {
  let rect: DOMRect | null = null;
  let at = 0;
  const reset = () => (rect = null);
  addEventListener("scroll", reset, { passive: true, capture: true });
  addEventListener("resize", reset, { passive: true });
  return {
    get(): DOMRect {
      const now = performance.now();
      if (!rect || now - at > 250) {
        rect = el.getBoundingClientRect();
        at = now;
      }
      return rect;
    },
    reset,
    dispose() {
      removeEventListener("scroll", reset, { capture: true });
      removeEventListener("resize", reset);
    },
  };
}
