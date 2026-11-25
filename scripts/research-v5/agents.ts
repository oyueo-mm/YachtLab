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

const label = (other: AgentName): Algorithm | undefined => (other === "dp" ? "DP Expert" : other === "v2" ? "Win DP v2" : undefined);

const v5 = (endgame: V5Config["endgame"], extra: Partial<V5Config> = {}) => (s: Game) => winDPv5Decision(s, { ...cfgBase!, endgame, ...extra });

const bayes = (name: string) => (s: Game) => {
  const f = filters[name], opp = s.cards[1 - s.player];
  f.observe(opp);
  const d = winDPv5WithOpponentPmf(s, { ...cfgBase!, endgame: "minimax", minimaxWindow: 3 }, f.mixture(maskOf(opp), Math.min(63, upper(opp))));
  return { ...d, note: d.note + ` · Bayesian opponent posterior ${f.posterior().map((x) => x.toFixed(3)).join("/")} after ${f.observations} turns` };
};
const filled = (s: Game) => 12 - (maskOf(s.cards[s.player]).toString(2).split("1").length - 1);

export const AGENTS: Record<string, { v5: boolean; bayes?: boolean; describe: string; act: (s: Game, other: AgentName) => Decision }> = {
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
  "v5-E5": { v5: true, describe: "v5-B3 + depth-2 PMF-expectimax final-category choice when top-2 gap < 0.05", act: (s) => winDPv5EDecision(s, { ...cfgBase!, endgame: "minimax", minimaxWindow: 3, gap: 0.05 }) },
};
