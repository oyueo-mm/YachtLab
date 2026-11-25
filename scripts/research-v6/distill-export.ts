// Export (features, exact PMF) of every canonical DP Expert state for PMF neural distillation.
// Output (git-ignored, training/checkpoints/v6/distill/): X.f32 [n x F], Y.f32 [n x BINS], meta.json
import { mkdirSync, writeFileSync } from "node:fs";
import { loadDPExpertBank } from "../research-v5/bank-io.ts";
import { canonicalUpper, upperHeadroom, popcount } from "../../src/research-v5/kernel.ts";
const BINS = 336;
const { bank, T } = loadDPExpertBank(false);
const keys: number[] = [];
for (let m = 0; m < 4096; m++) for (let u = 0; u < 64; u++) if (canonicalUpper(m, u) === u) keys.push(m * 64 + u);
const feat = (m: number, u: number) => {
  const f: number[] = [];
  for (let c = 0; c < 12; c++) f.push((m >> c) & 1);
  const k = popcount(m); for (let i = 0; i <= 12; i++) f.push(k === i ? 1 : 0);
  const pend = (m & 63) && u < 63 && u + upperHeadroom(m) >= 63 ? 1 : 0;
  f.push(u / 63, u >= 63 ? 1 : 0, pend, pend * (63 - u) / 63, upperHeadroom(m) / 105, T[m * 64 + u] / 200);
  return f;
};
const F = feat(0, 0).length, n = keys.length;
const X = new Float32Array(n * F), Y = new Float32Array(n * BINS), L = new Int32Array(n);
keys.forEach((k, i) => {
  const m = k >> 6, u = k & 63, p = bank.pmf[k]!;
  X.set(feat(m, u), i * F);
  if (p.length > BINS) throw Error("support too long");
  for (let g = 0; g < p.length; g++) Y[i * BINS + g] = p[g];
  L[i] = p.length;
});
const dir = "training/checkpoints/v6/distill/";
mkdirSync(dir, { recursive: true });
writeFileSync(dir + "X.f32", Buffer.from(X.buffer)); writeFileSync(dir + "Y.f32", Buffer.from(Y.buffer)); writeFileSync(dir + "L.i32", Buffer.from(L.buffer)); writeFileSync(dir + "keys.i32", Buffer.from(Int32Array.from(keys).buffer));
writeFileSync(dir + "meta.json", JSON.stringify({ n, F, BINS }));
console.log({ n, F, BINS, maxLen: L.reduce((a, b) => Math.max(a, b), 0) });
