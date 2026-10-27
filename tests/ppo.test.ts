import { it, expect } from "vitest";
import fixtures from "./python-rules.json";
import model from "../src/ppo-model.json";
import { categories, score, createGame, transition } from "../src/engine";
import { observe, policy, actionMask, ppoDecision } from "../src/ppo";
import { simulate } from "../src/match";
it("Python과 TypeScript는 252개 조합 × 12개 점수에서 일치", () => {
  for (const f of fixtures)
    categories.forEach((c, i) => expect(score(f.values, c)).toBe(f.scores[i]));
});
it("내보낸 모델의 PyTorch와 브라우저 확률 일치", () => {
  const s = {
    ...createGame(123),
    rolls: model.fixture.rolls,
    dice: model.fixture.dice.map((value, id) => ({ id, value, held: false })),
  };
  expect(observe(s)).toHaveLength(60);
  policy(s).forEach((p, i) =>
    expect(p).toBeCloseTo(model.fixture.probabilities[i], 5),
  );
  expect(policy(s).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
});
it("사용한 카테고리와 추가 재굴림 마스킹", () => {
  let s = transition(createGame(42), { type: "roll" });
  s = { ...s, rolls: 3, cards: [{ aces: 0, choice: 20 }, {}] };
  const mask = actionMask(s),
    probs = policy(s);
  expect(mask.slice(0, 32).every((v) => !v)).toBe(true);
  expect(probs.slice(0, 32).every((v) => v === 0)).toBe(true);
  expect(probs[32]).toBe(0);
  expect(probs[38]).toBe(0);
  const d = ppoDecision(s);
  expect(d.type).toBe("score");
});
it("PPO는 공유 규칙 엔진으로 12라운드를 완주", () => {
  const m = simulate(["PPO", "Greedy"], 2026);
  expect(m.frames.at(-1)!.state.done).toBe(true);
  expect(Object.keys(m.frames.at(-1)!.state.cards[0])).toHaveLength(12);
});
