// Value accuracy of v6 model values vs the EXACT interactive value (expectiminimax),
// on the v5 teacher states (P0 turn start, both k categories left, family 9004).
//   pmf      : both DP Expert from now (v5 non-interactive)
//   rollout  : v5-R one-turn rollout value
//   pset     : v6-P policy-set rollout value (my turn exact, then best lambda policy; opp DP PMF)
//   br       : v6-A full-horizon open-loop BR value vs the opponent's DP PMF
//   npx tsx scripts/research-v6/value-accuracy6.ts training/results/v5/value-accuracy/f9004.json
import { readFileSync, writeFileSync } from "node:fs";
import { loadDPExpertBank } from "../research-v5/bank-io.ts";
import { loadRiskBanks, DEFAULT_LAMBDAS } from "./banks.ts";
import { v6TurnStartValue, type V6Config } from "../../src/research-v6/apex6.ts";
const data = JSON.parse(readFileSync(process.argv[2], "utf8"));
const { bank, T } = loadDPExpertBank(false);
const cfg = { bank, dpValue: (m: number, u: number) => T[m * 64 + u], endgame: "none", banks: loadRiskBanks(DEFAULT_LAMBDAS) } as V6Config;
const err: Record<string, Record<number, number[]>> = { pmf: {}, rollout: {}, pset: {}, br: {} };
const ms: Record<number, number[]> = {};
for (const r of data.rows as number[][]) {
  const [k, M0, u0, T0, M1, u1, T1, pmf, roll, exact] = r;
  const pset = v6TurnStartValue(M0, u0, T0, M1, u1, T1, cfg, 1);
  const t0 = performance.now();
  const br = v6TurnStartValue(M0, u0, T0, M1, u1, T1, cfg, k);
  (ms[k] ??= []).push(performance.now() - t0);
  for (const [n, v] of [["pmf", pmf], ["rollout", roll], ["pset", pset], ["br", br]] as const) (err[n][k] ??= []).push(v - exact);
}
const st = (e: number[]) => ({ n: e.length, biasPP: 100 * e.reduce((a, b) => a + b, 0) / e.length, maePP: 100 * e.reduce((a, b) => a + Math.abs(b), 0) / e.length, maxAbsPP: 100 * Math.max(...e.map(Math.abs)) });
const out = Object.fromEntries(Object.entries(err).map(([n, byK]) => [n, Object.fromEntries(Object.entries(byK).map(([k, e]) => [k, st(e)]))]));
const all = Object.fromEntries(Object.entries(err).map(([n, byK]) => [n, st(Object.values(byK).flat())]));
const res = { dataset: process.argv[2], byK: out, all, brSolveMs: Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, { mean: v.reduce((a, b) => a + b, 0) / v.length, max: Math.max(...v) }])) };
console.log(JSON.stringify(res, null, 1));
writeFileSync("training/results/v6/value-accuracy6-f9004.json", JSON.stringify(res, null, 1));
