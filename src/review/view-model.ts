import { names, score, total, type Category } from "../engine";
import type { Assessment, Position, ReviewMatch, Value } from "./model";
import { grades } from "./quality";
import type { ReviewedAction, ReviewedRoll, ReviewReport } from "./report";

/**
 * Pure view model for the A5 review screen. Everything here is read from the C2 report
 * (`yachtlab-review-a5-v1`), the engine's per-action assessments or the public positions of the
 * replay. Nothing is re-estimated: missing values stay `null`/absent.
 */

export type Grade = keyof typeof grades;
export type Filter = "all" | "good" | "mistake" | "lucky" | "unlucky";
export const filterLabels: Record<Filter, string> = { all: "전체", good: "좋은 판단", mistake: "실수", lucky: "행운", unlucky: "불운" };
export const goodGrades: readonly Grade[] = ["!!", "!", "★", "✓"];
export const mistakeGrades: readonly Grade[] = ["?!", "?", "??"];
export const gradeOrder: readonly Grade[] = ["!!", "!", "★", "✓", "?!", "?", "??"];

export type SeatInfo = {
  seat: 0 | 1;
  name: string;
  /** Seat role shown next to every name so equal names stay distinct. */
  role: string;
  /** Name with the role appended when both seats share a display name. */
  display: string;
  me: boolean;
  tone: "me" | "opp";
};

export function seatInfo(match: ReviewMatch): SeatInfo[] {
  const seats = (match.solo ? [0] : [0, 1]) as (0 | 1)[];
  const simultaneous = !match.solo && match.steps.some(({ before }) => before.simultaneous);
  const duplicate = !match.solo && match.players[0].trim() === match.players[1].trim();
  return seats.map((seat) => {
    const role = match.solo ? "1인" : simultaneous ? `${seat + 1}번 좌석` : seat === 0 ? "선공" : "후공";
    const name = match.players[seat] || (match.solo ? "플레이어" : `플레이어 ${seat + 1}`);
    return {
      seat, name, role, display: duplicate ? `${name} (${role})` : name, me: match.me === seat,
      // D-060 seat colours: me red, opponent blue; without a known seat, seat 0 red and seat 1 blue.
      tone: match.me === undefined ? (seat === 0 ? "me" : "opp") : seat === match.me ? "me" : "opp",
    };
  });
}

/** Identity of a choice independent of die ids (equal eyes are the same keep). */
export function choiceKey(action: Value["action"], position: Position) {
  if (action.type === "score") return "s:" + action.category;
  return "k:" + position.dice.filter(({ id }) => action.ids.includes(id)).map(({ value }) => value).sort().join("");
}

export function choiceLabel(action: Value["action"], position: Position) {
  if (action.type === "score") return names[action.category];
  const kept = position.dice.filter(({ id }) => action.ids.includes(id)).map(({ value }) => value).sort();
  if (kept.length === 5) return "모두 킵";
  return kept.length ? `${kept.join("·")} 킵` : "모두 굴림";
}

export const scoreOf = (position: Position, category: Category) => score(position.dice.map(({ value }) => value), category);

export function rollTags(rolls: readonly ReviewedRoll[]) {
  const tags: Filter[] = [];
  if (rolls.some(({ swing }) => swing > 0)) tags.push("lucky");
  if (rolls.some(({ swing }) => swing < 0)) tags.push("unlucky");
  return tags;
}

export function actionTags(action: ReviewedAction | undefined): Filter[] {
  if (!action) return [];
  const tags: Filter[] = [];
  if (action.evaluation.state === "assessed") {
    if (goodGrades.includes(action.evaluation.grade)) tags.push("good");
    if (mistakeGrades.includes(action.evaluation.grade)) tags.push("mistake");
  }
  return [...tags, ...rollTags(action.rolls)];
}

export type TimelineItem =
  | { kind: "action"; index: number; seat: 0 | 1; round: number; position: Position; choice: Value["action"]; reviewed?: ReviewedAction; tags: Filter[] }
  | { kind: "opening"; seat: 0 | 1; round: number; position: Position; roll: ReviewedRoll | null; tags: Filter[] };

export type TimelineRound = { round: number; items: TimelineItem[] };

/** Rounds in play order. Works before analysis (no grades yet) and with a finished report. */
export function timeline(match: ReviewMatch, report?: ReviewReport): TimelineRound[] {
  const reviewed = new Map<number, ReviewedAction>();
  const openings: TimelineItem[] = [];
  for (const player of report?.players ?? []) {
    for (const round of player.rounds) {
      for (const action of round.actions) reviewed.set(action.index, action);
      for (const { position, roll } of round.unpairedFirstRolls) openings.push({
        kind: "opening", seat: player.seat as 0 | 1, round: position.round, position, roll, tags: roll ? rollTags([roll]) : [],
      });
    }
  }
  if (!report) for (const position of match.unpairedFirstRolls ?? []) openings.push({
    kind: "opening", seat: position.player as 0 | 1, round: position.round, position, roll: null, tags: [],
  });
  const items: TimelineItem[] = match.steps.map(({ before, action }, index) => ({
    kind: "action", index, seat: before.player as 0 | 1, round: before.round, position: before, choice: action,
    reviewed: reviewed.get(index), tags: actionTags(reviewed.get(index)),
  }));
  // Openings without a confirmed action go after that seat's actions in the same round.
  for (const opening of openings) {
    let at = 0;
    items.forEach((item, i) => {
      if (item.round < opening.round || (item.round === opening.round && item.seat <= opening.seat)) at = i + 1;
    });
    items.splice(at, 0, opening);
  }
  const rounds: TimelineRound[] = [];
  for (const item of items) {
    const last = rounds[rounds.length - 1];
    if (last?.round === item.round) last.items.push(item);
    else rounds.push({ round: item.round, items: [item] });
  }
  return rounds;
}

export function matches(item: TimelineItem, filter: Filter, seat: 0 | 1 | "all") {
  return (seat === "all" || item.seat === seat) && (filter === "all" || item.tags.includes(filter));
}

export function gradeCounts(report: ReviewReport, seat: number) {
  const counts = Object.fromEntries(gradeOrder.map((grade) => [grade, 0])) as Record<Grade, number>;
  for (const round of report.players[seat]?.rounds ?? []) for (const { evaluation } of round.actions)
    if (evaluation.state === "assessed") counts[evaluation.grade]++;
  return counts;
}

/**
 * Good decisions worth showing: the actual choice is (one of) the best and the engine's own
 * values put the next distinct choice clearly behind. The margin is read from the same option
 * values the report uses; actions without a distinct runner-up are skipped.
 */
export function goodMoments(match: ReviewMatch, report: ReviewReport, values: readonly Assessment[], seat: number, limit = 3) {
  const byIndex = new Map(values.map((row) => [row.index, row]));
  const value = (option: Value) => match.solo ? option.expected : option.winCredit === undefined ? undefined : option.winCredit * 100;
  const rows = (report.players[seat]?.rounds ?? []).flatMap(({ actions }) => actions).flatMap((action) => {
    const { evaluation, index } = action;
    if (evaluation.state !== "assessed" || !["!!", "!", "★"].includes(evaluation.grade)) return [];
    const row = byIndex.get(index);
    const position = match.steps[index].before;
    if (!row) return [];
    const own = choiceKey(row.actual.action, position);
    const others = row.options.filter((option) => choiceKey(option.action, position) !== own).map(value)
      .filter((v): v is number => v !== undefined);
    const actual = value(row.actual);
    if (!others.length || actual === undefined) return [];
    const margin = actual - Math.max(...others);
    return margin > 1e-8 ? [{ index, margin, grade: evaluation.grade }] : [];
  });
  return rows.sort((a, b) => gradeOrder.indexOf(a.grade) - gradeOrder.indexOf(b.grade) || b.margin - a.margin).slice(0, limit);
}

export type SeriesPoint = { x: number; index: number; round: number; value: number };

/** Running total after each recorded category, from the public card of that moment. */
export function scoreSeries(match: ReviewMatch, seat: number): SeriesPoint[] {
  return match.steps.flatMap(({ before, action }, index) => {
    if (before.player !== seat || action.type !== "score") return [];
    const card = { ...before.cards[seat], [action.category]: scoreOf(before, action.category) };
    return [{ x: index, index, round: before.round, value: total(card) }];
  });
}

/**
 * Win credit after each action from the reference seat's side. In 1:1 the two seats' credits
 * (win 1, draw 0.5) sum to 1, so the other seat's value is shown as 100 − value.
 */
export function winSeries(match: ReviewMatch, values: readonly Assessment[], reference: number): SeriesPoint[] {
  return values.flatMap((row) => {
    const credit = row.actual.winCredit;
    if (credit === undefined) return [];
    const { player, round } = match.steps[row.index].before;
    return [{ x: row.index, index: row.index, round, value: player === reference ? credit * 100 : 100 - credit * 100 }];
  });
}

/** 1인: DP Expert expected final score after each action. */
export function expectedSeries(match: ReviewMatch, values: readonly Assessment[]): SeriesPoint[] {
  return values.map((row) => ({ x: row.index, index: row.index, round: match.steps[row.index].before.round, value: row.actual.expected }));
}

export type RoundBar = { round: number; loss: number | null; luck: number | null; index: number | null };

export function roundBars(match: ReviewMatch, report: ReviewReport, seat: number): RoundBar[] {
  return (report.players[seat]?.rounds ?? []).map(({ round, totals, actions }) => ({
    round, loss: totals.loss, luck: totals.luck,
    index: actions[0]?.index ?? match.steps.findIndex(({ before }) => before.round === round && before.player === seat),
  })).map((bar) => ({ ...bar, index: bar.index === -1 ? null : bar.index }));
}

export function signed(value: number, digits = 2) {
  const fixed = Math.abs(value) < 0.5 * 10 ** -digits ? (0).toFixed(digits) : value.toFixed(digits);
  return value > 0 && Number(fixed) !== 0 ? "+" + fixed : fixed.replace(/^-(0\.0+)$/, "$1");
}

export const unassessedReason = {
  automatic: "자동 기록",
  "no-distinct-choice": "선택 차이 없음",
  "model-unavailable": "분석 값 없음",
} as const;
