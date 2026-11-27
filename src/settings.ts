import { useSyncExternalStore } from "react";

/** Player-facing presentation settings, persisted in this browser only. */
export type Settings = {
  /** Master mute: every sound (effects and music) is off. Older saves used it for effects only. */
  muted: boolean;
  /** Sound effects on (dice, scores, emotes, item sounds). */
  sfx: boolean;
  /** Sound-effect volume, 0..1. */
  volume: number;
  /** Background music on. */
  bgm: boolean;
  /** Background music volume, 0..1. */
  bgmVolume: number;
  /** Item / board / emote effect detail: auto (by device), high, low (fewer particles, no ambient motion). */
  fxQuality: FxQuality;
  /** PC keyboard shortcuts for play and review. */
  shortcuts: boolean;
  /** Shorter, lighter dice motion (for low-end devices or personal preference). */
  reducedEffects: boolean;
  /** Dice renderer: auto (3D when WebGL is usable), 3D high/standard, or the original 2.5D CSS motion. */
  diceQuality: DiceQuality;
  /** Show other players' showy item effects (animations, nickname effects) and their item sounds. */
  opponentFx: boolean;
};
export type FxQuality = "auto" | "high" | "low";
export const fxQualities: readonly FxQuality[] = ["auto", "high", "low"];
export type DiceQuality = "auto" | "3d-high" | "3d" | "2.5d";
export const diceQualities: readonly DiceQuality[] = ["auto", "3d-high", "3d", "2.5d"];

export const SETTINGS_KEY = "yachtlab.settings.v1";
export const defaultSettings: Settings = { muted: false, sfx: true, volume: 0.7, bgm: true, bgmVolume: 0.3, fxQuality: "auto", shortcuts: true, reducedEffects: false, diceQuality: "auto", opponentFx: true };

function sanitize(raw: unknown): Settings {
  const value = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const unit = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  return {
    muted: bool(value.muted, defaultSettings.muted),
    sfx: bool(value.sfx, defaultSettings.sfx),
    volume: unit(value.volume, defaultSettings.volume),
    bgm: bool(value.bgm, defaultSettings.bgm),
    bgmVolume: unit(value.bgmVolume, defaultSettings.bgmVolume),
    fxQuality: fxQualities.includes(value.fxQuality as FxQuality) ? (value.fxQuality as FxQuality) : defaultSettings.fxQuality,
    shortcuts: bool(value.shortcuts, defaultSettings.shortcuts),
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
// One live MediaQueryList (its `.matches` follows the system setting); creating a new query on every
// call cost a style recalculation each time, and effect layers ask on every render (A1.1 profile).
let reduceQuery: MediaQueryList | null | undefined;
const reducedMotionQuery = () => {
  if (reduceQuery === undefined) reduceQuery = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  return reduceQuery;
};
export function motionLevel(settings: Settings = current): MotionLevel {
  if (typeof window === "undefined") return "none";
  if (reducedMotionQuery()?.matches) return "none";
  return settings.reducedEffects || isLowEndDevice() ? "lite" : "full";
}

/**
 * innerWidth < 560, kept up to date by `resize`. Reading innerWidth when the DOM has just changed (as at
 * the start of a throw) forces a synchronous layout; the profile showed it on the tap → first-frame path.
 */
let narrowCache: boolean | undefined;
function isNarrowViewport() {
  if (typeof window === "undefined") return false;
  if (narrowCache === undefined) {
    narrowCache = window.innerWidth < 560;
    window.addEventListener("resize", () => (narrowCache = window.innerWidth < 560), { passive: true });
  }
  return narrowCache;
}
let lowEndCache: boolean | undefined;
export const isLowEndDevice = () => {
  if (typeof navigator === "undefined") return false;
  if (lowEndCache !== undefined) return lowEndCache;
  const nav = navigator as Navigator & { deviceMemory?: number };
  return (lowEndCache = (nav.hardwareConcurrency ?? 8) <= 2 || (nav.deviceMemory ?? 8) <= 2);
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

/** Sound effects audible right now (master mute, effects switch and volume). */
export const sfxAudible = (s: Settings = current) => !s.muted && s.sfx && s.volume > 0;
/** Background music audible right now. */
export const bgmAudible = (s: Settings = current) => !s.muted && s.bgm && s.bgmVolume > 0;

/**
 * Effect detail for cosmetic particles (dice trails, board reactions, emote particles): 1 = full,
 * 0.5 = light, 0 = none. Never touches dice motion or results. System "reduce motion" → 0.
 */
export function fxBudget(settings: Settings = current): number {
  const level = motionLevel(settings);
  if (level === "none") return 0;
  if (settings.fxQuality === "low") return 0.4;
  if (settings.fxQuality === "high") return level === "lite" ? 0.6 : 1;
  const narrow = isNarrowViewport();
  return level === "lite" ? 0.4 : narrow ? 0.7 : 1;
}
/** Listen to settings changes outside React (audio engine). */
export const subscribeSettings = (fn: () => void) => subscribe(fn);
