import { readFile, writeFile } from "node:fs/promises";
import { cpus, platform, release } from "node:os";
import { createServer } from "vite";
import { gunzipSync } from "node:zlib";
const algorithms = [
  "Random",
  "Greedy",
  "Expectimax",
  "MCTS",
  "PPO",
  "DP Expert",
];
const reports = await Promise.all(
  algorithms.map(async (a) =>
    JSON.parse(
      await readFile(
        `benchmarks/${a.replaceAll(" ", "-").toLowerCase()}.json`,
        "utf8",
      ),
    ),
  ),
);
const dpManifest = JSON.parse(await readFile("src/dp-manifest.json", "utf8"));
for (const report of reports) {
  if (
    report.games !== 1000 ||
    report.results.length !== 1000 ||
    !report.seedScheme
  )
    throw Error("Incomplete main evaluation");
}
const seeds = reports[0].results.map((r) => r.seed);
if (new Set(seeds).size !== 1000) throw Error("Duplicate evaluation seed");
const trainingSeeds = new Set(
  Array.from({ length: 64 }, (_, i) => 42 + i * 1009),
);
if (seeds.some((s) => trainingSeeds.has(s) || (s >= 100000 && s < 100100)))
  throw Error("Training/evaluation seed overlap");
for (const report of reports)
  if (report.results.some((r, i) => r.seed !== seeds[i] || r.side !== i % 2))
    throw Error("Seed or side mismatch");
const pairs = [];
// Wilson marginal intervals at 97.5% each; Bonferroni-combined bounds for
// credit = .5 + .5*(P(win)-P(loss)) retain uncertainty at 0/100% results.
function wilson(k, n) {
  const z = 2.241402727604947,
    p = k / n,
    denom = 1 + (z * z) / n,
    center = (p + (z * z) / (2 * n)) / denom,
    half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}
for (let i = 0; i < reports.length; i++)
  for (let j = i + 1; j < reports.length; j++) {
    const a = reports[i],
      b = reports[j],
      delta = a.results.map((r, k) => r.score - b.results[k].score),
      n = delta.length;
    const mean = delta.reduce((s, d) => s + d, 0) / n,
      sd = Math.sqrt(delta.reduce((s, d) => s + (d - mean) ** 2, 0) / (n - 1));
    const points = delta.map((d) => (d > 0 ? 1 : d === 0 ? 0.5 : 0)),
      rate = points.reduce((a, b) => a + b, 0) / n;
    const wins = delta.filter((d) => d > 0).length,
      losses = delta.filter((d) => d < 0).length;
    const w = wilson(wins, n),
      l = wilson(losses, n);
    pairs.push({
      a: a.algorithm,
      b: b.algorithm,
      games: n,
      wins,
      draws: delta.filter((d) => d === 0).length,
      losses,
      winCreditRate: rate,
      winCreditCI95: [
        Math.max(0, 0.5 + 0.5 * (w[0] - l[1])),
        Math.min(1, 0.5 + 0.5 * (w[1] - l[0])),
      ],
      meanScoreDifference: mean,
      meanDifferenceCI95: [
        mean - (1.96 * sd) / Math.sqrt(n),
        mean + (1.96 * sd) / Math.sqrt(n),
      ],
    });
  }
// Validate score-path independence against real paired games on 20 held-out seeds
// per opponent (these are included in the main seed list, not extra CI samples).
const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
});
let checked = 0;
try {
  const { simulate, result } = await server.ssrLoadModule("/src/match.ts");
  const { setDPTable } = await server.ssrLoadModule("/src/dp.ts");
  const manifest = JSON.parse(await readFile("src/dp-manifest.json", "utf8"));
  const bytes = gunzipSync(await readFile(`public/ai/${manifest.asset}`));
  setDPTable(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  const dp = reports.find((r) => r.algorithm === "DP Expert");
  for (const other of reports.filter((r) => r.algorithm !== "DP Expert"))
    for (let i = 0; i < 20; i++) {
      const sides =
        i % 2 ? [other.algorithm, "DP Expert"] : ["DP Expert", other.algorithm];
      const actual = result(simulate(sides, seeds[i], { iterations: 600 }));
      const expected =
        i % 2
          ? [other.results[i].score, dp.results[i].score]
          : [dp.results[i].score, other.results[i].score];
      if (actual.scores.some((s, j) => s !== expected[j]))
        throw Error(`Projected pair mismatch: ${other.algorithm}, ${seeds[i]}`);
      checked++;
    }
} finally {
  await server.close();
}
const ranked = [...reports].sort((a, b) => b.mean - a.mean),
  best = ranked[0].algorithm;
const superior = pairs
  .filter((p) => p.a === best || p.b === best)
  .every((p) =>
    p.a === best ? p.meanDifferenceCI95[0] > 0 : p.meanDifferenceCI95[1] < 0,
  );
const summary = {
  dpTableSha256: dpManifest.sha256,
  objective: "mean final total, not optimized opponent win probability",
  gamesPerAlgorithm: 1000,
  seedScheme: reports[0].seedScheme,
  seedBase: 200000,
  mctsIterations: 600,
  confidence:
    "Means: 95% normal approximation. Win credit: Bonferroni combination of 97.5% Wilson marginal intervals for wins/losses (approximate conservative 95%). Draw=0.5.",
  pairedProjectionChecks: checked,
  environment: {
    node: process.version,
    os: `${platform()} ${release()}`,
    cpu: cpus()[0].model,
    timing:
      "function wall time; browser validation may share the host; RSS includes Vite/Node harness",
  },
  bestAlgorithm: superior ? best : null,
  criterion:
    "highest sample mean and positive paired 95% mean-difference CI against every other policy",
  algorithms: reports.map(({ results, ...r }) => r),
  pairs,
};
await writeFile("benchmarks/summary.json", JSON.stringify(summary, null, 2));
await writeFile(
  "src/benchmark-summary.json",
  JSON.stringify(
    {
      dpTableSha256: dpManifest.sha256,
      bestAlgorithm: summary.bestAlgorithm,
      gamesPerAlgorithm: 1000,
      criterion: summary.criterion,
      means: Object.fromEntries(reports.map((r) => [r.algorithm, r.mean])),
    },
    null,
    2,
  ),
);
const dpPairs = pairs.filter((p) => p.a === "DP Expert" || p.b === "DP Expert");
let markdown =
  "# 고정 시드 본 평가 — AI 6종 × 1000경기\n\n" +
  "Murmur3로 혼합한 고정 시드, 선후공 교대, MCTS 600회. 평균 CI는 95% 정규 근사입니다. 평균 점수와 승률은 별개 목표이며 DP는 평균 최종 총점을 최적화합니다.\n\n" +
  "| AI | 평균 (95% CI) | 중앙값 | 표준편차 | 최저–최고 | 보너스 | 요트 | 행동 평균 ms | 최대 ms | 하네스 peak RSS MiB |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n";
for (const r of reports)
  markdown += `| ${r.algorithm} | ${r.mean.toFixed(2)} [${r.meanCI95.map((n) => n.toFixed(2)).join(", ")}] | ${r.median} | ${r.sd.toFixed(2)} | ${r.min}–${r.max} | ${(r.bonusRate * 100).toFixed(1)}% | ${(r.yachtRate * 100).toFixed(1)}% | ${r.meanActionMs.toFixed(3)} | ${r.maxActionMs.toFixed(2)} | ${(r.peakRssBytes / 1048576).toFixed(1)} |\n`;
markdown +=
  "\n## DP Expert 맞대결\n\n무승부는 0.5승으로 계산합니다. 아래 점수 쌍은 정책별 점수 경로의 독립성을 사용했으며 실제 맞대결 100경기로 재현 일치를 검증했습니다. 주사위 고정이 달라지면 소비하는 난수의 개수도 달라집니다. 승률 구간은 승리·패배 각각의 97.5% Wilson 구간을 Bonferroni 방식으로 결합한 보수적 95% 근사 구간입니다. 따라서 전승에서도 구간 폭을 0으로 만들지 않습니다. [Wilson 계산식 출처: NIST](https://itl.nist.gov/div898/handbook/prc/section2/prc241.htm).\n\n| 상대 | DP 승률 (95% CI) | DP 평균 점수 우위 (95% CI) |\n|---|---:|---:|\n";
for (const p of dpPairs) {
  const direct = p.a === "DP Expert",
    rate = direct ? p.winCreditRate : 1 - p.winCreditRate,
    ci = direct
      ? p.winCreditCI95
      : [1 - p.winCreditCI95[1], 1 - p.winCreditCI95[0]],
    diff = direct ? p.meanScoreDifference : -p.meanScoreDifference,
    dci = direct
      ? p.meanDifferenceCI95
      : [-p.meanDifferenceCI95[1], -p.meanDifferenceCI95[0]];
  markdown += `| ${direct ? p.b : p.a} | ${(rate * 100).toFixed(2)}% [${ci.map((n) => (n * 100).toFixed(2)).join(", ")}] | ${diff.toFixed(2)} [${dci.map((n) => n.toFixed(2)).join(", ")}] |\n`;
}
markdown +=
  "\n실행 환경과 개별 점수·시드·선후공은 JSON 파일에 보존했습니다. 시간은 로컬 실행 벽시계 관측값이며 최악 응답 시간 보장이 아닙니다. Node peak RSS에는 Vite와 검증 런타임이 포함됩니다. 브라우저 Worker 메모리 및 실제 왕복 지연은 `browser-dp.json`에서 별도로 확인하세요. PPO 기존 모델은 보존했으며 이번 평가를 이용한 추가 학습이나 정책 조정은 하지 않았습니다.\n";
await writeFile("benchmarks/REPORT.md", markdown);
console.log({
  best: summary.bestAlgorithm,
  checked,
  means: ranked.map((r) => [r.algorithm, r.mean]),
});
