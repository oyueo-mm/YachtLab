// v7 exact decision-regret benchmark.
//
// For turn-start states taken from real games (both players' remaining categories
// <= K), every estimator's induced within-turn policy is evaluated EXACTLY under the
// exact interactive (expectiminimax) stop values. Regret = optimal exact turn value -
// exact value of the estimator's policy. This is zero-variance per state (no dice
// sampling), so estimators can be ranked with far fewer states than games.
//
//   tsx scripts/research-v7/regret.ts --family 9101 --games 300 --K 4 --out training/results/v7/regret-f9101.json
//
// States come from games of v6-P vs v6-P on DEVELOPMENT family 9101 (seat-swapped seeds,
// same seed formula as bench.ts). Development data only.
import { mkdirSync, writeFileSync } from "node:fs";
import { createGame, transition, total, upper, type Game } from "../../src/engine.ts";
import { AGENTS, initAgents, prepareAgents } from "../research-v5/agents.ts";
import { maskOf, endgameValue, clearEndgameMemo } from "../../src/research-v5/apex.ts";
import { popcount, nextUpper, canonicalUpper, UPPER_CAP } from "../../src/research-v5/kernel.ts";
import { DISTINCT, bonusGain } from "../../src/research-v6/risk.ts";
import { TurnBuffers, turnOutcomesFromVal } from "../../src/research-v6/turn.ts";
import { loadRiskBanks, DEFAULT_LAMBDAS } from "../research-v6/banks.ts";
import { fillStopValues, V7_KINDS, type V7Kind, type V7Banks } from "../../src/research-v7/interactive.ts";

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const family = Number(arg("--family", "9101")), games = Number(arg("--games", "100")), K = Number(arg("--K", "4"));
const shard = Number(arg("--shard", "0"));
const kinds = (arg("--kinds") ?? V7_KINDS.join(",")).split(",") as V7Kind[];
const out = arg("--out", `training/results/v7/regret-f${family}-K${K}-s${shard}.json`)!;
if (!(family >= 9101 && family <= 9199)) throw Error("v7 regret benchmark uses v7 development families 9101-9199 only");

initAgents(true);
prepareAgents(["v6-P"]);
const banks = loadRiskBanks(DEFAULT_LAMBDAS);
const B: V7Banks = { banks, dp: banks[DEFAULT_LAMBDAS.indexOf(0)] };

const hash = (x: number) => { x >>>= 0; x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0; x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0; return (x ^ (x >>> 16)) >>> 0; };
const seedOf = (i: number) => hash(0x5eed0000 + family * 1_000_003 + shard * 20_011 + i);

type St = { mask: number; u: number; x: number; oMask: number; uo: number; ox: number; k: number; ko: number; mover: number };
function collect(seed: number): St[] {
  let s: Game = createGame(seed, true);
  const res: St[] = [];
  while (!s.done) {
    if (!s.rolls) {
      const me = s.player, op = 1 - me;
      const mask = maskOf(s.cards[me]), oMask = maskOf(s.cards[op]);
      const k = popcount(mask), ko = popcount(oMask);
      if (k <= K && ko <= K) res.push({ mask, u: canonicalUpper(mask, Math.min(UPPER_CAP, upper(s.cards[me]))), x: total(s.cards[me]), oMask, uo: canonicalUpper(oMask, Math.min(UPPER_CAP, upper(s.cards[op]))), ox: total(s.cards[op]), k, ko, mover: me });
      s = transition(s, { type: "roll" }); continue;
    }
    const view: Game = { ...s, seed: 0, rng: [0, 0], dice: s.dice.map((d) => ({ ...d })), cards: [{ ...s.cards[0] }, { ...s.cards[1] }] };
    const d = AGENTS["v6-P"].act(view, "v6-P");
    s = d.type === "score" ? transition(s, { type: "score", category: d.category }) : transition(transition(s, { type: "hold", ids: d.ids }), { type: "roll" });
  }
  return res;
}

const exactVal = new Float64Array(12 * 64), candVal = new Float64Array(12 * 64);
const bExact = new TurnBuffers(), bCand = new TurnBuffers();
function fillExact(st: St) {
  const D = st.x - st.ox;
  for (let c = 0; c < 12; c++) {
    if (!(st.mask & (1 << c))) continue;
    const next = st.mask ^ (1 << c);
    for (const p of DISTINCT[c]) {
      const g = bonusGain(c, p, st.u);
      exactVal[c * 64 + p] = st.oMask === 0 && next === 0 ? (D + g > 0 ? 1 : D + g === 0 ? 0.5 : 0) : 1 - endgameValue(st.oMask, st.uo, next, nextUpper(c, p, st.u), -(D + g));
    }
  }
}

const rows: { k: number; ko: number; exact: number; regret: Record<string, number>; value: Record<string, number>; ms: Record<string, number> }[] = [];
const t0 = performance.now();
for (let i = 0; i < games; i++) {
  const seed = seedOf(i);
  for (const st of collect(seed)) {
    const te = performance.now();
    fillExact(st);
    const opt = turnOutcomesFromVal(st.mask, exactVal, bExact).value;
    const exactMs = performance.now() - te;
    const row = { k: st.k, ko: st.ko, exact: opt, regret: {} as Record<string, number>, value: {} as Record<string, number>, ms: { exact: exactMs } as Record<string, number> };
    for (const kind of kinds) {
      const tc = performance.now();
      fillStopValues(kind, B, { mask: st.mask, u: st.u, x: st.x }, { mask: st.oMask, u: st.uo, x: st.ox }, candVal);
      const o = turnOutcomesFromVal(st.mask, candVal, bCand);
      row.ms[kind] = performance.now() - tc;
      let v = 0;
      for (let j = 0; j < o.keys.length; j++) v += o.prob[j] * exactVal[o.keys[j]];
      row.regret[kind] = Math.max(0, opt - v);
      row.value[kind] = o.value;
    }
    rows.push(row);
  }
  if (i % 10 === 9) { clearEndgameMemo(); console.error(`[regret f${family} K${K} s${shard}] ${i + 1}/${games} games, ${rows.length} states, ${((performance.now() - t0) / 1000).toFixed(0)}s`); }
}

// summary: mean regret (percentage points of win credit) by (k, ko) group and overall, paired vs P
const groups = new Map<string, typeof rows>();
for (const r of rows) { const key = `${r.k}/${r.ko}`; (groups.get(key) ?? groups.set(key, []).get(key)!).push(r); }
groups.set("all", rows);
const summ = (rs: typeof rows) => Object.fromEntries(kinds.map((kd) => {
  const reg = rs.map((r) => r.regret[kd]), d = rs.map((r) => r.regret[kd] - r.regret.P ?? 0);
  const m = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const se = (a: number[]) => { const mu = m(a); return Math.sqrt(a.reduce((x, y) => x + (y - mu) ** 2, 0) / Math.max(1, a.length - 1) / a.length); };
  const bias = rs.map((r) => r.value[kd] - r.exact);
  return [kd, { n: rs.length, meanRegretPP: 100 * m(reg), seRegretPP: 100 * se(reg), minusP_PP: 100 * m(d), minusP_sePP: 100 * se(d), zeroRegretShare: reg.filter((x) => x < 1e-12).length / reg.length, valueBiasPP: 100 * m(bias), valueMaePP: 100 * m(bias.map(Math.abs)), meanMs: m(rs.map((r) => r.ms[kd])) }];
}));
const summary = Object.fromEntries([...groups].map(([k, rs]) => [k, summ(rs)]));
mkdirSync(out.replace(/\/[^/]*$/, ""), { recursive: true });
writeFileSync(out, JSON.stringify({ version: 1, family, shard, games, K, kinds, sampler: "v6-P self-play turn-start states, both remaining <= K", elapsedSeconds: (performance.now() - t0) / 1000, summary, rows }, null, 0));
console.log(JSON.stringify({ all: summary.all }, null, 1));
