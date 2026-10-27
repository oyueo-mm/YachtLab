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
it("imports legacy matches and preserves a full prefix and exact RNG at branches", () => {
  const m = simulate(["Greedy", "Random"], 782),
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
