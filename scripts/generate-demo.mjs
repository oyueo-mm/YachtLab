// Build-time only: select real, unmodified Greedy turns from seeded matches.
// No search or random outcome generation runs on the home page.
import { createServer } from "vite";
import { writeFile } from "node:fs/promises";
const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
});
try {
  const { simulate } = await server.ssrLoadModule("/src/match.ts");
  const wanted = ["four", "full", "small", "large", "choice", "yacht"];
  const found = new Map();
  for (let seed = 1; seed <= 150 && found.size < wanted.length; seed++) {
    const match = simulate(["Greedy", "Greedy"], seed);
    let start = 0;
    for (let i = 1; i < match.frames.length; i++) {
      const frame = match.frames[i];
      if (frame.action?.type !== "score") continue;
      const category = frame.action.category,
        points = frame.state.cards[frame.actor][category];
      const frames = match.frames
        .slice(start, i + 1)
        .map(({ state, action, actor }, index) => ({
          state,
          action: index === 0 ? null : action,
          actor: index === 0 ? state.player : actor,
        }));
      // Include actual holds and rerolls; avoid an all-perfect showcase.
      if (
        wanted.includes(category) &&
        !found.has(category) &&
        points > 0 &&
        frames.some(
          (f) =>
            f.action?.type === "hold" &&
            f.action.ids.length > 0 &&
            f.action.ids.length < 5,
        )
      ) {
        found.set(category, { seed, category, points, frames });
      }
      start = i;
    }
  }
  if (found.size !== wanted.length)
    throw Error(
      `Missing demo categories: ${wanted.filter((c) => !found.has(c))}`,
    );
  await writeFile(
    new URL("../src/demo-records.json", import.meta.url),
    JSON.stringify(wanted.map((c) => found.get(c))),
  );
  console.log(
    [...found].map(([category, r]) => ({
      category,
      seed: r.seed,
      points: r.points,
      frames: r.frames.length,
    })),
  );
} finally {
  await server.close();
}
