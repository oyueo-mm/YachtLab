import type { PublicLook } from "../economy/live/catalog";
import { names, type Game, type Category } from "../engine";

type Choice = { type: "score"; category: Category } | { type: "reroll"; ids: number[] };

export type Position = Pick<Game, "player" | "cards" | "dice" | "rolls" | "round"> & { simultaneous?: true };

export type Situation = {
  before: Position;
  action: Choice;
  afterRoll?: Position;
};

export type ReviewMatch = {
  id: string;
  players: [string, string];
  looks?: [PublicLook | undefined, PublicLook | undefined];
  scores: [number, number];
  winners: (0 | 1)[];
  device?: true;
  steps: Situation[];
};

export type Value = {
  action: Choice;
  expected: number;
  winCredit?: number;
  winExpected?: number;
  winOutcomes?: { win: number; tie: number; loss: number };
};

export type Assessment = {
  index: number;
  options: Value[];
  actual: Value;
  loss: number;
  luck?: number;
  winLuck?: number;
  preRollValue?: number;
  exactness?: "exact" | "estimate";
  distribution?: { difference: number; mass: number }[];
};

export const reviewModel = { name: "DP Expert 기대점수 · Win DP v5 종반 승리점수율", version: "yachtlab-review-v2" } as const;

export const productReviewModel = { name: "v5-R 단일 은행 · 정확 종반 · 분석 API v6", version: "yachtlab-analysis-v6.1-wasm-f32" };

export type ReviewEvent =
  | { type: "progress"; completed: number }
  | { type: "done"; values: Assessment[] }
  | { type: "error"; message: string };

export function actionName(action: Choice, position: Position) {
  if (action.type === "score") return names[action.category];
  const dice = position.dice.filter((die) => action.ids.includes(die.id)).map((die) => die.value);
  return dice.length ? `${dice.join(" · ")} 킵 후 재굴림` : "모두 재굴림";
}
