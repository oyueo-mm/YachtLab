/// <reference lib="webworker" />
import { decide, type Algorithm, type Options } from "./ai";
import { simulate, simulateFromState, result, type Result } from "./match";
import { validateGameShape } from "./replay";
import type { Game } from "./engine";
import { loadDP } from "./dp";
import { compareStrategies } from "./strategy";
import type { Choice } from "./dp";
import { loadDistilled } from "./distilled";
export type Request =
  | {
      id: number;
      type: "compare";
      state: Game;
      algorithms: Algorithm[];
      options?: Options;
      actual?: Choice;
    }
  | {
      id: number;
      type: "decide";
      state: Game;
      algorithm: Algorithm;
      options?: Options;
    }
  | {
      id: number;
      type: "match";
      algorithms: [Algorithm, Algorithm];
      seed: number;
      initialState?: Game;
      pendingRoll?: boolean;
      options?: Options;
    }
  | {
      id: number;
      type: "tournament";
      algorithms: Algorithm[];
      games: number;
      seed: number;
      options?: Options;
    };
self.onmessage = async ({ data: r }: MessageEvent<Request>) => {
  try {
    const needsDP =
      r.type === "compare" ||
      (r.type === "decide"
        ? r.algorithm === "DP Expert"
        : r.algorithms.includes("DP Expert"));
    if (needsDP) await loadDP();
    const selected = r.type === "decide" ? [r.algorithm] : r.algorithms;
    await Promise.all(
      selected.map((a) =>
        a === "Distilled Policy" || a === "Distilled PPO"
          ? loadDistilled(a)
          : undefined,
      ),
    );
    if (r.type === "compare")
      self.postMessage({
        id: r.id,
        result: compareStrategies(r.state, r.algorithms, r.options, r.actual),
      });
    else if (r.type === "decide")
      self.postMessage({
        id: r.id,
        result: decide(r.state, r.algorithm, r.options),
      });
    else if (r.type === "match") {
      if (r.initialState) validateGameShape(r.initialState);
      self.postMessage({
        id: r.id,
        result: r.initialState
          ? simulateFromState(
              r.initialState,
              r.algorithms,
              r.options,
              r.pendingRoll,
            )
          : simulate(r.algorithms, r.seed, r.options),
      });
    } else {
      const results: Result[] = [],
        pairs: [Algorithm, Algorithm][] = [];
      for (let i = 0; i < r.algorithms.length; i++)
        for (let j = i + 1; j < r.algorithms.length; j++)
          pairs.push([r.algorithms[i], r.algorithms[j]]);
      if (!pairs.length || r.games < 1 || r.games > 500)
        throw Error("AI 2개 이상, 경기 수 1~500을 선택해주세요.");
      const count = pairs.length * r.games;
      for (let game = 0; game < r.games; game++)
        for (const pair of pairs) {
          const match = simulate(
            game % 2 ? [pair[1], pair[0]] : pair,
            (r.seed + game) >>> 0,
            r.options,
          );
          results.push(result(match));
          self.postMessage({
            id: r.id,
            progress: results.length / count,
            results,
          });
        }
      self.postMessage({ id: r.id, result: results });
    }
  } catch (e) {
    self.postMessage({
      id: r.id,
      error: e instanceof Error ? e.message : String(e),
    });
  }
};
