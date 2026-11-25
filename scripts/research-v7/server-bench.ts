// v7 server-feasibility benchmark (research only; no server is started).
// Measures for a long-lived process: bank load time, resident memory, and per-decision latency
// (p50/p95/p99/max) + single-core throughput for v7 estimators on public states sampled from
// v6-P self-play (dev family 9108). Each decision is a fresh root (cache cleared) unless --warm.
//   npx tsx scripts/research-v7/server-bench.ts --kinds P,I1RO,I2RO,I2R --states 300
import { createGame, transition, type Game } from "../../src/engine.ts";
import { AGENTS, initAgents, prepareAgents } from "../research-v5/agents.ts";
import { loadRiskBanks, DEFAULT_LAMBDAS } from "../research-v6/banks.ts";
import { winDPv7Decision, clearV7Cache } from "../../src/research-v7/apex7.ts";
import { winDPv2Decision } from "../../src/competitive-v2.ts";
import * as dp from "../../src/dp.ts";
import type { V7Kind } from "../../src/research-v7/interactive.ts";
import { loadDPExpertBank } from "../research-v5/bank-io.ts";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const kinds = arg("--kinds", "P,I1RO,I2RO").split(",") as V7Kind[], nStates = Number(arg("--states", "300"));
const rss = () => Math.round(process.memoryUsage().rss / 1e6);
const rss0 = rss(), t0 = performance.now();
initAgents(true);
const banks = loadRiskBanks(DEFAULT_LAMBDAS);
const initS = (performance.now() - t0) / 1000, rssBanks = rss();
prepareAgents(["v6-P"]);
const { bank } = loadDPExpertBank(false);
const cfgBase = { bank, dpValue: (m: number, u: number) => dp.dpFutureValue(m, u), endgame: "none" as const, v2: winDPv2Decision, dpDecision: dp.dpDecision };
// sample rolled public states from v6-P self-play
const states: Game[] = [];
for (let g = 0; states.length < nStates; g++) {
  let s: Game = createGame(9108_000 + g, true);
  while (!s.done && states.length < nStates) {
    if (!s.rolls) { s = transition(s, { type: "roll" }); continue; }
    const view: Game = { ...s, seed: 0, rng: [0, 0], dice: s.dice.map((d) => ({ ...d })), cards: [{ ...s.cards[0] }, { ...s.cards[1] }] };
    if (s.rolls === 1) states.push(view); // one sample per turn (first roll = new root)
    const d = AGENTS["v6-P"].act(view, "v6-P");
    s = d.type === "score" ? transition(s, { type: "score", category: d.category }) : transition(transition(s, { type: "hold", ids: d.ids }), { type: "roll" });
  }
}
const q = (a: number[], p: number) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
const out: Record<string, unknown> = { node: process.version, cpu: (await import("node:os")).cpus()[0]?.model, rssStartMB: rss0, bankLoadSeconds: +initS.toFixed(2), rssAfterBanksMB: rssBanks, states: states.length };
for (const kind of kinds) {
  const ms: number[] = [];
  const tk = performance.now();
  for (const s of states) {
    clearV7Cache();
    const t = performance.now();
    winDPv7Decision(s, { ...cfgBase, v7: { banks, dp: banks[DEFAULT_LAMBDAS.indexOf(0)] }, kind } as never);
    ms.push(performance.now() - t);
  }
  ms.sort((a, b) => a - b);
  out[kind] = { meanMs: +(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(3), p50: +q(ms, 0.5).toFixed(3), p95: +q(ms, 0.95).toFixed(3), p99: +q(ms, 0.99).toFixed(3), max: +ms[ms.length - 1].toFixed(2), rootsPerSecondPerCore: +(ms.length / ((performance.now() - tk) / 1000)).toFixed(1), rssMB: rss() };
}
console.log(JSON.stringify(out, null, 1));
