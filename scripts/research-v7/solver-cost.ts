// Cost of the exact interactive endgame solver (src/research-v5/apex.ts endgameValue) at turn-start
// states with both remaining = K, sampled from DP Expert self-play (dev family 9103).
//   npx tsx scripts/research-v7/solver-cost.ts --K 5 --n 5
import { createGame, transition, total, upper, type Game } from "../../src/engine.ts";
import { initAgents, AGENTS } from "../research-v5/agents.ts";
import { maskOf, endgameValue, clearEndgameMemo, solverStats } from "../../src/research-v5/apex.ts";
import { popcount, canonicalUpper, UPPER_CAP } from "../../src/research-v5/kernel.ts";
const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const K = Number(arg("--K", "5")), n = Number(arg("--n", "5")), keep = process.argv.includes("--keep-memo");
initAgents(true);
let found = 0;
for (let seed = 9103_000; found < n; seed++) {
  let s: Game = createGame(seed, true);
  while (!s.done) {
    if (!s.rolls) {
      const me = s.player, op = 1 - me, m = maskOf(s.cards[me]), o = maskOf(s.cards[op]);
      if (popcount(m) === K && popcount(o) === K) {
        if (!keep) clearEndgameMemo();
        const n0 = solverStats.nodes, t0 = performance.now();
        const v = endgameValue(m, canonicalUpper(m, Math.min(UPPER_CAP, upper(s.cards[me]))), o, canonicalUpper(o, Math.min(UPPER_CAP, upper(s.cards[op]))), total(s.cards[me]) - total(s.cards[op]));
        console.log(JSON.stringify({ K, seed, v: +v.toFixed(5), seconds: +((performance.now() - t0) / 1000).toFixed(2), nodes: solverStats.nodes - n0, rssMB: Math.round(process.memoryUsage().rss / 1e6) }));
        found++; break;
      }
      s = transition(s, { type: "roll" }); continue;
    }
    const d = AGENTS.dp.act(s, "dp");
    s = d.type === "score" ? transition(s, { type: "score", category: d.category }) : transition(transition(s, { type: "hold", ids: d.ids }), { type: "roll" });
  }
}
