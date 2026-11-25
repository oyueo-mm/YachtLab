// Teacher data for the v6-C residual (game-level split): states where the OPPONENT is
// about to start its turn and both players have <= 4 categories left, from v5-R vs Win DP v2
// games (seats alternate). Target = exact interactive value for "me" (the player who just
// scored) minus my v6-P policy-set value. Dev family 9021 (never used for confirmation).
//   npx tsx scripts/research-v6/residual-data.ts --games 3000 --k4 700
import { writeFileSync, mkdirSync } from "node:fs";
import { createGame, transition, total, upper, type Game } from "../../src/engine.ts";
import { initAgents, AGENTS, prepareAgents } from "../research-v5/agents.ts";
import { endgameValue, maskOf, clearEndgameMemo } from "../../src/research-v5/apex.ts";
import { popcount } from "../../src/research-v5/kernel.ts";
import { loadDPExpertBank } from "../research-v5/bank-io.ts";
import { loadRiskBanks, DEFAULT_LAMBDAS } from "./banks.ts";
import { v6PolicySetChildValue, type V6Config } from "../../src/research-v6/apex6.ts";
const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const games = Number(arg("--games", "3000")), k4Cap = Number(arg("--k4", "700"));
initAgents(true); prepareAgents(["v5-R"]);
const { bank, T } = loadDPExpertBank(false);
const cfg = { bank, dpValue: (m: number, u: number) => T[m * 64 + u], endgame: "none", banks: loadRiskBanks(DEFAULT_LAMBDAS) } as V6Config;
const hash = (x: number) => { x >>>= 0; x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0; x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0; return (x ^ (x >>> 16)) >>> 0; };
const rows: number[][] = [];
let k4 = 0;
const t0 = performance.now();
for (let gi = 0; gi < games; gi++) {
  let s: Game = createGame(hash(0x5eed0000 + 9021 * 1_000_003 + gi), true);
  const seatA = gi % 2 === 0 ? "v5-R" : "v2", seatB = gi % 2 === 0 ? "v2" : "v5-R";
  while (!s.done) {
    if (!s.rolls) {
      const mover = s.player, me = 1 - mover;
      const Mo = maskOf(s.cards[mover]), Mm = maskOf(s.cards[me]), ko = popcount(Mo), km = popcount(Mm);
      if (ko <= 4 && km <= 4 && ko >= 1 && (ko < 4 || k4 < k4Cap)) {
        const uo = Math.min(63, upper(s.cards[mover])), um = Math.min(63, upper(s.cards[me])), To = total(s.cards[mover]), Tm = total(s.cards[me]);
        const exactMe = 1 - endgameValue(Mo, uo, Mm, um, To - Tm);
        const model = v6PolicySetChildValue(Mm, um, Tm, Mo, uo, To, cfg);
        rows.push([gi, km, Mm, um, Tm, ko, Mo, uo, To, model, exactMe]);
        if (ko === 4) { k4++; clearEndgameMemo(); }
      }
      s = transition(s, { type: "roll" }); continue;
    }
    const d = AGENTS[s.player === 0 ? seatA : seatB].act({ ...s, seed: 0, rng: [0, 0] }, "x");
    s = d.type === "score" ? transition(s, { type: "score", category: d.category }) : transition(transition(s, { type: "hold", ids: d.ids }), { type: "roll" });
  }
  if ((gi + 1) % 500 === 0) console.error(`${gi + 1} games, ${rows.length} rows, ${((performance.now() - t0) / 1000).toFixed(0)}s`);
}
mkdirSync("training/results/v6/residual", { recursive: true });
writeFileSync("training/results/v6/residual/f9021.json", JSON.stringify({ family: 9021, columns: ["game", "kMe", "Mme", "uMe", "Tme", "kOpp", "Mopp", "uOpp", "Topp", "psetValue", "exactValue"], rows }));
console.log(JSON.stringify({ rows: rows.length, k4, seconds: (performance.now() - t0) / 1000 }));
