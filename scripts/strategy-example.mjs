import { createServer } from "vite";
import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
const server = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
});
try {
  const { simulate } = await server.ssrLoadModule("/src/match.ts");
  const { setDPTable, dpActionValue, dpDecision } =
    await server.ssrLoadModule("/src/dp.ts");
  const { loadDistilled } = await server.ssrLoadModule("/src/distilled.ts");
  const { compareStrategies } = await server.ssrLoadModule("/src/strategy.ts");
  const manifest = JSON.parse(await readFile("src/dp-manifest.json", "utf8")),
    b = gunzipSync(await readFile(`public/ai/${manifest.asset}`));
  setDPTable(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  await loadDistilled("Distilled Policy");
  await loadDistilled("Distilled PPO");
  const match = simulate(["Greedy", "Greedy"], 42);
  let selected;
  for (let i = 1; i < match.frames.length; i++) {
    const frame = match.frames[i],
      state = match.frames[i - 1].state;
    if (frame.actor !== 0 || frame.action?.type !== "score") continue;
    const loss = dpDecision(state).value - dpActionValue(state, frame.action);
    if (!selected || loss > selected.loss)
      selected = { frameIndex: i, state, loss, actual: frame.action };
  }
  const comparison = compareStrategies(
    selected.state,
    [
      "DP Expert",
      "Greedy",
      "Expectimax",
      "PPO",
      "Distilled Policy",
      "Distilled PPO",
    ],
    { seed: 42 },
    selected.actual,
  );
  await writeFile(
    "benchmarks/v04/strategy-example.json",
    JSON.stringify(
      {
        source: "actual Greedy vs Greedy game, seed 42",
        ...selected,
        comparison,
      },
      null,
      2,
    ) + "\n",
  );
  console.log({
    frame: selected.frameIndex,
    loss: selected.loss,
    rows: comparison.rows.map((r) => ({
      algorithm: r.algorithm,
      choice:
        r.decision.type === "score" ? r.decision.category : r.decision.ids,
      q: r.q,
      loss: r.loss,
    })),
  });
} finally {
  await server.close();
}
