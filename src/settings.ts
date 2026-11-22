import { useSyncExternalStore } from "react";

/** Player-facing presentation settings, persisted in this browser only. */
export type Settings = {
  /** Sound effects are off. */
  muted: boolean;
  /** Master sound-effect volume, 0..1. */
  volume: number;
  /** Shorter, lighter dice motion (for low-end devices or personal preference). */
  reducedEffects: boolean;
};

export const SETTINGS_KEY = "yachtlab.settings.v1";
export const defaultSettings: Settings = { muted: false, volume: 0.7, reducedEffects: false };

function sanitize(raw: unknown): Settings {
  const value = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const volume = typeof value.volume === "number" && Number.isFinite(value.volume) ? Math.min(1, Math.max(0, value.volume)) : defaultSettings.volume;
  return {
    muted: typeof value.muted === "boolean" ? value.muted : defaultSettings.muted,
    volume,
    reducedEffects: typeof value.reducedEffects === "boolean" ? value.reducedEffects : defaultSettings.reducedEffects,
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
