// One compact line of sufficient statistics per runner (for aggregation from CI logs):
// per matchup: pairs, sum/sumsq of pair credit, W/T/L, score sums, latency summary of A;
// per paired contrast (same opponent, same seeds): n, sum/sumsq of the pair-credit difference.
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
const dir = process.argv[2], contrasts = (process.argv[3] ?? "").split(",").filter(Boolean);
const shards = readdirSync(dir).filter((f) => f.endsWith(".json.gz")).map((f) => JSON.parse(gunzipSync(readFileSync(`${dir}/${f}`)).toString()));
const cr = (x: number, y: number) => (x > y ? 1 : x === y ? 0.5 : 0);
const pairMap = (s: { raw: number[] }) => { const m = new Map<number, number>(); for (let i = 0; i < s.raw.length; i += 5) m.set(s.raw[i], (cr(s.raw[i + 1], s.raw[i + 2]) + cr(s.raw[i + 3], s.raw[i + 4])) / 2); return m; };
const q = (bins: number[], p: number) => { const t = bins.reduce((a, b) => a + b, 0); let acc = 0; for (let i = 0; i < bins.length; i++) { acc += bins[i]; if (acc >= p * t) return +(10 ** ((i - 300 + 0.5) / 50)).toFixed(4); } return NaN; };
const M = shards.map((s) => {
  const pm = [...pairMap(s).values()];
  let sa = 0, sb = 0, w = 0, t = 0, l = 0;
  for (let i = 0; i < s.raw.length; i += 5) { sa += s.raw[i + 1] + s.raw[i + 3]; sb += s.raw[i + 2] + s.raw[i + 4]; for (const [x, y] of [[s.raw[i + 1], s.raw[i + 2]], [s.raw[i + 3], s.raw[i + 4]]]) x > y ? w++ : x === y ? t++ : l++; }
  const st = s.stats[s.a], bins = s.latencyBins[s.a];
  return { a: s.a, b: s.b, sh: s.shard, n: pm.length, s1: pm.reduce((x, y) => x + y, 0), s2: pm.reduce((x, y) => x + y * y, 0), w, t, l, sa, sb, dec: st.decisions, ms: +st.ms.toFixed(1), p50: q(bins, 0.5), p95: q(bins, 0.95), p99: q(bins, 0.99), max: +st.maxMs.toFixed(2), dDP: st.diffFromDP, sec: +s.elapsedSeconds.toFixed(1) };
});
const C = contrasts.flatMap((spec) => {
  const [x, y, opp] = spec.split(":");
  const sx = shards.find((s) => s.a === x && s.b === opp), sy = shards.find((s) => s.a === y && s.b === opp);
  if (!sx || !sy) return [];
  const px = pairMap(sx), py = pairMap(sy), d: number[] = [];
  for (const [seed, c] of px) if (py.has(seed)) d.push(c - py.get(seed)!);
  return [{ c: `${x}-${y}@${opp}`, n: d.length, s1: d.reduce((a, b) => a + b, 0), s2: d.reduce((a, b) => a + b * b, 0), ch: d.filter((v) => v !== 0).length }];
});
console.log("V5_STATS " + JSON.stringify({ m: M, c: C }));
