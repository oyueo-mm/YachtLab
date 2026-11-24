/**
 * Exact probability tools for rare-achievement analysis (economy study). Pure, no engine RNG.
 *
 * - Turn-level "target" DP: the maximum probability of ending a 3-roll turn with dice in a target set,
 *   holding optimally (e.g. yacht in one turn ≈ 4.603%).
 * - Whole-game "pattern" DP over the 4,096 category masks: the maximum probability that every
 *   category is filled with a dice set from its own target (e.g. a perfect 323-point game).
 * - Coupon-collector exact expectation / quantiles for collection achievements.
 *
 * Rules: YachtLab-12 (src/engine.ts `score`).
 */
import { categories, score, type Category } from "../engine";

export type Multiset = number[]; // sorted face values
const FACT = [1, 1, 2, 6, 24, 120];

function multisets(size: number): Multiset[] {
  const out: Multiset[] = [];
  const rec = (start: number, acc: number[]) => {
    if (acc.length === size) { out.push([...acc]); return; }
    for (let f = start; f <= 6; f++) { acc.push(f); rec(f, acc); acc.pop(); }
  };
  rec(1, []);
  return out;
}
/** Probability of rolling exactly this multiset with `m.length` fair dice. */
export function multisetProb(m: Multiset): number {
  const c = Array(7).fill(0);
  m.forEach((v) => c[v]++);
  let ways = FACT[m.length];
  for (let f = 1; f <= 6; f++) ways /= FACT[c[f]];
  return ways / 6 ** m.length;
}
const key = (m: Multiset) => m.join("");

export const FULL: Multiset[] = multisets(5); // 252
const fullIndex = new Map(FULL.map((m, i) => [key(m), i]));
const PARTIALS: Multiset[] = [0, 1, 2, 3, 4, 5].flatMap((k) => multisets(k)); // 462
/** For every kept partial multiset: the distribution over full multisets after rolling the rest. */
const TRANSITIONS: { to: number; p: number }[][] = PARTIALS.map((kept) => {
  const rest = multisets(5 - kept.length);
  return rest.map((r) => ({ to: fullIndex.get(key([...kept, ...r].sort()))!, p: multisetProb(r) }));
});
const partialIndex = new Map(PARTIALS.map((m, i) => [key(m), i]));
/** Distinct sub-multisets of each full multiset (hold choices). */
const HOLDS: number[][] = FULL.map((m) => {
  const set = new Set<number>();
  for (let mask = 0; mask < 32; mask++) set.add(partialIndex.get(key(m.filter((_, i) => mask & (1 << i))))!);
  return [...set];
});
const FIRST_ROLL = FULL.map((m) => multisetProb(m));

/**
 * Optimal value of one turn given a terminal payoff per final multiset (indexed like FULL):
 * the turn rolls 5 dice, then may hold/reroll twice. Returns the expected payoff under optimal holds.
 */
export function turnValue(terminal: ArrayLike<number>): number {
  let v = Float64Array.from(terminal);
  for (let step = 0; step < 2; step++) {
    const keepVal = TRANSITIONS.map((t) => t.reduce((a, e) => a + e.p * v[e.to], 0));
    const next = new Float64Array(FULL.length);
    for (let i = 0; i < FULL.length; i++) {
      let best = v[i]; // holding all five = stop
      for (const h of HOLDS[i]) if (keepVal[h] > best) best = keepVal[h];
      next[i] = best;
    }
    v = next;
  }
  return FIRST_ROLL.reduce((a, p, i) => a + p * v[i], 0);
}
/** Max probability of finishing a turn with a dice set satisfying `pred`. */
export function turnTargetProbability(pred: (m: Multiset) => boolean): number {
  return turnValue(FULL.map((m) => (pred(m) ? 1 : 0)));
}
/** Probability that a single roll of 5 dice satisfies `pred`. */
export function firstRollProbability(pred: (m: Multiset) => boolean): number {
  return FULL.reduce((a, m, i) => a + (pred(m) ? FIRST_ROLL[i] : 0), 0);
}

/**
 * Whole-game pattern DP: each category must be filled with a final dice set satisfying its own
 * predicate (any order, 12 turns). Returns the maximum success probability (optimal play for that goal).
 */
export function gamePatternProbability(pred: Record<Category, (m: Multiset) => boolean>): number {
  const ok = categories.map((c) => FULL.map((m) => pred[c](m)));
  const V = new Float64Array(1 << 12);
  V[0] = 1;
  for (let mask = 1; mask < 1 << 12; mask++) {
    const terminal = FULL.map((_, i) => {
      let best = 0;
      for (let c = 0; c < 12; c++) if (mask & (1 << c) && ok[c][i]) best = Math.max(best, V[mask ^ (1 << c)]);
      return best;
    });
    V[mask] = turnValue(terminal);
  }
  return V[(1 << 12) - 1];
}

export const maxScore: Record<Category, number> = { aces: 5, deuces: 10, threes: 15, fours: 20, fives: 25, sixes: 30, choice: 30, four: 30, full: 28, small: 15, large: 30, yacht: 50 };
export const PERFECT_TOTAL = Object.values(maxScore).reduce((a, b) => a + b, 0) + 35; // 323

/** Collection: per-match probability p[f] of obtaining item f (mutually exclusive within a match). */
export function couponExpectedMatches(p: number[]): number {
  let e = 0;
  const n = p.length;
  for (let s = 1; s < 1 << n; s++) {
    let ps = 0, bits = 0;
    for (let i = 0; i < n; i++) if (s & (1 << i)) { ps += p[i]; bits++; }
    e += (bits % 2 ? 1 : -1) / ps;
  }
  return e;
}
/** P(all collected within m matches). */
export function couponCdf(p: number[], m: number): number {
  let miss = 0;
  const n = p.length;
  for (let s = 1; s < 1 << n; s++) {
    let ps = 0, bits = 0;
    for (let i = 0; i < n; i++) if (s & (1 << i)) { ps += p[i]; bits++; }
    miss += (bits % 2 ? 1 : -1) * (1 - ps) ** m;
  }
  return 1 - miss;
}
export function couponQuantile(p: number[], q: number): number {
  let lo = 0, hi = 1;
  while (couponCdf(p, hi) < q) hi *= 2;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (couponCdf(p, mid) >= q) hi = mid; else lo = mid; }
  return hi;
}
/** Matches needed for P(≥1 occurrence) ≥ q when each match succeeds independently with probability p. */
export const matchesForProbability = (p: number, q: number) => (p <= 0 ? Infinity : Math.ceil(Math.log(1 - q) / Math.log(1 - p)));
/** Binomial tail P(X ≥ k), X ~ Bin(n, p) (n small). */
export function binomTail(n: number, p: number, k: number): number {
  let s = 0;
  for (let i = k; i <= n; i++) {
    let c = 1;
    for (let j = 0; j < i; j++) c = (c * (n - j)) / (j + 1);
    s += c * p ** i * (1 - p) ** (n - i);
  }
  return s;
}
export { score };
