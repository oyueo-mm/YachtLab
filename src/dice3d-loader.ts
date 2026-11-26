/** Lazy loader for the 3D dice chunk (three.js + cannon-es). Never part of the initial bundle. */
export type DiceTableModule = typeof import("./dice3d/table");
let loaded: DiceTableModule | null = null;
let loading: Promise<DiceTableModule | null> | null = null;
export const diceTableModule = () => loaded;
export function loadDiceTable(): Promise<DiceTableModule | null> {
  loading ??= import("./dice3d/table")
    .then((m) => (loaded = m))
    .catch(() => { loading = null; return null; });
  return loading;
}
let waitingForIntent = false;
/** Prewarm on real input; game views can still request the renderer directly. */
export function preloadDiceTableWhenIdle() {
  if (loaded || loading || waitingForIntent) return;
  waitingForIntent = true;
  const controller = new AbortController();
  const prepare = () => {
    controller.abort();
    const load = () => void loadDiceTable();
    if (window.requestIdleCallback) window.requestIdleCallback(load, { timeout: 500 });
    else window.setTimeout(load, 0);
  };
  const options = { signal: controller.signal, passive: true };
  window.addEventListener("pointerdown", prepare, options);
  window.addEventListener("keydown", prepare, options);
}
