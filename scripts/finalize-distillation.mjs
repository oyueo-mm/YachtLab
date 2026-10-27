import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const read = async (p) => JSON.parse(await readFile(p, "utf8"));
const report = await read("training/distillation-results.json"),
  data = await read("training/distillation-data.json");
const selected = report.architectures.find(
  (a) => a.width === report.selectedWidth,
);
// Metadata is derived from the selected checkpoint; weights are left untouched.
const model = await read("src/distilled-policy.json");
model.steps = selected.bestEpoch * Math.ceil(data.splits.train.rows / 1024);
await writeFile("src/distilled-policy.json", JSON.stringify(model));
for (const artifact of Object.values(report.artifacts)) {
  artifact.file = artifact.file.replaceAll("\\", "/");
  const bytes = await readFile(artifact.file);
  artifact.bytes = bytes.byteLength;
  artifact.sha256 = createHash("sha256").update(bytes).digest("hex");
}
report.behaviorCloning.checkpointGradientUpdates = model.steps;
report.environment = {
  pytorch: "2.14.1+cpu",
  numpy: "2.5.4",
  torchThreads: 2,
  device: "CPU",
};
report.randomInitControl.caveat =
  "Equal environment step budget, different learning rates (scratch 3e-4 versus initialized 1e-4); this is not an isolated causal test of initialization alone.";
await writeFile(
  "training/distillation-results.json",
  JSON.stringify(report, null, 2) + "\n",
);
const baseline = await read("benchmarks/v04/PPO.json"),
  status = {};
for (const name of ["Distilled Policy", "Distilled PPO"]) {
  const result = await read(`benchmarks/v04/${name.replaceAll(" ", "-")}.json`);
  if (
    result.games !== 1000 ||
    result.results.some((r, i) => r.seed !== baseline.results[i].seed)
  )
    throw Error("Mismatched final evaluation seeds");
  const diffs = result.results.map(
      (r, i) => r.score - baseline.results[i].score,
    ),
    mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const sd = Math.sqrt(
    diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / (diffs.length - 1),
  );
  status[name] = mean - (1.96 * sd) / Math.sqrt(diffs.length) > 0;
}
await writeFile(
  "src/distilled-status.json",
  JSON.stringify(status, null, 2) + "\n",
);
console.log({
  gradientUpdates: model.steps,
  artifacts: report.artifacts,
  status,
});
