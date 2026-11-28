import kernel from "../../dp-kernel.json";
import { chanceValues, dpActionValues } from "../../dp";
import { available, categories, names, score, total, upper, type Card, type Category, type Game } from "../../engine";
import { EPS, keepKey, scoreKey, type ValuedAction } from "./types";

/**
 * Exact action values for a turn decision (LIVE-1 puzzles).
 *
 *  - expectedValues: expected FINAL total under optimal solitaire play, from the existing full-game DP
 *    (src/dp.ts, dpActionValues; DP Expert's model — fair independent dice, Float64).
 *  - winValues: exact win probability (draw = ½) against an opponent who has FINISHED with total T,
 *    when the player has at most 3 categories left. Backward induction over (open categories, upper,
 *    current total) with the same dice kernel: no sampling, no estimate.
 */
const fullIndex = new Map(kernel.states.slice(210).map((v, i) => [v.join(""), i]));
const partialIndex = new Map(kernel.states.map((v, i) => [v.join(""), i]));
const sortKey = (faces: readonly number[]) => [...faces].sort((a, b) => a - b).join("");

export const maskOf = (card: Card) => categories.reduce((m, c, i) => (card[c] === undefined ? m | (1 << i) : m), 0);

export function gameFor(card: Card, dice: readonly number[], rollsLeft: number): Game {
  return {
    dice: dice.map((value, id) => ({ id, value, held: false })), order: [0, 1, 2, 3, 4], cards: [{ ...card }, {}], player: 0,
    round: 13 - available(card).length, rolls: 3 - rollsLeft, done: false, winner: null, seed: 0, rng: [0, 0], actions: 0,
  };
}

/** Distinct kept multisets of a roll (keep-all excluded: that is "stop"). */
export function keepOptions(dice: readonly number[]): number[][] {
  const seen = new Map<string, number[]>();
  for (let m = 0; m < 31; m++) {
    const kept = dice.filter((_, i) => m & (1 << i));
    const k = sortKey(kept);
    if (!seen.has(k)) seen.set(k, [...kept].sort((a, b) => a - b));
  }
  return [...seen.values()];
}

export const keepLabel = (kept: readonly number[]) => (kept.length ? `${[...kept].sort((a, b) => a - b).join("·")} 고정 후 다시 굴리기` : "모두 다시 굴리기");
export const scoreLabel = (c: Category, points: number) => `${names[c]}에 ${points}점 기록`;

export function expectedValues(card: Card, dice: readonly number[], rollsLeft: number): ValuedAction[] {
  const q = dpActionValues(gameFor(card, dice, rollsLeft));
  const out: ValuedAction[] = [];
  categories.forEach((c, i) => {
    if (Number.isFinite(q[32 + i])) out.push({ key: scoreKey(c), label: scoreLabel(c, score([...dice], c)), value: q[32 + i] });
  });
  if (rollsLeft > 0)
    for (const kept of keepOptions(dice)) {
      // any mask producing this multiset has the same value (dp.test.ts "symmetric holds")
      let m = 0;
      const left = [...kept];
      dice.forEach((v, i) => {
        const j = left.indexOf(v);
        if (j >= 0) {
          left.splice(j, 1);
          m |= 1 << i;
        }
      });
      out.push({ key: keepKey(kept), label: keepLabel(kept), value: q[m] });
    }
  return out.sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
}

/* ------------------------------------------------------------- exact endgame win ------------------------------------------------------------- */

const UPPER_BONUS = 35;
function points(d: number, c: number) {
  return kernel.points[d][c];
}
/** Values per rolls-left (0..2) for a turn whose stop value is `stop`. */
function turnTables(stop: Float64Array): Float64Array[] {
  const tables = [stop];
  for (let r = 1; r <= 2; r++) {
    const e = chanceValues(tables[r - 1]);
    const next = new Float64Array(252);
    for (let d = 0; d < 252; d++) {
      let best = stop[d];
      for (const h of kernel.holds[d]) if (e[h] > best) best = e[h];
      next[d] = best;
    }
    tables.push(next);
  }
  return tables;
}

export class EndgameWin {
  private memo = new Map<string, number>();
  constructor(readonly opponentTotal: number) {}
  payoff(final: number) {
    return final > this.opponentTotal ? 1 : final === this.opponentTotal ? 0.5 : 0;
  }
  /** Value of recording category c with full multiset d from (mask, u, s). */
  after(mask: number, u: number, s: number, d: number, c: number): number {
    const p = points(d, c);
    const nu = c < 6 ? Math.min(63, u + p) : u;
    const ns = s + p + (c < 6 && u < 63 && nu === 63 ? UPPER_BONUS : 0);
    const rest = mask & ~(1 << c);
    return rest === 0 ? this.payoff(ns) : this.start(rest, nu, ns);
  }
  stop(mask: number, u: number, s: number): Float64Array {
    const out = new Float64Array(252);
    for (let d = 0; d < 252; d++) {
      let best = -Infinity;
      for (let c = 0; c < 12; c++) if (mask & (1 << c)) best = Math.max(best, this.after(mask, u, s, d, c));
      out[d] = best;
    }
    return out;
  }
  /** Win probability at the start of a turn (before the first roll). */
  start(mask: number, u: number, s: number): number {
    const key = `${mask}:${u}:${s}`;
    const hit = this.memo.get(key);
    if (hit !== undefined) return hit;
    const tables = turnTables(this.stop(mask, u, s));
    const value = chanceValues(tables[2])[0];
    this.memo.set(key, value);
    return value;
  }
  /** Exact win probability of every legal action of a rolled position. */
  values(card: Card, dice: readonly number[], rollsLeft: number): ValuedAction[] {
    const mask = maskOf(card), u = Math.min(63, upper(card)), s = total(card);
    if (available(card).length > 3) throw Error("endgame solver: at most 3 open categories");
    const d = fullIndex.get(sortKey(dice))!;
    const out: ValuedAction[] = [];
    for (let c = 0; c < 12; c++)
      if (mask & (1 << c)) out.push({ key: scoreKey(categories[c]), label: scoreLabel(categories[c], points(d, c)), value: this.after(mask, u, s, d, c) });
    if (rollsLeft > 0) {
      const tables = turnTables(this.stop(mask, u, s));
      const e = chanceValues(tables[rollsLeft - 1]);
      for (const kept of keepOptions(dice)) out.push({ key: keepKey(kept), label: keepLabel(kept), value: e[partialIndex.get(sortKey(kept))!] });
    }
    return out.sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
  }
}

export const bestKeys = (values: ValuedAction[]) => values.filter((v) => v.value >= values[0].value - EPS).map((v) => v.key);

/* --------------------------------------------------------------- probability --------------------------------------------------------------- */

export type Target = "yacht" | "four" | "full" | "small" | "large" | "fullOrFour";
export const TARGET_NAMES: Record<Target, string> = { yacht: "요트", four: "포커(같은 눈 4개 이상)", full: "풀 하우스", small: "스몰 스트레이트 이상", large: "라지 스트레이트", fullOrFour: "풀 하우스 또는 포커" };
export function hits(values: number[], target: Target): boolean {
  if (target === "fullOrFour") return score(values, "full") > 0 || score(values, "four") > 0;
  return score(values, target) > 0;
}
/** Exact probability that rerolling every die except `kept` once hits `target`: [favourable, total]. */
export function rerollProbability(kept: readonly number[], target: Target): [number, number] {
  const n = 5 - kept.length;
  let ok = 0, all = 0;
  const rec = (acc: number[]) => {
    if (acc.length === n) {
      all++;
      if (hits([...kept, ...acc], target)) ok++;
      return;
    }
    for (let f = 1; f <= 6; f++) rec([...acc, f]);
  };
  rec([]);
  return [ok, all];
}
