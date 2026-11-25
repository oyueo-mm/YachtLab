// Aggregate "V5_STATS" lines (one per CI runner) into the final confirmation table.
//   npx tsx scripts/research-v5/aggregate-stats.ts stats.jsonl [--md out.md] [--json out.json]
import { readFileSync, writeFileSync } from "node:fs";
const lines = readFileSync(process.argv[2], "utf8").split("\n").filter((l) => l.includes("V5_STATS ")).map((l) => JSON.parse(l.slice(l.indexOf("V5_STATS ") + 9)));
const arg = (k: string) => { const i = process.argv.indexOf(k); return i < 0 ? undefined : process.argv[i + 1]; };
const z = 2.5758;
type M = { a: string; b: string; sh: number; n: number; s1: number; s2: number; w: number; t: number; l: number; sa: number; sb: number; dec: number; ms: number; p50: number; p95: number; p99: number; max: number; dDP: number; sec: number };
const ms = new Map<string, M[]>(), cs = new Map<string, { n: number; s1: number; s2: number; ch: number }[]>();
const seen = new Set<string>();
for (const L of lines) {
  for (const m of L.m as M[]) { const k = `${m.a}|${m.b}`; if (seen.has(k + m.sh)) continue; seen.add(k + m.sh); ms.set(k, [...(ms.get(k) ?? []), m]); }
  for (const c of L.c) cs.set(c.c, [...(cs.get(c.c) ?? []), c]);
}
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const normSf = (x: number) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI), p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))); return x >= 0 ? p : 1 - p; };
const rows = [...ms.entries()].map(([k, g]) => {
  const [a, b] = k.split("|");
  const n = g.reduce((s, x) => s + x.n, 0), s1 = g.reduce((s, x) => s + x.s1, 0), s2 = g.reduce((s, x) => s + x.s2, 0);
  const m = s1 / n, se = Math.sqrt((s2 - n * m * m) / (n - 1) / n), zz = (m - 0.5) / se;
  const games = 2 * n, w = g.reduce((s, x) => s + x.w, 0), t = g.reduce((s, x) => s + x.t, 0), l = g.reduce((s, x) => s + x.l, 0);
  const dec = g.reduce((s, x) => s + x.dec, 0);
  return { a, b, shards: g.length, games, winCredit: m, ci: [m - z * se, m + z * se], z: zz, pOneSided: normSf(zz), win: w / games, tie: t / games, loss: l / games, meanA: g.reduce((s, x) => s + x.sa, 0) / games, meanB: g.reduce((s, x) => s + x.sb, 0) / games, elo: 400 * Math.log10(m / (1 - m)), msMean: g.reduce((s, x) => s + x.ms, 0) / dec, p50: med(g.map((x) => x.p50)), p95: med(g.map((x) => x.p95)), p99: med(g.map((x) => x.p99)), maxMs: Math.max(...g.map((x) => x.max)), diffFromDP: g.reduce((s, x) => s + x.dDP, 0) / dec, cpuSec: g.reduce((s, x) => s + x.sec, 0) };
});
const crow = [...cs.entries()].map(([k, g]) => {
  const n = g.reduce((s, x) => s + x.n, 0), s1 = g.reduce((s, x) => s + x.s1, 0), s2 = g.reduce((s, x) => s + x.s2, 0), m = s1 / n, se = Math.sqrt((s2 - n * m * m) / (n - 1) / n);
  return { contrast: k, pairs: n, delta: m, ci: [m - z * se, m + z * se], z: m / se, changed: g.reduce((s, x) => s + x.ch, 0) };
});
const P = (v: number) => (100 * v).toFixed(3) + "%", PP = (v: number) => (v >= 0 ? "+" : "") + (100 * v).toFixed(3) + "%p";
let md = "| A | B | games | A win credit | 99% CI | z | W / T / L | mean A | mean B | Elo | A ms mean / p50 / p95 / p99 / max | A≠DP |\n|---|---|---:|---:|---|---:|---|---:|---:|---:|---|---:|\n";
for (const r of rows.sort((x, y) => x.b.localeCompare(y.b) || y.winCredit - x.winCredit)) md += `| ${r.a} | ${r.b} | ${r.games} | **${P(r.winCredit)}** | ${P(r.ci[0])}–${P(r.ci[1])} | ${r.z.toFixed(2)} | ${P(r.win)} / ${P(r.tie)} / ${P(r.loss)} | ${r.meanA.toFixed(2)} | ${r.meanB.toFixed(2)} | ${r.elo.toFixed(1)} | ${r.msMean.toFixed(3)} / ${r.p50} / ${r.p95} / ${r.p99} / ${r.maxMs} | ${P(r.diffFromDP)} |\n`;
md += "\n| paired contrast (A1 − A2 @ opponent, same seeds) | pairs | Δ win credit | 99% CI | z | changed pairs |\n|---|---:|---:|---|---:|---:|\n";
for (const c of crow) md += `| ${c.contrast} | ${c.pairs} | **${PP(c.delta)}** | ${PP(c.ci[0])} – ${PP(c.ci[1])} | ${c.z.toFixed(2)} | ${c.changed} |\n`;
console.log(md);
if (arg("--md")) writeFileSync(arg("--md")!, md);
if (arg("--json")) writeFileSync(arg("--json")!, JSON.stringify({ rows, contrasts: crow }, null, 1));
