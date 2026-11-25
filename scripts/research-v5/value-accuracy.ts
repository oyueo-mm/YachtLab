// Phase-wise value accuracy: exact interactive value (expectiminimax, both sides
// maximise win credit) vs (a) non-interactive exact PMF value (both DP Expert
// from now) and (b) the v5 one-turn rollout value, at the start of player 0's
// turn with k categories left each. Also writes the (features, residual) teacher
// dataset for the residual value network study.
//   npx tsx scripts/research-v5/value-accuracy.ts --family 9003 --per-k 400 --k4 120
import { writeFileSync, mkdirSync } from "node:fs";
import { createGame, transition, total, upper, type Game } from "../../src/engine.ts";
import { initAgents, AGENTS } from "./agents.ts";
import { endgameValue, rolloutTurnStart, maskOf, clearEndgameMemo } from "../../src/research-v5/apex.ts";
import { winCredit } from "../../src/research-v5/policy-pmf.ts";
import { loadDPExpertBank } from "./bank-io.ts";
import { popcount } from "../../src/research-v5/kernel.ts";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const family = Number(arg("--family", "9003")), perK = Number(arg("--per-k", "400")), k4 = Number(arg("--k4", "120")), k5 = Number(arg("--k5", "0"));
initAgents(true);
const { bank, T } = loadDPExpertBank(false);
const cfg = { bank, dpValue: (m: number, u: number) => T[m * 64 + u], endgame: "none" as const };
const hash = (x: number) => { x >>>= 0; x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0; x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0; return (x ^ (x >>> 16)) >>> 0; };
const want: Record<number, number> = { 1: perK, 2: perK, 3: perK, 4: k4, 5: k5 };
const states: Record<number, Game[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
for (let i = 0; Object.entries(want).some(([k, n]) => states[+k].length < n); i++) {
  let s = createGame(hash(0xacc0 + family * 7919 + i), true);
  while (!s.done) {
    if (!s.rolls) {
      const k = popcount(maskOf(s.cards[0]));
      if (s.player === 0 && k === popcount(maskOf(s.cards[1])) && want[k] && states[k].length < want[k] && (i + k) % 3 === 0) states[k].push(s);
      s = transition(s, { type: "roll" }); continue;
    }
    const d = AGENTS.dp.act(s, "dp");
    s = d.type === "score" ? transition(s, { type: "score", category: d.category }) : transition(transition(s, { type: "hold", ids: d.ids }), { type: "roll" });
  }
}
const rows: number[][] = [];
const summary: Record<string, unknown>[] = [];
for (const k of [1, 2, 3, 4, 5]) {
  if (!states[k].length) continue;
  const errP: number[] = [], errR: number[] = [], ms: number[] = [];
  for (const s of states[k]) {
    const M0 = maskOf(s.cards[0]), M1 = maskOf(s.cards[1]), u0 = Math.min(63, upper(s.cards[0])), u1 = Math.min(63, upper(s.cards[1]));
    const T0 = total(s.cards[0]), T1 = total(s.cards[1]);
    const pmfV = winCredit(T0, bank.get(M0, u0), T1, bank.get(M1, u1));
    const rollV = rolloutTurnStart(M0, u0, T0, M1, u1, T1, cfg);
    const t0 = performance.now();
    const exact = endgameValue(M0, u0, M1, u1, T0 - T1);
    ms.push(performance.now() - t0);
    if (k >= 4) clearEndgameMemo();
    errP.push(pmfV - exact); errR.push(rollV - exact);
    rows.push([k, M0, u0, T0, M1, u1, T1, pmfV, rollV, exact]);
  }
  const st = (e: number[]) => { const m = e.reduce((a, b) => a + b, 0) / e.length; return { bias: m, mae: e.reduce((a, b) => a + Math.abs(b), 0) / e.length, rmse: Math.sqrt(e.reduce((a, b) => a + b * b, 0) / e.length), maxAbs: Math.max(...e.map(Math.abs)), p95Abs: [...e.map(Math.abs)].sort((a, b) => a - b)[Math.floor(0.95 * (e.length - 1))] }; };
  const row = { k, states: states[k].length, pmfMinusExact: st(errP), rolloutMinusExact: st(errR), exactSolveMs: { mean: ms.reduce((a, b) => a + b, 0) / ms.length, max: Math.max(...ms) } };
  summary.push(row);
  console.log(JSON.stringify(row));
}
mkdirSync("training/results/v5/value-accuracy", { recursive: true });
writeFileSync(`training/results/v5/value-accuracy/f${family}.json`, JSON.stringify({ family, columns: ["k", "M0", "u0", "T0", "M1", "u1", "T1", "pmfValue", "rolloutValue", "exactValue"], summary, rows }));
