import type { Card, Category } from "../../engine";

/**
 * 오늘의 전략 퍼즐 (LIVE-1). Questions are generated OFFLINE (scripts/daily/generate-puzzles.ts) with
 * the existing DP engine; the Worker only looks answers up. Clients receive `PuzzleQuestion` — the
 * answer key (`PuzzleKey`) stays on the server until the player has answered or the day is closed.
 */
export type PuzzleLevel = "intro" | "normal" | "advanced";
export const LEVELS: readonly PuzzleLevel[] = ["intro", "normal", "advanced"];
export const LEVEL_NAMES: Record<PuzzleLevel, string> = { intro: "입문", normal: "보통", advanced: "고급" };

export type PuzzleKind = "keep" | "reroll" | "category" | "expected" | "win" | "bonus" | "comeback" | "protect" | "replay" | "probability";
export const KINDS: readonly PuzzleKind[] = ["keep", "reroll", "category", "expected", "win", "bonus", "comeback", "protect", "replay", "probability"];
export const KIND_NAMES: Record<PuzzleKind, string> = {
  keep: "킵 판단", reroll: "멈출까, 굴릴까", category: "기록할 족보", expected: "기대점수 최대화", win: "승리 확률 최대화",
  bonus: "상단 보너스 전략", comeback: "역전 전략", protect: "리드 지키기", replay: "대국 기보 문제", probability: "확률 문제",
};

/** Objective of the values in the key: expected final total (points), win probability (draw = ½), or a probability question. */
export type Objective = "expected" | "win" | "probability";

export type PuzzlePosition = {
  card: Card;
  dice: number[];
  /** Rerolls still allowed this turn (0 = must record now). */
  rollsLeft: number;
  round: number;
  /** Win puzzles: the opponent has finished with this total. Replay puzzles: the opponent's card at that moment. */
  opponent?: { total: number; finished: boolean; card?: Card };
};

/**
 * Canonical action keys. Turn puzzles: "k:" + kept faces ascending joined by "" ("k:" = reroll all,
 * "k:3346" = keep 3,3,4,6) or "s:<category>". Probability puzzles: "o:<choice id>".
 */
export type ActionKey = string;
export const keepKey = (faces: readonly number[]) => "k:" + [...faces].sort((a, b) => a - b).join("");
export const scoreKey = (c: Category) => "s:" + c;

export type PuzzleQuestion = {
  id: string;
  level: PuzzleLevel;
  kind: PuzzleKind;
  objective: Objective;
  title: string;
  prompt: string;
  position?: PuzzlePosition;
  choices?: { id: string; label: string }[];
  /** "exact": computed exactly under the stated model. "estimate": sampled (with an interval). */
  method: "exact" | "estimate";
  source: string;
};

export type ValuedAction = { key: ActionKey; label: string; value: number };
export type PuzzleKey = {
  /** All optimal actions (within EPS of the best). Any of them is correct. */
  best: ActionKey[];
  /** Every legal action with its value, best first. */
  values: ValuedAction[];
  unit: "점" | "%";
  /** Short reasoning lines, generated from the exact numbers. */
  explanation: string[];
  /** For win puzzles: the expected-score values of the same actions (to show the difference of goals). */
  expected?: ValuedAction[];
  model: string;
};
export type Puzzle = PuzzleQuestion & { key: PuzzleKey; fingerprint: string };

export type PuzzleBank = {
  format: 1;
  rules: string;
  generator: { version: string; seed: number; dpSha256: string; generatedFrom: string };
  epoch: string;
  schedule: Record<string, string[]>;
  reserve: Record<PuzzleLevel, string[]>;
  puzzles: Record<string, Puzzle>;
};

export const EPS = 1e-9;

export type PuzzleResult = {
  puzzleId: string;
  answer: ActionKey;
  correct: boolean;
  /** Value of the answer and the best value (same unit as the key). */
  value: number | null;
  bestValue: number;
  /** best - value (0 when correct). */
  loss: number | null;
  at: number;
};

/** Grade an answer against a key (all optimal actions are correct). */
export function grade(key: PuzzleKey, answer: ActionKey): { correct: boolean; value: number | null; bestValue: number; loss: number | null } | null {
  const hit = key.values.find((v) => v.key === answer);
  const bestValue = key.values[0].value;
  if (!hit) return null;
  const correct = key.best.includes(answer) || hit.value >= bestValue - EPS;
  return { correct, value: hit.value, bestValue, loss: correct ? 0 : bestValue - hit.value };
}

/** What a client may see before answering. */
export const questionOf = (p: Puzzle): PuzzleQuestion => ({
  id: p.id, level: p.level, kind: p.kind, objective: p.objective, title: p.title, prompt: p.prompt,
  ...(p.position ? { position: p.position } : {}), ...(p.choices ? { choices: p.choices } : {}), method: p.method, source: p.source,
});
