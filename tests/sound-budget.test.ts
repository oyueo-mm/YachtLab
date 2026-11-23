import { describe, expect, it } from "vitest";
import { MAX_VOICES, createVoiceBudget } from "../src/sound";

describe("주사위 충돌음 예산 (겹침·찢어짐 방지)", () => {
  it("같은 종류의 소리는 수 ms 안에 반복되지 않고, 훨씬 강한 충돌만 끼어든다", () => {
    const admit = createVoiceBudget();
    expect(admit("impact", 0, 0.1, 0.1, 0.5)).toBe(true);
    expect(admit("impact", 0, 0.105, 0.1, 0.5)).toBe(false); // 5 ms later, same strength
    expect(admit("impact", 0, 0.108, 0.1, 0.9)).toBe(true); // much harder hit
    expect(admit("impact", 0, 0.14, 0.1, 0.4)).toBe(true); // far enough apart
    expect(admit("clack", 0, 0.141, 0.05, 0.4)).toBe(true); // a different kind is independent
  });
  it("동시에 울리는 충돌음은 최대 개수로 제한되고, 끝난 소리만큼 다시 허용된다", () => {
    const admit = createVoiceBudget();
    let accepted = 0;
    for (let i = 0; i < 40; i++) if (admit(i % 2 ? "impact" : "clack", 0, 0.1 + i * 0.03, 1, 0.9)) accepted++;
    expect(accepted).toBe(MAX_VOICES);
    expect(admit("impact", 5, 5.1, 0.1, 0.5)).toBe(true); // all earlier voices have ended
  });
  it("효과음(점수·요트·입장)은 충돌음 예산에 막히지 않는다", () => {
    const admit = createVoiceBudget(1);
    expect(admit("impact", 0, 0, 5, 1)).toBe(true);
    expect(admit("join", 0, 0, 1, 1)).toBe(true);
    expect(admit("yachtHit", 0, 0, 1, 1)).toBe(true);
  });
});
