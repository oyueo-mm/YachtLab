import { readFileSync } from "node:fs";
// Registered agents for the v5 research tournaments (research harness only).
import * as dp from "../../src/dp.ts";
import { winDPDecision } from "../../src/win-dp.ts";
import { winDPv2Decision } from "../../src/competitive-v2.ts";
import { winDPv3Decision } from "../../src/competitive-v3.ts";
import { decide, type Algorithm, type Decision } from "../../src/ai.ts";
import type { Game } from "../../src/engine.ts";
import { winDPv5Decision, winDPv5EDecision, wGreedyDecision, winDPv5WithOpponentPmf, maskOf, type V5Config } from "../../src/research-v5/apex.ts";
import { OpponentFilter } from "../../src/research-v5/bayes.ts";
import { upper } from "../../src/engine.ts";
import { loadDPExpertBank, loadPolicyBank } from "./bank-io.ts";
import { loadDPTable } from "./load-dp.ts";
import { winDPv6Decision, type V6Config } from "../../src/research-v6/apex6.ts";
import { loadRiskBanks, loadRiskPolicy, DEFAULT_LAMBDAS } from "../research-v6/banks.ts";
import { RiskOpponentFilter } from "../../src/research-v6/bayes6.ts";
import { PolicyPmfBank as PolicyPmfBankCtor, type PolicyPmfBank } from "../../src/research-v5/policy-pmf.ts";
import { winDPv7Decision, type V7Config } from "../../src/research-v7/apex7.ts";
import type { V7Kind } from "../../src/research-v7/interactive.ts";

export type AgentName = string;
let cfgBase: Omit<V5Config, "endgame"> | null = null;

let filters: Record<string, OpponentFilter> = {};
const ZERO = () => 0;
export function initAgents(needV5: boolean, needBayes = false) {
  const table = loadDPTable();
  dp.setDPTable(table.buffer.slice(table.byteOffset, table.byteOffset + table.byteLength) as ArrayBuffer);
  if (needV5) {
    const { bank } = loadDPExpertBank();
    cfgBase = { bank, dpValue: (m, u) => table[m * 64 + u], v2: winDPv2Decision, dpDecision: dp.dpDecision };
    if (needBayes) {
      const myopic = loadPolicyBank("myopic", ZERO);
      const hyps = [{ name: "DP Expert", bank }, { name: "Myopic", bank: myopic }];
      filters = { "v5-D": new OpponentFilter(hyps, { epsilon: 0.02 }), "v5-Dd": new OpponentFilter(hyps, { epsilon: 0.02, discount: 0.7 }) };
    }
  }
}

let residualCache: { weights: number[]; gateKMe: number[] } | null = null;
const residualModel = () => (residualCache ??= JSON.parse(readFileSync(new URL("../../training/results/v6/residual/ridge-f9021.json", import.meta.url), "utf8")));
// v6 agents: banks are loaded once by prepareAgents() before timing starts.
const v6Banks = new Map<string, PolicyPmfBank[]>();
const V6_SETS: Record<string, number[]> = { all: DEFAULT_LAMBDAS, three: [-0.04, 0, 0.04], dp: [0] };
const v6 = (set: string, extra: Partial<V6Config> = {}) => (s: Game) =>
  winDPv6Decision(s, { ...cfgBase!, endgame: "none", banks: v6Banks.get(set)!, ...extra } as V6Config);
// v7 agents (research-v7): stop-value estimators of src/research-v7/interactive.ts
const v7 = (kind: V7Kind, extra: Partial<V7Config> = {}) => (s: Game) => {
  const banks = v6Banks.get("all")!;
  return winDPv7Decision(s, { ...cfgBase!, endgame: "none", v7: { banks, dp: banks[DEFAULT_LAMBDAS.indexOf(0)] }, kind, ...extra } as V7Config);
};
const v6Filters = new Map<number, RiskOpponentFilter>();
function v6Bayes(s: Game, discount: number) {
  let f = v6Filters.get(discount);
  if (!f) { f = new RiskOpponentFilter(DEFAULT_LAMBDAS.map((l, i) => ({ name: String(l), policy: loadRiskPolicy(l), bank: v6Banks.get("all")![i] })), { epsilon: 0.02, discount }); v6Filters.set(discount, f); }
  const opp = s.cards[1 - s.player];
  f.observe(opp);
  const mix = f.mixture(maskOf(opp), Math.min(63, upper(opp)));
  const fake = new PolicyPmfBankCtor("opponent posterior", () => NaN);
  const om = maskOf(opp), cu = Math.min(63, upper(opp));
  for (let u = 0; u < 64; u++) fake.pmf[om * 64 + u] = mix;
  void cu;
  return v6("all", { opponentBank: fake })(s);
}
/** Load whatever the named agents need (call after initAgents, before timing). */
export function prepareAgents(names: string[]) {
  for (const n of names) for (const set of AGENTS[n].v6 ?? []) if (!v6Banks.has(set)) v6Banks.set(set, loadRiskBanks(V6_SETS[set]));
}

const label = (other: AgentName): Algorithm | undefined => (other === "dp" ? "DP Expert" : other === "v2" ? "Win DP v2" : undefined);

const v5 = (endgame: V5Config["endgame"], extra: Partial<V5Config> = {}) => (s: Game) => winDPv5Decision(s, { ...cfgBase!, endgame, ...extra });

const bayes = (name: string) => (s: Game) => {
  const f = filters[name], opp = s.cards[1 - s.player];
  f.observe(opp);
  const d = winDPv5WithOpponentPmf(s, { ...cfgBase!, endgame: "minimax", minimaxWindow: 3 }, f.mixture(maskOf(opp), Math.min(63, upper(opp))));
  return { ...d, note: d.note + ` · Bayesian opponent posterior ${f.posterior().map((x) => x.toFixed(3)).join("/")} after ${f.observations} turns` };
};
const filled = (s: Game) => 12 - (maskOf(s.cards[s.player]).toString(2).split("1").length - 1);

export const AGENTS: Record<string, { v5: boolean; bayes?: boolean; v6?: string[]; describe: string; act: (s: Game, other: AgentName) => Decision }> = {
  dp: { v5: false, describe: "DP Expert (expected-score optimal)", act: (s) => dp.dpDecision(s) },
  v1: { v5: false, describe: "Win DP (v1, last category)", act: (s) => winDPDecision(s) ?? dp.dpDecision(s) },
  v2: { v5: false, describe: "Win DP v2 (deployed default competitive)", act: (s) => winDPv2Decision(s) ?? dp.dpDecision(s) },
  v3: { v5: false, describe: "Win DP v3 unmodified (own last 3 exact vs Gaussian/exact opp)", act: (s) => winDPv3Decision(s) ?? dp.dpDecision(s) },
  v4D: { v5: false, describe: "Win DP v4-D as registered in src/ai.ts (no v3.3 pack; opponent label only for DP Expert / Win DP v2)", act: (s, o) => decide(s, "Win DP v4-D", { opponentAlgorithm: label(o) }) },
  greedy: { v5: false, describe: "Greedy (src/ai.ts)", act: (s) => decide(s, "Greedy") },
  expectimax: { v5: false, describe: "Expectimax (src/ai.ts)", act: (s) => decide(s, "Expectimax") },
  "v5-R": { v5: true, describe: "v5 rollout everywhere (no special endgame)", act: v5("none") },
  "v5-A": { v5: true, describe: "v5-A rollout + Win DP v2 for own last 2", act: v5("v2") },
  "v5-X2": { v5: true, describe: "ablation: DP Expert early + exact minimax window 2", act: v5("minimax", { rollout: false, minimaxWindow: 2 }) },
  "v5-X3": { v5: true, describe: "ablation: DP Expert early + exact minimax window 3", act: v5("minimax", { rollout: false, minimaxWindow: 3 }) },
  "v5-B2": { v5: true, describe: "v5-B rollout + exact minimax window 2", act: v5("minimax", { minimaxWindow: 2 }) },
  "v5-B3": { v5: true, describe: "v5-B rollout + exact minimax window 3", act: v5("minimax", { minimaxWindow: 3 }) },
  "v5-B4": { v5: true, describe: "v5-B rollout + exact minimax window 4", act: v5("minimax", { minimaxWindow: 4 }) },
  myopic: { v5: false, describe: "red-team: myopic W=0 policy (best points this turn, ignores future)", act: (s) => wGreedyDecision(s, ZERO, "myopic") },
  switcher: { v5: false, describe: "red-team: myopic for its first 6 turns, then Win DP v2 (strategy switch)", act: (s) => (filled(s) < 6 ? wGreedyDecision(s, ZERO, "myopic") : winDPv2Decision(s) ?? dp.dpDecision(s)) },
  "v5-D": { v5: true, bayes: true, describe: "v5-B3 + exact-likelihood Bayesian opponent mixture {DP Expert, Myopic} (eps 0.02)", act: bayes("v5-D") },
  "v5-Dd": { v5: true, bayes: true, describe: "v5-B3 + discounted (lambda 0.7) Bayesian opponent mixture", act: bayes("v5-Dd") },
  "v5-E": { v5: true, describe: "v5-B3 + depth-2 PMF-expectimax final-category choice when top-2 gap < 0.02", act: (s) => winDPv5EDecision(s, { ...cfgBase!, endgame: "minimax", minimaxWindow: 3, gap: 0.02 }) },
  "v6-P0": { v5: true, v6: ["dp"], describe: "v6 sanity: policy-set rollout with the DP Expert bank only (must equal v5-R)", act: v6("dp") },
  "v6-P": { v5: true, v6: ["all"], describe: "v6-P policy-set rollout: future me = best of exp-utility policies lambda in {-0.08,-0.04,-0.02,0,0.02,0.04,0.08}", act: v6("all") },
  "v6-P3": { v5: true, v6: ["three"], describe: "v6-P with lambda in {-0.04,0,0.04}", act: v6("three") },
  "v6-P2": { v5: true, v6: ["all"], describe: "v6 depth-2 open-loop best response (my next turn exact) with policy-set leaf", act: v6("all", { depth: 2 }) },
  "v6-A3": { v5: true, v6: ["all"], describe: "v6-P + full-horizon exact BR vs opponent PMF when my remaining <= 3", act: v6("all", { brWindow: 3 }) },
  "v6-A4": { v5: true, v6: ["all"], describe: "v6-P + full-horizon exact BR vs opponent PMF when my remaining <= 4", act: v6("all", { brWindow: 4 }) },
  "v6-A6": { v5: true, v6: ["all"], describe: "v6-P + full-horizon exact BR vs opponent PMF when my remaining <= 6", act: v6("all", { brWindow: 6 }) },
  "v6-L": { v5: true, v6: ["all"], describe: "v6-P vs opponent policy set (same 7 exp-utility policies), opponent picks the worst for me (maximin)", act: (s) => v6("all", { oppBanks: v6Banks.get("all"), oppMode: "maximin" })(s) },
  "v6-Lm": { v5: true, v6: ["all"], describe: "v6-P vs uniform mixture of the 7 opponent exp-utility policies", act: (s) => v6("all", { oppBanks: v6Banks.get("all"), oppMode: "mixture" })(s) },
  "v6-C": { v5: true, v6: ["all"], describe: "v6-P + ridge residual (exact interactive - policy-set, dev 9021 game-split fit) on child values when both <= 4", act: (s) => v6("all", { residual: residualModel() })(s) },
  "v6-D": { v5: true, v6: ["all"], describe: "v6-P vs Bayesian posterior mixture over 7 exp-utility opponent hypotheses (exact likelihood, eps 0.02)", act: (s) => v6Bayes(s, 1) },
  "v6-Dd": { v5: true, v6: ["all"], describe: "v6-D with discounted (lambda 0.7) posterior to track strategy switches", act: (s) => v6Bayes(s, 0.7) },
  "v6-PB3": { v5: true, v6: ["all"], describe: "v6-P + exact interactive minimax when both <= 3", act: v6("all", { endgame: "minimax", minimaxWindow: 3 }) },
  "v6-A4B3": { v5: true, v6: ["all"], describe: "v6-A4 + exact interactive minimax when both <= 3", act: v6("all", { brWindow: 4, endgame: "minimax", minimaxWindow: 3 }) },
  "v5-E5": { v5: true, describe: "v5-B3 + depth-2 PMF-expectimax final-category choice when top-2 gap < 0.05", act: (s) => winDPv5EDecision(s, { ...cfgBase!, endgame: "minimax", minimaxWindow: 3, gap: 0.05 }) },
  "v7-P": { v5: true, v6: ["all"], describe: "v7 sanity: estimator P through the v7 engine (must equal v6-P decisions)", act: v7("P") },
  "v7-I1": { v5: true, v6: ["all"], describe: "v7-I1: one reactive opponent turn (opponent maximises its win credit with its policy set vs my DP PMF), then my closed-loop policy-set leaf vs opponent DP", act: v7("I1") },
  "v7-I1R": { v5: true, v6: ["all"], describe: "v7-I1R: as v7-I1 but the opponent's turn uses the v5-R objective (DP future vs my DP future)", act: v7("I1R") },
  "v7-I1D": { v5: true, v6: ["all"], describe: "v7-I1D ablation: opponent's next turn is DP Expert (non-reactive), then my closed-loop policy-set leaf", act: v7("I1D") },
  "v7-N": { v5: true, v6: ["all"], describe: "v7-N: value of the 7x7 policy matrix game (mixed Nash) at each outcome", act: v7("N") },
  "v7-I1O": { v5: true, v6: ["all"], describe: "v7-I1O: reactive opponent turn (policy-set objective) -> opponent final-score mixture PMF; my open-loop policy-set best response to it", act: v7("I1O") },
  "v7-I1RO": { v5: true, v6: ["all"], describe: "v7-I1RO: as v7-I1O but the opponent's turn uses the v5-R objective", act: v7("I1RO") },
  "v7-I2": { v5: true, v6: ["all"], describe: "v7-I2: reactive opponent turn (policy-set objective), then my exact next turn with P stop values (two-ply reaction)", act: v7("I2") },
  "v7-I2R": { v5: true, v6: ["all"], describe: "v7-I2R: as v7-I2 but the opponent's turn uses the v5-R objective", act: v7("I2R") },
  "v7-I1RO1": { v5: true, v6: ["all"], describe: "v7-I1RO1: I1RO with the DP Expert bank only (lightweight derivative; product-track candidate)", act: v7("I1RO1") },
  "v7-I1B3": { v5: true, v6: ["all"], describe: "v7-I1 + exact interactive minimax when both <= 3", act: v7("I1", { endgame: "minimax", minimaxWindow: 3 }) },
};
