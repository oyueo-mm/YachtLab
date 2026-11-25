import { winDPv5Decision } from "../src/research-v5/apex";
import { PolicyPmfBank } from "../src/research-v5/policy-pmf";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import manifest from "../src/dp-manifest.json";
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
