// Compare two serialized PMF banks element-wise (e.g. TypeScript vs native C++).
import { readFileSync } from "node:fs";
import { deserializeBank } from "./bank-io.ts";
const [a, b] = process.argv.slice(2).map((f) => deserializeBank(readFileSync(f), () => 0));
let maxAbs = 0, maxTv = 0, lenDiff = 0, states = 0, worst = "", over9 = 0, over6 = 0, init = 0;
for (let k = 0; k < 4096 * 64; k++) {
  const p = a.pmf[k], q = b.pmf[k];
  if (!p || !q) continue;
  states++;
  if (p.length !== q.length) lenDiff++;
  let tv = 0;
  for (let i = 0; i < Math.max(p.length, q.length); i++) { const d = Math.abs((p[i] ?? 0) - (q[i] ?? 0)); tv += d; if (d > maxAbs) { maxAbs = d; worst = `${k >> 6}:${k & 63}@${i}`; } }
  maxTv = Math.max(maxTv, tv / 2); if (tv / 2 > 1e-9 && (k & 63) === (k & 63)) over9++; if (tv / 2 > 1e-6) over6++; if (k === 4095 * 64) init = tv / 2;
}
console.log(JSON.stringify({ over9, over6, initialStateTV: init, states, lenDiff, maxAbsDiff: maxAbs, maxTotalVariation: maxTv, worst }));
