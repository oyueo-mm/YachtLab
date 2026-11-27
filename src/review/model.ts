import type { PublicLook } from "../economy/live/catalog";
import manifest from "../dp-manifest.json";
import { names, type Game, type Category } from "../engine";

type Choice = { type: "score"; category: Category } | { type: "reroll"; ids: number[] };

export type Position = Pick<Game, "player" | "cards" | "dice" | "rolls" | "round"> & { simultaneous?: true };

export type Situation = {
  before: Position;
  action: Choice;
  afterRoll?: Position;
  /** Snapshot at the first roll, attached exactly once to the next decision of this turn. */
  firstRoll?: Position;
  automatic?: true;
};

/** Older sequential archives have the first dice and unchanged cards on the first decision. */
export const firstRollPosition = ({ firstRoll, before }: Situation) =>
  firstRoll ?? (before.rolls === 1 && !before.simultaneous ? before : undefined);

export type ReviewMatch = {
  id: string;
  players: [string, string];
  looks?: [PublicLook | undefined, PublicLook | undefined];
  scores: [number, number];
  winners: (0 | 1)[];
  /** The viewer's seat when known (online: the server's `you`; AI games: the human seat). */
  me?: 0 | 1;
  device?: true;
  /** 1인 플레이: one player; seat 1 is empty and only expected score is analysed. */
  solo?: true;
  steps: Situation[];
  unpairedFirstRolls?: Position[];
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
  firstLuck?: number;
  firstWinLuck?: number;
  winLuck?: number;
  preRollValue?: number;
  preRollScore?: number;
  exactness?: "exact" | "estimate";
  distribution?: { difference: number; mass: number }[];
};

export const reviewAlgorithmVersion = "yachtlab-review-c2.1";
export const reviewModel = { name: "DP Expert · 정확 종반", version: "dp-expert-exact-1:" + manifest.asset } as const;

export const productReviewModel = { name: "v5-R 단일 은행 · 정확 종반 · 분석 API v6", version: "v5-r-wasm-f32.1:analysis-v6-exact-1:" + manifest.asset };

export type OpeningAssessment = Pick<Assessment, "preRollScore" | "preRollValue" | "firstLuck" | "firstWinLuck" | "exactness">;
export type ReviewInput = { steps: Situation[]; unpairedFirstRolls?: Position[] };
export type ReviewResults = { values: Assessment[]; openings: OpeningAssessment[] };

export type ReviewEvent =
  | { type: "progress"; completed: number }
  | ({ type: "done" } & ReviewResults)
  | { type: "error"; message: string };

export function actionName(action: Choice, position: Position) {
  if (action.type === "score") return names[action.category];
  const dice = position.dice.filter((die) => action.ids.includes(die.id)).map((die) => die.value);
  return dice.length ? `${dice.join(" · ")} 킵 후 재굴림` : "모두 재굴림";
}
