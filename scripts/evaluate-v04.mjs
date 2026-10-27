import { createServer } from "vite";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
const algorithm = process.argv[2] ?? "DP Expert",
  games = Number(process.argv[3] ?? 1000);
const mix = (x) => {
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
};
const server = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
});
try {
  const { createGame, transition, total, bonus } =
    await server.ssrLoadModule("/src/engine.ts");
  const { decide } = await server.ssrLoadModule("/src/ai.ts");
  if (algorithm === "Distilled Policy" || algorithm === "Distilled PPO") {
    const { loadDistilled } = await server.ssrLoadModule("/src/distilled.ts");
    await loadDistilled(algorithm);
  }
  const { setDPTable } = await server.ssrLoadModule("/src/dp.ts");
  const manifest = JSON.parse(await readFile("src/dp-manifest.json", "utf8")),
    b = gunzipSync(await readFile(`public/ai/${manifest.asset}`));
  setDPTable(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const results = [];
  let actions = 0,
    sumMs = 0,
    maxMs = 0;
  const start = performance.now();
  for (let i = 0; i < games; i++) {
    const seed = mix(700000 + i);
    let state = createGame(seed);
    const side = i % 2;
    while (!state.done) {
      if (!state.rolls) {
        state = transition(state, { type: "roll" });
        continue;
      }
      const t = performance.now(),
        d = decide(state, state.player === side ? algorithm : "Random", {
          seed: seed ^ state.actions,
          iterations: 600,
        }),
        ms = performance.now() - t;
      if (state.player === side) {
        actions++;
        sumMs += ms;
        maxMs = Math.max(maxMs, ms);
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
    if ((i + 1) % 50 === 0)
      console.log(
        `${algorithm}: ${i + 1}/${games}, elapsed ${((performance.now() - start) / 1000).toFixed(1)}s`,
      );
  }
  const scores = results.map((r) => r.score).sort((a, b) => a - b),
    mean = scores.reduce((a, b) => a + b, 0) / games,
    sd = Math.sqrt(
      scores.reduce((s, v) => s + (v - mean) ** 2, 0) / (games - 1),
    ),
    half = (1.96 * sd) / Math.sqrt(games);
  const output = {
    algorithm,
    games,
    seedScheme:
      "Murmur3 finalizer of 700000+i; reserved final-test set, unseen in training/validation/v0.3",
    teacherSha256: manifest.sha256,
    mean,
    sd,
    ci95: [mean - half, mean + half],
    median:
      (scores[Math.floor((games - 1) / 2)] +
        scores[Math.ceil((games - 1) / 2)]) /
      2,
    min: scores[0],
    max: scores.at(-1),
    bonusRate: results.filter((r) => r.bonus).length / games,
    yachtRate: results.filter((r) => r.yacht).length / games,
    actions,
    decisionMs: sumMs / actions,
    maxDecisionMs: maxMs,
    seconds: (performance.now() - start) / 1000,
    results,
  };
  await mkdir("benchmarks/v04", { recursive: true });
  await writeFile(
    `benchmarks/v04/${algorithm.replaceAll(" ", "-")}.json`,
    JSON.stringify(output, null, 2) + "\n",
  );
  console.log(JSON.stringify({ ...output, results: undefined }));
} finally {
  await server.close();
}
