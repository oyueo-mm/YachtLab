import { describe, expect, it } from "vitest";
import { available, createGame, transition } from "../src/engine";
import { appendFrame, newReplay, validateReplay } from "../src/replay";

describe("로컬 사람 vs 사람", () => {
  it("각 플레이어가 번갈아 12개 카테고리를 기록하고 유효한 인간 기보를 만든다", () => {
    const names = [{ type: "human" as const, name: "민수" }, { type: "human" as const, name: "지민" }] as const;
    let record = newReplay(createGame(732), [names[0], names[1]], "사람 vs 사람");
    for (let turn = 0; turn < 24; turn++) {
      const actor = (turn % 2) as 0 | 1;
      expect(record.finalState.player).toBe(actor);
      expect(record.finalState.round).toBe(Math.floor(turn / 2) + 1);
      record = appendFrame(record, { type: "roll" });
      const category = available(record.finalState.cards[actor])[0];
      record = appendFrame(record, { type: "score", category });
      if (turn < 23) expect(record.finalState.player).toBe((1 - actor) as 0 | 1);
    }
    expect(record.finalState.done).toBe(true);
    expect(record.finalState.winner).not.toBeNull();
    expect(record.frames).toHaveLength(49);
    expect(record.metadata.players).toEqual(names);
    expect(validateReplay(record).finalState).toEqual(record.finalState);
  });
  it("두 번째 플레이어도 재굴림·고정·0점 기록을 할 수 있다", () => {
    let state = transition(createGame(91), { type: "roll" });
    state = transition(state, { type: "score", category: "choice" });
    expect(state.player).toBe(1);
    state = transition(state, { type: "roll" });
    state = transition(state, { type: "hold", ids: [0, 2] });
    const held = state.dice.filter((d) => d.held).map((d) => d.value);
    state = transition(state, { type: "roll" });
    expect(state.dice.filter((d) => d.held).map((d) => d.value)).toEqual(held);
    state = transition(state, { type: "score", category: "yacht" });
    expect(state.cards[1].yacht).toBeGreaterThanOrEqual(0);
    expect(state.player).toBe(0);
  });
});
