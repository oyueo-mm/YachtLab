import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createGame, total, transition, type Game } from "../../src/engine";
import { winDPv5Decision, type V5Config, type V5Decision } from "../../src/research-v5/apex";
import { bankFromWasm, buildBankWasm } from "../../src/research-v6/wasm-pmf";
import { decodeBank, encodeBank } from "../../src/research-v6/bank-codec";
import { loadDPTable } from "../research-v5/load-dp";

const family = 9521;
const sampleSize = 10_000;
const margin = 0.005;
const dp = loadDPTable();
const wasm = readFileSync(new URL("../../training/v6-wasm/pmf.wasm", import.meta.url));
const f64 = await buildBankWasm(wasm, dp);
const f32 = await buildBankWasm(wasm, dp, { f32: true });
const config = (bank: V5Config["bank"]): V5Config => ({ bank, dpValue: (mask, up) => dp[mask * 64 + up], endgame: "none" });
const configs = [config(bankFromWasm(f32)), config(bankFromWasm(f64))];

function seedOf(index: number) {
  let n = (0x5eed0000 + family * 1_000_003 + index) >>> 0;
  n = Math.imul(n ^ (n >>> 16), 0x85ebca6b) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35) >>> 0;
  return (n ^ (n >>> 16)) >>> 0;
}

const key = (decision: V5Decision) => decision.type === "score" ? decision.category : [...decision.ids].sort().join(",");
const assessment = (decision: V5Decision, view: Game) => decision.type === "score"
  ? decision.category : view.dice.filter(({ id }) => decision.ids.includes(id)).map(({ value }) => value).sort().join(",");
const credit = (a: number, b: number) => a > b ? 1 : a < b ? 0 : 0.5;

const build = [f32, f64].map(({ buildMs, memoryBytes, data }) => ({ buildMs, memoryBytes, payloadBytes: data.byteLength }));
const stats = [0, 1].map(() => ({ decisions: 0, totalMs: 0, maxMs: 0 }));
let compared = 0, different = 0, material = 0, maxGap = 0;
const sample: Game[] = [];

function play(seed: number, candidateSeat: number, compare: boolean) {
  let game = createGame(seed, true);
  while (!game.done) {
    if (!game.rolls) {
      game = transition(game, { type: "roll" });
      continue;
    }
    const view: Game = { ...game, seed: 0, rng: [0, 0] };
    const agent = game.player === candidateSeat ? 0 : 1;
    const start = performance.now();
    const move = winDPv5Decision(view, configs[agent]);
    const elapsed = performance.now() - start;
    stats[agent].decisions++;
    stats[agent].totalMs += elapsed;
    stats[agent].maxMs = Math.max(stats[agent].maxMs, elapsed);
    if (compare) {
      if (sample.length < 2000) sample.push(view);
      const reference = agent === 1 ? move : winDPv5Decision(view, configs[1]);
      const candidate = agent === 0 ? move : winDPv5Decision(view, configs[0]);
      compared++;
      if (key(reference) !== key(candidate)) {
        different++;
        const value = reference.analysis.find((option) => option.kind === candidate.type && (
          candidate.type === "score" ? option.category === candidate.category :
          option.ids && assessment({ ...candidate, ids: option.ids }, view) === assessment(candidate, view)
        ))?.winCredit;
        if (value === undefined) throw Error("Missing legal candidate from reference");
        const gap = reference.analysis[0].winCredit - value;
        maxGap = Math.max(maxGap, gap);
        if (gap > 1e-6) material++;
      }
    }
    game = move.type === "score" ? transition(game, move) : transition(transition(game, { type: "hold", ids: move.ids }), { type: "roll" });
  }
  return game.cards.map(total);
}

const raw: number[][] = [];
const pairCredits: number[] = [];
const counts = { wins: 0, ties: 0, losses: 0 };
for (let i = 0; i < sampleSize; i++) {
  const seed = seedOf(i);
  const [a0, b1] = play(seed, 0, i < 100);
  const [b0, a1] = play(seed, 1, i < 100);
  const results = [credit(a0, b1), credit(a1, b0)];
  for (const result of results) counts[result === 1 ? "wins" : result === 0.5 ? "ties" : "losses"]++;
  raw.push([seed, a0, b1, a1, b0]);
  pairCredits.push((results[0] + results[1]) / 2);
  if ((i + 1) % 500 === 0) console.error(`${i + 1}/${sampleSize} pairs`);
}
const average = pairCredits.reduce((a, b) => a + b, 0) / sampleSize;
const standardError = Math.sqrt(pairCredits.reduce((sum, point) => sum + (point - average) ** 2, 0) / ((sampleSize - 1) * sampleSize));
const lower = average - 0.5 - 1.644854 * standardError;
const int16Start = performance.now();
const packed = encodeBank(configs[0].bank, "int16");
const int16EncodeMs = performance.now() - int16Start;
const decodeStart = performance.now();
const restored = decodeBank(packed);
const int16DecodeMs = performance.now() - decodeStart;
const decodedPayloadBytes = restored.get(4095, 0).buffer.byteLength;
const quantized = config(restored);
const int16StartDecisions = performance.now();
for (const view of sample) winDPv5Decision(view, quantized);
const int16 = { packedBytes: packed.byteLength, decodedPayloadBytes, int16EncodeMs, int16DecodeMs,
  decisionMs: (performance.now() - int16StartDecisions) / sample.length, sample: sample.length };
const result = { family, sampleSize, margin, counts, average, lower, passed: lower > -margin,
  comparisons: { compared, different, material, maxGap }, stats, build, int16 };
writeFileSync(process.argv[2] ?? "/tmp/yachtlab-v5r-9521.json.gz", gzipSync(JSON.stringify({ ...result, raw })));
console.log(JSON.stringify(result, null, 2));
