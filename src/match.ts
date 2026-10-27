import {
  createGame,
  transition,
  total,
  bonus,
  type Game,
  type Action,
} from "./engine";
import { decide, type Algorithm, type Decision, type Options } from "./ai";
export type Frame = {
  state: Game;
  action: Action | null;
  decision?: Decision;
  actor: 0 | 1;
  label: string;
  actorName?: string;
};
export type Match = {
  seed: number;
  algorithms: [Algorithm, Algorithm];
  frames: Frame[];
  elapsed: [number, number];
};
export function simulate(
  algorithms: [Algorithm, Algorithm],
  seed: number,
  options: Options = {},
): Match {
  return simulateFromState(createGame(seed), algorithms, options);
}
export function simulateFromState(
  initialState: Game,
  algorithms: [Algorithm, Algorithm],
  options: Options = {},
  pendingRoll = false,
): Match {
  let state = structuredClone(initialState);
  const seed = state.seed;
  const frames: Frame[] = [
      { state, action: null, actor: state.player, label: "경기 준비" },
    ],
    elapsed: [number, number] = [0, 0];
  const push = (action: Action, label: string, decision?: Decision) => {
    const actor = state.player;
    state = transition(state, action);
    frames.push({ state, action, actor, label, decision });
  };
  if (pendingRoll && !state.done) {
    if (state.rolls < 1 || state.rolls >= 3)
      throw Error("이어갈 재굴림이 없습니다.");
    push({ type: "roll" }, "고정 상태를 유지한 재굴림");
  }
  while (!state.done) {
    if (!state.rolls) {
      push({ type: "roll" }, "첫 번째 굴림");
      continue;
    }
    const actor = state.player,
      start = performance.now(),
      d = decide(state, algorithms[actor], options);
    elapsed[actor] += performance.now() - start;
    if (d.type === "score")
      push({ type: "score", category: d.category }, "점수 기록", d);
    else {
      push({ type: "hold", ids: d.ids }, "주사위 고정", d);
      push({ type: "roll" }, "다시 굴리기");
    }
    if (frames.length > 220) throw Error("경기 행동 제한 초과");
  }
  return { seed, algorithms, frames, elapsed };
}
export type Result = {
  algorithms: [Algorithm, Algorithm];
  seed: number;
  scores: [number, number];
  bonuses: [boolean, boolean];
  yachts: [boolean, boolean];
  elapsed: [number, number];
};
export function result(match: Match): Result {
  const state = match.frames.at(-1)!.state;
  return {
    algorithms: match.algorithms,
    seed: match.seed,
    scores: [total(state.cards[0]), total(state.cards[1])],
    bonuses: [bonus(state.cards[0]) > 0, bonus(state.cards[1]) > 0],
    yachts: [state.cards[0].yacht === 50, state.cards[1].yacht === 50],
    elapsed: match.elapsed,
  };
}
export function statistics(results: Result[], algorithm: Algorithm) {
  const rows = results.flatMap((r) =>
    r.algorithms.flatMap((a, i) =>
      a === algorithm
        ? [
            {
              score: r.scores[i],
              win:
                r.scores[i] > r.scores[1 - i]
                  ? 1
                  : r.scores[i] === r.scores[1 - i]
                    ? 0.5
                    : 0,
              bonus: r.bonuses[i],
              yacht: r.yachts[i],
              ms: r.elapsed[i],
            },
          ]
        : [],
    ),
  );
  if (!rows.length) return null;
  const scores = rows.map((r) => r.score).sort((a, b) => a - b),
    n = scores.length,
    mean = scores.reduce((a, b) => a + b, 0) / n;
  return {
    n,
    mean,
    median: n % 2 ? scores[n >> 1] : (scores[n / 2 - 1] + scores[n / 2]) / 2,
    min: scores[0],
    max: scores[n - 1],
    sd: Math.sqrt(scores.reduce((s, v) => s + (v - mean) ** 2, 0) / n),
    win: rows.reduce((s, r) => s + r.win, 0) / n,
    bonus: rows.filter((r) => r.bonus).length / n,
    yacht: rows.filter((r) => r.yacht).length / n,
    ms: rows.reduce((s, r) => s + r.ms, 0) / n,
  };
}
