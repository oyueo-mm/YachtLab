import { describe, it, expect } from "vitest";
import {
  score,
  categories,
  bonus,
  total,
  createGame,
  transition,
  random,
  available,
} from "../src/engine";
import { decide, outcomes, utility, holds, type Algorithm } from "../src/ai";
import { simulate, statistics, result } from "../src/match";
describe("국내 12종 요트 규칙", () => {
  it("상단과 초이스", () => {
    categories
      .slice(0, 6)
      .forEach((c, i) =>
        expect(score([1, 2, 3, 4, 6], c)).toBe(i === 4 ? 0 : i + 1),
      );
    expect(score([6, 6, 6, 1, 2], "sixes")).toBe(18);
    expect(score([6, 5, 4, 3, 2], "choice")).toBe(20);
  });
  it("포커는 4개 이상, 풀 하우스는 서로 다른 3+2", () => {
    expect(score([2, 2, 2, 2, 6], "four")).toBe(14);
    expect(score([6, 6, 6, 6, 6], "four")).toBe(30);
    expect(score([2, 2, 2, 3, 4], "four")).toBe(0);
    expect(score([3, 3, 3, 2, 2], "full")).toBe(13);
    expect(score([3, 3, 3, 3, 3], "full")).toBe(0);
  });
  it("중복이 있는 스몰, 양쪽 라지, 요트", () => {
    expect(score([1, 2, 3, 4, 4], "small")).toBe(15);
    expect(score([6, 2, 3, 4, 5], "large")).toBe(30);
    expect(score([1, 2, 3, 4, 5], "large")).toBe(30);
    expect(score([1, 2, 3, 5, 6], "small")).toBe(0);
    expect(score([4, 4, 4, 4, 4], "yacht")).toBe(50);
    expect(score([4, 4, 4, 4, 5], "yacht")).toBe(0);
  });
  it("정확한 보너스 경계", () => {
    expect(bonus({ sixes: 30, fives: 25, fours: 8 })).toBe(35);
    expect(bonus({ sixes: 30, fives: 25, fours: 7 })).toBe(0);
    expect(total({ sixes: 30, fives: 25, fours: 8, yacht: 50 })).toBe(148);
  });
  it("0점 선택, 재선택 방지, 최대 3회와 종료 상태", () => {
    let s = createGame(42);
    expect(() => transition(s, { type: "score", category: "yacht" })).toThrow();
    for (let turn = 0; turn < 24; turn++) {
      for (let i = 0; i < 3; i++) s = transition(s, { type: "roll" });
      expect(() => transition(s, { type: "roll" })).toThrow();
      const c = available(s.cards[s.player])[0];
      s = transition(s, { type: "score", category: c });
    }
    expect(s.done).toBe(true);
    expect(Object.keys(s.cards[0])).toHaveLength(12);
    expect(s.winner).not.toBeNull();
    expect(() => transition(s, { type: "roll" })).toThrow();
  });
  it("고정과 정렬은 주사위 정체성 및 난수 상태 보존", () => {
    let s = transition(createGame(100), { type: "roll" });
    s = transition(s, { type: "hold", ids: [0, 3] });
    const old = s.dice.map((d) => ({ ...d })),
      rng = s.rng;
    s = transition(s, { type: "order", ids: [4, 3, 2, 1, 0] });
    expect(s.dice).toEqual(old);
    expect(s.rng).toEqual(rng);
    s = transition(s, { type: "roll" });
    expect(s.dice[0]).toEqual(old[0]);
    expect(s.dice[3]).toEqual(old[3]);
  });
  it("카테고리 중복 방지", () => {
    let s = transition(createGame(1), { type: "roll" });
    s = transition(s, { type: "score", category: "aces" });
    s = transition(s, { type: "roll" });
    s = transition(s, { type: "score", category: "aces" });
    s = transition(s, { type: "roll" });
    expect(() => transition(s, { type: "score", category: "aces" })).toThrow();
  });
  it("유효하지 않은 값과 순서 거부", () => {
    expect(() => score([0, 1, 2, 3, 4], "choice")).toThrow();
    expect(() =>
      transition(createGame(), { type: "order", ids: [0, 0, 1, 2, 3] }),
    ).toThrow();
  });
});
describe("확률과 AI", () => {
  it("조합 확률의 합과 기대 합계", () => {
    for (let n = 0; n <= 5; n++) {
      const o = outcomes(n);
      expect(o.reduce((s, x) => s + x.p, 0)).toBeCloseTo(1, 12);
      expect(
        o.reduce((s, x) => s + x.p * x.values.reduce((a, b) => a + b, 0), 0),
      ).toBeCloseTo(3.5 * n, 10);
    }
    expect(holds([1, 2, 3, 4, 5])).toHaveLength(32);
  });
  it("Greedy 한 번 재굴림 기댓값은 독립 완전열거와 일치", () => {
    let s = transition(createGame(9), { type: "roll" });
    s = {
      ...s,
      rolls: 2,
      cards: [
        Object.fromEntries(
          categories.filter((c) => c !== "choice").map((c) => [c, 0]),
        ),
        {},
      ],
      dice: s.dice.map((d) => ({ ...d, value: 1 })),
    };
    const d = decide(s, "Greedy");
    expect(d.type).toBe("reroll");
    expect(d.value).toBeCloseTo(17.5, 10);
  });
  it("Expectimax는 남은 굴림과 카드 효용을 반영", () => {
    let s = transition(createGame(5), { type: "roll" });
    s = { ...s, rolls: 2, dice: s.dice.map((d) => ({ ...d, value: 6 })) };
    const d = decide(s, "Expectimax");
    expect(d.type).toBe("score");
    if (d.type === "score") expect(d.category).toBe("yacht");
    expect(
      utility([6, 6, 6, 6, 6], "sixes", { fives: 25, fours: 12 }, true),
    ).toBeGreaterThan(30);
  });
  it.each(["Random", "Greedy", "Expectimax", "MCTS"] as Algorithm[])(
    "%s의 경기 완주 및 리플레이",
    (algorithm) => {
      const match = simulate([algorithm, "Random"], 123, { iterations: 100 });
      let s = createGame(123);
      for (const frame of match.frames.slice(1)) {
        s = transition(s, frame.action!);
        expect(s).toEqual(frame.state);
      }
      expect(s.done).toBe(true);
      expect(match.frames.length).toBeLessThan(220);
    },
  );
  it("같은 시드로 같은 결과", () => {
    expect(random(3)).toEqual(random(3));
    const a = simulate(["Random", "MCTS"], 55, { iterations: 100 }),
      b = simulate(["Random", "MCTS"], 55, { iterations: 100 });
    expect(a.frames).toEqual(b.frames);
  });
  it("MCTS 방문 횟수와 실제 표본 평균", () => {
    const s = transition(createGame(3), { type: "roll" }),
      d = decide(s, "MCTS", { iterations: 300 });
    expect(d.candidates.reduce((s, c) => s + (c.visits ?? 0), 0)).toBe(300);
    expect(d.candidates.every((c) => Number.isFinite(c.value))).toBe(true);
  });
  it("실제 결과에서 통계 계산", () => {
    const r = result(simulate(["Random", "Greedy"], 5));
    expect(statistics([r], "Random")?.mean).toBe(r.scores[0]);
    expect(statistics([r], "Random")?.sd).toBe(0);
  });
});
