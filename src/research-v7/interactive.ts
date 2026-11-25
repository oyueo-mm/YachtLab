// Win DP v7 research (12-category Nintendo-style Yacht Dice, 1:1 win credit).
// Research-only: NOT registered in src/ai.ts, NOT a default AI, no product code changes.
//
// v7 question: v5-R / v6-P value every scoring outcome of my current turn by
// independent open-loop futures (opponent = fixed DP Expert PMF). v6 measured that
// this is optimistic vs the exact interactive value (§3.2 of V6-APEX-RESEARCH) and
// that deeper non-interactive optimisation of "future me" makes it worse.
// v7 adds the opponent's reaction explicitly and compares estimators by their
// EXACT decision regret against the exact interactive solver (see
// scripts/research-v7/regret.ts), before spending games on them.
//
// Every estimator here fills stop values val[c*64 + p] (larger = better for the
// mover) for all remaining categories c and raw points p of the mover's turn; the
// within-turn reroll policy is then solved exactly by src/research-v6/turn.ts.
//
// Estimators ("kinds"):
//   R    v5-R      both players DP Expert after this turn
//   P    v6-P      future me = best of the lambda policy set; opponent DP Expert
//   L    v6-L      max_i min_j over policy pairs (opponent commits after me)
//   Lm   v6-Lm     uniform opponent policy mixture
//   N    v7-N      value of the 7x7 zero-sum policy matrix game (mixed Nash, LP)
//   MM   v7-MM     min_j max_i (I respond to the opponent's commitment)
//   I1   v7-I1     ONE REACTIVE OPPONENT TURN: after my outcome the opponent plays
//                  its next turn exactly to maximise ITS win credit (opponent-side
//                  v6-P objective: its policy set vs my DP Expert PMF); then I pick my
//                  best policy (closed loop, after seeing that turn) vs opponent DP.
//   I1D  ablation  same, but the opponent's turn is DP Expert (non-reactive): isolates
//                  the closed-loop policy choice from the reaction.
//   I1R  ablation  same as I1 but the opponent's turn uses the v5-R objective
//                  (its DP future vs my DP future) and my leaf is the policy set.
//   I1O  / I1RO    as I1 / I1R but my leaf is OPEN-LOOP: the opponent's reactive turn
//                  followed by DP Expert defines ONE opponent final-score PMF (a mixture
//                  over its turn outcomes); I take the best lambda policy against it
//                  (= v6-P against a reaction-aware opponent distribution). ~6x cheaper leaf.
//   I2  / I2R      TWO-PLY REACTION: the opponent's reactive turn (objective as I1 / I1R), then MY
//                  next turn played exactly with P stop values (my policy set vs the opponent's DP
//                  future from its new state), i.e. the value of v6-P at my next turn start,
//                  averaged over the opponent's turn outcomes. Research/regret only (slow: ~N^2 turn solves).
//   I2RO           open-loop I2R: the opponent's reactive turn (v5-R objective) + DP defines one opponent
//                  final-score mixture PMF; MY next turn is then solved exactly with P stop values against it.
//                  N turn solves per root instead of N^2.
//   I1RO1          I1RO with a single bank (DP Expert only): lightweight derivative for the product track
//                  (with one policy I1 = I1R = I1O = I1RO, see tests).
//   I2R1 / I2RO1   product track (v7.2): I2R / I2RO with the DP Expert bank only (same memory as v5-R).
//                  With one policy I2 = I2R (the opponent objective max over {DP} is the DP objective),
//                  but I2R1 != I2RO1: my next-turn solve is a max (non-linear) so solving it per opponent
//                  outcome (closed loop) differs from solving it once against the mixture (open loop).
// Fairness boundary: only public scorecards are used (callers pass masks/totals).
import { canonicalUpper, nextUpper, UPPER_CAP } from "../research-v5/kernel";
import { creditTable, type PolicyPmfBank } from "../research-v5/policy-pmf";
import { DISTINCT, bonusGain } from "../research-v6/risk";
import { TurnBuffers, turnOutcomesFromVal, turnStartValue } from "../research-v6/turn";

export const V7_VERSION = "v7-research-2026-11-25.1";
export type V7Kind = "R" | "P" | "L" | "Lm" | "N" | "MM" | "I1" | "I1D" | "I1R" | "I1O" | "I1RO" | "I2" | "I2R" | "I2RO" | "I1RO1" | "I2R1" | "I2RO1";
export const V7_KINDS: V7Kind[] = ["R", "P", "L", "Lm", "N", "MM", "I1", "I1D", "I1R", "I1O", "I1RO", "I2", "I2R", "I2RO", "I1RO1", "I2R1", "I2RO1"];
/** Single-bank (DP Expert only) kinds and the multi-bank kind they reduce to. */
export const SINGLE_BANK: Partial<Record<V7Kind, V7Kind>> = { I1RO1: "I1RO", I2R1: "I2R", I2RO1: "I2RO" };

type Credit = ReturnType<typeof creditTable>;
const ONE = Float64Array.of(1);

/** E[credit(x0 + G)] for G ~ pmf. */
export function dotCredit(pmf: Float64Array, x0: number, ct: Credit): number {
  const off = x0 - ct.lo, tab = ct.table, L = ct.len + 1;
  let s = 0;
  for (let g = 0; g < pmf.length; g++) {
    const q = pmf[g];
    if (q === 0) continue;
    const i = off + g;
    s += q * (i <= 0 ? 0 : i >= L ? 1 : tab[i]);
  }
  return s;
}

/** Value of a zero-sum matrix game for the row (max) player, exact LP via dense simplex. */
export function matrixGameValue(M: number[][]): number {
  const n = M.length, m = M[0].length;
  let mn = Infinity;
  for (const r of M) for (const v of r) mn = Math.min(mn, v);
  const shift = 1 - mn; // make all entries >= 1
  // column player LP: max sum z s.t. A z <= 1, z >= 0 (A = M + shift, rows = my strategies)
  // tableau rows 0..n-1 constraints, columns 0..m-1 z, m..m+n-1 slack, last = rhs
  const W = m + n + 1;
  const T: Float64Array[] = Array.from({ length: n + 1 }, () => new Float64Array(W));
  for (let i = 0; i < n; i++) { for (let j = 0; j < m; j++) T[i][j] = M[i][j] + shift; T[i][m + i] = 1; T[i][W - 1] = 1; }
  for (let j = 0; j < m; j++) T[n][j] = -1;
  const basis = Array.from({ length: n }, (_, i) => m + i);
  for (let it = 0; it < 200; it++) {
    let pc = -1;
    for (let j = 0; j < W - 1; j++) if (T[n][j] < -1e-14) { pc = j; break; } // Bland's rule
    if (pc < 0) break;
    let pr = -1, best = Infinity;
    for (let i = 0; i < n; i++) if (T[i][pc] > 1e-14) { const r = T[i][W - 1] / T[i][pc]; if (r < best - 1e-15 || (Math.abs(r - best) <= 1e-15 && basis[i] < basis[pr])) { best = r; pr = i; } }
    if (pr < 0) throw Error("unbounded LP (impossible for a positive matrix game)");
    const piv = T[pr][pc];
    for (let j = 0; j < W; j++) T[pr][j] /= piv;
    for (let i = 0; i <= n; i++) if (i !== pr && T[i][pc] !== 0) { const f = T[i][pc]; for (let j = 0; j < W; j++) T[i][j] -= f * T[pr][j]; }
    basis[pr] = pc;
  }
  return 1 / T[n][W - 1] - shift;
}

export type V7Banks = { banks: PolicyPmfBank[]; dp: PolicyPmfBank };
export type Side = { mask: number; u: number; x: number };

const pmfOf = (b: PolicyPmfBank, mask: number, u: number) => (mask ? b.get(mask, u) : ONE);

/** Mover's leaf value at a state where the mover's future is a policy-set commitment and the opponent's is DP. */
function policySetLeaf(B: V7Banks, me: Side, opCt: Credit): number {
  if (!me.mask) return dotCredit(ONE, me.x, opCt);
  let best = -Infinity;
  for (const b of B.banks) { const v = dotCredit(b.get(me.mask, me.u), me.x, opCt); if (v > best) best = v; }
  return best;
}

const turnBufs = new TurnBuffers();
const oppVal = new Float64Array(12 * 64);

/**
 * Value (for "me") after my scoring outcome, when the opponent now plays one turn
 * exactly, then my leaf. kind: I1 (opp reactive, policy-set objective), I1D (opp DP Expert turn),
 * I1R (opp reactive, v5-R objective).
 */
const mixBuf = new Float64Array(1024);
function oneReactiveOppTurn(B: V7Banks, me: Side, op: Side, kind: "I1" | "I1D" | "I1R" | "I1O" | "I1RO" | "I2" | "I2R" | "I2RO"): number {
  if (!op.mask) return dotCredit(me.mask ? B.dp.get(me.mask, me.u) : ONE, me.x, creditTable(op.x, ONE)); // unreachable in alternation, kept total
  // opponent stop values
  const myDp = pmfOf(B.dp, me.mask, me.u);
  const ctMeForOpp = creditTable(me.x, myDp); // opponent's credit vs my DP future
  for (let c = 0; c < 12; c++) {
    if (!(op.mask & (1 << c))) continue;
    const next = op.mask ^ (1 << c);
    for (const p of DISTINCT[c]) {
      const g = bonusGain(c, p, op.u), u2 = canonicalUpper(next, nextUpper(c, p, op.u)), x2 = op.x + g;
      let v: number;
      if (kind === "I1D") v = g + (next ? B.dp.meanOf(next, u2) : 0); // DP Expert: expected points
      else if (!next) v = dotCredit(ONE, x2, ctMeForOpp);
      else if (kind === "I1R" || kind === "I1RO" || kind === "I2R" || kind === "I2RO") v = dotCredit(B.dp.get(next, u2), x2, ctMeForOpp);
      else { v = -Infinity; for (const b of B.banks) { const w = dotCredit(b.get(next, u2), x2, ctMeForOpp); if (w > v) v = w; } }
      oppVal[c * 64 + p] = v;
    }
  }
  const out = turnOutcomesFromVal(op.mask, oppVal, turnBufs);
  if (kind === "I1O" || kind === "I1RO" || kind === "I2RO") {
    // opponent final-score mixture PMF, absolute scores offset by op.x
    let hi = 0;
    mixBuf.fill(0);
    for (let i = 0; i < out.keys.length; i++) {
      const k = out.keys[i], c = k >> 6, p = k & 63;
      const next = op.mask ^ (1 << c), g = bonusGain(c, p, op.u);
      const pm = pmfOf(B.dp, next, canonicalUpper(next, nextUpper(c, p, op.u))), w = out.prob[i];
      for (let j = 0; j < pm.length; j++) mixBuf[g + j] += w * pm[j];
      hi = Math.max(hi, g + pm.length);
    }
    const ct = creditTable(op.x, mixBuf.subarray(0, hi));
    return kind === "I2RO" ? myTurnP(B, me, ct) : policySetLeaf(B, me, ct);
  }
  // copy: the opponent outcome buffers are reused by the nested my-turn solve of I2
  const keys = Int32Array.from(out.keys), prob = Float64Array.from(out.prob);
  let s = 0;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i], c = k >> 6, p = k & 63;
    const next = op.mask ^ (1 << c), g = bonusGain(c, p, op.u);
    const u2 = canonicalUpper(next, nextUpper(c, p, op.u));
    const opCt = creditTable(op.x + g, pmfOf(B.dp, next, u2));
    s += prob[i] * (kind === "I2" || kind === "I2R" ? myTurnP(B, me, opCt) : policySetLeaf(B, me, opCt));
  }
  return s;
}

/** Exact value of MY next turn with P stop values (policy set after it) vs a fixed opponent credit table. */
const myBufs = new TurnBuffers(), myVal = new Float64Array(12 * 64);
function myTurnP(B: V7Banks, me: Side, opCt: Credit): number {
  if (!me.mask) return dotCredit(ONE, me.x, opCt);
  for (let c = 0; c < 12; c++) {
    if (!(me.mask & (1 << c))) continue;
    const next = me.mask ^ (1 << c);
    for (const p of DISTINCT[c]) {
      const g = bonusGain(c, p, me.u);
      myVal[c * 64 + p] = policySetLeaf(B, { mask: next, u: canonicalUpper(next, nextUpper(c, p, me.u)), x: me.x + g }, opCt);
    }
  }
  return turnStartValue(me.mask, myVal, myBufs);
}

/**
 * Fill mover stop values for estimator `kind` at the mover's turn start.
 * me = (mask, u, base) of the mover, op = opponent. Returns val (same buffer).
 */
export function fillStopValues(kind: V7Kind, B: V7Banks, me: Side, op: Side, val: Float64Array): Float64Array {
  const single = SINGLE_BANK[kind];
  if (single) return fillStopValues(single, { banks: [B.dp], dp: B.dp }, me, op, val);
  const u = Math.min(UPPER_CAP, me.u);
  const opDpCt = creditTable(op.x, pmfOf(B.dp, op.mask, op.u));
  const needSet = kind === "L" || kind === "Lm" || kind === "N" || kind === "MM";
  const opCts = needSet ? B.banks.map((b) => creditTable(op.x, pmfOf(b, op.mask, op.u))) : [];
  // I1 caches by my resulting state (several (c,p) share it rarely; cheap anyway)
  for (let c = 0; c < 12; c++) {
    if (!(me.mask & (1 << c))) continue;
    const next = me.mask ^ (1 << c);
    for (const p of DISTINCT[c]) {
      const g = bonusGain(c, p, u), u2 = canonicalUpper(next, nextUpper(c, p, u)), x2 = me.x + g;
      let v: number;
      switch (kind) {
        case "R": v = dotCredit(pmfOf(B.dp, next, u2), x2, opDpCt); break;
        case "P": v = policySetLeaf(B, { mask: next, u: u2, x: x2 }, opDpCt); break;
        case "I1": case "I1D": case "I1R": case "I1O": case "I1RO": case "I2": case "I2R": case "I2RO":
          v = op.mask ? oneReactiveOppTurn(B, { mask: next, u: u2, x: x2 }, op, kind) : policySetLeaf(B, { mask: next, u: u2, x: x2 }, opDpCt);
          break;
        default: {
          const mine = next ? B.banks.map((b) => b.get(next, u2)) : [ONE];
          const M = mine.map((pm) => opCts.map((ct) => dotCredit(pm, x2, ct)));
          if (kind === "L") v = Math.max(...M.map((r) => Math.min(...r)));
          else if (kind === "Lm") v = Math.max(...M.map((r) => r.reduce((a, b) => a + b, 0) / r.length));
          else if (kind === "MM") { v = Infinity; for (let j = 0; j < opCts.length; j++) { let mx = -Infinity; for (const r of M) mx = Math.max(mx, r[j]); v = Math.min(v, mx); } }
          else v = M.length === 1 ? Math.min(...M[0]) : matrixGameValue(M);
        }
      }
      val[c * 64 + p] = v;
    }
  }
  return val;
}
