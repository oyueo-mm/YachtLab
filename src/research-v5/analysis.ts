// Common solver analysis interface for a future AI review (복기) feature.
// No UI here. A real-time engine and a high-precision review engine share the
// same output schema and differ only in configuration / compute budget.
import { categories, total, upper, type Game } from "../engine";
import { winDPv5Decision, scoreDiffPmf, V5_VERSION, type V5Config, type V5Action } from "./apex";
import { FULL, OFFSET, PARTIAL_INDEX, STATES, CHILD } from "./kernel";

export type AnalysisAccuracy = {
  /** "exact": exact expectiminimax win credit (Float64); "rollout": exact value of
   *  "this turn optimised, then both play DP Expert" (a policy-improvement estimate,
   *  not the value of optimal play). */
  kind: "exact" | "rollout" | "delegated";
  note: string;
  /** Float64 rounding of probabilities; tie tolerance used when ranking actions. */
  numericTolerance: number;
};
export type PositionAnalysis = {
  model: string;
  version: string;
  stage: string;
  budgetMs: number;
  elapsedMs: number;
  player: 0 | 1;
  rollsUsed: number;
  actions: V5Action[];
  best: V5Action;
  /** Present when a played action is supplied: its win-credit loss vs the best action. */
  played?: V5Action & { winCreditLoss: number; expectedPointsLoss: number };
  /** Expected final totals if both follow DP Expert from now (exact PMF means). */
  expectedFinal: { me: number; opponent: number };
  /** Exact distribution of (my final - opponent final) if both follow DP Expert from now. */
  scoreDiff: { offset: number; pmf: number[] };
  accuracy: AnalysisAccuracy;
};

export const LIVE_ENGINE = { name: "v5-live", minimaxWindow: 3, budgetMs: 150 } as const;
export const REVIEW_ENGINE = { name: "v5-review", minimaxWindow: 4, budgetMs: 5000 } as const;

const sameAction = (a: V5Action, played: { type: "score"; category: string } | { type: "reroll"; ids: number[] }) =>
  played.type === "score" ? a.kind === "score" && a.category === played.category
    : a.kind === "reroll" && [...(a.ids ?? [])].sort().join() === [...played.ids].sort().join();

export function analyzePosition(state: Game, cfg: V5Config, engine: { name: string; minimaxWindow: number; budgetMs: number } = LIVE_ENGINE,
  played?: { type: "score"; category: string } | { type: "reroll"; ids: number[] }): PositionAnalysis {
  const t0 = performance.now();
  const d = winDPv5Decision(state, { ...cfg, endgame: cfg.endgame === "none" ? "none" : "minimax", minimaxWindow: engine.minimaxWindow });
  const elapsedMs = performance.now() - t0;
  const me = state.player, opp = 1 - me;
  const mask = (p: number) => categories.reduce((m, c, i) => (state.cards[p][c] === undefined ? m | (1 << i) : m), 0);
  const diff = scoreDiffPmf(state, cfg.bank);
  const best = d.analysis[0];
  let playedOut: PositionAnalysis["played"];
  if (played) {
    const a = d.analysis.find((x) => sameAction(x, played));
    if (!a) throw Error("played action is not legal in this state");
    playedOut = { ...a, winCreditLoss: best.winCredit - a.winCredit, expectedPointsLoss: Math.max(...d.analysis.map((x) => x.expectedFinal)) - a.expectedFinal };
  }
  return {
    model: engine.name, version: V5_VERSION, stage: d.stage, budgetMs: engine.budgetMs, elapsedMs,
    player: me, rollsUsed: state.rolls, actions: d.analysis, best, played: playedOut,
    expectedFinal: { me: total(state.cards[me]) + cfg.bank.meanOf(mask(me), upper(state.cards[me])), opponent: total(state.cards[opp]) + cfg.bank.meanOf(mask(opp), upper(state.cards[opp])) },
    scoreDiff: { offset: diff.offset, pmf: Array.from(diff.pmf) },
    accuracy: d.stage === "minimax"
      ? { kind: "exact", note: "exact two-player expectiminimax over the remaining categories (both maximise win credit)", numericTolerance: 1e-12 }
      : d.stage === "rollout"
        ? { kind: "rollout", note: "exact win credit of optimising this turn then both players following DP Expert; real optimal-play value may be higher", numericTolerance: 1e-12 }
        : { kind: "delegated", note: "delegated to an existing solver", numericTolerance: 1e-12 },
  };
}

/** Exact distribution of the next full roll after keeping `kept` dice values (for review UIs). */
export function rerollDistribution(kept: number[]): { dice: number[]; p: number }[] {
  const start = PARTIAL_INDEX.get([...kept].sort((a, b) => a - b).join(""));
  if (start === undefined) throw Error("invalid kept dice");
  const mass = new Float64Array(STATES.length);
  mass[start] = 1;
  for (let h = 0; h < OFFSET; h++) if (mass[h]) for (let f = 0; f < 6; f++) mass[CHILD[h * 6 + f]] += mass[h] / 6;
  const out: { dice: number[]; p: number }[] = [];
  for (let d = 0; d < FULL; d++) if (mass[OFFSET + d] > 0) out.push({ dice: STATES[OFFSET + d], p: mass[OFFSET + d] });
  return out;
}
