import { readFileSync } from "node:fs";
import { createGame, transition, type Game } from "../../src/engine";
import { dpDecision, dpFutureValue, setDPTable } from "../../src/dp";
import { winDPv5Decision } from "../../src/research-v5/apex";
import { bankFromWasm, buildBankWasm } from "../../src/research-v6/wasm-pmf";
import { analyzeProductSituation } from "../../src/review/product-analysis";
import { accuracy, grade } from "../../src/review/quality";
import type { Assessment, Position } from "../../src/review/model";
import { loadDPTable } from "../research-v5/load-dp";

const table = loadDPTable();
setDPTable(table.buffer as ArrayBuffer);
const wasm = readFileSync(new URL("../../training/v6-wasm/pmf.wasm", import.meta.url));
const config = { bank: bankFromWasm(await buildBankWasm(wasm, table, { f32: true })), dpValue: dpFutureValue, endgame: "none" as const };
const position = ({ cards, dice, player, rolls, round }: Game): Position => ({ cards, dice, player, rolls, round });
const seeds = [9521001, 9521002, 9521003, 9521004, 9521005, 9521006, 9521007, 9521008];
const rows: [Assessment[], Assessment[]] = [[], []];
for (const [index, seed] of seeds.entries()) {
  let game = createGame(seed, true);
  while (!game.done) {
    if (!game.rolls) {
      game = transition(game, { type: "roll" });
      continue;
    }
    const before = position(game);
    const model = (game.player + index) % 2;
    const view: Game = { ...game, seed: 0, rng: [0, 0] };
    const decision = model === 0 ? winDPv5Decision(view, config) : dpDecision(view);
    if (decision.type === "reroll") {
      game = transition(transition(game, { type: "hold", ids: decision.ids }), { type: "roll" });
      rows[model].push(analyzeProductSituation({ before, action: decision, afterRoll: position(game) }, rows[model].length, config));
    } else {
      rows[model].push(analyzeProductSituation({ before, action: decision }, rows[model].length, config));
      game = transition(game, decision);
    }
  }
}
console.log(JSON.stringify({ seeds, policies: rows.map((actions, model) => {
  const grades: Record<string, number> = {};
  for (const action of actions) grades[grade(action)] = (grades[grade(action)] ?? 0) + 1;
  return { model: model === 0 ? "v5-R" : "DP Expert", actions: actions.length, scoreAccuracy: accuracy(actions, "score"), winAccuracy: accuracy(actions, "win"), grades };
}) }, null, 2));
