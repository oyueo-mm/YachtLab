// Summarize v5 tournament shards: per matchup win credit with seed-pair CIs,
// W/T/L, mean scores, Elo, latency quantiles, CRN variance reduction, and
// paired contrasts between candidates that faced the same opponent on the same seeds.
//   npx tsx scripts/research-v5/summarize.ts DIR [--z 2.576] [--md out.md] [--json out.json] [--contrast "v5-B3:v3"]
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const dir = process.argv[2];
const arg = (k: string, d?: string) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const z = Number(arg("--z", "2.5758"));
type Shard = { a: string; b: string; family: number; shard: number; pairs: number; raw: number[]; stats: Record<string, { decisions: number; ms: number; maxMs: number; diffFromDP: number; stages: Record<string, number> }>; latencyBins: Record<string, number[]>; elapsedSeconds: number; describe: Record<string, string> };
const shards: Shard[] = readdirSync(dir).filter((f) => f.endsWith(".json.gz")).map((f) => JSON.parse(gunzipSync(readFileSync(`${dir}/${f}`)).toString()));
const groups = new Map<string, Shard[]>();
for (const s of shards) { const k = `${s.a}|${s.b}|${s.family}`; groups.set(k, [...(groups.get(k) ?? []), s].sort((x, y) => x.shard - y.shard)); }

const credit = (x: number, y: number) => (x > y ? 1 : x === y ? 0.5 : 0);
function pairs(g: Shard[]) {
  const out: { seed: number; c: number; g1: number; g2: number; a1: number; b1: number; a2: number; b2: number }[] = [];
  for (const s of g) for (let i = 0; i < s.raw.length; i += 5) {
    const [seed, a1, b1, a2, b2] = s.raw.slice(i, i + 5);
    out.push({ seed, a1, b1, a2, b2, g1: credit(a1, b1), g2: credit(a2, b2), c: (credit(a1, b1) + credit(a2, b2)) / 2 });
  }
  return out;
}
const meanSd = (xs: number[]) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1); return { m, sd: Math.sqrt(v), se: Math.sqrt(v / xs.length) }; };
const elo = (p: number) => 400 * Math.log10(p / (1 - p));
function quantile(bins: number[], q: number) {
  const tot = bins.reduce((a, b) => a + b, 0); let acc = 0;
  for (let i = 0; i < bins.length; i++) { acc += bins[i]; if (acc >= q * tot) return 10 ** ((i - 300 + 0.5) / 50); }
  return NaN;
}

const rows: Record<string, unknown>[] = [];
for (const [key, g] of groups) {
  const [a, b, family] = key.split("|");
  const p = pairs(g), cs = meanSd(p.map((x) => x.c));
  const games = p.flatMap((x) => [x.g1, x.g2]), gs = meanSd(games);
  const w = games.filter((x) => x === 1).length, t = games.filter((x) => x === 0.5).length, l = games.length - w - t;
  const aScore = meanSd(p.flatMap((x) => [x.a1, x.a2])), bScore = meanSd(p.flatMap((x) => [x.b1, x.b2]));
  const agg = (name: string) => {
    const st = g.map((s) => s.stats[name]);
    const bins = g.map((s) => s.latencyBins[name]).reduce((acc, v) => acc.map((x, i) => x + v[i]));
    const decisions = st.reduce((s, x) => s + x.decisions, 0);
    const stages: Record<string, number> = {};
    for (const x of st) for (const [k, v] of Object.entries(x.stages)) stages[k] = (stages[k] ?? 0) + v;
    return { decisions, meanMs: st.reduce((s, x) => s + x.ms, 0) / decisions, p50: quantile(bins, 0.5), p95: quantile(bins, 0.95), p99: quantile(bins, 0.99), maxMs: Math.max(...st.map((x) => x.maxMs)), diffFromDPRate: st.reduce((s, x) => s + x.diffFromDP, 0) / decisions, stages };
  };
  // CRN / seat-swap variance reduction: var of pair mean vs var if the two games were independent
  const vrf = (gs.sd ** 2 / 2) / (cs.sd ** 2 || 1e-300);
  rows.push({ a, b, family: Number(family), shards: g.length, pairs: p.length, games: games.length, winCredit: cs.m, ci: [cs.m - z * cs.se, cs.m + z * cs.se], se: cs.se, wins: w, ties: t, losses: l, winRate: w / games.length, tieRate: t / games.length, lossRate: l / games.length, meanScoreA: aScore.m, meanScoreB: bScore.m, meanDiff: aScore.m - bScore.m, elo: elo(cs.m), eloCi: [elo(cs.m - z * cs.se), elo(cs.m + z * cs.se)], varianceReductionFactor: vrf, latencyA: agg(a), latencyB: agg(b), cpuSeconds: g.reduce((s, x) => s + x.elapsedSeconds, 0), describe: g[0].describe });
}

// paired contrasts: same opponent b, same family, same seeds
const contrasts: Record<string, unknown>[] = [];
for (const spec of (arg("--contrast", "") ?? "").split(",").filter(Boolean)) {
  const [x, y] = spec.split(":");
  for (const [key, g] of groups) {
    const [a, b, family] = key.split("|");
    if (a !== x) continue;
    const other = groups.get(`${y}|${b}|${family}`);
    if (!other) continue;
    const px = pairs(g), py = new Map(pairs(other).map((r) => [r.seed, r]));
    const d = px.filter((r) => py.has(r.seed)).map((r) => r.c - py.get(r.seed)!.c);
    if (!d.length) continue;
    const s = meanSd(d);
    contrasts.push({ candidate: x, baseline: y, opponent: b, family: Number(family), pairs: d.length, delta: s.m, ci: [s.m - z * s.se, s.m + z * s.se], changedPairs: d.filter((v) => v !== 0).length });
  }
}

const pct = (v: number) => (100 * v).toFixed(3) + "%";
const pp = (v: number) => (100 * v >= 0 ? "+" : "") + (100 * v).toFixed(3) + "%p";
let md = `| A | B | seed family | games | A win credit | ${(z === 1.96 ? "95" : "99")}% CI (seed pairs) | W / T / L (A) | mean A | mean B | Elo A−B | A ms mean / p50 / p95 / p99 | A≠DP | CRN VRF |\n|---|---|---:|---:|---:|---|---|---:|---:|---:|---|---:|---:|\n`;
for (const r of rows.sort((x, y) => String(x.b).localeCompare(String(y.b)) || (y.winCredit as number) - (x.winCredit as number))) {
  const la = r.latencyA as { meanMs: number; p50: number; p95: number; p99: number; diffFromDPRate: number };
  md += `| ${r.a} | ${r.b} | ${r.family} | ${r.games} | **${pct(r.winCredit as number)}** | ${pct((r.ci as number[])[0])}–${pct((r.ci as number[])[1])} | ${pct(r.winRate as number)} / ${pct(r.tieRate as number)} / ${pct(r.lossRate as number)} | ${(r.meanScoreA as number).toFixed(2)} | ${(r.meanScoreB as number).toFixed(2)} | ${(r.elo as number).toFixed(1)} | ${la.meanMs.toFixed(2)} / ${la.p50.toFixed(2)} / ${la.p95.toFixed(2)} / ${la.p99.toFixed(2)} | ${pct(la.diffFromDPRate)} | ${(r.varianceReductionFactor as number).toFixed(1)}× |\n`;
}
if (contrasts.length) {
  md += `\n| paired contrast (same seeds) | opponent | family | pairs | Δ win credit | CI | pairs with changed result |\n|---|---|---:|---:|---:|---|---:|\n`;
  for (const c of contrasts) md += `| ${c.candidate} − ${c.baseline} | ${c.opponent} | ${c.family} | ${c.pairs} | **${pp(c.delta as number)}** | ${pp((c.ci as number[])[0])} – ${pp((c.ci as number[])[1])} | ${c.changedPairs} |\n`;
}
console.log(md);
if (arg("--md")) writeFileSync(arg("--md")!, md);
if (arg("--json")) writeFileSync(arg("--json")!, JSON.stringify({ z, rows, contrasts }, null, 1));
