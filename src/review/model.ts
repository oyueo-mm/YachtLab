import type { Choice } from "../dp";
import { names, type Game } from "../engine";

export type Position = Pick<Game, "player" | "cards" | "dice" | "rolls" | "round"> & { simultaneous?: true };

export type Situation = {
  before: Position;
  action: Choice;
  afterRoll?: Position;
};

export type ReviewMatch = {
  id: string;
  players: [string, string];
  scores: [number, number];
  winners: (0 | 1)[];
  device?: true;
  steps: Situation[];
};

export type Value = {
  action: Choice;
  expected: number;
  winCredit?: number;
};

export type Assessment = {
  index: number;
  options: Value[];
  actual: Value;
  loss: number;
  luck?: number;
  distribution?: { difference: number; mass: number }[];
};

export const reviewModel = { name: "DP Expert · 기대 최종점수", version: "yachtlab-dp-review-v1" } as const;

export type ReviewEvent =
  | { type: "progress"; completed: number }
  | { type: "done"; values: Assessment[] }
  | { type: "error"; message: string };

export function actionName(action: Choice, position: Position) {
  if (action.type === "score") return names[action.category];
  const dice = position.dice.filter((die) => action.ids.includes(die.id)).map((die) => die.value);
  return dice.length ? `${dice.join(" · ")} 킵 후 재굴림` : "모두 재굴림";
}
