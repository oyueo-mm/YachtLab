import { createServer } from "vite";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
const games = Number(process.argv[2] ?? 2000);
if (!Number.isInteger(games) || games < 2 || games > 100000 || games % 2 !== 0) throw Error("games must be an even integer between 2 and 100000.");
const mix = (number) => { let n = number >>> 0; n = Math.imul(n ^ (n >>> 16), 0x85ebca6b) >>> 0; n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35) >>> 0; return (n ^ (n >>> 16)) >>> 0; };
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
try {
  const { simulate } = await server.ssrLoadModule("/src/match.ts");
  const { total } = await server.ssrLoadModule("/src/engine.ts");
  const { dpDecision, setDPTable } = await server.ssrLoadModule("/src/dp.ts");
  const manifest = JSON.parse(await readFile("src/dp-manifest.json", "utf8"));
  const bytes = gunzipSync(await readFile("public/ai/" + manifest.asset));
  setDPTable(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const pairedCredit = [], gamesData = [];
  let strategicChanges = 0, winDecisions = 0, elapsedMs = 0;
  for (let pair = 0; pair < games / 2; pair++) {
    const seed = mix(910000 + pair), outcomes = [];
    for (const side of [0, 1]) {
      const algorithms = side === 0 ? ["Win DP", "DP Expert"] : ["DP Expert", "Win DP"];
      const time = performance.now(), match = simulate(algorithms, seed);
      elapsedMs += performance.now() - time;
      const final = match.frames.at(-1).state;
      const own = total(final.cards[side]), opponent = total(final.cards[1 - side]);
      const credit = own > opponent ? 1 : own === opponent ? 0.5 : 0;
      outcomes.push(credit);
      for (let i = 1; i < match.frames.length; i++) {
        const frame = match.frames[i];
        if (frame.actor !== side || !frame.decision?.note.startsWith("마지막 턴 승리 확률")) continue;
        winDecisions++;
        const base = dpDecision(match.frames[i - 1].state);
        const same = base.type === frame.decision.type && (base.type === "score"
          ? base.category === frame.decision.category
          : [...base.ids].sort().join(",") === [...frame.decision.ids].sort().join(","));
        if (!same) strategicChanges++;
      }
      gamesData.push({ seed, side, own, opponent, credit, difference: own - opponent });
    }
    pairedCredit.push((outcomes[0] + outcomes[1]) / 2);
    if ((pair + 1) % 250 === 0) console.log("BENCHMARK_PROGRESS " + JSON.stringify({ completePairs: pair + 1, games: 2 * (pair + 1) }));
  }
  const n = pairedCredit.length, rate = pairedCredit.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(pairedCredit.reduce((s, v) => s + (v - rate) ** 2, 0) / Math.max(1, n - 1));
  const halfWidth = 1.96 * sd / Math.sqrt(n);
  const ownMean = gamesData.reduce((s, g) => s + g.own, 0) / games;
  const oppMean = gamesData.reduce((s, g) => s + g.opponent, 0) / games;
  const result = {
    algorithm: "Win DP", opponent: "DP Expert", games, pairedSeeds: n,
    seedScheme: "Murmur3 finalizer of 910000+i (independent research set)",
    seats: "each seed played twice with swapped algorithm seats",
    metric: "win credit = win 1 / draw 0.5 / loss 0",
    winCredit: rate, ci95ApproxPairedNormal: [Math.max(0, rate - halfWidth), Math.min(1, rate + halfWidth)],
    excessOverHalf: rate - 0.5, ownMean, opponentMean, expectedScoreGap: ownMean - oppMean,
    endgameDecisions: winDecisions, differentEndgameActionsVsDP: strategicChanges,
    elapsedSeconds: elapsedMs / 1000,
    caveat: "Exact if opponent finished; exact conditional on DP Expert's final-turn policy if opponent has one remaining category; no SOTA claim.",
    individualMatches: gamesData
  };
  await mkdir("benchmarks/research", { recursive: true });
  await writeFile("benchmarks/research/win-dp-vs-dp.json", JSON.stringify(result, null, 2) + "\n");
  console.log("BENCHMARK_SUMMARY " + JSON.stringify({ ...result, individualMatches: undefined }));
} finally { await server.close(); }
