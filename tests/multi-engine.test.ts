import { describe, expect, it } from "vitest";
import { available, createGame, total } from "../src/engine";
import { createMultiGame, multiStandings, transitionMulti } from "../src/multi-engine";
import { appendMultiAction, newMultiReplay, parseMultiReplay, replaySeek, validateMultiReplay } from "../src/multi-replay";
import { appendFrame, newReplay } from "../src/replay";

function finish(n: number, seed = 103) {
  const players = Array.from({ length: n }, (_, i) => ({ type: "human" as const, name: "P" + (i + 1) }));
  let replay = newMultiReplay(createMultiGame(n, seed), players);
  for (let turn = 0; turn < n * 12; turn++) {
    const before = replay.finalState;
    expect(before.player).toBe(turn % n);
    expect(before.round).toBe(Math.floor(turn / n) + 1);
    replay = appendMultiAction(replay, { type: "roll" });
    const category = available(replay.finalState.cards[before.player])[0];
    replay = appendMultiAction(replay, { type: "score", category });
  }
  return replay;
}

describe("N명 로컬 요트 규칙", () => {
  it.each([2, 3, 4, 9, 50])("%i명에서 12라운드 완주, 정확한 순환과 우승 순위", (n) => {
    const replay = finish(n);
    expect(replay.finalState.done).toBe(true);
    expect(replay.finalState.cards).toHaveLength(n);
    expect(replay.finalState.round).toBe(12);
    const points = replay.finalState.cards.map(total);
    const high = Math.max(...points);
    expect(replay.finalState.winners).toEqual(points.flatMap((v, i) => v === high ? [i] : []));
    expect(replay.actions).toHaveLength(n * 24);
    expect(multiStandings(replay.finalState).every((p) => p.finished === 12)).toBe(true);
    const parsed = parseMultiReplay(JSON.stringify(replay));
    expect(parsed.finalState).toEqual(replay.finalState);
    const seek = replaySeek(parsed);
    expect(seek(0).round).toBe(1);
    expect(seek(37).actions).toBeLessThanOrEqual(37);
    expect(seek(replay.actions.length)).toEqual(replay.finalState);
  });
  it("서로 다른 참가자에게 중복되지 않는 PRNG 초기 상태를 배정하고 동일 시드 재현성을 유지", () => {
    for (const seed of [0, 1, 103, 0xffffffff]) {
      const first = createMultiGame(50, seed);
      const second = createMultiGame(50, seed);
      expect(first.rng).toEqual(second.rng);
      expect(new Set(first.rng).size).toBe(50);
      expect(new Set(createMultiGame(50, seed, true).rng).size).toBe(1);
    }
    let state = createMultiGame(4, 20261109);
    const sequences: string[] = [];
    for (let i = 0; i < 4; i++) {
      state = transitionMulti(state, { type: "roll" });
      sequences.push(state.dice.map((die) => die.value).join(","));
      state = transitionMulti(state, { type: "score", category: "aces" });
    }
    expect(new Set(sequences).size).toBeGreaterThan(1);
  });
  it("이전 다인전 v1 기보의 동일 시드 결과를 정확히 불러와 재생", () => {
    let legacy = newMultiReplay(createMultiGame(3, 531, true), Array.from({ length: 3 }, (_, i) => ({ type: "human", name: "P" + i })));
    legacy.version = 1;
    legacy.metadata.ruleVersion = "YachtLab-12-multi-v1";
    for (let i = 0; i < 3; i++) {
      legacy = appendMultiAction(legacy, { type: "roll" });
      legacy = appendMultiAction(legacy, { type: "score", category: "choice" });
    }
    const parsed = parseMultiReplay(JSON.stringify(legacy));
    expect(parsed.version).toBe(1);
    expect(replaySeek(parsed)(parsed.actions.length)).toEqual(legacy.finalState);
    expect(parsed.finalState.rng).toEqual(legacy.finalState.rng);
  });
  it("새 다인전 기보는 버전 2를 사용", () => {
    const replay = finish(4);
    expect(replay.version).toBe(2);
    expect(replay.metadata.ruleVersion).toBe("YachtLab-12-multi-v2");
  });
  it("주사위 고정과 순서 변경은 현재 플레이어 RNG만 변경", () => {
    let s = transitionMulti(createMultiGame(5, 17), { type: "roll" });
    const rng0 = s.rng.slice();
    s = transitionMulti(s, { type: "hold", ids: [0, 1] });
    s = transitionMulti(s, { type: "order", ids: [4, 3, 2, 1, 0] });
    expect(s.rng).toEqual(rng0);
    const held = s.dice.slice(0, 2).map((d) => d.value);
    s = transitionMulti(s, { type: "roll" });
    expect(s.dice.slice(0, 2).map((d) => d.value)).toEqual(held);
    expect(s.rng.slice(1)).toEqual(rng0.slice(1));
    expect(() => transitionMulti(s, { type: "order", ids: [0, 0, 1, 2, 3] })).toThrow();
  });
  it("변조된 기보 상태·행동 및 제한 초과를 거부", () => {
    const replay = finish(3);
    const corrupt = JSON.parse(JSON.stringify(replay));
    corrupt.finalState.rng[0]++;
    expect(() => validateMultiReplay(corrupt)).toThrow();
    const illegal = JSON.parse(JSON.stringify(replay));
    illegal.actions[0] = { type: "score", category: "aces" };
    expect(() => validateMultiReplay(illegal)).toThrow();
    expect(() => createMultiGame(1, 1)).toThrow();
    expect(() => parseMultiReplay("x".repeat(4 * 1024 * 1024 + 1))).toThrow();
  });
  it("기존 v1 2인 기보를 새 뷰어가 불러올 수 있고 두 엔진은 같은 시드를 재현", () => {
    let legacy = newReplay(createGame(555), [{ type: "human", name: "갑" }, { type: "human", name: "을" }]);
    for (let i = 0; i < 4; i++) {
      legacy = appendFrame(legacy, { type: "roll" });
      legacy = appendFrame(legacy, { type: "score", category: available(legacy.finalState.cards[legacy.finalState.player])[0] });
    }
    const converted = parseMultiReplay(JSON.stringify(legacy));
    expect(converted.metadata.players.map((x) => x.name)).toEqual(["갑", "을"]);
    expect(converted.actions).toHaveLength(8);
    expect(converted.finalState.cards).toEqual(legacy.finalState.cards);
    expect(converted.finalState.dice).toEqual(legacy.finalState.dice);
    expect(converted.finalState.rng).toEqual(legacy.finalState.rng);
  });
});
