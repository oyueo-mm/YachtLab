import { winDPv5Decision } from "../src/research-v5/apex";
import { PolicyPmfBank } from "../src/research-v5/policy-pmf";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import manifest from "../src/dp-manifest.json";
import { FULL, PROB, STATES } from "../src/research-v5/kernel";
import { choiceIndex, dpActionValue, dpDecision, dpFutureValue, setDPTable } from "../src/dp";
import { categories, createGame, transition, type Game } from "../src/engine";
import { appendFrame, newReplay } from "../src/replay";
import { fromReplay } from "../src/review/sources";
import { assessSituation } from "../src/review/solver";
import type { Position, Situation } from "../src/review/model";

beforeAll(() => {
  const decoded = gunzipSync(readFileSync(new URL("../public/ai/" + manifest.asset, import.meta.url)));
  setDPTable(decoded.buffer.slice(decoded.byteOffset, decoded.byteOffset + decoded.byteLength) as ArrayBuffer);
});

function position(state: Game): Position {
  const { cards, dice, player, rolls, round } = state;
  return { cards, dice, player, rolls, round };
}

describe("DP Expert review", () => {
  it("compares every legal action, measures a confirmed hold mask, and isolates luck from the decision", () => {
    const before = transition(createGame(17), { type: "roll" });
    const kept = transition(before, { type: "hold", ids: [0, 2] });
    const action = { type: "reroll", ids: [0, 2] } as const;
    const step: Situation = { before: position(kept), action: { ...action, ids: [...action.ids] }, afterRoll: position(transition(kept, { type: "roll" })) };
    const result = assessSituation(step, 0);
    expect(result.options).toHaveLength(44);
    expect(result.options[0].expected).toBeCloseTo(dpDecision(before).value, 10);
    expect(result.actual.expected).toBeCloseTo(dpActionValue(before, step.action), 10);
    const differentOutcome = position(transition(kept, { type: "roll" }));
    for (const die of differentOutcome.dice) if (!die.held) die.value = 6;
    const another = assessSituation({ ...step, afterRoll: differentOutcome }, 0);
    expect(another.actual).toEqual(result.actual);
    expect(another.loss).toBe(result.loss);
    expect(another.luck).not.toBe(result.luck);
  });

  it("reports a certain tie as half credit and preserves a zero-point recorded action", () => {
    const zeroCard = Object.fromEntries(categories.map((category) => [category, 0]));
    const { yacht: _, ...own } = zeroCard;
    const state = { ...createGame(1), rolls: 3, cards: [own, zeroCard] as Game["cards"] };
    state.dice[0].value = 2;
    const result = assessSituation({ before: position(state), action: { type: "score", category: "yacht" } }, 0);
    expect(result.actual.expected).toBe(0);
    expect(result.actual.winCredit).toBe(.5);
    expect(result.loss).toBe(0);
    expect(result.distribution).toEqual([{ difference: 0, mass: 1 }]);
    expect(assessSituation({ before: { ...position(state), simultaneous: true }, action: { type: "score", category: "yacht" } }, 0).actual.winCredit).toBeUndefined();
  });

  it("withholds unfinished replays and sends only visible pre-action snapshots for completed ones", () => {
    let replay = newReplay(createGame(20), [{ name: "A", type: "human" }, { name: "B", type: "human" }]);
    expect(typeof fromReplay(replay)).toBe("string");
    for (const category of categories) {
      for (let i = 0; i < 2; i++) {
        replay = appendFrame(replay, { type: "roll" });
        replay = appendFrame(replay, { type: "score", category });
      }
    }
    const report = fromReplay(replay);
    if (typeof report === "string") throw Error(report);
    expect(report.steps).toHaveLength(24);
    expect(report.steps[0].before.cards).toEqual([{}, {}]);
    expect(JSON.stringify(report)).not.toMatch(/"rng"|"seed"/);
  });
});

it("cross-checks v5 win credit for final-turn scoring and every canonical re-roll", () => {
  const zero = Object.fromEntries(categories.map((category) => [category, 0]));
  const { sixes: _six, ...own } = zero;
  const { choice: _choice, ...other } = zero;
  const state: Game = { ...transition(createGame(21), { type: "roll" }), cards: [own, other] };
  const independent = winDPv5Decision(state, {
    bank: new PolicyPmfBank("unused by minimax", dpFutureValue), dpValue: dpFutureValue,
    endgame: "minimax", minimaxWindow: 1,
  });
  const reviewed = assessSituation({ before: position(state), action: { type: "score", category: "sixes" } }, 0);
  for (const item of independent.analysis) {
    const index = item.kind === "score" ? choiceIndex({ type: "score", category: item.category! }) : choiceIndex({ type: "reroll", ids: item.ids! });
    const option = reviewed.options.find((entry) => choiceIndex(entry.action) === index);
    expect(option?.winCredit).toBeCloseTo(item.winCredit, 10);
  }
});

it("balances first-roll luck across all dice and attributes each roll once", async () => {
  const { createReviewReport } = await import("../src/review/report");
  const zeros = Object.fromEntries(categories.filter((category) => category !== "choice").map((category) => [category, 0]));
  const base = { ...position(transition(createGame(17), { type: "roll" })), cards: [zeros, {}] as Position["cards"], simultaneous: true as const };
  const move = { type: "score", category: "choice" } as const;
  const sum = Array.from({ length: FULL }, (_, index) => {
    const before = { ...base, dice: base.dice.map((die, id) => ({ ...die, value: STATES[210 + index][id] })) };
    return PROB[index] * assessSituation({ before, action: move, firstRoll: before }, 0).firstLuck!;
  }).reduce((total, value) => total + value, 0);
  expect(sum).toBeCloseTo(0, 10);

  const first: Situation = { before: base, firstRoll: base, action: { type: "reroll", ids: [0, 1, 2, 3, 4] }, afterRoll: { ...base, rolls: 2 } };
  const second: Situation = { before: first.afterRoll!, action: move, automatic: true };
  const match = { id: "luck", players: ["A", ""] as [string, string], winners: [0 as const],
    scores: [0, 0] as [number, number], solo: true as const, steps: [first, second] };
  const result = createReviewReport(match, match.steps.map(assessSituation));
  const [player] = result.players;
  const [opening, recorded] = player.rounds[0].actions;
  expect(result.unit).toBe("points");
  expect(opening.rolls.map(({ kind }) => kind)).toEqual(["first", "reroll"]);
  expect(opening.rolls[1].swing).toBe(0);
  expect(recorded.evaluation).toEqual({ state: "unassessed", reason: "automatic" });
  expect(player.totals.assessedRolls).toBe(2);
  expect(player.totals.luck).toBe(opening.rolls[0].swing);
  expect(recorded.cumulativeLuck).toBe(player.totals.luck);
  const fallback = createReviewReport({ ...match, solo: undefined }, match.steps.map(assessSituation));
  expect(fallback.unit).toBe("percentage-points");
  expect(fallback.players[0].totals).toMatchObject({ accuracy: null, loss: null, luck: null, assessedRolls: 0 });
});

it("includes a real first roll even when the game ends before the player chooses", async () => {
  const { assessOpening } = await import("../src/review/solver");
  const { createReviewReport } = await import("../src/review/report");
  const first = position(transition(createGame(728), { type: "roll" }));
  const match = { id: "resigned", players: ["A", "B"] as [string, string], scores: [0, 0] as [number, number],
    winners: [1 as const], steps: [], unpairedFirstRolls: [first], solo: undefined };
  const row = { ...assessOpening(first), preRollValue: 0.5, firstWinLuck: 0.125, exactness: "estimate" as const };
  const report = createReviewReport(match, [], undefined, [row]);
  expect(report.players[0].totals).toMatchObject({ firstLuck: 12.5, luck: 12.5, observedRolls: 1, assessedActions: 0, accuracy: null });
  expect(report.players[0].rounds[0].actions).toEqual([]);
  expect(report.players[0].rounds[0].unpairedFirstRolls[0].roll?.realizedValue).toBe(62.5);
  expect(report.players[0].highlights.lucky[0]).toMatchObject({ round: 1, index: null });
});
