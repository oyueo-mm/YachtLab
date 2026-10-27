import {
  available,
  bonus,
  categories,
  random,
  score,
  upper,
  type Card,
  type Category,
  type Game,
} from "./engine";
import { ppoDecision } from "./ppo";
import { dpDecision } from "./dp";
import { distilledDecision } from "./distilled";
import distilledStatus from "./distilled-status.json";
const allAlgorithms = [
  "Random",
  "Greedy",
  "Expectimax",
  "MCTS",
  "PPO",
  "DP Expert",
  "Distilled Policy",
  "Distilled PPO",
] as const;
export type Algorithm = (typeof allAlgorithms)[number];
export const algorithms = allAlgorithms.filter((a) =>
  a === "Distilled Policy" || a === "Distilled PPO" ? distilledStatus[a] : true,
);
export type Candidate = { label: string; value: number; visits?: number };
export type Decision =
  | {
      type: "score";
      category: Category;
      value: number;
      candidates: Candidate[];
      note: string;
    }
  | {
      type: "reroll";
      ids: number[];
      value: number;
      candidates: Candidate[];
      note: string;
    };
export type Options = { iterations?: number; seed?: number };
type Hold = { values: number[]; ids: number[] };
export function holds(values: number[]): number[][] {
  const result: number[][] = [];
  function visit(face: number, held: number[]) {
    if (face === 7) {
      result.push(held);
      return;
    }
    const n = values.filter((v) => v === face).length;
    for (let k = 0; k <= n; k++)
      visit(face + 1, [...held, ...Array(k).fill(face)]);
  }
  visit(1, []);
  return result;
}
const outcomeCache = new Map<number, { values: number[]; p: number }[]>();
const factorial = [1, 1, 2, 6, 24, 120];
export function outcomes(n: number) {
  if (outcomeCache.has(n)) return outcomeCache.get(n)!;
  const result: { values: number[]; p: number }[] = [];
  function visit(start: number, values: number[]) {
    if (values.length === n) {
      const counts = Array(7).fill(0);
      values.forEach((v) => counts[v]++);
      result.push({
        values,
        p: factorial[n] / counts.reduce((a, c) => a * factorial[c], 1) / 6 ** n,
      });
      return;
    }
    for (let v = start; v <= 6; v++) visit(v, [...values, v]);
  }
  visit(1, []);
  outcomeCache.set(n, result);
  return result;
}
// A turn-optimal search under this approximate terminal utility, not a full-game solution.
export function utility(
  values: number[],
  category: Category,
  card: Card,
  strategic: boolean,
) {
  const points = score(values, category);
  if (!strategic) return points;
  const index = categories.indexOf(category),
    remaining = available(card).length;
  // Opportunity cost prevents consuming rare high-value categories for small gains.
  const baseline = [2, 4, 6, 8, 10, 12, 18, 12, 10, 11, 16, 12][index];
  let value = points - (baseline * (remaining - 1)) / 11;
  if (index < 6 && upper(card) < 63) {
    const next = { ...card, [category]: points };
    value += bonus(next) - bonus(card);
    if (!bonus(next)) value += Math.min(points, 63 - upper(card)) * 0.35;
  }
  return value;
}
function terminal(values: number[], card: Card, strategic: boolean) {
  return available(card)
    .map((category) => ({
      category,
      value: utility(values, category, card, strategic),
    }))
    .sort((a, b) => b.value - a.value)[0];
}
function holdIds(state: Game, values: number[]): number[] {
  const left = [...values];
  return state.dice
    .filter((d) => {
      const i = left.indexOf(d.value);
      if (i < 0) return false;
      left.splice(i, 1);
      return true;
    })
    .map((d) => d.id);
}
function holdOptions(state: Game): Hold[] {
  return holds(state.dice.map((d) => d.value))
    .filter((v) => v.length < 5)
    .map((values) => ({ values, ids: holdIds(state, values) }));
}
export function decide(
  state: Game,
  algorithm: Algorithm,
  options: Options = {},
): Decision {
  if (state.done || !state.rolls)
    throw Error("AI 판단에는 굴린 주사위가 필요합니다.");
  if (algorithm === "PPO") return ppoDecision(state);
  if (algorithm === "DP Expert") return dpDecision(state);
  if (algorithm === "Distilled Policy" || algorithm === "Distilled PPO")
    return distilledDecision(state, algorithm);
  const card = state.cards[state.player],
    values = state.dice.map((d) => d.value),
    left = 3 - state.rolls;
  let seed = (options.seed ?? state.rng[state.player] ^ 0x9e3779b9) >>> 0;
  const rng = () => {
    const [r, n] = random(seed);
    seed = n;
    return r;
  };
  if (algorithm === "Random") {
    if (!left || rng() < 0.3) {
      const choices = available(card),
        category = choices[Math.floor(rng() * choices.length)];
      return {
        type: "score",
        category,
        value: score(values, category),
        candidates: [],
        note: "합법적인 점수 선택과 재굴림 중 무작위 선택",
      };
    }
    return {
      type: "reroll",
      ids: state.dice.filter(() => rng() < 0.5).map((d) => d.id),
      value: 0,
      candidates: [],
      note: "각 주사위를 독립 확률 50%로 고정",
    };
  }
  const strategic = algorithm !== "Greedy",
    best = terminal(values, card, strategic);
  if (!left)
    return {
      type: "score",
      ...best,
      candidates: available(card).map((c) => ({
        label: c,
        value: utility(values, c, card, strategic),
      })),
      note: strategic
        ? "기회비용과 상단 보너스를 반영한 근사 효용"
        : "현재 얻는 점수가 가장 큰 카테고리",
    };
  if (algorithm === "MCTS") return mcts(state, options, rng);
  const memo = new Map<string, number>();
  function search(v: number[], rolls: number): number {
    const key = [...v].sort().join("") + ":" + rolls;
    if (memo.has(key)) return memo.get(key)!;
    let value = terminal(v, card, strategic).value;
    if (rolls > 0)
      for (const held of holds(v))
        if (held.length < 5) {
          let e = 0;
          for (const o of outcomes(5 - held.length))
            e += o.p * search([...held, ...o.values], rolls - 1);
          value = Math.max(value, e);
        }
    memo.set(key, value);
    return value;
  }
  const depth = algorithm === "Greedy" ? 1 : left;
  const ranked = holdOptions(state)
    .map((h) => ({
      ...h,
      value: outcomes(5 - h.values.length).reduce(
        (s, o) => s + o.p * search([...h.values, ...o.values], depth - 1),
        0,
      ),
    }))
    .sort((a, b) => b.value - a.value);
  const candidates = [
    { label: best.category, value: best.value },
    ...ranked.map((h) => ({
      label: `고정 ${h.values.join("·") || "없음"}`,
      value: h.value,
    })),
  ].sort((a, b) => b.value - a.value);
  const note =
    algorithm === "Greedy"
      ? "한 번의 재굴림 기댓점수와 즉시 점수를 비교"
      : "남은 굴림을 모두 탐색한 근사 효용의 기댓값 (전체 경기 최적해 아님)";
  return ranked[0].value > best.value + 1e-9
    ? {
        type: "reroll",
        ids: ranked[0].ids,
        value: ranked[0].value,
        candidates,
        note,
      }
    : { type: "score", ...best, candidates, note };
}
type Node = {
  values: number[];
  left: number;
  visits: number;
  sum: number;
  edges: Edge[];
};
type Edge = {
  held?: number[];
  category?: Category;
  visits: number;
  sum: number;
  children: Map<string, Node>;
};
function mcts(state: Game, options: Options, rng: () => number): Decision {
  const card = state.cards[state.player];
  const make = (values: number[], left: number): Node => ({
    values,
    left,
    visits: 0,
    sum: 0,
    edges: [
      ...available(card).map((category) => ({
        category,
        visits: 0,
        sum: 0,
        children: new Map<string, Node>(),
      })),
      ...(left
        ? holds(values)
            .filter((h) => h.length < 5)
            .map((held) => ({
              held,
              visits: 0,
              sum: 0,
              children: new Map<string, Node>(),
            }))
        : []),
    ],
  });
  const sample = (held: number[]) => [
    ...held,
    ...Array.from({ length: 5 - held.length }, () => 1 + Math.floor(rng() * 6)),
  ];
  function rollout(values: number[], left: number): number {
    if (!left) return terminal(values, card, true).value;
    const counts = values.map((v) => values.filter((x) => x === v).length);
    const max = Math.max(...counts);
    const target = values[counts.indexOf(max)];
    const held = values.filter((v) => v === target);
    return rollout(sample(held), left - 1);
  }
  function visit(node: Node): number {
    const unvisited = node.edges.filter((e) => !e.visits);
    const edge = unvisited.length
      ? unvisited[Math.floor(rng() * unvisited.length)]
      : node.edges.reduce((a, b) =>
          a.sum / a.visits / 85 +
            Math.sqrt((2 * Math.log(node.visits)) / a.visits) >
          b.sum / b.visits / 85 +
            Math.sqrt((2 * Math.log(node.visits)) / b.visits)
            ? a
            : b,
        );
    let value: number;
    if (edge.category) value = utility(node.values, edge.category, card, true);
    else {
      const values = sample(edge.held!),
        key = [...values].sort().join("");
      let child = edge.children.get(key);
      if (child) value = visit(child);
      else {
        child = make(values, node.left - 1);
        edge.children.set(key, child);
        value = rollout(values, child.left);
        child.visits++;
        child.sum += value;
      }
    }
    node.visits++;
    node.sum += value;
    edge.visits++;
    edge.sum += value;
    return value;
  }
  const root = make(
      state.dice.map((d) => d.value),
      3 - state.rolls,
    ),
    iterations = Math.max(
      root.edges.length,
      Math.min(50000, Math.floor(options.iterations ?? 600)),
    );
  for (let i = 0; i < iterations; i++) visit(root);
  const ranked = [...root.edges].sort(
      (a, b) => b.visits - a.visits || b.sum / b.visits - a.sum / a.visits,
    ),
    edge = ranked[0];
  const candidates = ranked.map((e) => ({
    label: e.category ?? `고정 ${e.held!.join("·") || "없음"}`,
    value: e.sum / e.visits,
    visits: e.visits,
  }));
  const common = {
    value: edge.sum / edge.visits,
    candidates,
    note: `UCT 탐색 ${iterations}회 · 표본 평균 근사 효용 · 가장 많이 방문한 행동 선택`,
  };
  return edge.category
    ? { type: "score", category: edge.category, ...common }
    : { type: "reroll", ids: holdIds(state, edge.held!), ...common };
}
