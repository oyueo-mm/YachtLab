/// <reference lib="webworker" />
import { decide, type Algorithm, type Options } from "./ai";
import { simulate, result, type Result } from "./match";
import type { Game } from "./engine";
export type Request =
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
self.onmessage = ({ data: r }: MessageEvent<Request>) => {
  try {
    if (r.type === "decide")
      self.postMessage({
        id: r.id,
        result: decide(r.state, r.algorithm, r.options),
      });
    else if (r.type === "match")
      self.postMessage({
        id: r.id,
        result: simulate(r.algorithms, r.seed, r.options),
      });
    else {
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
