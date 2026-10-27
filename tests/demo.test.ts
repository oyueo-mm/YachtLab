import { it, expect } from "vitest";
import records from "../src/demo-records.json";
import {
  transition,
  score,
  type Game,
  type Action,
  type Category,
} from "../src/engine";
it("홈의 모든 턴은 기존 엔진의 합법적이고 정확한 상태 전이", () => {
  expect(new Set(records.map((r) => r.category)).size).toBe(6);
  for (const clip of records) {
    let state = clip.frames[0].state as Game;
    expect(state.rolls).toBe(0);
    expect(clip.frames[0].action).toBeNull();
    let rolls = 0,
      holds = 0;
    for (const frame of clip.frames.slice(1)) {
      if (frame.action?.type === "roll") rolls++;
      if (frame.action?.type === "hold") holds++;
      state = transition(state, frame.action as Action);
      expect(state).toEqual(frame.state);
    }
    expect(rolls).toBeGreaterThan(1);
    expect(rolls).toBeLessThanOrEqual(3);
    expect(holds).toBeGreaterThan(0);
    const final = clip.frames.at(-1)!;
    expect(final.action?.type).toBe("score");
    expect(
      score(
        final.state.dice.map((d) => d.value),
        clip.category as Category,
      ),
    ).toBe(clip.points);
  }
});
