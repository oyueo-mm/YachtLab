import { observe, actionMask } from "./ppo";
import { categories, type Game } from "./engine";
import type { Decision } from "./ai";
export type DistilledName = "Distilled Policy" | "Distilled PPO";
type Model = {
  format: number;
  observationVersion: string;
  observationSize: number;
  actionSize: number;
  steps: number;
  layers: { weight: number[][]; bias: number[] }[];
};
const models: Partial<Record<DistilledName, Model>> = {};
const pending: Partial<Record<DistilledName, Promise<void>>> = {};
export async function loadDistilled(name: DistilledName) {
  if (models[name]) return;
  if (!pending[name])
    pending[name] = (async () => {
      const m = (
        name === "Distilled Policy"
          ? await import("./distilled-policy.json")
          : await import("./distilled-ppo.json")
      ).default;
      let input = 60;
      if (m.layers.length !== 3) throw Error("Invalid model layers");
      for (const layer of m.layers) {
        if (
          layer.weight.length !== layer.bias.length ||
          layer.weight.some(
            (row) =>
              row.length !== input || row.some((w) => !Number.isFinite(w)),
          ) ||
          layer.bias.some((b) => !Number.isFinite(b))
        )
          throw Error("Invalid model dimensions");
        input = layer.bias.length;
      }
      if (input !== 44) throw Error("Invalid model action space");
      models[name] = m;
    })();
  try {
    await pending[name];
  } catch (e) {
    delete pending[name];
    throw e;
  }
}
export function canonicalDice(state: Game) {
  return [...state.dice].sort((a, b) => a.value - b.value || a.id - b.id);
}
export function distilledPolicy(state: Game, name: DistilledName) {
  const model = models[name];
  if (!model) throw Error("Load the distilled policy first");
  if (
    model.format !== 2 ||
    model.observationSize !== 60 ||
    model.actionSize !== 44 ||
    model.observationVersion !== "canonical-sorted-v2"
  )
    throw Error("Unsupported policy schema");
  const sorted = canonicalDice(state);
  let h = observe({ ...state, dice: sorted.map((d, id) => ({ ...d, id })) });
  model.layers.forEach((l, index) => {
    h = l.weight.map((row, i) => {
      const sum = row.reduce((s, w, j) => s + w * h[j], l.bias[i]);
      return index === model.layers.length - 1 ? sum : Math.tanh(sum);
    });
  });
  const mask = actionMask(state),
    max = Math.max(...h.filter((_, i) => mask[i]));
  if (!Number.isFinite(max)) throw Error("No legal action");
  const exp = h.map((v, i) => (mask[i] ? Math.exp(v - max) : 0)),
    sum = exp.reduce((a, b) => a + b, 0);
  return exp.map((v) => v / sum);
}
export function distilledDecision(state: Game, name: DistilledName): Decision {
  const probabilities = distilledPolicy(state, name),
    action = probabilities.indexOf(Math.max(...probabilities)),
    sorted = canonicalDice(state);
  const candidates = probabilities
    .map((value, a) => ({
      value,
      label:
        a >= 32
          ? categories[a - 32]
          : `고정 ${
              sorted
                .filter((_, i) => a & (1 << i))
                .map((d) => d.value)
                .join("·") || "없음"
            }`,
    }))
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value);
  const model = models[name]!;
  const common = {
    value: probabilities[action],
    candidates,
    note: `${name === "Distilled Policy" ? "DP 교사 모방학습" : "모방학습 초기화 + 실제 보상 PPO"} ${model.steps.toLocaleString("ko-KR")}${name === "Distilled Policy" ? "회 업데이트" : " 환경 스텝 체크포인트"} · 마스킹 후 정책 확률`,
  };
  return action >= 32
    ? { type: "score", category: categories[action - 32], ...common }
    : {
        type: "reroll",
        ids: sorted.filter((_, i) => action & (1 << i)).map((d) => d.id),
        ...common,
      };
}
