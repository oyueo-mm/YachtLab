/** Lazy loader for the 3D dice chunk (three.js + cannon-es). Never part of the initial bundle. */
export type DiceTableModule = typeof import("./dice3d/table");
let loaded: DiceTableModule | null = null;
let loading: Promise<DiceTableModule | null> | null = null;
export const diceTableModule = () => loaded;
export function loadDiceTable(): Promise<DiceTableModule | null> {
  loading ??= import("./dice3d/table")
    .then((m) => (loaded = m))
    .catch(() => null);
  return loading;
}
/** Start loading when the browser is idle (no effect if already loaded). */
export function preloadDiceTableWhenIdle() {
  if (loaded || loading) return;
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(() => void loadDiceTable(), { timeout: 2500 });
  else window.setTimeout(() => void loadDiceTable(), 800);
}
