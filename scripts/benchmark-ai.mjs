import { createServer } from "vite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { evaluationSeed } from "./benchmark-seeds.mjs";
const algorithm = process.argv[2] ?? "DP Expert",
  games = Number(process.argv[3] ?? 1000),
  seedStart = 200000,
  iterations = 600;
const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
});
try {
  const { createGame, transition, total, bonus } =
    await server.ssrLoadModule("/src/engine.ts");
  const { decide, algorithms } = await server.ssrLoadModule("/src/ai.ts");
  if (!algorithms.includes(algorithm)) throw Error("Unknown algorithm");
  if (algorithm === "DP Expert") {
    const { setDPTable } = await server.ssrLoadModule("/src/dp.ts");
    const manifest = JSON.parse(await readFile("src/dp-manifest.json", "utf8"));
    const data = gunzipSync(await readFile(`public/ai/${manifest.asset}`));
    setDPTable(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    );
  }
  const results = [];
  let sumMs = 0,
    maxMs = 0,
    actions = 0,
    peakRss = process.memoryUsage().rss,
    peakHeap = process.memoryUsage().heapUsed;
  const started = performance.now();
  for (let game = 0; game < games; game++) {
    const seed = evaluationSeed(game);
    let state = createGame(seed);
    const side = game % 2;
    while (!state.done) {
      if (!state.rolls) {
        state = transition(state, { type: "roll" });
        continue;
      }
      const isTarget = state.player === side,
        start = performance.now();
      const d = decide(state, isTarget ? algorithm : "Random", { iterations });
      const ms = performance.now() - start;
      if (isTarget) {
        sumMs += ms;
        maxMs = Math.max(maxMs, ms);
        actions++;
      }
      if (d.type === "score")
        state = transition(state, { type: "score", category: d.category });
      else {
        state = transition(state, { type: "hold", ids: d.ids });
        state = transition(state, { type: "roll" });
      }
    }
    results.push({
      seed,
      side,
      score: total(state.cards[side]),
      bonus: bonus(state.cards[side]) > 0,
      yacht: state.cards[side].yacht === 50,
    });
    const memory = process.memoryUsage();
    peakRss = Math.max(peakRss, memory.rss);
    peakHeap = Math.max(peakHeap, memory.heapUsed);
    if ((game + 1) % 50 === 0)
      console.log(
        `${algorithm}: ${game + 1}/${games} mean=${(results.reduce((s, r) => s + r.score, 0) / results.length).toFixed(2)} elapsed=${((performance.now() - started) / 1000).toFixed(1)}s`,
      );
  }
  const scores = results.map((r) => r.score).sort((a, b) => a - b),
    mean = scores.reduce((a, b) => a + b, 0) / games,
    sd = Math.sqrt(
      scores.reduce((s, v) => s + (v - mean) ** 2, 0) / (games - 1),
    ),
    half = (1.96 * sd) / Math.sqrt(games);
  const report = {
    algorithm,
    games,
    seedStart,
    seedScheme: "Murmur3 32-bit finalizer of 200000 + game index",
    iterations: algorithm === "MCTS" ? iterations : null,
    mean,
    meanCI95: [mean - half, mean + half],
    median:
      games % 2
        ? scores[games >> 1]
        : (scores[games / 2 - 1] + scores[games / 2]) / 2,
    sd,
    min: scores[0],
    max: scores.at(-1),
    bonusRate: results.filter((r) => r.bonus).length / games,
    yachtRate: results.filter((r) => r.yacht).length / games,
    meanActionMs: sumMs / actions,
    maxActionMs: maxMs,
    actions,
    peakRssBytes: peakRss,
    peakHeapBytes: peakHeap,
    wallSeconds: (performance.now() - started) / 1000,
    results,
  };
  await mkdir("benchmarks", { recursive: true });
  await writeFile(
    `benchmarks/${algorithm.replaceAll(" ", "-").toLowerCase()}.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify({ ...report, results: undefined }));
} finally {
  await server.close();
}
