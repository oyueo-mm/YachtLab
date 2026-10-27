import { createServer } from "vite";
import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
const server = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
});
try {
  const { simulate, result } = await server.ssrLoadModule("/src/match.ts");
  const { loadDistilled } = await server.ssrLoadModule("/src/distilled.ts");
  const { setDPTable } = await server.ssrLoadModule("/src/dp.ts");
  const manifest = JSON.parse(await readFile("src/dp-manifest.json", "utf8")),
    b = gunzipSync(await readFile(`public/ai/${manifest.asset}`));
  setDPTable(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  await loadDistilled("Distilled Policy");
  await loadDistilled("Distilled PPO");
  const pairs = [];
  for (const other of ["DP Expert", "Distilled PPO", "PPO"]) {
    const pair = ["Distilled Policy", other],
      raw = await Promise.all(
        pair.map(async (n) =>
          JSON.parse(
            await readFile(
              `benchmarks/v04/${n.replaceAll(" ", "-")}.json`,
              "utf8",
            ),
          ),
        ),
      );
    for (let i = 0; i < 100; i++) {
      const ordered = i % 2 ? [pair[1], pair[0]] : pair,
        m = result(simulate(ordered, raw[0].results[i].seed));
      for (let side = 0; side < 2; side++)
        if (
          m.scores[side] !== raw[pair.indexOf(ordered[side])].results[i].score
        )
          throw Error("Pair projection mismatch");
    }
    pairs.push({
      a: pair[0],
      b: pair[1],
      actualMatches: 100,
      alternatedSeats: true,
      allScoresMatch: true,
    });
  }
  await writeFile(
    "benchmarks/v04/paired-checks.json",
    JSON.stringify({ totalActualMatches: 300, pairs }, null, 2) + "\n",
  );
  console.log(pairs);
} finally {
  await server.close();
}
