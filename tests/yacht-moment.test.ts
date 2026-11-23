import { describe, expect, it } from "vitest";
import { isYachtDice } from "../src/yacht-moment";

const dice = (...v: number[]) => v.map((value) => ({ value }));
describe("요트 자동 감지 (표시 전용)", () => {
  it("굴린 뒤 다섯 눈이 모두 같을 때만", () => {
    expect(isYachtDice(dice(4, 4, 4, 4, 4), 1)).toBe(true);
    expect(isYachtDice(dice(6, 6, 6, 6, 6), 3)).toBe(true);
    expect(isYachtDice(dice(4, 4, 4, 4, 3), 2)).toBe(false);
    expect(isYachtDice(dice(1, 1, 1, 1, 1), 0)).toBe(false); // before the first roll
    expect(isYachtDice(dice(2, 2, 2, 2), 1)).toBe(false);
  });
});
