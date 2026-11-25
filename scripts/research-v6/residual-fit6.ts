// Fit the v6-C ridge residual with a GAME-level split (game % 5 == 0 held out).
//   npx tsx scripts/research-v6/residual-fit6.ts training/results/v6/residual/f9021.json
import { readFileSync, writeFileSync } from "node:fs";
import { residualFeatures, predictResidual } from "../../src/research-v6/residual.ts";
const data = JSON.parse(readFileSync(process.argv[2], "utf8"));
const rows: number[][] = data.rows; // game,kMe,Mme,uMe,Tme,kOpp,Mopp,uOpp,Topp,pset,exact
const X = rows.map((r) => residualFeatures(r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9])), y = rows.map((r) => r[10] - r[9]);
const test = rows.map((r) => r[0] % 5 === 0);
const d = X[0].length;
function ridge(lam: number, idx: number[]) {
  const A = Array.from({ length: d }, () => new Float64Array(d + 1));
  for (const i of idx) for (let p = 0; p < d; p++) { A[p][d] += X[i][p] * y[i]; for (let q = 0; q < d; q++) A[p][q] += X[i][p] * X[i][q]; }
  for (let p = 1; p < d; p++) A[p][p] += lam;
  for (let c = 0; c < d; c++) {
    let piv = c; for (let r = c + 1; r < d; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    if (Math.abs(A[c][c]) < 1e-12) continue;
    for (let r = 0; r < d; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k <= d; k++) A[r][k] -= f * A[c][k]; }
  }
  return Array.from({ length: d }, (_, c) => (Math.abs(A[c][c]) < 1e-12 ? 0 : A[c][d] / A[c][c]));
}
const tr = rows.map((_, i) => i).filter((i) => !test[i]), te = rows.map((_, i) => i).filter((i) => test[i]);
const mae = (idx: number[], w: number[] | null) => idx.reduce((s, i) => s + Math.abs(y[i] - (w ? predictResidual(w, X[i]) : 0)), 0) / idx.length;
const byK = (w: number[] | null) => Object.fromEntries([0, 1, 2, 3, 4].map((k) => { const ii = te.filter((i) => rows[i][1] === k); return [k, ii.length ? { n: ii.length, maePP: 100 * mae(ii, w) } : null]; }));
const res: Record<string, unknown> = { dataset: process.argv[2], features: d, trainRows: tr.length, testRows: te.length, trainGames: new Set(tr.map((i) => rows[i][0])).size, testGames: new Set(te.map((i) => rows[i][0])).size, baselineHeldOutMAEpp: 100 * mae(te, null), baselineByK: byK(null), residualMeanPP: 100 * y.reduce((a, b) => a + b, 0) / y.length };
let best: { lam: number; w: number[]; m: number } | null = null;
for (const lam of [1e-4, 1e-3, 1e-2, 1e-1, 1]) {
  // choose lambda on an inner game split of the training games (game % 5 == 1)
  const inTr = tr.filter((i) => rows[i][0] % 5 !== 1), inVa = tr.filter((i) => rows[i][0] % 5 === 1);
  const m = mae(inVa, ridge(lam, inTr));
  if (!best || m < best.m) best = { lam, w: [], m };
}
// gate: enable the residual only for kMe values where it helps on the INNER validation games
const inTr = tr.filter((i) => rows[i][0] % 5 !== 1), inVa = tr.filter((i) => rows[i][0] % 5 === 1);
const wIn = ridge(best!.lam, inTr);
const gate = [0, 1, 2, 3, 4].filter((k) => { const ii = inVa.filter((i) => rows[i][1] === k); return ii.length > 0 && mae(ii, wIn) < mae(ii, null); });
best!.w = ridge(best!.lam, tr);
const gatedMae = te.reduce((s2, i) => s2 + Math.abs(y[i] - (gate.includes(rows[i][1]) ? predictResidual(best!.w, X[i]) : 0)), 0) / te.length;
Object.assign(res, { gateKMe: gate, gatedHeldOutMAEpp: 100 * gatedMae });
Object.assign(res, { ridgeLambda: best!.lam, ridgeHeldOutMAEpp: 100 * mae(te, best!.w), ridgeByK: byK(best!.w), weights: best!.w });
console.log(JSON.stringify({ ...res, weights: undefined }, null, 1));
writeFileSync("training/results/v6/residual/ridge-f9021.json", JSON.stringify(res));
