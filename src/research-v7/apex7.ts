// Win DP v7 decision engine (research-only; not in src/ai.ts).
// Uses the stop-value estimators of ./interactive.ts at the root of the mover's turn;
// the within-turn reroll policy is solved exactly over those stop values
// (decideFromStopValues, same tie-break rules as v5/v6).
// Optional exact interactive expectiminimax window (v5 solver) when both <= window.
import { upper, total, type Game } from "../engine";
import { UPPER_CAP, popcount, canonicalUpper } from "../research-v5/kernel";
import { decideFromStopValues, fillPoints, maskOf, winDPv5Decision, type RootValues, type V5Config, type V5Decision } from "../research-v5/apex";
import { fillStopValues, V7_VERSION, type V7Banks, type V7Kind } from "./interactive";

export type V7Config = V5Config & { v7: V7Banks; kind: V7Kind };
export const v7Stats = { roots: 0, rootMs: 0, cacheHits: 0 };

let rootCache: { key: string; root: RootValues } | null = null;
export function clearV7Cache() { rootCache = null; }

export function winDPv7Decision(state: Game, cfg: V7Config): V5Decision {
  if (state.done || !state.rolls) throw Error("v7 requires a rolled public state");
  const me = state.player, opp = 1 - me;
  const mask = maskOf(state.cards[me]), oMask = maskOf(state.cards[opp]);
  const k = popcount(mask), ko = popcount(oMask);
  if (cfg.endgame === "minimax" && k <= (cfg.minimaxWindow ?? 2) && ko <= (cfg.minimaxWindow ?? 2)) return winDPv5Decision(state, cfg);
  const u = Math.min(UPPER_CAP, upper(state.cards[me])), uo = Math.min(UPPER_CAP, upper(state.cards[opp]));
  const base = total(state.cards[me]), oBase = total(state.cards[opp]);
  const key = [cfg.kind, mask, u, base, oMask, uo, oBase].join(",");
  const note = `Win DP v7 (${V7_VERSION}) · estimator ${cfg.kind} · win+0.5 tie`;
  if (rootCache?.key === key) { v7Stats.cacheHits++; return decideFromStopValues(state, mask, rootCache.root, note, "v7-" + cfg.kind); }
  const t0 = performance.now();
  const root: RootValues = { w: new Float64Array(12 * 64), p: new Float64Array(12 * 64) };
  fillPoints(mask, u, base, cfg, root.p);
  fillStopValues(cfg.kind, cfg.v7, { mask, u: canonicalUpper(mask, u), x: base }, { mask: oMask, u: canonicalUpper(oMask, uo), x: oBase }, root.w);
  v7Stats.roots++; v7Stats.rootMs += performance.now() - t0;
  rootCache = { key, root };
  return decideFromStopValues(state, mask, root, note, "v7-" + cfg.kind);
}
