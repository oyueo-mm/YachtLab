// Aggregate CI shard sufficient statistics (pair credit sum / sum of squares) logged by
// bench.ts ("V5_SHARD" lines in GitHub Actions job logs) into win credit + CI.
import { readFileSync } from "node:fs";
const rows = readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l));
const z = 2.5758, groups = new Map<string, typeof rows>();
for (const r of rows) groups.set(`${r.a}|${r.b}|${r.family}`, [...(groups.get(`${r.a}|${r.b}|${r.family}`) ?? []), r]);
for (const [k, g] of groups) {
  const n = g.reduce((s, r) => s + r.pairs, 0), s1 = g.reduce((s, r) => s + r.pairCreditSum, 0), s2 = g.reduce((s, r) => s + r.pairCreditSumSq, 0);
  const m = s1 / n, v = (s2 - n * m * m) / (n - 1), se = Math.sqrt(v / n);
  const w = g.reduce((s, r) => s + r.wins, 0), t = g.reduce((s, r) => s + r.ties, 0), l = g.reduce((s, r) => s + r.losses, 0);
  console.log(JSON.stringify({ matchup: k, shards: g.length, games: 2 * n, winCredit: m, ci99: [m - z * se, m + z * se], p_one_sided: 0.5 * (1 + Math.tanh(-((m - 0.5) / se) * 0.7978845608 * (1 + 0.044715 * ((m - 0.5) / se) ** 2))), wins: w, ties: t, losses: l, uniqueShards: new Set(g.map((r) => r.shard)).size }));
}
