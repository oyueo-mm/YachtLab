// Win DP v6 research engine (12-category Nintendo-style Yacht Dice, 1:1 win credit).
// Research-only: NOT registered in src/ai.ts and NOT a default AI.
//
// v5-R assumed that after the current turn BOTH players follow DP Expert. v6
// removes the "future me = DP Expert" restriction while keeping every value an
// exact probability under an explicit model of the opponent:
//
//   Opponent model (all v6 stages): the opponent's future points follow a fixed
//   own-state policy (DP Expert by default), so its final score X = oBase + G_opp
//   is independent of my actions; terminal utility F(x) = P(X < x) + 0.5 P(X = x).
//
//   v6-P  Policy-Set Rollout: after this turn, "future me" commits to the best of
//         a set of exact stationary policies (exponential-utility family, lambda=0
//         is DP Expert). Value = max_lambda E[F(base + gain + G_lambda)] exactly.
//         >= the v5-R value in the same model (lambda = 0 is in the set).
//   v6-Pd Depth-d open-loop Best Response: my next d-1 turns are solved exactly
//         (all dice/holds/categories) against F, with the Policy-Set leaf.
//   v6-A  Full-horizon exact Best Response when my remaining categories <= K:
//         maximise E[F(final)] over ALL my remaining turns (exact Bellman DP on
//         (mask, u, banked points)). This is the exact optimal response to the
//         fixed opponent distribution *as known now*; re-planned every decision.
//   v6-*M Optional exact interactive expectiminimax (v5 solver) when both
//         players have <= window categories left.
//
// What is NOT claimed: the open-loop BR ignores that I will observe the opponent's
// future turns (re-planning recovers part of that), and the opponent is assumed
// non-reactive. Exact interactive play is only solved in the endgame window.
// Fairness boundary: only cards, dice values, rolls and player are read.
import { upper, total, type Game } from "../engine";
import { canonicalUpper, nextUpper, popcount, UPPER_CAP } from "../research-v5/kernel";
import { PolicyPmfBank, creditTable } from "../research-v5/policy-pmf";
import {
  decideFromStopValues, fillPoints, maskOf, winDPv5Decision,
  type RootValues, type V5Config, type V5Decision,
} from "../research-v5/apex";
import { DISTINCT, bonusGain } from "./risk";
import { TurnBuffers, turnStartValue } from "./turn";
import { residualFeatures, predictResidual, RESIDUAL_MAX_K } from "./residual";

export const V6_VERSION = "v6-research-2026-11-25.1";

export type V6Config = V5Config & {
  /** Exact PMF banks of the policies "future me" may commit to (must include DP Expert for the v5-R guarantee). */
  banks: PolicyPmfBank[];
  /** Policy-set leaf depth in my turns, counting the current one (1 = v6-P). */
  depth?: number;
  /** Full-horizon exact BR when my remaining categories (incl. current) <= brWindow (0 = off). */
  brWindow?: number;
  /** Exact interactive minimax when both <= minimaxWindow (uses V5Config.endgame = "minimax"). */
  /**
   * Opponent policy set (v6-L / v6-Lm, depth 1 only): the opponent's future is one of these
   * exact policy PMFs instead of the single opponentBank.
   *   "maximin": the opponent picks the policy that minimises my win credit (restricted
   *              robust best response / restricted Nash with pure opponent commitment)
   *   "mixture": uniform prior mixture over the set (model uncertainty, no adversary)
   */
  oppBanks?: PolicyPmfBank[];
  oppMode?: "maximin" | "mixture";
  /** v6-C: add a fitted residual (exact interactive - policy-set) to child values, depth 1 only. */
  residual?: { weights: number[]; gateKMe: number[] };
};

type Credit = ReturnType<typeof creditTable>;
const credit = (ct: Credit, x: number) => { const i = x - ct.lo; return i <= 0 ? 0 : i >= ct.len + 1 ? 1 : ct.table[i]; };

export const v6Stats = { leafEvals: 0, brNodes: 0, lambdaPick: new Map<string, number>(), rootCacheHits: 0 };

/** max over policy banks of E[F(x0 + G)] for my state (mask, u). */
function policySetValue(banks: PolicyPmfBank[], mask: number, u: number, x0: number, ct: Credit, pick?: { i: number }): number {
  let best = -Infinity;
  const off = x0 - ct.lo, tab = ct.table, L = ct.len + 1;
  for (let b = 0; b < banks.length; b++) {
    const pmf = banks[b].get(mask, u);
    let s = 0;
    for (let g = 0; g < pmf.length; g++) {
      const q = pmf[g];
      if (q === 0) continue;
      const i = off + g;
      s += q * (i <= 0 ? 0 : i >= L ? 1 : tab[i]);
    }
    if (s > best + 1e-15) { best = s; if (pick) pick.i = b; }
  }
  v6Stats.leafEvals++;
  return best;
}

class Searcher {
  memo = new Map<number, number>();
  bufs: TurnBuffers[] = Array.from({ length: 14 }, () => new TurnBuffers());
  vals: Float64Array[] = Array.from({ length: 14 }, () => new Float64Array(12 * 64));
  constructor(readonly banks: PolicyPmfBank[], readonly ct: Credit) {}
  /** Value at the start of my turn with (mask, u) and banked total x, `depth` exact turns left before the leaf. */
  value(mask: number, u: number, x: number, depth: number, level: number): number {
    if (mask === 0) return credit(this.ct, x);
    u = canonicalUpper(mask, u);
    if (depth <= 0) return policySetValue(this.banks, mask, u, x, this.ct);
    const key = ((mask * 64 + u) * 1024 + (x + 200)) * 16 + depth;
    const hit = this.memo.get(key);
    if (hit !== undefined) return hit;
    v6Stats.brNodes++;
    const val = this.vals[level];
    this.fill(mask, u, x, depth - 1, level + 1, val);
    const v = turnStartValue(mask, val, this.bufs[level]);
    this.memo.set(key, v);
    return v;
  }
  /** Stop values of my current turn: child value after scoring (c, p). */
  fill(mask: number, u: number, x: number, childDepth: number, level: number, val: Float64Array) {
    for (let c = 0; c < 12; c++) {
      if (!(mask & (1 << c))) continue;
      const next = mask ^ (1 << c);
      for (const p of DISTINCT[c]) {
        const g = bonusGain(c, p, u);
        val[c * 64 + p] = this.value(next, nextUpper(c, p, u), x + g, childDepth, level);
      }
    }
  }
}

let rootCache: { key: string; root: RootValues; stage: string; note: string } | null = null;
export function clearV6Cache() { rootCache = null; }

export function winDPv6Decision(state: Game, cfg: V6Config): V5Decision {
  if (state.done || !state.rolls) throw Error("v6 requires a rolled public state");
  const me = state.player, opp = 1 - me;
  const mask = maskOf(state.cards[me]), oMask = maskOf(state.cards[opp]);
  const k = popcount(mask), ko = popcount(oMask);
  // Interactive exact endgame (v5 solver) takes precedence when configured.
  if (cfg.endgame === "minimax" && k <= (cfg.minimaxWindow ?? 2) && ko <= (cfg.minimaxWindow ?? 2)) return winDPv5Decision(state, cfg);
  const u = Math.min(UPPER_CAP, upper(state.cards[me])), uo = Math.min(UPPER_CAP, upper(state.cards[opp]));
  const base = total(state.cards[me]), oBase = total(state.cards[opp]);
  const depth = cfg.brWindow && k <= cfg.brWindow ? k : Math.max(1, cfg.depth ?? 1);
  const key = [mask, u, base, oMask, uo, oBase, depth, cfg.banks.length, cfg.oppBanks?.length ?? 0, cfg.oppMode ?? "", cfg.residual ? 1 : 0].join(",");
  if (rootCache?.key === key) {
    v6Stats.rootCacheHits++;
    return decideFromStopValues(state, mask, rootCache.root, rootCache.note, rootCache.stage);
  }
  const ct = creditTable(oBase, (cfg.opponentBank ?? cfg.bank).get(oMask, uo));
  const root: RootValues = { w: new Float64Array(12 * 64), p: new Float64Array(12 * 64) };
  fillPoints(mask, u, base, cfg, root.p);
  const search = new Searcher(cfg.banks, ct);
  let stage: string;
  if (depth === 1 && cfg.oppBanks?.length) {
    stage = `policy-set-vs-${cfg.oppMode ?? "maximin"}`;
    const cts = cfg.oppBanks.map((b) => creditTable(oBase, b.get(oMask, uo)));
    const mix = cfg.oppMode === "mixture";
    for (let c = 0; c < 12; c++) {
      if (!(mask & (1 << c))) continue;
      const next = mask ^ (1 << c);
      for (const p of DISTINCT[c]) {
        const g = bonusGain(c, p, u), x0 = base + g;
        let best = -Infinity;
        if (!next) { let w = mix ? 0 : Infinity; for (const t of cts) { const v = credit(t, x0); w = mix ? w + v / cts.length : Math.min(w, v); } best = w; }
        else for (const bank of cfg.banks) {
          const pmf = bank.get(next, canonicalUpper(next, nextUpper(c, p, u)));
          let w = mix ? 0 : Infinity;
          for (const t of cts) {
            let s = 0;
            for (let gg = 0; gg < pmf.length; gg++) { const q = pmf[gg]; if (q) s += q * credit(t, x0 + gg); }
            w = mix ? w + s / cts.length : Math.min(w, s);
          }
          if (w > best + 1e-15) best = w;
        }
        root.w[c * 64 + p] = best;
      }
    }
  } else if (depth === 1) {
    stage = "policy-set";
    const pick = { i: 0 };
    for (let c = 0; c < 12; c++) {
      if (!(mask & (1 << c))) continue;
      const next = mask ^ (1 << c);
      for (const p of DISTINCT[c]) {
        const g = bonusGain(c, p, u);
        const u2 = canonicalUpper(next, nextUpper(c, p, u));
        let v = next ? policySetValue(cfg.banks, next, u2, base + g, ct, pick) : credit(ct, base + g);
        const kn = k - 1;
        if (cfg.residual && ko >= 1 && ko <= RESIDUAL_MAX_K && cfg.residual.gateKMe.includes(kn))
          v = Math.min(1, Math.max(0, v + predictResidual(cfg.residual.weights, residualFeatures(kn, next, u2, base + g, ko, oMask, uo, oBase, v))));
        root.w[c * 64 + p] = v;
        if (next) { const n = cfg.banks[pick.i].name; v6Stats.lambdaPick.set(n, (v6Stats.lambdaPick.get(n) ?? 0) + 1); }
      }
    }
  } else {
    stage = depth >= k ? `full-br(${k})` : `br-depth${depth}`;
    search.fill(mask, u, base, depth - 1, 0, root.w);
  }
  const note = `Win DP v6 · ${stage} · opponent future = fixed ${(cfg.opponentBank ?? cfg.bank).name} PMF · future-me policy set {${cfg.banks.map((b) => b.name).join(", ")}} · win+0.5 tie`;
  rootCache = { key, root, stage, note };
  return decideFromStopValues(state, mask, root, note, stage);
}

/** Exact open-loop value of the current turn-start state for analysis (my turn not rolled yet). */
export function v6TurnStartValue(mask: number, u: number, base: number, oMask: number, uo: number, oBase: number, cfg: V6Config, depth: number): number {
  const ct = creditTable(oBase, (cfg.opponentBank ?? cfg.bank).get(oMask, uo));
  return new Searcher(cfg.banks, ct).value(mask, u, base, depth, 0);
}

/** My v6-P policy-set value for a position where the OPPONENT moves next (my turn not started). */
export function v6PolicySetChildValue(mask: number, u: number, base: number, oMask: number, uo: number, oBase: number, cfg: V6Config): number {
  const ct = creditTable(oBase, (cfg.opponentBank ?? cfg.bank).get(oMask, uo));
  if (mask === 0) return credit(ct, base);
  return policySetValue(cfg.banks, mask, canonicalUpper(mask, u), base, ct);
}
