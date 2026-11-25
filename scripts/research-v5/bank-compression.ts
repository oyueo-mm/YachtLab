// Deployment study: storage size of the exact PMF bank under lossy encodings and
// the induced error (max total variation, max win-credit error on random pairs).
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { deserializeBank } from "./bank-io.ts";
import { canonicalUpper } from "../../src/research-v5/kernel.ts";
import { winCredit } from "../../src/research-v5/policy-pmf.ts";
const bank = deserializeBank(readFileSync("training/checkpoints/v5/dp-expert-pmf.f64bank"), () => 0);
const keys: number[] = [];
for (let m = 0; m < 4096; m++) for (let u = 0; u < 64; u++) if (canonicalUpper(m, u) === u) keys.push(m * 64 + u);
function encode(kind: "f64" | "f32" | "f32-trim9" | "u16-trim6") {
  const parts: Uint8Array[] = []; const decoded = new Map<number, Float64Array>(); let raw = 0;
  for (const k of keys) {
    const p = bank.pmf[k]!;
    let lo = 0, hi = p.length - 1;
    const eps = kind === "f32-trim9" ? 1e-9 : kind === "u16-trim6" ? 1e-6 : 0;
    if (eps) { while (lo < hi && p[lo] < eps) lo++; while (hi > lo && p[hi] < eps) hi--; }
    const seg = p.subarray(lo, hi + 1);
    let arr: Uint8Array, dec: Float64Array;
    if (kind === "f64") { arr = new Uint8Array(Float64Array.from(seg).buffer); dec = Float64Array.from(seg); }
    else if (kind === "u16-trim6") { const mx = Math.max(...seg); const q = Uint16Array.from(seg, (x) => Math.round((x / mx) * 65535)); arr = new Uint8Array(q.buffer); dec = Float64Array.from(q, (x) => (x / 65535) * mx); }
    else { const f = Float32Array.from(seg); arr = new Uint8Array(f.buffer); dec = Float64Array.from(f); }
    // renormalise (decoder side) and re-place
    const s = dec.reduce((a, b) => a + b, 0); const full = new Float64Array(p.length); for (let i = 0; i < dec.length; i++) full[lo + i] = dec[i] / s;
    decoded.set(k, full); parts.push(arr); raw += arr.length + 4;
  }
  const blob = Buffer.concat(parts.map((x) => Buffer.from(x)));
  let maxTV = 0;
  for (const k of keys) { const a = bank.pmf[k]!, b = decoded.get(k)!; let tv = 0; for (let i = 0; i < a.length; i++) tv += Math.abs(a[i] - b[i]); maxTV = Math.max(maxTV, tv / 2); }
  let maxWin = 0, s = 7;
  for (let t = 0; t < 20000; t++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; const k1 = keys[s % keys.length]; s = (Math.imul(s, 1664525) + 1013904223) >>> 0; const k2 = keys[s % keys.length]; const d = (s >>> 8) % 80 - 40;
    maxWin = Math.max(maxWin, Math.abs(winCredit(d, bank.pmf[k1]!, 0, bank.pmf[k2]!) - winCredit(d, decoded.get(k1)!, 0, decoded.get(k2)!))); }
  return { kind, rawMB: raw / 1e6, gzipMB: gzipSync(blob, { level: 6 }).length / 1e6, maxTotalVariation: maxTV, maxWinCreditError: maxWin };
}
for (const k of ["f64", "f32", "f32-trim9", "u16-trim6"] as const) console.log(JSON.stringify(encode(k)));
