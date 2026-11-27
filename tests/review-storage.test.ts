import { expect, test } from "vitest";
import { categories, createGame, total } from "../src/engine";
import { RULES_ID, type MatchRecord } from "../src/identity/records";
import { appendFrame, newReplay } from "../src/replay";
import { reviewKey } from "../src/review/cache";
import { recoverLegacyReplay } from "../src/review/offline-history";
import { fromReplay } from "../src/review/sources";

function fixture() {
  let replay = newReplay(createGame(73, true), [
    { name: "Random", type: "ai", algorithm: "Random" }, { name: "Player", type: "human" },
  ], "요트 대국", 2);
  for (const category of categories) for (const _seat of [0, 1]) {
    replay = appendFrame(replay, { type: "roll" });
    replay = appendFrame(replay, { type: "score", category });
  }
  const [ai, card] = replay.finalState.cards;
  const record: MatchRecord = {
    recordId: "d_legacy", mode: "ai", rules: RULES_ID, source: "device", verification: "client-reported",
    startedAt: Date.parse(replay.metadata.createdAt), endedAt: Date.parse(replay.metadata.createdAt) + 50_000,
    name: "Player", score: total(card), card, outcome: total(card) > total(ai) ? "win" : total(card) < total(ai) ? "loss" : "draw",
    endReason: "completed", opponent: { kind: "ai", name: "AI · 매우 쉬움", score: total(ai) }, aiLevel: "매우 쉬움",
  };
  return { replay, record };
}

test("legacy linkage requires a unique replay and a unique matching record", () => {
  const { replay, record } = fixture();
  expect(recoverLegacyReplay(record, [record], [replay])).toBe(replay);
  expect(recoverLegacyReplay(record, [record], [])).toBeUndefined();
  expect(recoverLegacyReplay({ ...record, startedAt: record.startedAt + 1 }, [record], [replay])).toBeUndefined();
  expect(recoverLegacyReplay(record, [record, { ...record, recordId: "d_clone" }], [replay])).toBeUndefined();
  expect(recoverLegacyReplay(record, [record], [replay, { ...replay, metadata: { ...replay.metadata, id: "other" } }])).toBeUndefined();
});

test("review cache keeps replay IDs, model versions and changed public snapshots distinct", async () => {
  const match = fromReplay(fixture().replay);
  if (typeof match === "string") throw Error(match);
  const snapshot = JSON.stringify(match.steps);
  const key = await reviewKey(match, snapshot, "model-1");
  expect(await reviewKey(match, snapshot, "model-1")).toBe(key);
  expect(await reviewKey(match, snapshot, "model-2")).not.toBe(key);
  expect(await reviewKey({ ...match, id: "other" }, snapshot, "model-1")).not.toBe(key);
  expect(await reviewKey(match, JSON.stringify(match.steps.slice(1)), "model-1")).not.toBe(key);
});
