/**
 * Economy study — EXACT final-score distribution of the DP Expert policy (solo, fair dice).
 * DP Expert's decisions depend only on (open-category mask, capped upper sum, dice, rolls), so the
 * policy is a finite Markov chain; we propagate its exact outcome distribution backward level by level.
 * Ties are broken as "first maximum" (category order / stop-before-hold), which may differ from the
 * game AI only on exactly-tied actions (equal expected value). Check: the PMF mean must equal the DP
 * table value 191.760879752165.
 * Output: src/economy/data/exact-score-pmf.json. Usage: npx tsx scripts/economy/exact-score-pmf.ts
 */
import { writeFileSync } from "node:fs";
import kernel from "../../src/dp-kernel.json";
import { chanceValues, dpFutureValue } from "../../src/dp";
import { loadDPTable } from "./policies";

loadDPTable();
const started = performance.now();
const MAXP = [5, 10, 15, 20, 25, 30, 30, 30, 28, 15, 30, 50];
const popcount = (m: number) => { let c = 0; while (m) { m &= m - 1; c++; } return c; };
const maxRemain = (mask: number) => MAXP.reduce((a, p, c) => (mask & (1 << c) ? a + p : a), 0) + 35;
const points: number[][] = kernel.points;
const holds: number[][] = kernel.holds;
const children: number[][] = kernel.children;
const firstRoll: number[] = kernel.probabilities;
if (firstRoll.length !== 252) throw Error("unexpected kernel.probabilities");

let prev = new Map<number, Float64Array[]>();
prev.set(0, Array.from({ length: 64 }, () => Float64Array.of(1)));
for (let k = 1; k <= 12; k++) {
  const cur = new Map<number, Float64Array[]>();
  for (let mask = 1; mask < 4096; mask++) {
    if (popcount(mask) !== k) continue;
    const L = maxRemain(mask) + 1;
    const list: Float64Array[] = [];
    for (let u = 0; u < 64; u++) {
      // --- policy (same Bellman as src/dp.ts turnValues) ---
      const stop = new Float64Array(252), stopCat = new Int8Array(252);
      for (let d = 0; d < 252; d++) {
        let best = -Infinity, bc = -1;
        for (let c = 0; c < 12; c++) if (mask & (1 << c)) {
          const p = points[d][c], nx = c < 6 ? Math.min(63, u + p) : u;
          const v = p + (u < 63 && nx === 63 ? 35 : 0) + dpFutureValue(mask ^ (1 << c), nx);
          if (v > best) { best = v; bc = c; }
        }
        stop[d] = best; stopCat[d] = bc;
      }
      const exp1 = chanceValues(stop);
      const val1 = new Float64Array(252), choice1 = new Int16Array(252);
      for (let d = 0; d < 252; d++) {
        let best = stop[d], bh = -1;
        for (const h of holds[d]) if (exp1[h] > best) { best = exp1[h]; bh = h; }
        val1[d] = best; choice1[d] = bh;
      }
      const exp2 = chanceValues(val1);
      const choice2 = new Int16Array(252);
      for (let d = 0; d < 252; d++) {
        let best = stop[d], bh = -1;
        for (const h of holds[d]) if (exp2[h] > best) { best = exp2[h]; bh = h; }
        choice2[d] = bh;
      }
      // --- forward mass through the turn ---
      const outcome = new Float64Array(252);
      const step = (mass: Float64Array, choice: Int16Array) => {
        const node = new Float64Array(462);
        for (let d = 0; d < 252; d++) if (mass[d] > 0) { if (choice[d] < 0) outcome[d] += mass[d]; else node[choice[d]] += mass[d]; }
        for (let h = 0; h < 210; h++) if (node[h] > 0) { const x = node[h] / 6; for (const ch of children[h]) node[ch] += x; }
        return node.subarray(210);
      };
      const m2 = step(Float64Array.from(firstRoll), choice2);
      const m3 = step(Float64Array.from(m2), choice1);
      for (let d = 0; d < 252; d++) outcome[d] += m3[d];
      // --- combine ---
      const pmf = new Float64Array(L);
      const agg = new Map<number, number>();
      for (let d = 0; d < 252; d++) if (outcome[d] > 0) { const c = stopCat[d], key = c * 1000 + points[d][c]; agg.set(key, (agg.get(key) ?? 0) + outcome[d]); }
      for (const [key, mass] of agg) {
        const c = Math.floor(key / 1000), p = key % 1000, nx = c < 6 ? Math.min(63, u + p) : u;
        const gain = p + (u < 63 && nx === 63 ? 35 : 0);
        const child = prev.get(mask ^ (1 << c))![nx];
        for (let i = 0; i < child.length; i++) if (child[i] > 0) pmf[i + gain] += mass * child[i];
      }
      list.push(pmf);
    }
    cur.set(mask, list);
  }
  prev = cur;
  console.log("level", k, ((performance.now() - started) / 1000).toFixed(1) + "s");
}
const pmf = Array.from(prev.get(4095)![0]);
const mass = pmf.reduce((a, b) => a + b, 0);
const mean = pmf.reduce((a, p, i) => a + p * i, 0);
const sd = Math.sqrt(pmf.reduce((a, p, i) => a + p * (i - mean) ** 2, 0));
const tail = (t: number) => pmf.slice(t).reduce((a, b) => a + b, 0);
const cdfQ = (q: number) => { let c = 0; for (let i = 0; i < pmf.length; i++) { c += pmf[i]; if (c >= q) return i; } return pmf.length - 1; };
// Two independent DP Expert players (each has its own dice): margin distribution
let draw = 0;
for (let i = 0; i < pmf.length; i++) draw += pmf[i] * pmf[i];
const cdf: number[] = []; { let c = 0; for (const p of pmf) { c += p; cdf.push(c); } }
const winBy = (m: number) => { let s = 0; for (let i = 0; i < pmf.length; i++) { const j = i - m; if (j >= 0) s += pmf[i] * cdf[j]; } return s; };
const thresholds = [150, 180, 200, 220, 250, 270, 280, 290, 300, 310, 320, 323];
const out = {
  generatedBy: "scripts/economy/exact-score-pmf.ts",
  policy: "DP Expert (expected-score Bellman, src/dp.ts table), first-max tie-break",
  check: { mass, mean, dpTableValue: dpFutureValue(4095, 0), absError: Math.abs(mean - dpFutureValue(4095, 0)) },
  sd,
  quantiles: { p001: cdfQ(0.001), p01: cdfQ(0.01), p10: cdfQ(0.1), p50: cdfQ(0.5), p90: cdfQ(0.9), p99: cdfQ(0.99), p999: cdfQ(0.999), p999999: cdfQ(0.999999) },
  tailAtLeast: Object.fromEntries(thresholds.map((t) => [t, tail(t)])),
  maxSupport: pmf.reduce((m, p, i) => (p > 0 ? i : m), 0),
  headToHead: { draw, winByAtLeast: Object.fromEntries([1, 50, 100, 150].map((m) => [m, winBy(m)])) },
  pmf: pmf.map((p) => (p === 0 ? 0 : Number(p.toPrecision(6)))),
  runtimeSeconds: (performance.now() - started) / 1000,
};
writeFileSync("src/economy/data/exact-score-pmf.json", JSON.stringify(out));
console.log(out.check, out.quantiles, out.tailAtLeast, out.headToHead, out.maxSupport);
