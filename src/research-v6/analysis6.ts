// Versioned review/analysis interface "yachtlab-analysis-v6" (research engine, no UI).
// Extends src/research-v5/analysis.ts (unchanged, still exported) with:
//   - win / tie / loss probabilities per action (not only win credit)
//   - pre-roll (turn-start) value and a decision-loss vs dice-luck decomposition
//   - explicit model / config / exactness / budget metadata
// Values are exact probabilities UNDER THE STATED MODEL (opponent future = fixed
// policy PMF, or exact interactive expectiminimax in the endgame window). They are
// not "the true optimal win rate"; see accuracy.measuredError for validated error.
// Only public information (scorecards, dice values, rolls, player) is read.
// Actions are final decisions per roll (score a category, or keep a multiset and
// re-roll the rest); individual keep toggles are UI steps, not separate actions.
import { categories, total, upper, type Game, type Category } from "../engine";
import {
  FULL, PROB, POINTS, HOLD_START, HOLD_LIST, STATES, FULL_INDEX, chance, popcount, canonicalUpper, nextUpper, UPPER_CAP,
} from "../research-v5/kernel";
import { creditTable, PolicyPmfBank } from "../research-v5/policy-pmf";
import { maskOf, scoreDiffPmf, winDPv5Decision, type V5Action } from "../research-v5/apex";
import { winDPv6Decision, clearV6Cache, V6_VERSION, type V6Config } from "./apex6";
import { DISTINCT, bonusGain } from "./risk";

const EPS = 1e-12;
export type V6ActionAnalysis = {
  kind: "score" | "reroll";
  category?: Category;
  /** die ids to KEEP (kind = "reroll"; same as the engine "hold" action) and their values */
  ids?: number[];
  kept?: number[];
  label: string;
  winCredit: number;
  pWin: number | null;
  pTie: number | null;
  pLoss: number | null;
  /** expected own final total if DP Expert expected-points play followed (secondary ranking key) */
  expectedFinal: number;
  lossVsBest: number;
  tiedWithBest: boolean;
};
export type V6Analysis = {
  schema: "yachtlab-analysis-v6";
  model: { name: string; version: string; stage: string; policySet: string[]; opponentModel: string; depth: number; brWindow: number; minimaxWindow: number };
  exactness: { kind: "exact-interactive" | "exact-vs-fixed-opponent-distribution"; note: string; numericTolerance: number };
  budget: { budgetMs: number; elapsedMs: number };
  position: { player: 0 | 1; rollsUsed: number; rollsLeft: number; dice: number[]; myTotal: number; opponentTotal: number; myRemaining: number; opponentRemaining: number };
  /** Model value at the start of this turn, before the first roll (same model). */
  preRollValue: number;
  /** Model value of the current (rolled) position = best action's win credit. */
  currentValue: number;
  actions: V6ActionAnalysis[];
  best: { label: string; tiedActions: string[] };
  played?: V6ActionAnalysis & { winCreditLoss: number; expectedPointsLoss: number };
  /** Exact distribution of (my final - opponent final) if both follow DP Expert from now (v5 helper, for charts). */
  scoreDiffDPExpert: { offset: number; pmf: number[] };
  accuracy: { measuredError: string };
};
export const V6_LIVE = { name: "v6-live", depth: 1, brWindow: 4, minimaxWindow: 0, budgetMs: 50 } as const;
export const V6_REVIEW = { name: "v6-review", depth: 2, brWindow: 6, minimaxWindow: 3, budgetMs: 5000 } as const;

type Triple = { c: Float64Array; w: Float64Array; t: Float64Array }; // credit, P(win), P(tie)
const triple = (n: number): Triple => ({ c: new Float64Array(n), w: new Float64Array(n), t: new Float64Array(n) });

/** Open-loop best response searcher that carries P(win) and P(tie) along the credit-optimal policy. */
class TripleSearch {
  memo = new Map<number, [number, number, number]>();
  constructor(readonly banks: PolicyPmfBank[], readonly oppPmf: Float64Array, readonly oBase: number) {}
  terminal(x: number): [number, number, number] {
    // P(opp final < x), P(opp final = x)
    let below = 0, eq = 0;
    for (let g = 0; g < this.oppPmf.length; g++) { const y = this.oBase + g; if (y < x) below += this.oppPmf[g]; else if (y === x) eq += this.oppPmf[g]; }
    return [below + eq / 2, below, eq];
  }
  leaf(mask: number, u: number, x: number): [number, number, number] {
    const ct = creditTable(this.oBase, this.oppPmf);
    let best: [number, number, number] = [-Infinity, 0, 0];
    for (const bank of this.banks) {
      const pmf = bank.get(mask, u);
      let c = 0, w = 0, t = 0;
      for (let g = 0; g < pmf.length; g++) {
        const q = pmf[g]; if (!q) continue;
        const i = x + g - ct.lo;
        const cr = i <= 0 ? 0 : i >= ct.len + 1 ? 1 : ct.table[i];
        const tie = i <= 0 || i >= ct.len + 1 ? 0 : this.oppPmf[i - 1];
        c += q * cr; t += q * tie; w += q * (cr - tie / 2);
      }
      if (c > best[0] + 1e-15) best = [c, w, t];
    }
    return best;
  }
  value(mask: number, u: number, x: number, depth: number): [number, number, number] {
    if (mask === 0) return this.terminal(x);
    u = canonicalUpper(mask, u);
    if (depth <= 0) return this.leaf(mask, u, x);
    const key = ((mask * 64 + u) * 1024 + (x + 200)) * 16 + depth;
    const hit = this.memo.get(key);
    if (hit) return hit;
    const st = triple(12 * 64);
    this.fill(mask, u, x, depth - 1, st);
    const v = turnTriple(mask, st);
    this.memo.set(key, v);
    return v;
  }
  fill(mask: number, u: number, x: number, childDepth: number, st: Triple) {
    for (let c = 0; c < 12; c++) {
      if (!(mask & (1 << c))) continue;
      const next = mask ^ (1 << c);
      for (const p of DISTINCT[c]) {
        const [cc, w, t] = this.value(next, nextUpper(c, p, u), x + bonusGain(c, p, u), childDepth);
        st.c[c * 64 + p] = cc; st.w[c * 64 + p] = w; st.t[c * 64 + p] = t;
      }
    }
  }
}

/** Same policy as src/research-v6/turn.ts (first strict max) carrying win/tie along. */
function stopTriple(mask: number, st: Triple): Triple {
  const out = triple(FULL);
  for (let d = 0; d < FULL; d++) {
    let best = -Infinity, k = -1;
    for (let c = 0; c < 12; c++) if (mask & (1 << c)) { const kk = c * 64 + POINTS[d * 12 + c]; if (st.c[kk] > best) { best = st.c[kk]; k = kk; } }
    out.c[d] = best; out.w[d] = st.w[k]; out.t[d] = st.t[k];
  }
  return out;
}
function rollTriple(stop: Triple, prev: Triple): Triple {
  const ec = chance(prev.c), ew = chance(prev.w), et = chance(prev.t);
  const out = triple(FULL);
  for (let d = 0; d < FULL; d++) {
    let bc = stop.c[d], bw = stop.w[d], bt = stop.t[d];
    for (let i = HOLD_START[d], end = HOLD_START[d + 1] - 1; i < end; i++) { const h = HOLD_LIST[i]; if (ec[h] > bc) { bc = ec[h]; bw = ew[h]; bt = et[h]; } }
    out.c[d] = bc; out.w[d] = bw; out.t[d] = bt;
  }
  return out;
}
function turnTriple(mask: number, st: Triple): [number, number, number] {
  const s0 = stopTriple(mask, st), l1 = rollTriple(s0, s0), l2 = rollTriple(s0, l1);
  let c = 0, w = 0, t = 0;
  for (let d = 0; d < FULL; d++) { c += PROB[d] * l2.c[d]; w += PROB[d] * l2.w[d]; t += PROB[d] * l2.t[d]; }
  return [c, w, t];
}

type AnalysisEngine = { name: string; depth: number; brWindow: number; minimaxWindow: number; budgetMs: number };

type Played = { type: "score"; category: string } | { type: "reroll"; ids: number[] };
const same = (a: { kind: string; category?: string; ids?: number[] }, p: Played) =>
  p.type === "score" ? a.kind === "score" && a.category === p.category : a.kind === "reroll" && [...(a.ids ?? [])].sort().join() === [...p.ids].sort().join();

export function analyzeV6(state: Game, cfg: V6Config, engine: AnalysisEngine = { ...V6_REVIEW, brWindow: cfg.brWindow ?? V6_REVIEW.brWindow }, played?: Played): V6Analysis {
  const t0 = performance.now();
  const me = state.player, opp = 1 - me;
  const mask = maskOf(state.cards[me]), oMask = maskOf(state.cards[opp]);
  const u = Math.min(UPPER_CAP, upper(state.cards[me])), uo = Math.min(UPPER_CAP, upper(state.cards[opp]));
  const base = total(state.cards[me]), oBase = total(state.cards[opp]);
  const k = popcount(mask), ko = popcount(oMask);
  const interactive = engine.minimaxWindow > 0 && k <= engine.minimaxWindow && ko <= engine.minimaxWindow;
  const run = { ...cfg, depth: engine.depth, brWindow: engine.brWindow, endgame: interactive ? ("minimax" as const) : ("none" as const), minimaxWindow: engine.minimaxWindow };
  clearV6Cache();
  const d = interactive ? winDPv5Decision(state, run) : winDPv6Decision(state, run);
  const oppPmf = (cfg.opponentBank ?? cfg.bank).get(oMask, uo);
  const search = new TripleSearch(cfg.banks, oppPmf, oBase);
  const depth = engine.brWindow && k <= engine.brWindow ? k : Math.max(1, engine.depth);
  // per-stop (c,p) triples at the root, then exact within-turn backups for each roll level
  let rootT: Triple | null = null;
  if (!interactive) { rootT = triple(12 * 64); search.fill(mask, u, base, depth - 1, rootT); }
  const dice = state.dice.map((x) => x.value);
  const d0 = FULL_INDEX.get([...dice].sort((a, b) => a - b).join(""))!;
  const left = 3 - state.rolls;
  const tripleOf = (a: V5Action): [number | null, number | null] => {
    if (!rootT) return [null, null];
    if (a.kind === "score") { const kk = categories.indexOf(a.category!) * 64 + POINTS[d0 * 12 + categories.indexOf(a.category!)]; return [rootT.w[kk], rootT.t[kk]]; }
    const s0 = stopTriple(mask, rootT);
    let lvl = s0;
    for (let r = 1; r < left; r++) lvl = rollTriple(s0, lvl);
    const ew = chance(lvl.w), et = chance(lvl.t);
    const kept = a.label.replace("고정 ", "").split("·").filter((x) => x !== "없음").map(Number);
    let h = -1;
    for (let i = HOLD_START[d0]; i < HOLD_START[d0 + 1] - 1; i++) if (STATES[HOLD_LIST[i]].join("·") === kept.join("·")) h = HOLD_LIST[i];
    return h < 0 ? [null, null] : [ew[h], et[h]];
  };
  const actions: V6ActionAnalysis[] = d.analysis.map((a) => {
    const [w, t] = tripleOf(a);
    const kept = a.kind === "reroll" ? state.dice.filter((x) => a.ids!.includes(x.id)).map((x) => x.value).sort((p, q) => p - q) : undefined;
    return { kind: a.kind, category: a.category, ids: a.ids, kept, label: a.label, winCredit: a.winCredit, pWin: w, pTie: t, pLoss: w === null || t === null ? null : Math.max(0, 1 - w - t), expectedFinal: a.expectedFinal, lossVsBest: d.analysis[0].winCredit - a.winCredit, tiedWithBest: d.analysis[0].winCredit - a.winCredit <= EPS };
  });
  const preRollValue = interactive ? NaN : search.value(mask, u, base, depth)[0];
  let playedOut: V6Analysis["played"];
  if (played) {
    const a = actions.find((x) => same(x, played));
    if (!a) throw Error("played action is not legal in this state");
    playedOut = { ...a, winCreditLoss: actions[0].winCredit - a.winCredit, expectedPointsLoss: Math.max(...actions.map((x) => x.expectedFinal)) - a.expectedFinal };
  }
  const diff = scoreDiffPmf(state, cfg.bank);
  return {
    schema: "yachtlab-analysis-v6",
    model: { name: engine.name, version: V6_VERSION, stage: d.stage, policySet: cfg.banks.map((b) => b.name), opponentModel: `fixed ${(cfg.opponentBank ?? cfg.bank).name} future-score PMF`, depth: engine.depth, brWindow: engine.brWindow, minimaxWindow: engine.minimaxWindow },
    exactness: interactive
      ? { kind: "exact-interactive", note: "exact two-player expectiminimax over all remaining categories (both maximise win credit)", numericTolerance: EPS }
      : { kind: "exact-vs-fixed-opponent-distribution", note: depth >= k ? "exact optimal response over all my remaining turns to the opponent's fixed future-score distribution (non-reactive opponent model)" : `my next ${depth} turn(s) solved exactly, then the best of the policy set; opponent future fixed`, numericTolerance: EPS },
    budget: { budgetMs: engine.budgetMs, elapsedMs: performance.now() - t0 },
    position: { player: me as 0 | 1, rollsUsed: state.rolls, rollsLeft: left, dice, myTotal: base, opponentTotal: oBase, myRemaining: k, opponentRemaining: ko },
    preRollValue, currentValue: actions[0].winCredit, actions,
    best: { label: actions[0].label, tiedActions: actions.filter((a) => a.tiedWithBest).map((a) => a.label) },
    played: playedOut,
    scoreDiffDPExpert: { offset: diff.offset, pmf: Array.from(diff.pmf) },
    accuracy: { measuredError: "see docs/context/V6-APEX-RESEARCH.md §value accuracy (MAE vs exact interactive value by remaining categories)" },
  };
}

/**
 * Decision vs luck decomposition of one step (same model for both positions):
 *   decisionLoss = value(best action at `before`) - value(played action at `before`)
 *   luck         = value(`after`, the next decision point) - value(played action at `before`)
 * Only uses the two public positions; never the RNG.
 */
export function decomposeStep(before: Game, played: Played, after: Game, cfg: V6Config, engine?: AnalysisEngine) {
  const a = analyzeV6(before, cfg, engine, played);
  if (after.player !== before.player) throw Error("after must be the same player's next decision (use preRollValue of their next turn otherwise)");
  const b = analyzeV6(after, cfg, engine);
  return { decisionLoss: a.played!.winCreditLoss, luck: b.currentValue - a.played!.winCredit, before: a.currentValue, playedValue: a.played!.winCredit, after: b.currentValue };
}
