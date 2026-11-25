// Sizes of the full DP Expert bank in the YPB1 shipping formats (raw and gzip) + decode check.
//   npx tsx scripts/research-v6/codec-sizes.ts
import { gzipSync } from "node:zlib";
import { loadDPExpertBank } from "../research-v5/bank-io.ts";
import { encodeBank, decodeBank } from "../../src/research-v6/bank-codec.ts";
import { canonicalUpper } from "../../src/research-v5/kernel.ts";
const { bank } = loadDPExpertBank(false);
for (const kind of ["f32", "int16"] as const) {
  let t0 = performance.now(); const buf = encodeBank(bank, kind); const encMs = performance.now() - t0;
  const gz = gzipSync(Buffer.from(buf), { level: 9 });
  t0 = performance.now(); const dec = decodeBank(buf); const decMs = performance.now() - t0;
  let maxAbs = 0, maxMean = 0;
  for (let m = 0; m < 4096; m++) for (let u = 0; u < 64; u++) { if (canonicalUpper(m, u) !== u) continue; const k = m * 64 + u, a = dec.pmf[k]!, b = bank.pmf[k]!; for (let g = 0; g < b.length; g++) maxAbs = Math.max(maxAbs, Math.abs(a[g] - b[g])); maxMean = Math.max(maxMean, Math.abs(dec.mean[k] - bank.mean[k])); }
  console.log(JSON.stringify({ kind, rawMB: +(buf.byteLength / 2 ** 20).toFixed(1), gzipMB: +(gz.length / 2 ** 20).toFixed(1), encodeMs: Math.round(encMs), decodeMs: Math.round(decMs), maxAbsError: maxAbs, maxMeanError: maxMean }));
}
