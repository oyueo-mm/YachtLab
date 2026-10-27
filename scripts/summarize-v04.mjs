import { readFile, writeFile, stat, copyFile, mkdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
const read = async (p) => JSON.parse(await readFile(p, "utf8"));
const names = [
    "DP Expert",
    "Distilled Policy",
    "Distilled PPO",
    "Expectimax",
    "Greedy",
    "PPO",
  ],
  rows = [];
for (const name of names) {
  try {
    rows.push(await read(`benchmarks/v04/${name.replaceAll(" ", "-")}.json`));
  } catch (e) {
    if (!process.argv.includes("--partial")) throw e;
  }
}
const pairs = [];
for (let a = 0; a < rows.length; a++)
  for (let b = a + 1; b < rows.length; b++) {
    const x = rows[a],
      y = rows[b],
      n = x.games;
    if (
      n !== y.games ||
      x.results.some(
        (r, i) => r.seed !== y.results[i].seed || r.side !== y.results[i].side,
      )
    )
      throw Error("Seed mismatch");
    const diffs = x.results.map((r, i) => r.score - y.results[i].score),
      mean = diffs.reduce((a, b) => a + b, 0) / n,
      sd = Math.sqrt(diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / (n - 1));
    const wins = diffs.filter((d) => d > 0).length,
      draws = diffs.filter((d) => d === 0).length,
      credit = (wins + 0.5 * draws) / n;
    pairs.push({
      a: x.algorithm,
      b: y.algorithm,
      games: n,
      meanDifference: mean,
      ci95: [
        mean - (1.96 * sd) / Math.sqrt(n),
        mean + (1.96 * sd) / Math.sqrt(n),
      ],
      wins,
      draws,
      losses: n - wins - draws,
      winCredit: credit,
    });
  }
const report = await read("training/distillation-results.json"),
  data = await read("training/distillation-data.json");
const models = {};
for (const [name, path] of [
  ["Distilled Policy", "src/distilled-policy.json"],
  ["Distilled PPO", "src/distilled-ppo.json"],
  ["PPO", "src/ppo-model.json"],
]) {
  const bytes = await readFile(path);
  models[name] = {
    bytes: bytes.byteLength,
    gzipBytes: gzipSync(bytes, { level: 9 }).byteLength,
  };
}
const dp = await read("src/dp-manifest.json");
models["DP Expert"] = {
  bytes: 2097152,
  gzipBytes: (await stat(`public/ai/${dp.asset}`)).size,
};
const summary = {
  complete: rows.length === 6,
  gamesPerAlgorithm: 1000,
  teacherSha256: dp.sha256,
  bestAlgorithm: [...rows].sort((a, b) => b.mean - a.mean)[0].algorithm,
  trainingStates: data.splits.train.rows,
  validationStates: data.splits.validation.rows,
  width: report.selectedWidth,
  gradientUpdates: report.behaviorCloning.checkpointGradientUpdates,
  ppoSteps: report.ppo.stepsExecuted,
  ppoCheckpointSteps: report.ppo.checkpointSteps,
  accuracy: report.before.top1Equivalent,
  top3: report.before.top3Equivalent,
  regret: report.before.meanDPRegret,
  ppoRegret: report.after.meanDPRegret,
  algorithms: rows.map(({ results, ...r }) => ({
    ...r,
    model: models[r.algorithm] ?? null,
  })),
  pairs,
};
await writeFile(
  "benchmarks/v04/summary.json",
  JSON.stringify(summary, null, 2) + "\n",
);
await writeFile(
  "src/research-summary.json",
  JSON.stringify(summary, null, 2) + "\n",
);
await mkdir("public/research", { recursive: true });
await copyFile(
  "benchmarks/v04/learning-curves.svg",
  "public/research/learning-curves.svg",
);
console.log(
  summary.algorithms.map((r) => ({
    algorithm: r.algorithm,
    mean: r.mean,
    ci95: r.ci95,
    decisionMs: r.decisionMs,
    model: r.model,
  })),
);
