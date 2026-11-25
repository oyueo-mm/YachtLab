// Node measurement of the PRODUCT path: Float32 DP bank built by the product WASM generator (as in
// src/product-ai/runtime.ts) + decision function. Reports RSS / heap / WASM memory after init and the peak over
// N seat-swapped games vs v5-R, plus latency quantiles, and checks for growth across games (leak check).
//   npx tsx scripts/research-v7/product-mem.ts --kind I2RO1|R|I2R1 --games 40 [--window 6 --fallback I2RO1]
import { readFileSync } from "node:fs";
import { createGame, transition, total, type Game } from "../../src/engine.ts";
import { setDPTable, dpFutureValue } from "../../src/dp.ts";
import { buildBankWasm, bankFromWasm } from "../../src/research-v6/wasm-pmf.ts";
import { winDPv5Decision, type V5Config } from "../../src/research-v5/apex.ts";
import { productV7Decision } from "../../src/research-v7/product.ts";
import { winDPv7Decision, clearV7Cache } from "../../src/research-v7/apex7.ts";
import type { V7Kind } from "../../src/research-v7/interactive.ts";
import { loadDPTable } from "../research-v5/load-dp.ts";
const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const kind = arg("--kind", "I2RO1"), games = Number(arg("--games", "40")), win = arg("--window", ""), fb = arg("--fallback", "I2RO1");
const mb = (x: number) => +(x / 2 ** 20).toFixed(1);
const mem = () => { const m = process.memoryUsage(); return { rss: mb(m.rss), heapUsed: mb(m.heapUsed), external: mb(m.external), arrayBuffers: mb(m.arrayBuffers) }; };
const before = mem();
const t0 = performance.now();
const T = loadDPTable();
setDPTable(T.buffer.slice(T.byteOffset, T.byteOffset + T.byteLength) as ArrayBuffer);
const r = await buildBankWasm(readFileSync("training/v6-wasm/pmf.wasm"), T, { f32: true });
const bank = bankFromWasm(r);
const initMs = performance.now() - t0;
const afterInit = mem();
const base: V5Config = { bank, dpValue: dpFutureValue, endgame: "none" };
const act = (s: Game) => kind === "R" ? winDPv5Decision(s, base) : win ? winDPv7Decision(s, { ...base, v7: { banks: [bank], dp: bank }, kind: kind as V7Kind, window: Number(win), fallback: fb as V7Kind }) : productV7Decision(s, base, kind as V7Kind);
const times: number[] = [], rssAfterGame: number[] = [];
let peak = afterInit.rss, credit = 0;
for (let g = 0; g < games; g++) {
  const seat = g % 2; let s = createGame(0x7e570000 + (g >> 1), true); clearV7Cache();
  while (!s.done) {
    if (!s.rolls) { s = transition(s, { type: "roll" }); continue; }
    const view: Game = { ...s, seed: 0, rng: [0, 0], dice: s.dice.map((d) => ({ ...d })), cards: [{ ...s.cards[0] }, { ...s.cards[1] }] };
    let d;
    if (s.player === seat) { const ta = performance.now(); d = act(view); times.push(performance.now() - ta); } else d = winDPv5Decision(view, base);
    s = d.type === "score" ? transition(s, { type: "score", category: d.category }) : transition(transition(s, { type: "hold", ids: d.ids }), { type: "roll" });
  }
  const a = total(s.cards[seat]), b = total(s.cards[1 - seat]); credit += a > b ? 1 : a === b ? 0.5 : 0;
  const m = mem(); peak = Math.max(peak, m.rss); rssAfterGame.push(m.rss);
}
times.sort((x, y) => x - y);
const q = (p: number) => +times[Math.min(times.length - 1, Math.floor(p * times.length))].toFixed(2);
const half = Math.floor(games / 2), avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
console.log(JSON.stringify({ kind, window: win || null, games, credit: credit / games, node: process.version, initMs: Math.round(initMs), wasmMemoryMiB: mb(r.memoryBytes), memBefore: before, memAfterInit: afterInit, rssPeakMiB: peak, memEnd: mem(),
  leakCheck: { rssFirstHalfMeanMiB: +avg(rssAfterGame.slice(0, half)).toFixed(1), rssSecondHalfMeanMiB: +avg(rssAfterGame.slice(half)).toFixed(1) },
  decisions: times.length, ms: { mean: +avg(times).toFixed(2), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: +times[times.length - 1].toFixed(1) } }));
