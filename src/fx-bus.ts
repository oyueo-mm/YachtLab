/**
 * Presentation events for the board and other effect layers (2026-11-26). The dice table and the game
 * screens announce what just happened on screen; boards react (ripples, petals, sparks). Viewport (client)
 * coordinates. Nothing here is read by the engine, the AI or the server: purely cosmetic.
 */
export type FxEventType = "roll" | "impact" | "land" | "hold" | "release" | "straight" | "yacht" | "win" | "trail";
/**
 * `strength`: impact speed in dice-edges per second (3D physics; 2.5D sends its planned hit × 14).
 * `id`: the die (impact / land / trail). `trail`: where a moving die is drawn now (~30 Hz, synergy).
 */
export type FxEvent = { type: FxEventType; x?: number; y?: number; strength?: number; id?: number };
const listeners = new Set<(e: FxEvent) => void>();
export function emitFx(e: FxEvent) {
  listeners.forEach((fn) => fn(e));
  if (e.type !== "trail" && typeof window !== "undefined") {
    const w = window as unknown as { __yachtlabFxEvents?: FxEvent[] };
    (w.__yachtlabFxEvents ??= []).push(e);
    if (w.__yachtlabFxEvents.length > 60) w.__yachtlabFxEvents.shift();
  }
}
export function onFx(fn: (e: FxEvent) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
