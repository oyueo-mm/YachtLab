// YachtLab v5 research kernel: dense, allocation-free dice tables for the
// 12-category Nintendo-style Yacht Dice rules (5 dice, up to 3 rolls,
// upper >= 63 -> +35). Built from the same dp-kernel.json as src/dp.ts so the
// chance model is identical. Research-only; not used by the product AI list.
import kernel from "../dp-kernel.json";

export const FULL = 252; // 5-dice multisets
export const PARTIAL = 462; // 0..5-dice multisets; index 210+d is full multiset d
export const OFFSET = 210;
export const UPPER_CAP = 63;
export const BONUS = 35;

/** POINTS[d*12+c] raw category points for full multiset d. */
export const POINTS = new Int16Array(FULL * 12);
for (let d = 0; d < FULL; d++) for (let c = 0; c < 12; c++) POINTS[d * 12 + c] = kernel.points[d][c];
export const PROB = Float64Array.from(kernel.probabilities);
/** Children of each partial (<5 dice) multiset, one per face. */
export const CHILD = new Int16Array(OFFSET * 6);
for (let h = 0; h < OFFSET; h++) for (let f = 0; f < 6; f++) CHILD[h * 6 + f] = kernel.children[h][f];
/** Holds of full multiset d in kernel order (CSR); the final entry is the full hold 210+d. */
export const HOLD_START = new Int32Array(FULL + 1);
export const HOLD_LIST: Int16Array = (() => {
  const all: number[] = [];
  for (let d = 0; d < FULL; d++) {
    HOLD_START[d] = all.length;
    for (const h of kernel.holds[d]) all.push(h);
  }
  HOLD_START[FULL] = all.length;
  return Int16Array.from(all);
})();
export const STATES: number[][] = kernel.states;
export const FULL_INDEX = new Map(kernel.states.slice(OFFSET).map((v, i) => [v.join(""), i]));
export const PARTIAL_INDEX = new Map(kernel.states.map((v, i) => [v.join(""), i]));

/** Exact re-roll transition of partial hold h (<210): CSR over full multisets. */
function buildTransitions() {
  const memo = new Map<number, Map<number, number>>();
  const dist = (h: number): Map<number, number> => {
    if (h >= OFFSET) return new Map([[h - OFFSET, 1]]);
    const hit = memo.get(h);
    if (hit) return hit;
    const out = new Map<number, number>();
    for (let f = 0; f < 6; f++) for (const [d, p] of dist(CHILD[h * 6 + f])) out.set(d, (out.get(d) ?? 0) + p / 6);
    memo.set(h, out);
    return out;
  };
  const start = new Int32Array(OFFSET + 1), to: number[] = [], p: number[] = [];
  for (let h = 0; h < OFFSET; h++) {
    start[h] = to.length;
    for (const [d, q] of [...dist(h).entries()].sort((a, b) => a[0] - b[0])) { to.push(d); p.push(q); }
  }
  start[OFFSET] = to.length;
  return { start, to: Int16Array.from(to), p: Float64Array.from(p) };
}
const transitions = buildTransitions();
export const TRANS_START = transitions.start;
export const TRANS_TO = transitions.to;
export const TRANS_P = transitions.p;

/** Same recursion as dp.ts chanceValues: expected value of each partial hold. */
export function chance(full: Float64Array, out = new Float64Array(PARTIAL)): Float64Array {
  for (let d = 0; d < FULL; d++) out[OFFSET + d] = full[d];
  for (let h = OFFSET - 1; h >= 0; h--) {
    const b = h * 6;
    out[h] = (out[CHILD[b]] + out[CHILD[b + 1]] + out[CHILD[b + 2]] + out[CHILD[b + 3]] + out[CHILD[b + 4]] + out[CHILD[b + 5]]) / 6;
  }
  return out;
}

export const popcount = (m: number) => { let n = 0; for (; m; m &= m - 1) n++; return n; };
/** Points added by scoring category c with full multiset d at upper u (incl. a newly reached bonus). */
export const gainOf = (d: number, c: number, u: number) => {
  const p = POINTS[d * 12 + c];
  return p + (c < 6 && u < UPPER_CAP && u + p >= UPPER_CAP ? BONUS : 0);
};
export const nextUpper = (c: number, p: number, u: number) => (c < 6 ? Math.min(UPPER_CAP, u + p) : u);
/** Largest raw upper sum the remaining upper categories of mask can still add. */
export const upperHeadroom = (mask: number) => { let s = 0; for (let c = 0; c < 6; c++) if (mask & (1 << c)) s += 5 * (c + 1); return s; };
/**
 * Canonical upper state: future play depends on u only through bonus reachability.
 * - no upper category left, or u >= 63: future is u-independent -> 63 when bonus banked, else 0 (no effect)
 * - bonus unreachable: identical to u = 0 (also unreachable).
 * Returns a value in 0..63 that gives identical future values/policy (verified in tests).
 */
export function canonicalUpper(mask: number, u: number): number {
  const um = Math.min(UPPER_CAP, u);
  if ((mask & 63) === 0) return 0;
  if (um >= UPPER_CAP) return UPPER_CAP;
  if (um + upperHeadroom(mask) < UPPER_CAP) return 0;
  return um;
}
