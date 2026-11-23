import { useSyncExternalStore } from "react";
import { comboDiceIds, grandCombos } from "./combo";
import { names, score, type Category, type Die } from "./engine";

/**
 * Score celebration events. The game screens announce a score right before committing it
 * (so the dice that were on the table are known); the dice area plays the effect. The effect is
 * presentation only: the engine has already scored the move, nothing here can change a value,
 * and a rapid second score never replays or doubles an earlier one.
 */
export type ScoreFx = {
  key: number;
  category: Category;
  label: string;
  points: number;
  /** Dice (by id) that make the combination. Empty when nothing is celebrated. */
  ids: number[];
  grand: boolean;
  /** Face values by die id at the time of scoring. */
  values: Record<number, number>;
  /** Total effect length, ms. */
  ms: number;
  /** performance.now() when announced (stale events are ignored). */
  at: number;
};

let current: ScoreFx | null = null;
let counter = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
const emit = () => listeners.forEach((fn) => fn());

export const FX_MS = 1050;
export const FX_GRAND_MS = 1450;

/** Build the effect for scoring `category` with these dice (pure; used by tests). */
export function buildScoreFx(dice: readonly Pick<Die, "id" | "value">[], category: Category, key = 0): ScoreFx {
  const points = score(dice.map((d) => d.value), category);
  const ids = comboDiceIds(dice, category);
  const grand = points > 0 && grandCombos.includes(category);
  return { key, category, label: names[category], points, ids, grand, values: Object.fromEntries(dice.map((d) => [d.id, d.value])), ms: grand ? FX_GRAND_MS : FX_MS, at: typeof performance !== "undefined" ? performance.now() : 0 };
}

export function announceScore(dice: readonly Pick<Die, "id" | "value">[], category: Category): ScoreFx {
  const fx = buildScoreFx(dice, category, ++counter);
  current = fx;
  if (typeof window !== "undefined") {
    const w = window as unknown as { __yachtlabFx?: ScoreFx[] };
    (w.__yachtlabFx ??= []).push(fx);
    if (w.__yachtlabFx.length > 30) w.__yachtlabFx.shift();
  }
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (current?.key === fx.key) {
      current = null;
      emit();
    }
  }, fx.ms + 400);
  emit();
  return fx;
}
export const clearScoreFx = () => {
  clearTimeout(timer);
  if (current) {
    current = null;
    emit();
  }
};
export const getScoreFx = () => current;
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const useScoreFx = () => useSyncExternalStore(subscribe, getScoreFx, getScoreFx);
