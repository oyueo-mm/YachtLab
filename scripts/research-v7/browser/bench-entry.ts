// Research-only browser benchmark entry (bundled by scripts/research-v7/browser/run.cjs into a Web Worker).
// Builds the Float32 DP Expert bank with the product WASM generator (same path as src/product-ai/runtime.ts),
// then plays seat-swapped games of a candidate vs v5-R and times every candidate decision.
// It does NOT change product code; product integration would only swap the decision call (see V7-PRODUCT-HANDOFF).
import { createGame, transition, total, available, type Game } from "../../../src/engine";
import { setDPTable, dpFutureValue } from "../../../src/dp";
import { buildBankWasm, bankFromWasm } from "../../../src/research-v6/wasm-pmf";
import { winDPv5Decision, type V5Config } from "../../../src/research-v5/apex";
import { winDPv7Decision, clearV7Cache, type V7Config } from "../../../src/research-v7/apex7";
import type { V7Kind } from "../../../src/research-v7/interactive";

type Msg = { wasm: ArrayBuffer; dp: ArrayBuffer; kind: string; window?: number; fallback?: string; games: number; seed0: number };
const heap = () => ((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 2 ** 20;

export async function run(m: Msg) {
  const t0 = performance.now();
  setDPTable(m.dp.slice(0));
  const T = new Float64Array(m.dp);
  const heapBefore = heap();
  const r = await buildBankWasm(m.wasm, T, { f32: true });
  const bank = bankFromWasm(r);
  const initMs = performance.now() - t0;
  const heapAfterInit = heap();
  const base: V5Config = { bank, dpValue: dpFutureValue, endgame: "none" };
  const cand: V7Config = { ...base, v7: { banks: [bank], dp: bank }, kind: m.kind as V7Kind, window: m.window, fallback: m.fallback as V7Kind | undefined };
  const act = (s: Game, who: "cand" | "ref") => (who === "ref" ? winDPv5Decision(s, base) : m.kind === "R" ? winDPv5Decision(s, base) : winDPv7Decision(s, cand));
  const times: number[] = [];
  let credit = 0, heapPeak = heapAfterInit;
  for (let g = 0; g < m.games; g++) {
    const seat = g % 2; // candidate seat alternates
    let s = createGame(m.seed0 + (g >> 1), true);
    clearV7Cache();
    while (!s.done) {
      if (!s.rolls) { s = transition(s, { type: "roll" }); continue; }
      const who = s.player === seat ? "cand" : "ref";
      const view: Game = { ...s, seed: 0, rng: [0, 0], dice: s.dice.map((d) => ({ ...d })), cards: [{ ...s.cards[0] }, { ...s.cards[1] }] };
      const ta = performance.now();
      const d = act(view, who);
      if (who === "cand") times.push(performance.now() - ta);
      if (d.type === "score") { if (!available(s.cards[s.player]).includes(d.category)) throw Error("illegal"); s = transition(s, { type: "score", category: d.category }); }
      else s = transition(transition(s, { type: "hold", ids: d.ids }), { type: "roll" });
    }
    const a = total(s.cards[seat]), b = total(s.cards[1 - seat]);
    credit += a > b ? 1 : a === b ? 0.5 : 0;
    heapPeak = Math.max(heapPeak, heap());
  }
  times.sort((x, y) => x - y);
  const q = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))];
  return { kind: m.kind, window: m.window ?? null, games: m.games, credit: credit / m.games, decisions: times.length, initMs, bankBuildMs: r.buildMs,
    wasmMemoryMiB: r.memoryBytes / 2 ** 20, jsHeapMiB: { before: heapBefore, afterInit: heapAfterInit, peak: heapPeak, end: heap() },
    ms: { mean: times.reduce((x, y) => x + y, 0) / times.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: times[times.length - 1] } };
}
