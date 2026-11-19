import { beforeAll, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import kernel from "../src/dp-kernel.json";
import manifest from "../src/dp-manifest.json";
import {
  setDPTable,
  dpFutureValue,
  dpDecision,
  turnValues,
  chanceValues,
  dpActionValues,
  dpActionValue,
} from "../src/dp";
import {
  createGame,
  transition,
  categories,
  score,
  upper,
  total,
  type Card,
  type Game,
  type Category,
} from "../src/engine";
import { outcomes, holds } from "../src/ai";
import { simulate } from "../src/match";
import { winDPDecision, canUseWinDP, lastTurnDPDistribution } from "../src/win-dp";
beforeAll(() => {
  const bytes = gunzipSync(readFileSync(`public/ai/${manifest.asset}`));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    manifest.sha256,
  );
  setDPTable(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
});
it('arbitrary legal actions use the same DP Bellman value, including symmetric holds',()=>{
  let state=transition(createGame(123),{type:'roll'});
  state={...state,dice:[1,1,3,4,6].map((value,id)=>({id,value,held:false}))};
  for(const rolls of [1,2,3]){
    const s={...state,rolls},d=dpDecision(s),q=dpActionValues(s);
    expect(Math.max(...q)).toBeCloseTo(d.value,9);
    expect(dpActionValue(s,d)).toBeCloseTo(d.value,9);
    if(rolls<3)expect(dpActionValue(s,{type:'reroll',ids:[0]})).toBeCloseTo(dpActionValue(s,{type:'reroll',ids:[1]}),12);
    else expect(()=>dpActionValue(s,{type:'reroll',ids:[]})).toThrow();
  }
  expect(()=>dpActionValue(state,{type:'reroll',ids:[0,0]})).toThrow();
});
it("DP 커널의 점수는 YachtLab 엔진과 일치", () => {
  kernel.states
    .slice(210)
    .forEach((v, i) =>
      categories.forEach((c, j) =>
        expect(kernel.points[i][j]).toBe(score(v, c)),
      ),
    );
  expect(kernel.probabilities.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
});
it("부분 멀티셋 기댓값은 독립 순서 결과의 완전 열거와 일치", () => {
  const full = kernel.states
    .slice(210)
    .map((v) => score(v, "yacht") + score(v, "choice"));
  const e = chanceValues(full);
  for (const i of [0, 1, 6, 7, 30, 100, 209]) {
    const kept = kernel.states[i],
      direct = outcomes(5 - kept.length).reduce(
        (sum, o) =>
          sum +
          o.p *
            (score([...kept, ...o.values], "yacht") +
              score([...kept, ...o.values], "choice")),
        0,
      );
    expect(e[i]).toBeCloseTo(direct, 11);
  }
});
// Independent recursive enumeration: it uses the existing outcomes/holds code,
// never the DP transition kernel or its stored value table.
function brute(
  mask: number,
  u: number,
  dice: number[] | null = null,
  left = 2,
  memo = new Map<string, number>(),
): number {
  if (!mask) return 0;
  const key = `${mask}:${u}:${dice ? [...dice].sort().join("") : "start"}:${left}`;
  if (memo.has(key)) return memo.get(key)!;
  let best: number;
  if (!dice)
    best = outcomes(5).reduce(
      (s, o) => s + o.p * brute(mask, u, o.values, 2, memo),
      0,
    );
  else {
    best = -Infinity;
    for (let c = 0; c < 12; c++)
      if (mask & (1 << c)) {
        const p = score(dice, categories[c]),
          next = c < 6 ? Math.min(63, u + p) : u;
        best = Math.max(
          best,
          p +
            (u < 63 && next === 63 ? 35 : 0) +
            brute(mask ^ (1 << c), next, null, 2, memo),
        );
      }
    if (left)
      for (const kept of holds(dice))
        if (kept.length < 5)
          best = Math.max(
            best,
            outcomes(5 - kept.length).reduce(
              (s, o) =>
                s +
                o.p * brute(mask, u, [...kept, ...o.values], left - 1, memo),
              0,
            ),
          );
  }
  memo.set(key, best);
  return best;
}
it("남은 1~2칸에서 전 게임 DP는 독립 완전 탐색과 일치", () => {
  for (const [mask, u] of [
    [1 << 6, 0],
    [1 << 11, 0],
    [1 << 5, 62],
    [(1 << 0) | (1 << 6), 60],
    [(1 << 5) | (1 << 11), 47],
  ])
    expect(dpFutureValue(mask, u)).toBeCloseTo(brute(mask, u), 8);
});
it("종료 상태, 보너스 경계와 이미 획득한 보너스", () => {
  for (const u of [0, 62, 63]) expect(dpFutureValue(0, u)).toBe(0);
  expect(dpFutureValue(1 << 0, 62)).toBeGreaterThan(dpFutureValue(1 << 0, 61));
  expect(dpFutureValue(1 << 6, 62)).toBe(dpFutureValue(1 << 6, 63));
  expect(dpFutureValue(4095, 0)).toBeCloseTo(manifest.initialExpectedScore, 10);
});
function stateFor(
  remaining: Category[],
  values: number[],
  u = 0,
  left = 0,
): Game {
  const card: Card = Object.fromEntries(
    categories.filter((c) => !remaining.includes(c)).map((c) => [c, 0]),
  );
  const upperUsed = categories.slice(0, 6).find((c) => !remaining.includes(c));
  if (u === 63 && categories.slice(0, 6).every((c) => !remaining.includes(c)))
    categories.slice(0, 6).forEach((c, i) => (card[c] = 3 * (i + 1)));
  else if (upperUsed) card[upperUsed] = u;
  return {
    ...createGame(42),
    cards: [card, {}],
    rolls: 3 - left,
    dice: values.map((value, id) => ({ id, value, held: false })),
  };
}
it("0점 칸을 버려 장기 가치를 보존하는 선택", () => {
  const s = stateFor(["aces", "yacht"], [2, 3, 4, 5, 6], 0, 0);
  const d = dpDecision(s);
  expect(d.type).toBe("score");
  if (d.type === "score") expect(d.category).toBe("aces");
});
it("마지막 칸과 최종 굴림 기대점수", () => {
  const s = stateFor(["yacht"], [6, 6, 6, 6, 6], 63, 0),
    d = dpDecision(s);
  expect(d.type).toBe("score");
  expect(d.value).toBe(total(s.cards[0]) + 50);
});
it("현재 행동 기대값은 테이블 Bellman 재귀와 일치", () => {
  const mask = (1 << 5) | (1 << 6),
    u = 45,
    solved = turnValues(mask, u, 2);
  expect(chanceValues(solved.values)[0]).toBeCloseTo(
    dpFutureValue(mask, u),
    10,
  );
});

it("여러 남은 카테고리·보너스 상태의 Bellman 잔차는 수치 오차 이내", () => {
  for (const mask of [3, 63, 255, 511, 1023, 2047, 4095])
    for (const u of [0, 47, 62, 63]) {
      const solved = turnValues(mask, u, 2);
      expect(chanceValues(solved.values)[0]).toBeCloseTo(
        dpFutureValue(mask, u),
        9,
      );
    }
});
it("동일 상태 결정성, 순서 독립성 및 합법적인 완주", () => {
  const s = transition(createGame(123), { type: "roll" });
  expect(dpDecision(s)).toEqual(dpDecision(s));
  const reordered = { ...s, order: [4, 3, 2, 1, 0] };
  expect(dpDecision(s)).toEqual(dpDecision(reordered));
  for (const seed of [42, 123, 2026]) {
    const m = simulate(["DP Expert", "Expectimax"], seed);
    expect(m.frames.at(-1)!.state.done).toBe(true);
    for (const f of m.frames)
      expect(upper(f.state.cards[0])).toBeGreaterThanOrEqual(0);
  }
});

it("분석 후보의 최댓값과 현재 턴 DP 값은 동일", () => {
  for (let seed = 20; seed < 30; seed++) {
    const s = transition(createGame(seed), { type: "roll" }),
      d = dpDecision(s);
    const index = kernel.states.slice(210).findIndex(
      (v) =>
        v.join("") ===
        s.dice
          .map((d) => d.value)
          .sort()
          .join(""),
    );
    expect(d.value).toBeCloseTo(turnValues(4095, 0, 2).values[index], 10);
    expect(d.candidates[0].value).toBe(d.value);
    expect(d.candidates.every((c) => c.value <= d.value + 1e-10)).toBe(true);
  }
});


it("상대 점수가 확정된 초이스 마지막 턴에서 승률 DP가 기대점수 DP와 다른 수를 선택", () => {
  const opponent = Object.fromEntries(categories.map((c) => [c, c === "sixes" ? 24 : 0])) as Card;
  const mine = Object.fromEntries(categories.filter((c) => c !== "choice").map((c) => [c, 0])) as Card;
  const state: Game = { ...createGame(42, true), cards: [opponent, mine], player: 1, round: 12, rolls: 1,
    dice: [1, 4, 5, 6, 6].map((value, id) => ({ id, value, held: false })) };
  const win = winDPDecision(state)!, baseline = dpDecision(state);
  expect(canUseWinDP(state)).toBe(true);
  expect(win.type).toBe("reroll");
  expect(baseline.type).toBe("reroll");
  if (win.type === "reroll" && baseline.type === "reroll") {
    expect(win.ids).toEqual([1, 2, 3, 4]);
    expect(baseline.ids).toEqual([2, 3, 4]);
  }
  expect(win.value).toBeGreaterThanOrEqual(0);
  expect(win.value).toBeLessThanOrEqual(1);
  expect(winDPDecision(state)).toEqual(win);
});
it("상대가 한 칸 남은 경우 DP Expert의 최종 점수 분포를 정규화하고 이용", () => {
  for (const category of ["choice", "sixes", "yacht"] as Category[]) {
    const dist = lastTurnDPDistribution(category, category === "sixes" ? 60 : 0);
    expect(dist.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 10);
    expect(dist.every((p) => p >= 0)).toBe(true);
  }
  const choice = lastTurnDPDistribution("choice", 0);
  const average = choice.reduce((sum, p, score) => sum + score * p, 0);
  expect(average).toBeCloseTo(23.3333333333, 3);
  const after = choice.slice(25).reduce((a, b) => a + b, 0);
  expect(after).toBeGreaterThan(0.38);
  expect(after).toBeLessThan(0.41);
  const mine = Object.fromEntries(categories.filter((c) => c !== "choice").map((c) => [c, 0])) as Card;
  const other = Object.fromEntries(categories.filter((c) => c !== "sixes").map((c) => [c, 0])) as Card;
  const state: Game = { ...createGame(77, true), cards: [mine, other], player: 0, round: 12, rolls: 1,
    dice: [1, 4, 5, 6, 6].map((value, id) => ({ id, value, held: false })) };
  expect(canUseWinDP(state)).toBe(true);
  const d = winDPDecision(state)!;
  expect(d.note).toContain("DP Expert");
  expect(d.value).toBeGreaterThanOrEqual(0);
  expect(d.value).toBeLessThanOrEqual(1);
});
it("남은 라운드가 많은 상태에선 Win DP가 DP Expert와 정확히 동일하게 동작", () => {
  for (const seed of [1, 42, 99]) {
    const state = transition(createGame(seed, true), { type: "roll" });
    expect(canUseWinDP(state)).toBe(false);
    expect(winDPDecision(state)).toBeNull();
  }
});
it("Win DP와 기존 DP Expert의 실제 12라운드 경기가 정상 종료", () => {
  for (const seed of [21, 22, 23, 24]) {
    const match = simulate(seed % 2 ? ["Win DP", "DP Expert"] : ["DP Expert", "Win DP"], seed);
    expect(match.frames.at(-1)!.state.done).toBe(true);
    expect(match.frames.at(-1)!.state.cards.every((c) => Object.keys(c).length === 12)).toBe(true);
    const winDecisions = match.frames.filter((f) => f.decision?.note.includes("마지막 턴 승리 확률"));
    expect(winDecisions.length).toBeGreaterThan(0);
  }
});
