import type { MotionLevel } from "./settings";

/**
 * 2.5D dice throw choreography (pure and deterministic, so it is unit-testable).
 *
 * The engine resolves the dice *before* any animation starts. Motion is decoration only:
 * the die face shown when the motion lands is always the engine's value, and intermediate
 * "tumbling" faces are cosmetic. Sounds are scheduled from the same plan, so audio and motion
 * stay in sync.
 */
export type ThrowPlan = {
  /** ms before this die starts moving (dice leave the hand slightly staggered). */
  delay: number;
  /** ms of motion after the delay. */
  duration: number;
  keyframes: Keyframe[];
  shadow: Keyframe[];
  /** ms from roll start at which the die hits the tray, with relative loudness. */
  impacts: { at: number; intensity: number }[];
  /** ms from roll start when a cosmetic tumbling face is shown. */
  tumbleFaces: { at: number; face: number }[];
  /** ms from roll start after which the real (engine) face is shown. */
  revealAt: number;
  /** ms from roll start when the die is fully at rest. */
  endAt: number;
};

/** Upper bound of a full throw, used by tests and to keep AI pacing comfortable. */
export const MAX_THROW_MS = 760;

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tf = (x: number, y: number, r: number, sx: number, sy = sx) =>
  `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${r.toFixed(1)}deg) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;

/**
 * @param token  roll counter (different every roll)
 * @param id     die id (0..4) — each die gets its own path
 * @param slot   on-screen position (0..4) — stagger follows the visual order
 * @param direction  -1 thrown toward the left, 1 toward the right
 * @param finalFace  the engine's resolved value; tumble faces never fake a stop on another value
 */
export function planThrow(token: number, id: number, slot: number, direction: -1 | 1, level: MotionLevel, finalFace: number): ThrowPlan | null {
  if (level === "none") return null;
  const r = rng(token * 7919 + id * 104729 + 17);
  const face = () => {
    let f = 1 + Math.floor(r() * 6);
    if (f === finalFace) f = (f % 6) + 1;
    return f;
  };
  if (level === "lite") {
    const delay = slot * 12;
    const duration = 260;
    return {
      delay,
      duration,
      keyframes: [
        { offset: 0, transform: tf(0, -14, direction * 8, 1.08), opacity: 0.6, easing: "ease-in" },
        { offset: 0.6, transform: tf(0, 0, 0, 1.03, 0.97), opacity: 1, easing: "ease-out" },
        { offset: 1, transform: tf(0, 0, 0, 1), opacity: 1 },
      ],
      shadow: [
        { offset: 0, transform: "scale(0.8)", opacity: 0.25 },
        { offset: 0.6, transform: "scale(1)", opacity: 0.5 },
        { offset: 1, transform: "scale(1)", opacity: 0.45 },
      ],
      impacts: [{ at: delay + 0.6 * duration, intensity: 0.6 }],
      tumbleFaces: [],
      revealAt: delay + 0.3 * duration,
      endAt: delay + duration,
    };
  }
  const delay = Math.round(slot * 22 + r() * 25);
  const duration = Math.round(560 + r() * 80);
  const at = (p: number) => delay + p * duration;
  const x0 = -direction * (110 + 60 * r()) - (slot - 2) * 12;
  const y0 = 70 + 50 * r();
  const r0 = -direction * (220 + 160 * r());
  const apex = -34 - 18 * r();
  const hop = -12 - 8 * r();
  const wobble = direction * (4 + 4 * r());
  return {
    delay,
    duration,
    keyframes: [
      { offset: 0, transform: tf(x0, y0, r0, 0.72), opacity: 0, easing: "cubic-bezier(.2,.7,.35,1)" },
      { offset: 0.08, opacity: 1 },
      { offset: 0.3, transform: tf(x0 * 0.45, apex, r0 * 0.55, 1.16), easing: "cubic-bezier(.55,0,1,.6)" },
      { offset: 0.46, transform: tf(x0 * 0.22, 0, r0 * 0.3, 1.05, 0.94), easing: "cubic-bezier(0,.5,.5,1)" },
      { offset: 0.58, transform: tf(x0 * 0.12, hop, r0 * 0.15, 1.04), easing: "cubic-bezier(.55,0,1,.6)" },
      { offset: 0.7, transform: tf(x0 * 0.05, 0, wobble, 1.02, 0.97), easing: "ease-out" },
      { offset: 0.84, transform: tf(-direction * 2, 0, -wobble * 0.4, 1) },
      { offset: 1, transform: tf(0, 0, 0, 1), opacity: 1 },
    ],
    shadow: [
      { offset: 0, transform: "translate3d(0, 10px, 0) scale(0.6)", opacity: 0 },
      { offset: 0.3, transform: "translate3d(0, 6px, 0) scale(0.7)", opacity: 0.22 },
      { offset: 0.46, transform: "scale(1)", opacity: 0.5 },
      { offset: 0.58, transform: "scale(0.86)", opacity: 0.35 },
      { offset: 0.7, transform: "scale(1)", opacity: 0.5 },
      { offset: 1, transform: "scale(1)", opacity: 0.45 },
    ],
    impacts: [
      { at: at(0.46), intensity: 0.9 },
      { at: at(0.7), intensity: 0.45 },
    ],
    tumbleFaces: [
      { at: at(0.12), face: face() },
      { at: at(0.3), face: face() },
      { at: at(0.46), face: face() },
    ],
    revealAt: at(0.58),
    endAt: delay + duration,
  };
}

/** One-shot hint from a throw gesture: which way the next roll should fly. Consumed by the next roll. */
const hint = { direction: 1 as -1 | 1, fresh: false, token: -1, resolved: 1 as -1 | 1 };
export function setThrowDirection(direction: -1 | 1) {
  hint.direction = direction;
  hint.fresh = true;
}
/** Idempotent per roll token (safe under React StrictMode double renders). */
export function takeThrowDirection(token: number): -1 | 1 {
  if (hint.token === token) return hint.resolved;
  hint.token = token;
  hint.resolved = hint.fresh ? hint.direction : token % 2 ? 1 : -1;
  hint.fresh = false;
  return hint.resolved;
}

/* ------------------------------------------------------------------------------------------------
 * Dice "in motion" store. While any roll animation runs, the roll button, dice and score sheet are
 * not interactive (prevents double rolls and input landing on the wrong die), and the AI waits
 * until the dice have visibly settled before acting. Every roll has a safety timeout.
 * ---------------------------------------------------------------------------------------------- */
const active = new Set<number>();
const busyListeners = new Set<() => void>();
let nextRollId = 1;
const emitBusy = () => busyListeners.forEach((fn) => fn());
export const isDiceBusy = () => active.size > 0;
export function beginDiceMotion(maxMs = 4000): () => void {
  const id = nextRollId++;
  active.add(id);
  emitBusy();
  const end = () => {
    if (!active.delete(id)) return;
    clearTimeout(timer);
    emitBusy();
  };
  const timer = setTimeout(end, maxMs);
  return end;
}
export const subscribeDiceBusy = (fn: () => void) => {
  busyListeners.add(fn);
  return () => {
    busyListeners.delete(fn);
  };
};
/** Resolves once no roll animation is running (immediately if none). */
export function waitForDice(signal?: AbortSignal): Promise<void> {
  if (!isDiceBusy()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => {
      if (isDiceBusy()) return;
      off();
      resolve();
    };
    const abort = () => {
      off();
      reject(new DOMException("취소됨", "AbortError"));
    };
    const off = () => {
      unsubscribe();
      signal?.removeEventListener("abort", abort);
    };
    const unsubscribe = subscribeDiceBusy(done);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
