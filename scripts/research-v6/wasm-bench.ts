// WASM PMF bank: build time in Node and bit-exactness vs the TS bank.
//   npx tsx scripts/research-v6/wasm-bench.ts [--simd] [--f32]
import { readFileSync } from "node:fs";
import { buildBankWasm } from "../../src/research-v6/wasm-pmf.ts";
import { loadDPExpertBank } from "../research-v5/bank-io.ts";
import { canonicalUpper } from "../../src/research-v5/kernel.ts";
const simd = process.argv.includes("--simd"), f32 = process.argv.includes("--f32");
const wasm = readFileSync(new URL(`../../training/v6-wasm/${simd ? "pmf-simd" : "pmf"}.wasm`, import.meta.url));
const { bank, T } = loadDPExpertBank(false);
const r = await buildBankWasm(wasm, T, { f32 });
let diffStates = 0, maxAbs = 0, maxTV = 0, n = 0;
for (let mask = 0; mask < 4096; mask++) for (let u = 0; u < 64; u++) {
  if (canonicalUpper(mask, u) !== u) continue;
  const key = mask * 64 + u, off = r.index[key * 2], len = r.index[key * 2 + 1], ref = bank.pmf[key]!;
  let tv = 0, differs = len !== ref.length;
  for (let g = 0; g < Math.max(len, ref.length); g++) { const a = g < len ? r.data[off + g] : 0, b = ref[g] ?? 0; if (a !== b) differs = true; maxAbs = Math.max(maxAbs, Math.abs(a - b)); tv += Math.abs(a - b); }
  maxTV = Math.max(maxTV, tv / 2); if (differs) diffStates++; n++;
}
const hwm = /VmHWM:\s+(\d+)/.exec(readFileSync("/proc/self/status", "utf8"))![1];
console.log(JSON.stringify({ runtime: `node ${process.version}`, simd, f32, buildSeconds: +(r.buildMs / 1000).toFixed(3), floats: r.floats, wasmMemoryMB: Math.round(r.memoryBytes / 2 ** 20), states: n, statesNotBitIdentical: diffStates, maxAbsError: maxAbs, maxTotalVariation: maxTV, processPeakRssMB: Math.round(Number(hwm) / 1024) }));
