import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import manifest from "../src/dp-manifest.json";
import { setDPTable } from "../src/dp";
import { total } from "../src/engine";
import { validateMultiReplay } from "../src/multi-replay";
import { validateReplay } from "../src/replay";
import { firstRollPosition, reviewAlgorithmVersion, type ReviewMatch } from "../src/review/model";
import { createReviewReport } from "../src/review/report";
import { assessSituation } from "../src/review/solver";
import { fromMultiReplay, fromReplay } from "../src/review/sources";
import { seatInfo, timeline, winSeries } from "../src/review/view-model";

// Frozen inputs in the formats that existed before the A5 screen (see tests/fixtures/review-legacy/generate.ts).
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/review-legacy/${name}`, import.meta.url), "utf8"));

beforeAll(() => {
  const decoded = gunzipSync(readFileSync(new URL("../public/ai/" + manifest.asset, import.meta.url)));
  setDPTable(decoded.buffer.slice(decoded.byteOffset, decoded.byteOffset + decoded.byteLength) as ArrayBuffer);
});

/** DP-only (fallback) values: exact endgame win credit, nothing estimated. */
const assess = (match: ReviewMatch) => match.steps.map((step, index) => assessSituation(step, index));

describe("legacy-format review inputs", () => {
  it("v1 AI replay (shared dice stream) still opens with an a5-v1 report", () => {
    const replay = validateReplay(fixture("ai-replay-v1.json"));
    expect(replay.version).toBe(1);
    const match = fromReplay(replay);
    if (typeof match === "string") throw Error(match);
    expect(match.me).toBe(0);
    expect(match.scores).toEqual([total(replay.finalState.cards[0]), total(replay.finalState.cards[1])]);
    const values = assess(match);
    const report = createReviewReport(match, values, "legacy-test");
    expect(report.schema).toBe("yachtlab-review-a5-v1");
    expect(report.algorithmVersion).toBe(reviewAlgorithmVersion);
    expect(report.players).toHaveLength(2);
    expect(timeline(match, report).map(({ round }) => round)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    // Without the v5 bank only the exact endgame has win credit; earlier actions stay unassessed, not 0.
    const series = winSeries(match, values, 0);
    expect(series.length).toBeGreaterThan(0);
    expect(series.every(({ exactness }) => exactness === "exact")).toBe(true);
    for (const { totals } of report.players) expect(totals.unassessedActions).toBeGreaterThan(0);
  });

  it("v1 local 1:1 replay with a legacy seed stream and equal names", () => {
    const replay = validateMultiReplay(fixture("local-multi-v1.json"));
    expect(replay.version).toBe(1);
    const match = fromMultiReplay(replay);
    if (typeof match === "string") throw Error(match);
    expect(match.scores).toEqual([total(replay.finalState.cards[0]), total(replay.finalState.cards[1])]);
    expect(match.steps.filter(({ action }) => action.type === "score")).toHaveLength(24);
    expect(seatInfo(match).map(({ display }) => display)).toEqual(["철수 (선공)", "철수 (후공)"]);
    const report = createReviewReport(match, assess(match), "legacy-test");
    expect(report.players.map(({ name }) => name)).toEqual(["철수", "철수"]);
  });

  it("account archive without roll context reads the first dice from the first decision", () => {
    const archive = fixture("account-archive-legacy.json") as ReviewMatch;
    expect(archive.steps.some((step) => "firstRoll" in step)).toBe(false);
    expect(archive.unpairedFirstRolls).toBeUndefined();
    const first = archive.steps[0];
    expect(firstRollPosition(first)).toBe(first.before);
    const values = assess(archive);
    const report = createReviewReport(archive, values, "legacy-test");
    // Same decisions as the fresh trace of the same game: identical grades and losses.
    const fresh = fromReplay(validateReplay(fixture("ai-replay-v1.json")));
    if (typeof fresh === "string") throw Error(fresh);
    const freshReport = createReviewReport(fresh, assess(fresh), "legacy-test");
    const evaluations = (r: typeof report) => r.players.flatMap(({ rounds }) => rounds.flatMap(({ actions }) => actions.map(({ evaluation }) => evaluation)));
    expect(evaluations(report)).toEqual(evaluations(freshReport));
    // No looks / device in the archive: the view still names both seats.
    expect(seatInfo(archive).map(({ display }) => display)).toEqual(archive.players);
  });
});
