import type { PreparedThrow, SimInput } from "./physics";

/**
 * Client of physics-worker.ts. `prepareOffThread` resolves with the prepared throw, or null when
 * workers are unavailable or failed (the caller then keeps the idle-time main-thread path).
 */
let worker: Worker | null = null;
let broken = false;
let seq = 0;
const waiting = new Map<number, (p: PreparedThrow | null) => void>();
function ensure(): Worker | null {
  if (worker || broken) return worker;
  try {
    worker = new Worker(new URL("./physics-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; prepared?: PreparedThrow; error?: string }>) => {
      const done = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      done?.(e.data.prepared ?? null);
    };
    worker.onerror = () => {
      broken = true;
      worker?.terminate();
      worker = null;
      waiting.forEach((done) => done(null));
      waiting.clear();
    };
  } catch {
    broken = true;
    worker = null;
  }
  return worker;
}
export const offThreadPhysics = () => !broken && typeof Worker !== "undefined";
export function prepareOffThread(input: SimInput): Promise<PreparedThrow | null> {
  const w = ensure();
  if (!w) return Promise.resolve(null);
  const id = ++seq;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    w.postMessage({ id, input });
  });
}
