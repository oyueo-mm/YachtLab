import { available, categories, score, total, upper, type Card, type Category } from "../engine";
import { DAILY_RULES } from "./calendar";
import { tapeFaces, type DayKey } from "./tape";

/**
 * Server-authoritative daily game (one player, the regular 12-category Yacht Dice).
 *
 * Steps (what a client may ask for):
 *   { t: "roll", keep }   keep = bitmask of die slots to hold (0 on the turn's first roll)
 *   { t: "score", c }     record category c with the current dice
 *
 * The client never sends dice or points. After a "score" the server also performs the next turn's
 * first roll (a forced action, no decision), which saves one request per turn; the page reveals it
 * when the player presses "roll". A full game is 13..37 accepted steps.
 */
export type DailyStep = { t: "roll"; keep: number } | { t: "score"; c: Category };
export type DailyState = {
  v: 1;
  date: string;
  rules: typeof DAILY_RULES;
  /** 1..12; 13 once done. */
  round: number;
  /** Rolls used this turn (0..3). After a score the next turn's first roll is already made: rolls = 1. */
  rolls: number;
  dice: number[];
  /** Hold mask that produced the current dice (UI only). */
  keep: number;
  card: Card;
  log: DailyStep[];
  done: boolean;
};

export const MAX_STEPS = 1 + 12 * 3; // first roll + per turn (2 rerolls + score, the score includes the next first roll)

export function newDailyState(date: string, key: DayKey): DailyState {
  return { v: 1, date, rules: DAILY_RULES, round: 1, rolls: 1, dice: tapeFaces(key, 1, 1), keep: 0, card: {}, log: [{ t: "roll", keep: 0 }], done: false };
}

export class DailyRuleError extends Error {
  constructor(readonly code: "DONE" | "NO_ROLLS" | "BAD_KEEP" | "TAKEN" | "BAD_STEP", message: string) {
    super(message);
  }
}

/** Validate an untrusted step (shape only). */
export function parseStep(raw: unknown): DailyStep | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.t === "roll" && Number.isInteger(r.keep) && (r.keep as number) >= 0 && (r.keep as number) < 32) return { t: "roll", keep: r.keep as number };
  if (r.t === "score" && typeof r.c === "string" && (categories as readonly string[]).includes(r.c)) return { t: "score", c: r.c as Category };
  return null;
}

export const sameStep = (a: DailyStep, b: DailyStep) => a.t === b.t && (a.t === "roll" ? a.keep === (b as typeof a).keep : a.c === (b as { c: Category }).c);

/** Apply one step. Pure: returns a new state, throws DailyRuleError for an illegal step. */
export function applyStep(state: DailyState, step: DailyStep, key: DayKey): DailyState {
  if (state.done) throw new DailyRuleError("DONE", "이미 끝난 도전이에요.");
  if (step.t === "roll") {
    if (state.rolls >= 3) throw new DailyRuleError("NO_ROLLS", "이번 차례에는 더 굴릴 수 없어요.");
    if (step.keep === 31) throw new DailyRuleError("BAD_KEEP", "다시 굴릴 주사위를 하나 이상 골라 주세요.");
    const roll = state.rolls + 1;
    const faces = tapeFaces(key, state.round, roll);
    const dice = state.dice.map((v, j) => (step.keep & (1 << j) ? v : faces[j]));
    return { ...state, rolls: roll, dice, keep: step.keep, log: [...state.log, step] };
  }
  if (state.card[step.c] !== undefined) throw new DailyRuleError("TAKEN", "이미 기록한 칸이에요.");
  const card = { ...state.card, [step.c]: score(state.dice, step.c) };
  const done = available(card).length === 0;
  if (done) return { ...state, card, done, round: 13, rolls: 0, keep: 0, log: [...state.log, step] };
  const round = state.round + 1;
  return { ...state, card, round, rolls: 1, dice: tapeFaces(key, round, 1), keep: 0, log: [...state.log, step] };
}

export const finalScore = (state: DailyState) => total(state.card);

/**
 * Recompute an attempt from its step log (server restore, archive verification by anyone once the day key
 * is revealed). Returns null when the log is not a legal game of that day.
 */
export function replayLog(date: string, key: DayKey, log: readonly DailyStep[]): DailyState | null {
  if (!log.length || log[0].t !== "roll" || log[0].keep !== 0 || log.length > MAX_STEPS) return null;
  let state = newDailyState(date, key);
  try {
    for (const step of log.slice(1)) state = applyStep(state, step, key);
  } catch {
    return null;
  }
  return state;
}

/** Public view of an attempt: what the player already saw, nothing about future rolls. */
export type DailyView = { date: string; rules: string; round: number; rolls: number; dice: number[]; keep: number; card: Card; seq: number; done: boolean; score: number; upper: number };
export const viewOf = (state: DailyState): DailyView => ({
  date: state.date, rules: state.rules, round: state.round, rolls: state.rolls, dice: [...state.dice], keep: state.keep,
  card: { ...state.card }, seq: state.log.length, done: state.done, score: total(state.card), upper: upper(state.card),
});
