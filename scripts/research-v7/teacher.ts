// v7 exact teacher data: turn-start states (mover to roll) with both remaining <= K, from mixed-agent
// games on a DEVELOPMENT family, labelled with the exact interactive value (v5 expectiminimax) and the
// turn-start values of several estimators (for residual learning / calibration).
//
//   npx tsx scripts/research-v7/teacher.ts --family 9106 --games 200 --K 5 --out training/data/v7/teacher-f9106-K5.csv
//
// Columns: game,seed,k,ko,mask,u,x,omask,ou,ox,D,exact,<estimator turn-start values...>
// Agents alternate per game among pairs below so states are not only from one policy's self-play.
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { createGame, transition, total, upper, type Game } from "../../src/engine.ts";
import { AGENTS, initAgents, prepareAgents } from "../research-v5/agents.ts";
import { maskOf, endgameValue, clearEndgameMemo } from "../../src/research-v5/apex.ts";
import { popcount, canonicalUpper, UPPER_CAP } from "../../src/research-v5/kernel.ts";
import { TurnBuffers, turnStartValue } from "../../src/research-v6/turn.ts";
import { loadRiskBanks, DEFAULT_LAMBDAS } from "../research-v6/banks.ts";
import { fillStopValues, type V7Kind, type V7Banks } from "../../src/research-v7/interactive.ts";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const family = Number(arg("--family", "9106")), games = Number(arg("--games", "50")), K = Number(arg("--K", "5")), shard = Number(arg("--shard", "0"));
const kinds = arg("--kinds", "R,P,I1RO,I2RO").split(",") as V7Kind[];
const out = arg("--out", `training/data/v7/teacher-f${family}-K${K}-s${shard}.csv`);
if (!(family >= 9101 && family <= 9199)) throw Error("teacher data uses v7 development families 9101-9199 only");
const PAIRS: [string, string][] = [["v6-P", "v6-P"], ["v7-I1RO", "v5-R"], ["dp", "v2"], ["v5-R", "v6-P"]];
initAgents(true);
prepareAgents(["v6-P", "v7-I1RO"]);
const banks = loadRiskBanks(DEFAULT_LAMBDAS);
const B: V7Banks = { banks, dp: banks[DEFAULT_LAMBDAS.indexOf(0)] };
const hash = (x: number) => { x >>>= 0; x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0; x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0; return (x ^ (x >>> 16)) >>> 0; };
const seedOf = (i: number) => hash(0x5eed0000 + family * 1_000_003 + shard * 20_011 + i);
mkdirSync(out.replace(/\/[^/]*$/, ""), { recursive: true });
writeFileSync(out, ["game", "seed", "k", "ko", "mask", "u", "x", "omask", "ou", "ox", "D", "exact", ...kinds.map((k) => "v_" + k), "exact_ms"].join(",") + "\n");
const val = new Float64Array(12 * 64), tb = new TurnBuffers();
const t0 = performance.now();
let n = 0;
for (let g = 0; g < games; g++) {
  const seed = seedOf(g), [a, b] = PAIRS[g % PAIRS.length];
  let s: Game = createGame(seed, true);
  while (!s.done) {
    if (!s.rolls) {
      const me = s.player, op = 1 - me, m = maskOf(s.cards[me]), o = maskOf(s.cards[op]);
      if (popcount(m) <= K && popcount(o) <= K) {
        const u = canonicalUpper(m, Math.min(UPPER_CAP, upper(s.cards[me]))), ou = canonicalUpper(o, Math.min(UPPER_CAP, upper(s.cards[op])));
        const x = total(s.cards[me]), ox = total(s.cards[op]);
        const te = performance.now();
        const exact = endgameValue(m, u, o, ou, x - ox);
        const ems = performance.now() - te;
        const ests = kinds.map((kd) => turnStartValue(m, fillStopValues(kd, B, { mask: m, u, x }, { mask: o, u: ou, x: ox }, val), tb));
        appendFileSync(out, [g, seed, popcount(m), popcount(o), m, u, x, o, ou, ox, x - ox, exact.toFixed(8), ...ests.map((v) => v.toFixed(8)), ems.toFixed(1)].join(",") + "\n");
        n++;
      }
      s = transition(s, { type: "roll" }); continue;
    }
    const name = s.player === 0 ? a : b;
    const view: Game = { ...s, seed: 0, rng: [0, 0], dice: s.dice.map((d) => ({ ...d })), cards: [{ ...s.cards[0] }, { ...s.cards[1] }] };
    const d = AGENTS[name].act(view, s.player === 0 ? b : a);
    s = d.type === "score" ? transition(s, { type: "score", category: d.category }) : transition(transition(s, { type: "hold", ids: d.ids }), { type: "roll" });
  }
  if (g % 10 === 9) { clearEndgameMemo(); console.error(`[teacher f${family} K${K} s${shard}] ${g + 1}/${games} games, ${n} states, ${((performance.now() - t0) / 1000).toFixed(0)}s`); }
}
