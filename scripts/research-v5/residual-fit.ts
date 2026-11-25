// Method 10 (measurement only): fit a residual "interaction" value model
//   exact interactive value - exact non-interactive PMF value
// from the value-accuracy teacher dataset, with a train / held-out split by
// sampled game, and report whether it reduces value error. Ridge regression and a
// tiny 1-hidden-layer MLP are compared at the same data budget. The fitted models
// are NOT used in play here (no strength claim).
//   npx tsx scripts/research-v5/residual-fit.ts training/results/v5/value-accuracy/f9004.json
import { readFileSync, writeFileSync } from "node:fs";
import { upperHeadroom } from "../../src/research-v5/kernel.ts";
const data = JSON.parse(readFileSync(process.argv[2], "utf8"));
const rows: number[][] = data.rows; // k,M0,u0,T0,M1,u1,T1,pmf,roll,exact
const feats = (r: number[]) => {
  const [k, M0, u0, T0, M1, u1, T1, pmf, roll] = r;
  const f = [1, (T0 - T1) / 100, pmf, pmf * pmf, pmf * (1 - pmf), roll - pmf];
  for (let kk = 1; kk <= 5; kk++) f.push(k === kk ? 1 : 0);
  for (let c = 0; c < 12; c++) f.push((M0 >> c) & 1, (M1 >> c) & 1);
  const pend = (M: number, u: number) => ((M & 63) && u < 63 && u + upperHeadroom(M) >= 63 ? 1 : 0);
  f.push(pend(M0, u0), pend(M1, u1), pend(M0, u0) * (63 - u0) / 63, pend(M1, u1) * (63 - u1) / 63);
  return f;
};
const X = rows.map(feats), y = rows.map((r) => r[9] - r[7]);
const isTest = rows.map((_, i) => i % 5 === 0);
const tr = X.map((_, i) => i).filter((i) => !isTest[i]), te = X.map((_, i) => i).filter((i) => isTest[i]);
const d = X[0].length;
function ridge(lambda: number) {
  const A = Array.from({ length: d }, () => new Float64Array(d)), b = new Float64Array(d);
  for (const i of tr) for (let p = 0; p < d; p++) { b[p] += X[i][p] * y[i]; for (let q = 0; q < d; q++) A[p][q] += X[i][p] * X[i][q]; }
  for (let p = 1; p < d; p++) A[p][p] += lambda;
  // Gaussian elimination
  const w = new Float64Array(d), M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < d; c++) {
    let piv = c; for (let r = c + 1; r < d; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) continue;
    for (let r = 0; r < d; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= d; k++) M[r][k] -= f * M[c][k]; }
  }
  for (let c = 0; c < d; c++) w[c] = Math.abs(M[c][c]) < 1e-12 ? 0 : M[c][d] / M[c][c];
  return (x: number[]) => x.reduce((s, v, i) => s + v * w[i], 0);
}
function mlp(hidden: number, epochs: number, lr: number, seed = 1) {
  let s = seed; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 0.2;
  const W1 = Array.from({ length: hidden }, () => Array.from({ length: d }, rnd)), b1 = new Float64Array(hidden), W2 = Array.from({ length: hidden }, rnd); let b2 = 0;
  const h = new Float64Array(hidden);
  const fwd = (x: number[]) => { let o = b2; for (let j = 0; j < hidden; j++) { let a = b1[j]; for (let i = 0; i < d; i++) a += W1[j][i] * x[i]; h[j] = Math.tanh(a); o += W2[j] * h[j]; } return o; };
  for (let e = 0; e < epochs; e++) for (const i of tr) {
    const o = fwd(X[i]), g = o - y[i];
    for (let j = 0; j < hidden; j++) { const gh = g * W2[j] * (1 - h[j] * h[j]); W2[j] -= lr * g * h[j]; b1[j] -= lr * gh; for (let q = 0; q < d; q++) W1[j][q] -= lr * gh * X[i][q]; }
    b2 -= lr * g;
  }
  return fwd;
}
const evalModel = (f: ((x: number[]) => number) | null) => {
  const byK: Record<number, number[]> = {};
  for (const i of te) { const pred = rows[i][7] + (f ? f(X[i]) : 0); (byK[rows[i][0]] ??= []).push(Math.abs(pred - rows[i][9])); }
  const all = te.map((i) => Math.abs(rows[i][7] + (f ? f(X[i]) : 0) - rows[i][9]));
  return { mae: all.reduce((a, b) => a + b, 0) / all.length, byK: Object.fromEntries(Object.entries(byK).map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length])) };
};
const rollEval = (() => { const a = te.map((i) => Math.abs(rows[i][8] - rows[i][9])); return a.reduce((x, y) => x + y, 0) / a.length; })();
const out = {
  dataset: process.argv[2], train: tr.length, test: te.length, features: d,
  residualDistribution: { mean: y.reduce((a, b) => a + b, 0) / y.length, maxAbs: Math.max(...y.map(Math.abs)), p99Abs: [...y.map(Math.abs)].sort((a, b) => a - b)[Math.floor(0.99 * (y.length - 1))] },
  heldOutMAE: { pmfOnly: evalModel(null), rolloutValue: rollEval, ridge: evalModel(ridge(1e-3)), mlp16: evalModel(mlp(16, 60, 0.003)) },
};
console.log(JSON.stringify(out, null, 1));
writeFileSync(process.argv[2].replace(/\.json$/, "-residual-fit.json"), JSON.stringify(out, null, 1));
