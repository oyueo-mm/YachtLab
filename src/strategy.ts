import { decide, type Algorithm, type Decision, type Options } from "./ai";
import { dpActionValues, dpDecision, choiceIndex, type Choice } from "./dp";
import type { Game } from "./engine";
export type Comparison = {
  best: number;
  optimal: Decision;
  rows: {algorithm: Algorithm; decision: Decision; ms: number; q: number; loss: number}[];
  actual?: {choice: Choice; q: number; loss: number; sameChoice: boolean};
};
export function compareStrategies(state: Game, algorithms: Algorithm[], options?: Options, actual?: Choice): Comparison {
  const q = dpActionValues(state), best = Math.max(...q), optimal = dpDecision(state);
  const signature = (c:Choice) => c.type === 'score' ? c.category : c.ids.map(id=>state.dice[id].value).sort().join(',');
  const evaluate = (choice: Choice) => {
    const value = q[choiceIndex(choice)];
    if (!Number.isFinite(value)) throw Error("분석할 수 없는 불법 행동입니다.");
    return {q: value, loss: Math.max(0, best - value)};
  };
  const rows = algorithms.map(algorithm => {
    const start = performance.now(), decision = decide(state, algorithm, options), ms = performance.now() - start;
    return {algorithm, decision, ms, ...evaluate(decision)};
  }).sort((a,b) => a.loss - b.loss);
  return {best, optimal, rows, ...(actual ? {actual:{choice:actual, sameChoice:actual.type === optimal.type && signature(actual) === signature(optimal), ...evaluate(actual)}} : {})};
}
