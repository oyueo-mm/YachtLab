// Win DP v5 research engine (method axes A/B/F): exact policy-PMF rollout and
// an exact interactive two-player endgame solver for Nintendo-style 12-category
// Yacht Dice. Research-only: NOT registered in src/ai.ts and NOT a default AI.
//
// Objective: win credit = P(win) + 0.5 P(tie) for the player to move.
//
// Stages (chosen per decision from the public scorecards only):
//  - "rollout": exact one-turn policy improvement. Every scoring outcome of the
//    current turn is valued by the exact probability of winning if, afterwards,
//    BOTH players follow DP Expert (independent exact future-score PMFs from the
//    PMF bank). Within the turn, re-roll choices are solved exactly by chance
//    backups. This is a rollout (policy-improvement) step over DP Expert; it is
//    not the optimal response to a reactive opponent.
//  - "minimax": exact expectiminimax (negamax with chance nodes) when both
//    players have at most `minimaxWindow` categories left, i.e. both players are
//    assumed to maximise their own win credit. Exact up to Float64 rounding;
//    safe pruning only when the result is mathematically decided.
//  - "v2": delegate to the deployed Win DP v2 (for the v5-A ablation).
//
// Fairness boundary: only state.cards, state.dice values, state.rolls and
// state.player are read. The engine seed / RNG state are never read.
import { categories, upper, total, type Game, type Category } from "../engine";
import type { Candidate, Decision } from "../ai";
import {
  FULL, PROB, POINTS, HOLD_START, HOLD_LIST, STATES, FULL_INDEX, OFFSET,
  chance, popcount, gainOf, nextUpper, canonicalUpper, upperHeadroom, UPPER_CAP,
} from "./kernel";
import { PolicyPmfBank, creditTable, turnOutcomes, TurnScratch } from "./policy-pmf";

export const V5_VERSION = "v5-research-2026-11-25.1";
const EPS = 1e-12;
const MAX_RAW = [5, 10, 15, 20, 25, 30, 30, 30, 28, 15, 30, 50];
/** Distinct raw points of category c over all 252 multisets. */
const DISTINCT: number[][] = Array.from({ length: 12 }, (_, c) => {
  const s = new Set<number>();
  for (let d = 0; d < FULL; d++) s.add(POINTS[d * 12 + c]);
  return [...s].sort((a, b) => a - b);
});

export type EndgameMode = "none" | "minimax" | "v2";
export type V5Config = {
  /** Exact future-score PMF of the policy assumed after the current turn (DP Expert). */
  bank: PolicyPmfBank;
  /** PMF bank used for the opponent's future (defaults to `bank`). */
  opponentBank?: PolicyPmfBank;
  /** DP Expert expected-future table, used only as secondary tie-break (expected points). */
  dpValue: (mask: number, u: number) => number;
  endgame: EndgameMode;
  /** Both players' remaining categories <= window -> exact minimax (default 2). */
  minimaxWindow?: number;
  /** Disable the rollout stage (DP Expert before the endgame) for ablations. */
  rollout?: boolean;
  /** Fallback for endgame "v2". */
  v2?: (state: Game) => Decision | null;
  dpDecision?: (state: Game) => Decision;
};

const maskOf = (card: Game["cards"][number]) => categories.reduce((m, c, i) => (card[c] === undefined ? m | (1 << i) : m), 0);
export const maxGain = (mask: number, u: number) => {
  let s = 0;
  for (let c = 0; c < 12; c++) if (mask & (1 << c)) s += MAX_RAW[c];
  const um = Math.min(UPPER_CAP, u);
  if ((mask & 63) && um < UPPER_CAP && um + upperHeadroom(mask) >= UPPER_CAP) s += 35;
  return s;
};

// ---------------------------------------------------------------------------
// Exact interactive endgame: negamax with chance nodes.
// V(Mm, um, Mo, uo, D) = win credit of the player to move, D = mover total - opponent total.
// ---------------------------------------------------------------------------
class Scratch {
  val = new Float64Array(12 * 64);
  stop = new Float64Array(FULL);
  v1 = new Float64Array(FULL);
  e = new Float64Array(462);
}
const scratch: Scratch[] = Array.from({ length: 26 }, () => new Scratch());
const memo = new Map<number, number>();
export const solverStats = { nodes: 0, memoHits: 0, pruned: 0 };
const MEMO_LIMIT = 6_000_000;
export function clearEndgameMemo() { memo.clear(); }

function turnStartValue(mask: number, s: Scratch): number {
  const { val, stop, v1, e } = s;
  for (let d = 0; d < FULL; d++) {
    let best = -Infinity;
    for (let c = 0; c < 12; c++) if (mask & (1 << c)) { const v = val[c * 64 + POINTS[d * 12 + c]]; if (v > best) best = v; }
    stop[d] = best;
  }
  chance(stop, e);
  for (let d = 0; d < FULL; d++) {
    let best = stop[d];
    for (let i = HOLD_START[d], end = HOLD_START[d + 1] - 1; i < end; i++) { const v = e[HOLD_LIST[i]]; if (v > best) best = v; }
    v1[d] = best;
  }
  chance(v1, e);
  let total2 = 0;
  for (let d = 0; d < FULL; d++) {
    let best = stop[d];
    for (let i = HOLD_START[d], end = HOLD_START[d + 1] - 1; i < end; i++) { const v = e[HOLD_LIST[i]]; if (v > best) best = v; }
    total2 += PROB[d] * best;
  }
  return total2;
}

export function endgameValue(Mm: number, um: number, Mo: number, uo: number, D: number, depth = 0): number {
  if (Mm === 0) {
    if (Mo !== 0) throw Error("alternation violated: mover finished before opponent");
    return D > 0 ? 1 : D === 0 ? 0.5 : 0;
  }
  um = canonicalUpper(Mm, um); uo = canonicalUpper(Mo, uo);
  if (D > maxGain(Mo, uo)) { solverStats.pruned++; return 1; }
  if (D + maxGain(Mm, um) < 0) { solverStats.pruned++; return 0; }
  const key = ((((Mm * 64 + um) * 4096 + Mo) * 64 + uo) * 2048) + (D + 1024);
  const hit = memo.get(key);
  if (hit !== undefined) { solverStats.memoHits++; return hit; }
  solverStats.nodes++;
  const s = scratch[depth];
  fillEndgameStopValues(Mm, um, Mo, uo, D, depth, s.val);
  const v = turnStartValue(Mm, s);
  if (memo.size >= MEMO_LIMIT) memo.clear();
  memo.set(key, v);
  return v;
}

function fillEndgameStopValues(Mm: number, um: number, Mo: number, uo: number, D: number, depth: number, val: Float64Array) {
  for (let c = 0; c < 12; c++) {
    if (!(Mm & (1 << c))) continue;
    const next = Mm ^ (1 << c);
    for (const p of DISTINCT[c]) {
      const g = p + (c < 6 && um < UPPER_CAP && um + p >= UPPER_CAP ? 35 : 0);
      val[c * 64 + p] = 1 - endgameValue(Mo, uo, next, nextUpper(c, p, um), -(D + g), depth + 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Root decision with lexicographic (win credit, expected final points).
// ---------------------------------------------------------------------------
type RootValues = { w: Float64Array; p: Float64Array }; // indexed c*64 + raw points

function decideFromStopValues(state: Game, mask: number, root: RootValues, note: string, stage: string): V5Decision {
  const dice = state.dice.map((d) => d.value);
  const d0 = FULL_INDEX.get([...dice].sort((a, b) => a - b).join(""))!;
  const left = 3 - state.rolls;
  const stopW = new Float64Array(FULL), stopP = new Float64Array(FULL), stopC = new Int16Array(FULL);
  for (let d = 0; d < FULL; d++) {
    let bw = -Infinity, bp = -Infinity, bc = -1;
    for (let c = 0; c < 12; c++) if (mask & (1 << c)) {
      const k = c * 64 + POINTS[d * 12 + c], w = root.w[k], p = root.p[k];
      if (w > bw + EPS || (Math.abs(w - bw) <= EPS && p > bp + EPS)) { bw = w; bp = p; bc = c; }
    }
    stopW[d] = bw; stopP[d] = bp; stopC[d] = bc;
  }
  const levelsW = [stopW], levelsP = [stopP];
  for (let r = 1; r < left; r++) {
    const ew = chance(levelsW[r - 1]), ep = chance(levelsP[r - 1]);
    const nw = new Float64Array(FULL), np = new Float64Array(FULL);
    for (let d = 0; d < FULL; d++) {
      let bw = stopW[d], bp = stopP[d];
      for (let i = HOLD_START[d], end = HOLD_START[d + 1] - 1; i < end; i++) {
        const h = HOLD_LIST[i];
        if (ew[h] > bw + EPS || (Math.abs(ew[h] - bw) <= EPS && ep[h] > bp + EPS)) { bw = ew[h]; bp = ep[h]; }
      }
      nw[d] = bw; np[d] = bp;
    }
    levelsW.push(nw); levelsP.push(np);
  }
  const actions: V5Action[] = [];
  for (let c = 0; c < 12; c++) if (mask & (1 << c)) {
    const k = c * 64 + POINTS[d0 * 12 + c];
    actions.push({ kind: "score", category: categories[c], label: categories[c], winCredit: root.w[k], expectedFinal: root.p[k] });
  }
  if (left > 0) {
    const ew = chance(levelsW[left - 1]), ep = chance(levelsP[left - 1]);
    for (let i = HOLD_START[d0], end = HOLD_START[d0 + 1] - 1; i < end; i++) {
      const h = HOLD_LIST[i], kept = [...STATES[h]];
      const ids = state.dice.filter((die) => { const j = kept.indexOf(die.value); if (j < 0) return false; kept.splice(j, 1); return true; }).map((die) => die.id);
      actions.push({ kind: "reroll", ids, label: "고정 " + (STATES[h].join("·") || "없음"), winCredit: ew[h], expectedFinal: ep[h] });
    }
  }
  // stable lexicographic order; scores come first on exact ties (as in dp.ts)
  const order = actions.map((a, i) => ({ a, i })).sort((x, y) => {
    if (Math.abs(x.a.winCredit - y.a.winCredit) > EPS) return y.a.winCredit - x.a.winCredit;
    if (Math.abs(x.a.expectedFinal - y.a.expectedFinal) > EPS) return y.a.expectedFinal - x.a.expectedFinal;
    return x.i - y.i;
  }).map((x) => x.a);
  const best = order[0];
  for (const a of order) a.lossVsBest = best.winCredit - a.winCredit;
  const candidates: Candidate[] = order.map((a) => ({ label: a.label, value: a.winCredit }));
  const common = { value: best.winCredit, candidates, note, stage, analysis: order };
  return best.kind === "score"
    ? { type: "score", category: best.category!, ...common }
    : { type: "reroll", ids: best.ids!, ...common };
}

export type V5Action = { kind: "score" | "reroll"; category?: Category; ids?: number[]; label: string; winCredit: number; expectedFinal: number; lossVsBest?: number };
export type V5Decision = Decision & { stage: string; analysis: V5Action[] };

/** Expected-points secondary: base + gain + DP future (identical to DP Expert Q values up to rounding). */
function fillPoints(mask: number, u: number, base: number, cfg: V5Config, out: Float64Array) {
  for (let c = 0; c < 12; c++) if (mask & (1 << c)) {
    const next = mask ^ (1 << c);
    for (const p of DISTINCT[c]) {
      const g = p + (c < 6 && u < UPPER_CAP && u + p >= UPPER_CAP ? 35 : 0);
      out[c * 64 + p] = base + g + (next ? cfg.dpValue(next, canonicalUpper(next, nextUpper(c, p, u))) : 0);
    }
  }
}

export function winDPv5Decision(state: Game, cfg: V5Config): V5Decision {
  if (state.done || !state.rolls) throw Error("v5 requires a rolled public state");
  const me = state.player, opp = 1 - me;
  const mask = maskOf(state.cards[me]), oMask = maskOf(state.cards[opp]);
  const u = Math.min(UPPER_CAP, upper(state.cards[me])), uo = Math.min(UPPER_CAP, upper(state.cards[opp]));
  const base = total(state.cards[me]), oBase = total(state.cards[opp]);
  const k = popcount(mask), ko = popcount(oMask);
  const window = cfg.minimaxWindow ?? 2;
  const root: RootValues = { w: new Float64Array(12 * 64), p: new Float64Array(12 * 64) };
  fillPoints(mask, u, base, cfg, root.p);
  if (cfg.endgame === "minimax" && k <= window && ko <= window) {
    fillEndgameStopValues(mask, canonicalUpper(mask, u), oMask, canonicalUpper(oMask, uo), base - oBase, 1, root.w);
    return decideFromStopValues(state, mask, root, `Win DP v5 · exact interactive expectiminimax (both ≤${window} categories) · win+0.5 tie`, "minimax");
  }
  if (cfg.endgame === "v2" && k <= 2) {
    const d = cfg.v2?.(state);
    if (d) return { ...d, stage: "v2", analysis: [] };
  }
  if (cfg.rollout === false) {
    const d = cfg.dpDecision!(state);
    return { ...d, stage: "dp", analysis: [] };
  }
  // exact one-turn rollout over DP Expert futures for both players
  const oBank = cfg.opponentBank ?? cfg.bank;
  const ct = creditTable(oBase, oBank.get(oMask, uo));
  for (let c = 0; c < 12; c++) if (mask & (1 << c)) {
    const next = mask ^ (1 << c);
    for (const p of DISTINCT[c]) {
      const g = p + (c < 6 && u < UPPER_CAP && u + p >= UPPER_CAP ? 35 : 0);
      const pmf = cfg.bank.get(next, nextUpper(c, p, u));
      const x0 = base + g;
      let s = 0;
      // credit(x) is a lookup: index i = x - lo
      for (let gg = 0; gg < pmf.length; gg++) {
        const q = pmf[gg];
        if (q === 0) continue;
        const i = x0 + gg - ct.lo;
        s += q * (i <= 0 ? 0 : i >= ct.len + 1 ? 1 : ct.table[i]);
      }
      root.w[c * 64 + p] = s;
    }
  }
  return decideFromStopValues(state, mask, root, "Win DP v5 · exact one-turn win-credit rollout over exact DP Expert future-score PMFs (both players)", "rollout");
}

/** Exact distribution of (my final - opponent final) if both follow DP Expert from now (review/analysis helper). */
export function scoreDiffPmf(state: Game, bank: PolicyPmfBank) {
  const me = state.player, opp = 1 - me;
  const a = bank.get(maskOf(state.cards[me]), upper(state.cards[me]));
  const b = bank.get(maskOf(state.cards[opp]), upper(state.cards[opp]));
  const off = total(state.cards[me]) - total(state.cards[opp]) - (b.length - 1);
  const out = new Float64Array(a.length + b.length - 1);
  for (let i = 0; i < a.length; i++) if (a[i]) for (let j = 0; j < b.length; j++) out[i + (b.length - 1 - j)] += a[i] * b[j];
  return { offset: off, pmf: out };
}
export { OFFSET };

/**
 * Decision of the W-greedy stationary policy (the policy whose exact PMF a
 * PolicyPmfBank with the same W stores). W = DP table reproduces DP Expert up to
 * floating-point tie order; W = 0 is the myopic "best points this turn" policy.
 */
export function wGreedyDecision(state: Game, W: (mask: number, u: number) => number, name = "W-greedy"): V5Decision {
  const me = state.player, mask = maskOf(state.cards[me]);
  const u = Math.min(UPPER_CAP, upper(state.cards[me])), base = total(state.cards[me]);
  const root: RootValues = { w: new Float64Array(12 * 64), p: new Float64Array(12 * 64) };
  for (let c = 0; c < 12; c++) if (mask & (1 << c)) {
    const next = mask ^ (1 << c);
    for (const p of DISTINCT[c]) {
      const g = p + (c < 6 && u < UPPER_CAP && u + p >= UPPER_CAP ? 35 : 0);
      root.w[c * 64 + p] = root.p[c * 64 + p] = base + g + (next ? W(next, canonicalUpper(next, nextUpper(c, p, u))) : 0);
    }
  }
  return decideFromStopValues(state, mask, root, name + " (expected points w.r.t. continuation W)", name);
}

/** Rollout against an arbitrary opponent future-score PMF (used by the Bayesian agent). */
export function winDPv5WithOpponentPmf(state: Game, cfg: V5Config, oppPmf: Float64Array): V5Decision {
  const fake = new PolicyPmfBank("opponent-mixture", () => 0);
  const oMask = maskOf(state.cards[1 - state.player]);
  const uo = Math.min(UPPER_CAP, upper(state.cards[1 - state.player]));
  fake.pmf[oMask * 64 + canonicalUpper(oMask, uo)] = oppPmf;
  return winDPv5Decision(state, { ...cfg, opponentBank: fake });
}
export { maskOf };

// ---------------------------------------------------------------------------
// v5-E: depth-2 PMF-Expectimax for the scoring decision, gated by value of information.
// my score (c,p) -> opponent's next turn (exact DP Expert outcome distribution)
// -> my next turn optimised by the exact rollout -> both DP Expert afterwards.
// Applied only when the rollout wants to stop and its best two categories are
// within `gap` win credit (adaptive compute). Not exact optimal play.
// ---------------------------------------------------------------------------
const oppTurnCache = new Map<number, { keys: Int32Array; prob: Float64Array }>();
const d2Scratch = new Scratch();
const d2Turn = new TurnScratch();

function rolloutTurnStart(myMask: number, myU: number, myBase: number, oMask: number, oU: number, oBase: number, cfg: V5Config): number {
  if (myMask === 0) { const D = myBase - oBase; return D > 0 ? 1 : D === 0 ? 0.5 : 0; }
  const ct = creditTable(oBase, (cfg.opponentBank ?? cfg.bank).get(oMask, oU));
  const val = d2Scratch.val;
  for (let c = 0; c < 12; c++) if (myMask & (1 << c)) {
    const next = myMask ^ (1 << c);
    for (const p of DISTINCT[c]) {
      const g = p + (c < 6 && myU < UPPER_CAP && myU + p >= UPPER_CAP ? 35 : 0);
      const pmf = cfg.bank.get(next, nextUpper(c, p, myU));
      const x0 = myBase + g - ct.lo;
      let s = 0;
      for (let gg = 0; gg < pmf.length; gg++) { const q = pmf[gg]; if (q === 0) continue; const i = x0 + gg; s += q * (i <= 0 ? 0 : i >= ct.len + 1 ? 1 : ct.table[i]); }
      val[c * 64 + p] = s;
    }
  }
  return turnStartValue(myMask, d2Scratch);
}

export type V5EConfig = V5Config & { gap?: number };
export const depth2Stats = { calls: 0, changed: 0 };
export function winDPv5EDecision(state: Game, cfg: V5EConfig): V5Decision {
  const base = winDPv5Decision(state, cfg);
  if (base.stage !== "rollout" || base.type !== "score") return base;
  const scores = base.analysis.filter((a) => a.kind === "score");
  if (scores.length < 2 || scores[0].winCredit - scores[1].winCredit > (cfg.gap ?? 0.02)) return base;
  const me = state.player, opp = 1 - me;
  const mask = maskOf(state.cards[me]), oMask = maskOf(state.cards[opp]);
  const u = Math.min(UPPER_CAP, upper(state.cards[me])), uo = canonicalUpper(oMask, Math.min(UPPER_CAP, upper(state.cards[opp])));
  const T = total(state.cards[me]), To = total(state.cards[opp]);
  const okey = oMask * 64 + uo;
  let ot = oppTurnCache.get(okey);
  if (!ot) { ot = turnOutcomes(oMask, uo, cfg.bank.W, d2Turn); if (oppTurnCache.size > 50000) oppTurnCache.clear(); oppTurnCache.set(okey, ot); }
  depth2Stats.calls++;
  const dice = state.dice.map((d) => d.value);
  const d0 = FULL_INDEX.get([...dice].sort((a, b) => a - b).join(""))!;
  let best: V5Action | null = null, bestV = -Infinity;
  const evals: V5Action[] = [];
  for (const a of scores) {
    const c = categories.indexOf(a.category!), p = POINTS[d0 * 12 + c];
    const g = gainOf(d0, c, u), M1 = mask ^ (1 << c), u1 = canonicalUpper(M1, nextUpper(c, p, u));
    let v = 0;
    for (let i = 0; i < ot.keys.length; i++) {
      const k = ot.keys[i], oc = k >> 6, op = k & 63;
      const og = op + (oc < 6 && uo < UPPER_CAP && uo + op >= UPPER_CAP ? 35 : 0);
      const oM1 = oMask ^ (1 << oc), ou1 = canonicalUpper(oM1, nextUpper(oc, op, uo));
      v += ot.prob[i] * rolloutTurnStart(M1, u1, T + g, oM1, ou1, To + og, cfg);
    }
    evals.push({ ...a, winCredit: v });
    if (v > bestV + EPS) { bestV = v; best = a; }
  }
  if (best!.category !== base.category) depth2Stats.changed++;
  return { ...base, type: "score", category: best!.category!, value: bestV, stage: "rollout+depth2", note: base.note + " · depth-2 PMF-expectimax category re-evaluation (VOI-gated)", analysis: [...evals.sort((x, y) => y.winCredit - x.winCredit), ...base.analysis.filter((x) => x.kind === "reroll")] };
}
