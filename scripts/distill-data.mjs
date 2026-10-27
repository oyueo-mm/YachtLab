import { createServer } from "vite";
import { readFile, writeFile, mkdir, open } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
});
const trainGames = Number(process.argv[2] ?? 3600),
  valGames = Number(process.argv[3] ?? 400);
const mix = (x) => {
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
};
try {
  const { createGame, transition, categories, upper } =
    await server.ssrLoadModule("/src/engine.ts");
  const { decide } = await server.ssrLoadModule("/src/ai.ts");
  const { observe } = await server.ssrLoadModule("/src/ppo.ts");
  const { setDPTable, dpActionValues } =
    await server.ssrLoadModule("/src/dp.ts");
  const manifest = JSON.parse(await readFile("src/dp-manifest.json", "utf8"));
  const b = gunzipSync(await readFile(`public/ai/${manifest.asset}`));
  setDPTable(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  await mkdir("training/data", { recursive: true });
  const meta = {
    format: 1,
    columns: 108,
    observation: "sorted-value-then-stable-id, baseline 60 features",
    actions: "32 canonical hold masks + 12 categories",
    teacherSha256: manifest.sha256,
    seedScheme:
      "Murmur3 finalizer; training 400000+i, validation 500000+i; final evaluation reserved 700000+i",
    splits: {},
    createdAt: new Date().toISOString(),
  };
  for (const [split, games, start] of [
    ["train", trainGames, 400000],
    ["validation", valGames, 500000],
  ]) {
    const file = await open(`training/data/${split}.f32`, "w");
    let rows = 0;
    const coverage = {
      rolls: [0, 0, 0, 0],
      phase: [0, 0, 0],
      upperNearBonus: 0,
      policies: [0, 0, 0, 0],
    };
    const hash = createHash("sha256");
    const started = performance.now();
    try {
      for (let game = 0; game < games; game++) {
        let state = createGame(mix(start + game));
        const mode = game % 4;
        while (!state.done) {
          if (!state.rolls) {
            state = transition(state, { type: "roll" });
            continue;
          }
          const sorted = [...state.dice].sort(
            (a, b) => a.value - b.value || a.id - b.id,
          );
          const canonical = {
            ...state,
            dice: sorted.map((d, id) => ({ ...d, id })),
          };
          const q = dpActionValues(canonical);
          const card = state.cards[state.player],
            u = upper(card),
            remaining = categories.filter((c) => card[c] === undefined).length;
          const row = new Float32Array([
            ...observe(canonical),
            ...q,
            game,
            mode,
            u,
            remaining,
          ]);
          const bytes = Buffer.from(row.buffer);
          hash.update(bytes);
          await file.write(bytes);
          rows++;
          coverage.rolls[state.rolls]++;
          coverage.phase[remaining > 8 ? 0 : remaining > 4 ? 1 : 2]++;
          coverage.upperNearBonus += Number(u >= 50 && u < 63);
          coverage.policies[mode]++;
          const algorithm =
            mode === 0
              ? "DP Expert"
              : mode === 1
                ? "Greedy"
                : mode === 2
                  ? "Random"
                  : ["DP Expert", "Greedy", "Random"][
                      (state.actions + game) % 3
                    ];
          const d = decide(state, algorithm, {
            seed: mix(game + state.actions + 800000),
          });
          if (d.type === "score")
            state = transition(state, { type: "score", category: d.category });
          else {
            state = transition(state, { type: "hold", ids: d.ids });
            state = transition(state, { type: "roll" });
          }
        }
        if ((game + 1) % 100 === 0)
          console.log(
            `${split} ${game + 1}/${games}: ${rows} states, ${((performance.now() - started) / 1000).toFixed(1)}s`,
          );
      }
    } finally {
      await file.close();
    }
    meta.splits[split] = {
      games,
      rows,
      seedStart: start,
      coverage,
      sha256: hash.digest("hex"),
      seconds: (performance.now() - started) / 1000,
    };
  }
  await writeFile(
    "training/distillation-data.json",
    JSON.stringify(meta, null, 2) + "\n",
  );
} finally {
  await server.close();
}
