import { getSettings, subscribeSettings } from "./settings";

/**
 * Adaptive effect quality (A1.1, 2026-11-27). Decorative layers (board environment and reactions,
 * synergy, item particles) scale down on devices that cannot keep up; the dice, their physics, the
 * 3D table and input are never touched by this (they keep priority).
 *
 * Measured, not guessed: after every 3D throw the table reports the frame intervals it actually got.
 *  - 2 throws in a row with average > 22 ms (or p95 > 30 ms with average > 19 ms) → one tier down
 *    (max tier 2). The first throw of a session is warm-up (shaders, chunks) and is not judged.
 *  - 5 throws in a row with p95 ≤ 18 ms and average ≤ 17.5 ms → one tier up.
 *  Hysteresis + at most one step per decision + applied only when a throw starts (never mid-animation),
 *  so the look does not flicker between tiers. Remembered for the browser session.
 * The "효과 품질" setting still wins: 높음 = tier 0, 낮음 = tier 2; 자동 = this governor.
 */
export type FxTier = 0 | 1 | 2;
export type FxTierParams = {
  /** Board environment redraw interval (ms) when nothing reacts. */
  envMs: number;
  /** Redraw interval while a reaction runs. */
  reactMs: number;
  /** Multiplier on particle counts (on top of the effect budget). */
  particles: number;
  /** Synergy path sampling interval (ms) and mark spacing factor. */
  trailMs: number;
  /** Board / synergy canvas pixels per CSS px (cap). */
  canvas: number;
  /** Decorative halos (wide faint strokes around bolts, cracks, streaks). */
  glow: boolean;
  /** Detail of synergy links (garland dots, frost ticks, lightning layers): 0..1. */
  linkDetail: number;
};
export const FX_TIERS: readonly FxTierParams[] = [
  { envMs: 32, reactMs: 15, particles: 1, trailMs: 32, canvas: 1.25, glow: true, linkDetail: 1 },
  { envMs: 48, reactMs: 32, particles: 0.7, trailMs: 48, canvas: 1, glow: true, linkDetail: 0.6 },
  { envMs: 66, reactMs: 32, particles: 0.45, trailMs: 64, canvas: 0.8, glow: false, linkDetail: 0.35 },
];

const KEY = "yachtlab.fx.tier";
const read = (): FxTier => {
  try {
    const n = Number(sessionStorage.getItem(KEY));
    return n === 1 || n === 2 ? n : 0;
  } catch {
    return 0;
  }
};
let measured: FxTier = typeof sessionStorage !== "undefined" ? read() : 0;
/** Tier in force for the layers (changes only at a throw start). */
let active: FxTier = measured;
let bad = 0, good = 0;
const listeners = new Set<() => void>();

function wanted(): FxTier {
  const q = getSettings().fxQuality;
  return q === "high" ? 0 : q === "low" ? 2 : measured;
}
export const fxTier = (): FxTier => active;
export const fxTierParams = (): FxTierParams => FX_TIERS[active];
export function onFxTier(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
/** Called when a throw starts: a pending tier change takes effect now (between animations). */
export function applyPendingFxTier() {
  const next = wanted();
  if (next === active) return;
  active = next;
  mirrorTier();
  listeners.forEach((fn) => fn());
}
/** The tier on <html> lets pure-CSS cosmetics (frames, bubbles, names) stop their loops at the lowest tier. */
function mirrorTier() {
  if (typeof document !== "undefined") document.documentElement.dataset.fxTier = String(active);
}
if (typeof window !== "undefined") {
  active = wanted();
  mirrorTier();
  subscribeSettings(() => applyPendingFxTier()); // a settings change is the user's choice: apply at once
}

/** Pure decision (tests): next measured tier and the streak counters after one throw. */
export function decideTier(tier: FxTier, streak: { bad: number; good: number }, frames: number[]): { tier: FxTier; bad: number; good: number } {
  const v = frames.slice(1).filter((x) => x > 0 && x < 1000);
  if (v.length < 20) return { tier, ...streak };
  const sorted = [...v].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const avg = v.reduce((a, b) => a + b, 0) / v.length;
  let { bad: b, good: g } = streak;
  // slow = slow on average, not just a few spikes (shader warm-up, a GC) on an otherwise smooth throw
  if (avg > 22 || (p95 > 30 && avg > 19)) (b++, (g = 0));
  else if (p95 <= 18 && avg <= 17.5) (g++, (b = 0));
  else (b = 0), (g = 0);
  if (b >= 2 && tier < 2) return { tier: (tier + 1) as FxTier, bad: 0, good: 0 };
  if (g >= 5 && tier > 0) return { tier: (tier - 1) as FxTier, bad: 0, good: 0 };
  return { tier, bad: b, good: g };
}
/** The 3D table reports the frame intervals of each finished throw. */
let throwsSeen = 0;
export function reportThrowFrames(frames: number[]) {
  if (throwsSeen++ === 0) return; // warm-up throw
  const next = decideTier(measured, { bad, good }, frames);
  bad = next.bad;
  good = next.good;
  if (next.tier === measured) return;
  measured = next.tier;
  try {
    sessionStorage.setItem(KEY, String(measured));
  } catch {
    /* private mode */
  }
  if (typeof window !== "undefined") (window as unknown as { __yachtlabFxTier?: { measured: FxTier } }).__yachtlabFxTier = { measured };
}
