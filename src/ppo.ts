import model from "./ppo-model.json";
import { categories, available, upper, type Game } from "./engine";
import type { Decision } from "./ai";
export function observe(state: Game) {
  const card = state.cards[state.player];
  return [
    ...[...state.dice]
      .sort((a, b) => a.id - b.id)
      .flatMap((d) => [1, 2, 3, 4, 5, 6].map((v) => Number(d.value === v))),
    ...[0, 1, 2, 3].map((v) => Number(state.rolls === v)),
    ...categories.map((c) => Number(card[c] !== undefined)),
    ...categories.map((c) => (card[c] ?? 0) / 50),
    Math.min(upper(card), 98) / 63,
    available(card).length / 12,
  ];
}
export function actionMask(state: Game) {
  return [
    ...Array(32).fill(state.rolls < 3 && state.rolls > 0),
    ...categories.map((c) => state.cards[state.player][c] === undefined),
  ].map(Boolean);
}
export function policy(state: Game) {
  let hidden = observe(state);
  model.layers.forEach((layer, index) => {
    hidden = layer.weight.map((row, i) => {
      const sum = row.reduce((s, w, j) => s + w * hidden[j], layer.bias[i]);
      return index === model.layers.length - 1 ? sum : Math.tanh(sum);
    });
  });
  const mask = actionMask(state),
    max = Math.max(...hidden.filter((_, i) => mask[i]));
  const weights = hidden.map((v, i) => (mask[i] ? Math.exp(v - max) : 0)),
    sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((v) => v / sum);
}
export function ppoDecision(state: Game): Decision {
  const probabilities = policy(state),
    action = probabilities.indexOf(Math.max(...probabilities));
  const candidates = probabilities
    .map((value, i) => ({
      label:
        i >= 32
          ? categories[i - 32]
          : `고정 ${
              state.dice
                .filter((d) => (i & (1 << d.id)) !== 0)
                .map((d) => d.value)
                .join("·") || "없음"
            }`,
      value,
    }))
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value);
  const common = {
    value: probabilities[action],
    candidates,
    note: `실제 PPO 학습 ${model.steps.toLocaleString("ko-KR")}스텝 · 행동 마스킹 후 정책 확률 · 초기 학습 모델`,
  };
  return action >= 32
    ? { type: "score", category: categories[action - 32], ...common }
    : {
        type: "reroll",
        ids: state.dice
          .filter((d) => (action & (1 << d.id)) !== 0)
          .map((d) => d.id),
        ...common,
      };
}
