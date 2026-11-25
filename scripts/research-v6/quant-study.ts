// Precision / compression study of the DP Expert PMF bank on REAL decisions.
// For each encoding the bank is quantised -> dequantised (Float64 again) and the v5-R
// rollout decision is recomputed on positions sampled from v5-R vs Win DP v2 games
// (dev family 9031). Reports: action agreement, regret (win-credit loss of the changed
// action evaluated with the exact Float64 bank), value error, and separate slices for
// near-ties (top-2 gap < 1e-3) and extreme positions (best credit < 2% or > 98%).
//   npx tsx scripts/research-v6/quant-study.ts [positions=4000]
import { createGame, transition, type Game } from "../../src/engine.ts";
import { winDPv5Decision, type V5Config } from "../../src/research-v5/apex.ts";
import { PolicyPmfBank } from "../../src/research-v5/policy-pmf.ts";
import { canonicalUpper, popcount } from "../../src/research-v5/kernel.ts";
import { winDPv2Decision } from "../../src/competitive-v2.ts";
import * as dp from "../../src/dp.ts";
import { loadDPExpertBank, loadBankFile } from "../research-v5/bank-io.ts";

const N = Number(process.argv[2] ?? 4000);
const { bank, T } = loadDPExpertBank(false);
dp.setDPTable(T.buffer.slice(0) as ArrayBuffer);
const base: V5Config = { bank, dpValue: (m, u) => T[m * 64 + u], endgame: "none", dpDecision: dp.dpDecision };

// sample public positions (P0 = v5-R, P1 = v2) from dev family 9031
const hash = (x: number) => { x >>>= 0; x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0; x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0; return (x ^ (x >>> 16)) >>> 0; };
const positions: Game[] = [];
for (let i = 0; positions.length < N; i++) {
  let s = createGame(hash(0x5eed0000 + 9031 * 1_000_003 + i), true);
  while (!s.done) {
    if (!s.rolls) { s = transition(s, { type: "roll" }); continue; }
    const view: Game = { ...s, seed: 0, rng: [0, 0] };
    if (s.player === 0) positions.push(view);
    const d = s.player === 0 ? winDPv5Decision(view, base) : winDPv2Decision(view) ?? dp.dpDecision(view);
    s = d.type === "score" ? transition(s, { type: "score", category: d.category }) : transition(transition(s, { type: "hold", ids: d.ids }), { type: "roll" });
  }
}
const NP = positions.length;
const ref = positions.map((p) => winDPv5Decision(p, base));
const f16 = (x: number) => { // round to IEEE half precision (subnormals included)
  if (x === 0) return 0; const e = Math.floor(Math.log2(x)); const ee = Math.max(e, -14); const q = 2 ** (ee - 10); return Math.round(x / q) * q;
};
type Enc = { name: string; bytesPerFloat: number; map: (p: Float64Array) => Float64Array; sparse?: boolean };
const perState = (levels: number) => (p: Float64Array) => { let mx = 0; for (const v of p) mx = Math.max(mx, v); return p.map((v) => Math.round((v / mx) * levels) / levels * mx); };
const trunc = (eps: number) => (p: Float64Array) => { const q = p.map((v) => (v < eps ? 0 : v)); const s = q.reduce((a, b) => a + b, 0); return q.map((v) => v / s); };
const ENC: Enc[] = [
  { name: "float32", bytesPerFloat: 4, map: (p) => p.map(Math.fround) },
  { name: "float16", bytesPerFloat: 2, map: (p) => p.map(f16) },
  { name: "int16/state", bytesPerFloat: 2, map: perState(65535) },
  { name: "int8/state", bytesPerFloat: 1, map: perState(255) },
  { name: "float32+trunc1e-9", bytesPerFloat: 4, map: (p) => trunc(1e-9)(p).map(Math.fround), sparse: true },
  { name: "float64+trunc1e-6", bytesPerFloat: 8, map: trunc(1e-6), sparse: true },
  { name: "float64+trunc1e-4", bytesPerFloat: 8, map: trunc(1e-4), sparse: true },
];
// --bank FILE[,FILE]: evaluate externally produced banks (e.g. PMF neural distillation) instead
const ext = (() => { const i = process.argv.indexOf("--bank"); return i < 0 ? [] : process.argv[i + 1].split(","); })();
// --hybrid K: exact PMF for masks with <= K open categories, external bank otherwise (Hybrid Exact-Neural)
const hyb = (() => { const i = process.argv.indexOf("--hybrid"); return i < 0 ? [] : process.argv[i + 1].split(",").map(Number); })();
const ENCS: Enc[] = ext.length ? ext.flatMap((f) => { const b = loadBankFile(f, () => NaN); const ks = hyb.length ? hyb : [-1];
  return ks.map((K) => ({ name: f.split("/").pop()! + (K >= 0 ? `+exact<=${K}` : ""), bytesPerFloat: 8, map: (p: Float64Array, k?: number) => (popcount(k! >> 6) <= K ? p : b.pmf[k!]!), exactFloats: K } as unknown as Enc)); }) : ENC;
const rows = [];
for (const enc of ENCS) {
  const qb = new PolicyPmfBank(enc.name, () => NaN);
  let stored = 0;
  for (let mask = 0; mask < 4096; mask++) for (let u = 0; u < 64; u++) {
    const cu = canonicalUpper(mask, u), k = mask * 64 + u;
    if (cu !== u) continue;
    const q = (enc.map as (p: Float64Array, k: number) => Float64Array)(bank.pmf[k]!, k);
    qb.pmf[k] = q;
    const K = (enc as unknown as { exactFloats?: number }).exactFloats;
    if (K !== undefined && popcount(mask) > K) { /* neural part: counted separately below */ } else if (enc.sparse) { let lo = 0, hi = q.length - 1; while (lo < hi && q[lo] === 0) lo++; while (hi > lo && q[hi] === 0) hi--; stored += hi - lo + 1; } else stored += q.length;
  }
  for (let mask = 0; mask < 4096; mask++) for (let u = 0; u < 64; u++) { const cu = canonicalUpper(mask, u); if (cu !== u) qb.pmf[mask * 64 + u] = qb.pmf[mask * 64 + cu]; }
  let agree = 0, material = 0, regretSum = 0, regretMax = 0, valErrMax = 0, nearN = 0, nearAgree = 0, extN = 0, extErrMax = 0;
  positions.forEach((p, i) => {
    const r = ref[i], d = winDPv5Decision(p, { ...base, bank: qb });
    const same = d.type === r.type && (d.type === "score" ? d.category === (r as typeof d).category : [...d.ids].sort().join() === [...(r as typeof d).ids].sort().join());
    if (same) agree++;
    const chosen = r.analysis.find((a) => a.label === d.analysis[0].label && a.kind === d.analysis[0].kind)!;
    const regret = r.analysis[0].winCredit - chosen.winCredit;
    if (regret > 1e-9) material++;
    regretSum += regret; regretMax = Math.max(regretMax, regret);
    valErrMax = Math.max(valErrMax, Math.abs(d.value - r.value));
    const gap = r.analysis.length > 1 ? r.analysis[0].winCredit - r.analysis[1].winCredit : 1;
    if (gap < 1e-3) { nearN++; if (same) nearAgree++; }
    if (r.value < 0.02 || r.value > 0.98) { extN++; extErrMax = Math.max(extErrMax, Math.abs(d.value - r.value)); }
  });
  rows.push({ encoding: enc.name, storedMB: +(stored * enc.bytesPerFloat / 2 ** 20).toFixed(1), positions: NP, actionAgreement: agree / NP, materialDisagreement: material / NP, meanRegret: regretSum / NP, maxRegret: regretMax, maxValueError: valErrMax, nearTies: nearN, nearTieAgreement: nearN ? nearAgree / nearN : null, extremePositions: extN, extremeMaxValueError: extErrMax });
  console.log(JSON.stringify(rows.at(-1)));
}
