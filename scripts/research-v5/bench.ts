// v5 paired tournament runner. Each seed is played twice with seats swapped,
// engine createGame(seed, true) (independent per-seat dice streams, the same as
// prior 50k/200k studies). One seed pair = one statistical observation.
//
//   npx tsx scripts/research-v5/bench.ts --a v5-B3 --b v2 --family 9101 --shard 0 --pairs 500
//
// Seed families (pre-registered, disjoint from previous studies 1301-1500,
// 2201-2220, 5101-5110, 6101-6110, 7201-7210):
//   9001-9099  development / debugging / model selection
//   9501-9599  confirmation (never used for selection)
import { mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createGame, transition, total, available, type Game } from "../../src/engine.ts";
import { AGENTS, initAgents } from "./agents.ts";
import type { Decision } from "../../src/ai.ts";
import * as dp from "../../src/dp.ts";

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const A = arg("--a")!, B = arg("--b")!;
const family = Number(arg("--family", "9001")), shard = Number(arg("--shard", "0")), pairs = Number(arg("--pairs", "100"));
const outDir = arg("--out", "training/results/v5")!;
if (!AGENTS[A] || !AGENTS[B]) throw Error(`unknown agent ${A} / ${B}; known: ${Object.keys(AGENTS).join(",")}`);
if (!(family >= 9001 && family <= 9599) || !Number.isInteger(shard) || shard < 0 || shard > 999 || !(pairs >= 1 && pairs <= 20000)) throw Error("unregistered seed family / shard / pairs");
initAgents(AGENTS[A].v5 || AGENTS[B].v5, Boolean(AGENTS[A].bayes || AGENTS[B].bayes));

const hash = (x: number) => { x >>>= 0; x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0; x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0; return (x ^ (x >>> 16)) >>> 0; };
const seedOf = (i: number) => hash(0x5eed0000 + family * 1_000_003 + shard * 20_011 + i);

// log-binned latency histogram: bin = floor(50*log10(ms)) + 300, ms in [1e-6, 1e6]
const HB = 600;
const binOf = (ms: number) => Math.max(0, Math.min(HB - 1, Math.floor(50 * Math.log10(Math.max(ms, 1e-6))) + 300));
const latency: Record<string, Float64Array> = { [A]: new Float64Array(HB), [B]: new Float64Array(HB) };
const stats: Record<string, { decisions: number; ms: number; maxMs: number; diffFromDP: number; stages: Record<string, number> }> = {};
for (const n of [A, B]) stats[n] = { decisions: 0, ms: 0, maxMs: 0, diffFromDP: 0, stages: {} };

const same = (a: Decision, b: Decision) => a.type === b.type && (a.type === "score" ? a.category === (b as typeof a).category : [...a.ids].sort().join() === [...(b as typeof a).ids].sort().join());

function play(seed: number, seat0: string, seat1: string) {
  let s: Game = createGame(seed, true);
  let steps = 0;
  while (!s.done) {
    if (++steps > 200) throw Error("too many actions");
    if (!s.rolls) { s = transition(s, { type: "roll" }); continue; }
    const me = s.player === 0 ? seat0 : seat1, other = s.player === 0 ? seat1 : seat0;
    // the agent only receives a copy without seed / rng (fairness boundary)
    const view: Game = { ...s, seed: 0, rng: [0, 0], dice: s.dice.map((d) => ({ ...d })), cards: [{ ...s.cards[0] }, { ...s.cards[1] }] };
    const t0 = performance.now();
    const d = AGENTS[me].act(view, other);
    const ms = performance.now() - t0;
    const st = stats[me];
    st.decisions++; st.ms += ms; st.maxMs = Math.max(st.maxMs, ms); latency[me][binOf(ms)]++;
    const stage = (d as { stage?: string }).stage ?? "-";
    st.stages[stage] = (st.stages[stage] ?? 0) + 1;
    if (!same(d, dp.dpDecision(view))) st.diffFromDP++;
    if (d.type === "score") {
      if (!available(s.cards[s.player]).includes(d.category)) throw Error("illegal score");
      s = transition(s, { type: "score", category: d.category });
    } else {
      if (s.rolls >= 3 || new Set(d.ids).size !== d.ids.length || d.ids.some((id) => id < 0 || id > 4)) throw Error("illegal reroll");
      s = transition(transition(s, { type: "hold", ids: d.ids }), { type: "roll" });
    }
  }
  return [total(s.cards[0]), total(s.cards[1])] as const;
}

const raw: number[] = []; // per pair: seed, A score g1, B score g1, A score g2, B score g2
let credit = 0, wins = 0, ties = 0, losses = 0;
const t0 = performance.now();
for (let i = 0; i < pairs; i++) {
  const seed = seedOf(i);
  const [a1, b1] = play(seed, A, B);
  const [b2, a2] = play(seed, B, A);
  for (const [x, y] of [[a1, b1], [a2, b2]]) { if (x > y) wins++; else if (x === y) ties++; else losses++; }
  credit += ((a1 > b1 ? 1 : a1 === b1 ? 0.5 : 0) + (a2 > b2 ? 1 : a2 === b2 ? 0.5 : 0)) / 2;
  raw.push(seed, a1, b1, a2, b2);
  if ((i + 1) % Math.max(1, Math.ceil(pairs / 10)) === 0)
    console.error(`[${A} vs ${B} f${family} s${shard}] ${i + 1}/${pairs} credit=${(credit / (i + 1) * 100).toFixed(3)}% ${((performance.now() - t0) / 1000).toFixed(0)}s`);
}
const out = {
  version: 1, a: A, b: B, family, shard, pairs, games: 2 * pairs,
  describe: { [A]: AGENTS[A].describe, [B]: AGENTS[B].describe },
  rules: "YachtLab-12 Nintendo-style; 5 dice; 3 rolls; upper>=63 +35; createGame(seed,true)",
  winCredit: credit / pairs, wins, ties, losses,
  stats, latencyBins: Object.fromEntries(Object.entries(latency).map(([k, v]) => [k, Array.from(v)])),
  elapsedSeconds: (performance.now() - t0) / 1000,
  commit: process.env.GITHUB_SHA ?? process.env.V5_COMMIT ?? null,
  raw,
};
mkdirSync(outDir, { recursive: true });
const file = `${outDir}/${A}_vs_${B}-f${family}-s${shard}.json.gz`;
writeFileSync(file, gzipSync(JSON.stringify(out)));
const pc: number[] = []; for (let i = 0; i < raw.length; i += 5) pc.push(((raw[i + 1] > raw[i + 2] ? 1 : raw[i + 1] === raw[i + 2] ? 0.5 : 0) + (raw[i + 3] > raw[i + 4] ? 1 : raw[i + 3] === raw[i + 4] ? 0.5 : 0)) / 2);
console.log("V5_SHARD " + JSON.stringify({ file, a: A, b: B, family, shard, pairs, games: out.games, winCredit: out.winCredit, pairCreditSum: pc.reduce((x, y) => x + y, 0), pairCreditSumSq: pc.reduce((x, y) => x + y * y, 0), wins, ties, losses, elapsedSeconds: out.elapsedSeconds, msPerDecisionA: stats[A].ms / stats[A].decisions }));
