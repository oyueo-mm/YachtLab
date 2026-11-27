import { describe, expect, it } from "vitest";
import { createGame, transition, type Game } from "../src/engine";
import type { Assessment, Position, ReviewMatch, Situation } from "../src/review/model";
import { createReviewReport } from "../src/review/report";
import { actionTags, goodMoments, gradeCounts, matches, roundBars, scoreSeries, seatInfo, signed, timeline, winSeries } from "../src/review/view-model";

const pos = ({ cards, dice, player, rolls, round }: Game): Position => ({ cards, dice, player, rolls, round });

function match(names: [string, string] = ["요트", "요트"], extra: Partial<ReviewMatch> = {}): ReviewMatch {
  let game = transition(createGame(5, true), { type: "roll" });
  const steps: Situation[] = [];
  steps.push({ before: pos(game), action: { type: "score", category: "choice" } });
  game = transition(game, { type: "score", category: "choice" });
  game = transition(game, { type: "roll" });
  steps.push({ before: pos(game), action: { type: "score", category: "aces" } });
  return { id: "m", players: names, scores: [10, 3], winners: [0], steps, ...extra };
}

const value = (index: number, step: Situation, actual: number, other: number): Assessment => {
  const chosen = { action: step.action, expected: 0, winCredit: actual };
  const alt = { action: { type: "score" as const, category: step.action.type === "score" && step.action.category === "yacht" ? "aces" as const : "yacht" as const }, expected: 0, winCredit: other };
  return { index, options: [chosen, alt], actual: chosen, loss: 0, exactness: "estimate" };
};

describe("A5 review view model", () => {
  it("keeps equal names apart with seat roles and seat colours independent of grades", () => {
    const seats = seatInfo(match(["요트", "요트"], { me: 1 }));
    expect(seats.map(({ display }) => display)).toEqual(["요트 (선공)", "요트 (후공)"]);
    expect(seats.map(({ tone }) => tone)).toEqual(["opp", "me"]);
    expect(seatInfo(match(["가", "나"])).map(({ display }) => display)).toEqual(["가", "나"]);
    const solo = seatInfo({ ...match(), solo: true, players: ["혼자", ""] });
    expect(solo).toHaveLength(1);
    expect(solo[0].role).toBe("1인");
  });

  it("reads grades, filters and good moments from the report without inventing values", () => {
    const m = match();
    const values = [value(0, m.steps[0], 0.7, 0.4), value(1, m.steps[1], 0.2, 0.5)];
    const report = createReviewReport(m, values);
    const counts = gradeCounts(report, 0);
    const action0 = report.players[0].rounds[0].actions[0];
    expect(action0.evaluation.state).toBe("assessed");
    expect(actionTags(action0)).toContain("good");
    const action1 = report.players[1].rounds[0].actions[0];
    expect(actionTags(action1)).toContain("mistake");
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(1);
    const moments = goodMoments(m, report, values, 0);
    expect(moments).toHaveLength(1);
    expect(moments[0].margin).toBeCloseTo(30, 8);
    expect(goodMoments(m, report, values, 1)).toEqual([]);
    const items = timeline(m, report).flatMap(({ items }) => items);
    expect(items.filter((item) => matches(item, "mistake", "all")).map((item) => item.seat)).toEqual([1]);
    expect(items.filter((item) => matches(item, "all", 0))).toHaveLength(1);
    // Without rolls there is no luck: null, not 0.
    expect(roundBars(m, report, 0)[0].luck).toBeNull();
  });

  it("shows win credit from one seat's side and running scores from public cards", () => {
    const m = match(["가", "나"]);
    const values = [value(0, m.steps[0], 0.7, 0.4), value(1, m.steps[1], 0.2, 0.5)];
    expect(winSeries(m, values, 0).map(({ value }) => Math.round(value))).toEqual([70, 80]);
    expect(winSeries(m, values, 1).map(({ value }) => Math.round(value))).toEqual([30, 20]);
    expect(scoreSeries(m, 0)).toHaveLength(1);
    expect(scoreSeries(m, 0)[0].value).toBeGreaterThan(0);
  });

  it("lists timeline before analysis and formats signed values", () => {
    const m = match();
    const rounds = timeline(m);
    expect(rounds).toHaveLength(1);
    expect(rounds[0].items.every((item) => item.kind === "action" && !item.reviewed)).toBe(true);
    expect(signed(1.234)).toBe("+1.23");
    expect(signed(-0.001)).toBe("0.00");
    expect(signed(-2)).toBe("-2.00");
  });
});
