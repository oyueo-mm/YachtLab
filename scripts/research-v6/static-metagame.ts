// Exact restricted meta-game over STATIC exp-utility commitments (PSRO-style restricted
// game, technique 33/34/43). Strategy i = "follow the lambda_i policy for the whole game".
// Both players' final scores are independent, so credit(i vs j) = sum_x,y P_i(x) P_j(y) ([x>y] + 0.5[x=y])
// is exact (no sampling). Seat order does not matter for static policies.
//   npx tsx scripts/research-v6/static-metagame.ts
import { loadBankFile, loadDPExpertBank } from "../research-v5/bank-io.ts";
const L = [-0.08, -0.04, -0.02, 0, 0.02, 0.04, 0.08];
const init: Float64Array[] = [];
for (const lam of L) {
  const b = lam === 0 ? loadDPExpertBank(false).bank : loadBankFile(new URL(`../../training/checkpoints/v6/risk_${lam}.f64bank`, import.meta.url), () => NaN);
  init.push(Float64Array.from(b.get(4095, 0)));
}
const stats = init.map((p, i) => { let m = 0, v = 0; p.forEach((q, g) => (m += q * g)); p.forEach((q, g) => (v += q * (g - m) ** 2)); let p250 = 0; p.forEach((q, g) => g >= 250 && (p250 += q)); return { lambda: L[i], mean: m, sd: Math.sqrt(v), pAtLeast250: p250 }; });
const M = init.map((a) => init.map((b) => { let c = 0, below = 0; const cdf = new Float64Array(b.length + 1); for (let y = 0; y < b.length; y++) cdf[y + 1] = cdf[y] + b[y]; for (let x = 0; x < a.length; x++) if (a[x]) c += a[x] * (cdf[Math.min(x, b.length)] + (x < b.length ? b[x] / 2 : 0)); void below; return c; }));
// zero-sum game value via fictitious play (exact pure best responses)
let x = new Float64Array(L.length).fill(0), y = new Float64Array(L.length).fill(0);
x[3] = 1; y[3] = 1;
for (let t = 1; t <= 200000; t++) {
  const rowPay = M.map((r) => r.reduce((s, v, j) => s + v * y[j], 0));
  const colPay = L.map((_, j) => M.reduce((s, r, i) => s + r[j] * x[i], 0));
  const bi = rowPay.indexOf(Math.max(...rowPay)), bj = colPay.indexOf(Math.min(...colPay));
  x = x.map((v, i) => v + ((i === bi ? 1 : 0) - v) / (t + 1)); y = y.map((v, j) => v + ((j === bj ? 1 : 0) - v) / (t + 1));
}
const vRow = Math.min(...L.map((_, j) => M.reduce((s, r, i) => s + r[j] * x[i], 0)));
console.log(JSON.stringify({ stats, matrix: M.map((r) => r.map((v) => +(v * 100).toFixed(3))), lambdas: L, nashRow: Array.from(x, (v) => +v.toFixed(4)), guaranteedValue: vRow, dpRowVsAll: M[3] }, null, 1));
