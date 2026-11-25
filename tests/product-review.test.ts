import { readFileSync } from "node:fs";
import { beforeAll, expect, test } from "vitest";
import { categories, createGame, transition, type Game } from "../src/engine";
import { dpFutureValue, setDPTable } from "../src/dp";
import { winDPv5Decision, type V5Config } from "../src/research-v5/apex";
import { bankFromWasm, buildBankWasm } from "../src/research-v6/wasm-pmf";
import { analyzeProductSituation } from "../src/review/product-analysis";
import type { Position } from "../src/review/model";
import { loadDPTable } from "../scripts/research-v5/load-dp";
import { accuracy, grade } from "../src/review/quality";

let config: V5Config;
beforeAll(async () => {
  const table = loadDPTable();
  setDPTable(table.buffer as ArrayBuffer);
  const wasm = readFileSync(new URL("../training/v6-wasm/pmf.wasm", import.meta.url));
  config = { bank: bankFromWasm(await buildBankWasm(wasm, table, { f32: true })), dpValue: dpFutureValue, endgame: "none" };
});

function position({ cards, dice, player, rolls, round }: Game): Position {
  return { cards, dice, player, rolls, round };
}

test("v6 adapter matches single-bank v5-R value, keeps all 44 actions and isolates the observed roll", () => {
  const start = transition(createGame(501), { type: "roll" });
  const kept = transition(start, { type: "hold", ids: [0, 1] });
  const before = position(kept);
  const afterRoll = position(transition(kept, { type: "roll" }));
  const action = { type: "reroll", ids: [0, 1] } as const;
  const result = analyzeProductSituation({ before, afterRoll, action: { ...action, ids: [...action.ids] } }, 0, config);
  expect(result.exactness).toBe("estimate");
  expect(result.options).toHaveLength(44);
  expect(result.options.every((option) => option.winCredit !== undefined && option.winOutcomes !== undefined)).toBe(true);
  expect(Math.max(...result.options.map((option) => option.winCredit!))).toBeCloseTo(winDPv5Decision(start, config).value, 7);
  expect(result.winLuck).toBeCloseTo(winDPv5Decision({ ...start, ...afterRoll }, config).value - result.actual.winCredit!, 7);
  const changed = analyzeProductSituation({ before, afterRoll: { ...afterRoll, dice: afterRoll.dice.map((die) =>
    die.held ? die : { ...die, value: 6 }) }, action: { ...action, ids: [...action.ids] } }, 0, config);
  expect(changed.actual).toEqual(result.actual);
  expect(changed.winLuck).not.toBe(result.winLuck);
});

test("solved endgame keeps outcome probabilities absent and certainty does not lower win accuracy", () => {
  const zero = Object.fromEntries(categories.map((category) => [category, 0]));
  const { sixes: _one, ...own } = zero;
  const { choice: _another, ...other } = zero;
  const state = { ...transition(createGame(21), { type: "roll" }), cards: [own, other] as Game["cards"] };
  const row = analyzeProductSituation({ before: position(state), action: { type: "score", category: "sixes" } }, 0, config);
  const comparison = winDPv5Decision(state, { ...config, endgame: "minimax", minimaxWindow: 1 });
  expect(row.exactness).toBe("exact");
  expect(row.options.every(({ winOutcomes }) => winOutcomes === undefined)).toBe(true);
  expect(Math.max(...row.options.map((move) => move.winCredit!))).toBeCloseTo(comparison.value, 10);
  const winning = { ...state, cards: [{ ...own, yacht: 50 }, other] as Game["cards"] };
  const forced = analyzeProductSituation({ before: position(winning), action: { type: "score", category: "sixes" } }, 0, config);
  expect(accuracy([forced], "win")).toBeUndefined();
  expect(grade(forced)).toBe("★");
});


test("exceptional grades require a unique exact advantage and a measurable expected-score sacrifice", () => {
  const actual = { action: { type: "score", category: "choice" } as const, expected: 180, winCredit: .8 };
  const alternative = { action: { type: "score", category: "yacht" } as const, expected: 183, winCredit: .55 };
  const example = { index: 0, actual, options: [actual, alternative], loss: 3 };
  expect(grade({ ...example, exactness: "estimate" })).toBe("★");
  expect(grade({ ...example, exactness: "exact" })).toBe("!!");
  expect(grade({ ...example, exactness: "exact", options: [actual, { ...alternative, winCredit: .66 }], loss: 1 })).toBe("!");
  expect(grade({ ...example, exactness: "exact", options: [actual, { ...alternative, winCredit: .8 }] })).toBe("★");
});
