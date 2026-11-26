import { useSyncExternalStore } from "react";

/** Player-facing presentation settings, persisted in this browser only. */
export type Settings = {
  /** Sound effects are off. */
  muted: boolean;
  /** Master sound-effect volume, 0..1. */
  volume: number;
  /** Shorter, lighter dice motion (for low-end devices or personal preference). */
  reducedEffects: boolean;
  /** Dice renderer: auto (3D when WebGL is usable), 3D high/standard, or the original 2.5D CSS motion. */
  diceQuality: DiceQuality;
  /** Show other players' showy item effects (animations, nickname effects) and their item sounds. */
  opponentFx: boolean;
};
export type DiceQuality = "auto" | "3d-high" | "3d" | "2.5d";
export const diceQualities: readonly DiceQuality[] = ["auto", "3d-high", "3d", "2.5d"];

export const SETTINGS_KEY = "yachtlab.settings.v1";
export const defaultSettings: Settings = { muted: false, volume: 0.7, reducedEffects: false, diceQuality: "auto", opponentFx: true };

function sanitize(raw: unknown): Settings {
  const value = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const volume = typeof value.volume === "number" && Number.isFinite(value.volume) ? Math.min(1, Math.max(0, value.volume)) : defaultSettings.volume;
  return {
    muted: typeof value.muted === "boolean" ? value.muted : defaultSettings.muted,
    volume,
    reducedEffects: typeof value.reducedEffects === "boolean" ? value.reducedEffects : defaultSettings.reducedEffects,
    diceQuality: diceQualities.includes(value.diceQuality as DiceQuality) ? (value.diceQuality as DiceQuality) : defaultSettings.diceQuality,
    opponentFx: typeof value.opponentFx === "boolean" ? value.opponentFx : defaultSettings.opponentFx,
  };
}

function load(): Settings {
  try {
    const text = globalThis.localStorage?.getItem(SETTINGS_KEY);
    return text ? sanitize(JSON.parse(text)) : { ...defaultSettings };
  } catch {
    return { ...defaultSettings };
  }
}

let current: Settings = load();
const listeners = new Set<() => void>();

export const getSettings = () => current;

export function updateSettings(patch: Partial<Settings>) {
  current = sanitize({ ...current, ...patch });
  try {
    globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(current));
  } catch {
    // Private mode or blocked storage: keep the in-memory value for this session.
  }
  listeners.forEach((fn) => fn());
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings, getSettings);
}

export type MotionLevel = "full" | "lite" | "none";

/** System "reduce motion" always wins; low-end hardware or the user setting selects the lighter motion. */
export function motionLevel(settings: Settings = current): MotionLevel {
  if (typeof window === "undefined") return "none";
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return "none";
  const nav = navigator as Navigator & { deviceMemory?: number };
  const lowEnd = (nav.hardwareConcurrency ?? 8) <= 2 || (nav.deviceMemory ?? 8) <= 2;
  return settings.reducedEffects || lowEnd ? "lite" : "full";
}

export const isLowEndDevice = () => {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { deviceMemory?: number };
  return (nav.hardwareConcurrency ?? 8) <= 2 || (nav.deviceMemory ?? 8) <= 2;
};
let webgl: boolean | null = null;
/** WebGL availability, probed once (a throwaway canvas). */
export function webglAvailable(): boolean {
  if (webgl !== null) return webgl;
  // Test/diagnostic switch to exercise the no-WebGL fallback.
  if ((globalThis as { __YACHTLAB_DISABLE_WEBGL__?: boolean }).__YACHTLAB_DISABLE_WEBGL__) return (webgl = false);
  try {
    const canvas = document.createElement("canvas");
    webgl = !!(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    webgl = false;
  }
  return webgl;
}
export type DiceRenderer = "3d-high" | "3d" | "2.5d" | "none";
/** Pick the requested renderer without creating a probe context during page render.
 * The physical table handles context creation failure; the settings panel can probe on demand.
 */
export function diceRenderer(settings: Settings = current): DiceRenderer {
  const level = motionLevel(settings);
  if (level === "none") return "none";
  if (level === "lite" || settings.diceQuality === "2.5d" || webgl === false || (globalThis as { __YACHTLAB_DISABLE_WEBGL__?: boolean }).__YACHTLAB_DISABLE_WEBGL__) return "2.5d";
  // "자동": sharp rendering on every screen (phones included), with adaptive resolution (see renderPolicy).
  if (settings.diceQuality === "auto") return "3d-high";
  return settings.diceQuality;
}
