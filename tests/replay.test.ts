import { it, expect } from "vitest";
import { createGame, transition } from "../src/engine";
import {
  newReplay,
  appendFrame,
  parseReplay,
  validateReplay,
  clone,
  replayFromMatch,
  branchReplay,
} from "../src/replay";
import { simulate, simulateFromState } from "../src/match";
const players = [
  { type: "human" as const, name: "Human" },
  { type: "ai" as const, name: "Greedy", algorithm: "Greedy" as const },
] as const;
const fresh = () => newReplay(createGame(824), [...players]);
it("round-trips human rolls, sorting, holds and independent snapshots", () => {
  const r = fresh(),
    s = appendFrame(r, { type: "roll" }),
    t = appendFrame(s, { type: "order", ids: [4, 3, 2, 1, 0] }),
    u = appendFrame(t, { type: "hold", ids: [0, 3] });
  expect(parseReplay(JSON.stringify(u))).toEqual(u);
  expect(r.frames).toHaveLength(1);
  expect(s.finalState.order).toEqual([0, 1, 2, 3, 4]);
});
it("새 사람 vs AI의 독립 주사위 시드와 기존 v1 기보를 모두 재현", () => {
  const legacy = appendFrame(fresh(), { type: "roll" });
  const independent = appendFrame(newReplay(createGame(824, true), [...players], "요트 대국", 2), { type: "roll" });
  expect(parseReplay(JSON.stringify(legacy))).toEqual(legacy);
  expect(parseReplay(JSON.stringify(independent))).toEqual(independent);
  const altered = clone(independent);
  altered.initialState.rng[1] = altered.initialState.rng[0];
  expect(() => validateReplay(altered)).toThrow();
});
it("rejects forged RNG, score, dice, illegal actions, versions and oversized files", () => {
  const r = appendFrame(fresh(), { type: "roll" });
  for (const mutate of [
    (x: any) => x.frames[1].state.rng[0]++,
    (x: any) => (x.frames[1].state.dice[0].value = 0),
    (x: any) => (x.frames[1].action = { type: "hold", ids: [9] }),
    (x: any) => (x.finalState.cards[0].yacht = 50),
    (x: any) => (x.version = 2),
  ]) {
    const x = clone(r);
    mutate(x);
    expect(() => validateReplay(x)).toThrow();
  }
  expect(() => parseReplay(" ".repeat(8 * 1024 * 1024 + 1))).toThrow();
});
it("새 AI 대국은 v2로 저장하고 기존 동일 난수의 v1 대국도 읽는다", () => {
  const independent = simulate(["Random", "Random"], 42);
  const modern = replayFromMatch(independent);
  expect(modern.version).toBe(2);
  expect(modern.metadata.ruleVersion).toBe("YachtLab-12-v2");
  expect(validateReplay(independent).finalState).toEqual(modern.finalState);
  expect(parseReplay(JSON.stringify(modern))).toEqual(modern);
  const old = simulateFromState(createGame(42), ["Random", "Random"]);
  const legacy = replayFromMatch(old);
  expect(legacy.version).toBe(1);
  expect(validateReplay(old).finalState).toEqual(legacy.finalState);
  expect(parseReplay(JSON.stringify(legacy))).toEqual(legacy);
});
it("imports legacy matches and preserves a full prefix and exact RNG at branches", () => {
  const m = simulateFromState(createGame(782), ["Greedy", "Random"]),
    r = replayFromMatch(m),
    index = m.frames.findIndex((f) => f.action?.type === "hold");
  expect(validateReplay(m).finalState).toEqual(r.finalState);
  const before = clone(r),
    state = r.frames[index].state;
  const continuation = simulateFromState(state, ["Greedy", "Greedy"], {}, true);
  expect(continuation.frames[1].state).toEqual(
    transition(state, { type: "roll" }),
  );
  const b = branchReplay(r, index, continuation);
  expect(b.frames.slice(0, index + 1)).toEqual(r.frames.slice(0, index + 1));
  expect(b.metadata.source).toEqual({
    replayId: r.metadata.id,
    frameIndex: index,
  });
  expect(b.finalState.done).toBe(true);
  expect(r).toEqual(before);
  expect(parseReplay(JSON.stringify(b))).toEqual(b);
});
