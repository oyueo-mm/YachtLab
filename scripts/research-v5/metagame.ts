// Restricted meta-game (PSRO-style) over the measured tournament payoffs.
// Input: summarize.ts --json output(s). Payoff M[i][j] = measured win credit of i vs j
// (antisymmetric completion M[j][i] = 1 - M[i][j], diagonal 0.5). Solves the zero-sum
// restricted game by fictitious play and reports the mixture and restricted
// exploitability. This is NOT the full-game Nash equilibrium or full-game exploitability.
//   npx tsx scripts/research-v5/metagame.ts summary1.json [summary2.json ...]
import { readFileSync } from "node:fs";
const subsetArg = process.argv.find((a) => a.startsWith("--subset="));
const subset = subsetArg ? new Set(subsetArg.slice(9).split(",")) : null;
const rows = process.argv.slice(2).filter((a) => !a.startsWith("--")).flatMap((f) => JSON.parse(readFileSync(f, "utf8")).rows as { a: string; b: string; winCredit: number; games: number }[]);
const names = [...new Set(rows.flatMap((r) => [r.a, r.b]))].filter((x) => !subset || subset.has(x)).sort();
const n = names.length, M = names.map(() => names.map(() => NaN));
const games = names.map(() => names.map(() => 0));
for (let i = 0; i < n; i++) M[i][i] = 0.5;
for (const r of rows) {
  const i = names.indexOf(r.a), j = names.indexOf(r.b);
  if (i < 0 || j < 0) continue;
  // pool multiple measurements weighted by games
  const prev = games[i][j];
  M[i][j] = prev ? (M[i][j] * prev + r.winCredit * r.games) / (prev + r.games) : r.winCredit;
  M[j][i] = 1 - M[i][j]; games[i][j] = games[j][i] = prev + r.games;
}
const missing: string[] = [];
for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (Number.isNaN(M[i][j])) missing.push(`${names[i]}-${names[j]}`);
if (missing.length) { console.log(JSON.stringify({ error: "incomplete payoff matrix", missing })); process.exit(0); }
const count = new Float64Array(n); count[0] = 1;
const iters = 200000;
for (let t = 0; t < iters; t++) {
  // best response of a player against the opponent's empirical mixture (symmetric game)
  let best = -1, bi = 0;
  const tot = count.reduce((a, b) => a + b, 0);
  for (let i = 0; i < n; i++) { let v = 0; for (let j = 0; j < n; j++) v += M[i][j] * count[j] / tot; if (v > best) { best = v; bi = i; } }
  count[bi]++;
}
const tot = count.reduce((a, b) => a + b, 0), x = Array.from(count, (c) => c / tot);
const brValue = Math.max(...names.map((_, i) => x.reduce((s, xj, j) => s + xj * M[i][j], 0)));
console.log(JSON.stringify({ policies: names, mixture: Object.fromEntries(names.map((s, i) => [s, +x[i].toFixed(4)])), restrictedExploitability: brValue - 0.5, payoff: Object.fromEntries(names.map((s, i) => [s, Object.fromEntries(names.map((t, j) => [t, +M[i][j].toFixed(5)]))])) }, null, 1));
