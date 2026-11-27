import { firstRollPosition, productReviewModel, reviewAlgorithmVersion, reviewModel, type Assessment, type OpeningAssessment, type Position, type ReviewMatch, type Value } from "./model";
import { decisionAccuracy, decisionLoss, grade, recommended, type Criterion } from "./quality";

export type ReviewAnalysisStatus =
  | { state: "preparing"; total: number }
  | { state: "analyzing"; completed: number; total: number }
  | { state: "cancelled"; completed: number; total: number }
  | { state: "failed"; message: string; completed: number; total: number }
  | { state: "unassessed"; reason: "no-actions" }
  | { state: "complete"; report: ReviewReport };

type Exactness = "exact" | "estimate";
type Grade = ReturnType<typeof grade>;

export type ReviewedRoll = {
  kind: "first" | "reroll";
  dice: number[];
  expectedValue: number;
  realizedValue: number;
  swing: number;
  exactness: Exactness;
};

export type ReviewedAction = {
  index: number;
  position: Position;
  actual: Value["action"];
  evaluation:
    | { state: "unassessed"; reason: "automatic" | "no-distinct-choice" | "model-unavailable" }
    | { state: "assessed"; exactness: Exactness; recommended: Value["action"]; actualValue: number; bestValue: number; loss: number; accuracy: number; grade: Grade };
  rolls: ReviewedRoll[];
  cumulativeLoss: number | null;
  cumulativeLuck: number | null;
};

export type ReviewTotals = {
  assessedActions: number;
  unassessedActions: number;
  estimatedActions: number;
  accuracy: number | null;
  loss: number | null;
  firstLuck: number | null;
  rerollLuck: number | null;
  luck: number | null;
  observedRolls: number;
  assessedRolls: number;
  estimatedRolls: number;
};

export type ReviewReport = {
  schema: "yachtlab-review-a5-v1";
  replayId: string;
  modelVersion: string;
  algorithmVersion: string;
  criterion: Criterion;
  unit: "points" | "percentage-points";
  players: {
    seat: number;
    name: string;
    totals: ReviewTotals;
    rounds: { round: number; totals: ReviewTotals; actions: ReviewedAction[]; unpairedFirstRolls: { position: Position; roll: ReviewedRoll | null }[] }[];
    highlights: {
      mistakes: { index: number; loss: number }[];
      lucky: { index: number | null; round: number; roll: ReviewedRoll }[];
      unlucky: { index: number | null; round: number; roll: ReviewedRoll }[];
    };
  }[];
};

const sum = (values: number[]) => values.length ? values.reduce((total, value) => total + value, 0) : null;
const add = (previous: number | null, value: number) => (previous ?? 0) + value;

type UnpairedRoll = { position: Position; roll: ReviewedRoll | null };

function rollResult(kind: ReviewedRoll["kind"], position: Position, baseline: number, difference: number, multiplier: number, exactness: Exactness): ReviewedRoll {
  const expectedValue = baseline * multiplier;
  const swing = Math.abs(difference) < 1e-8 ? 0 : difference * multiplier;
  return { kind, dice: position.dice.map(({ value }) => value), expectedValue, realizedValue: expectedValue + swing, swing, exactness };
}

function summarize(actions: ReviewedAction[], match: ReviewMatch, unpaired: UnpairedRoll[]): ReviewTotals {
  const evaluated = actions.flatMap(({ evaluation }) => evaluation.state === "assessed" ? [evaluation] : []);
  const rolls = [...actions.flatMap((action) => action.rolls), ...unpaired.flatMap(({ roll }) => roll ? [roll] : [])];
  const observedRolls = actions.reduce((count, { index }) => {
    const step = match.steps[index];
    return count + Number(!!firstRollPosition(step)) + Number(!!step.afterRoll);
  }, 0);
  return {
    assessedActions: evaluated.length,
    unassessedActions: actions.length - evaluated.length,
    estimatedActions: evaluated.filter(({ exactness }) => exactness === "estimate").length,
    accuracy: evaluated.length ? (sum(evaluated.map(({ accuracy }) => accuracy))! / evaluated.length) : null,
    loss: sum(evaluated.map(({ loss }) => loss)),
    firstLuck: sum(rolls.filter(({ kind }) => kind === "first").map(({ swing }) => swing)),
    rerollLuck: sum(rolls.filter(({ kind }) => kind === "reroll").map(({ swing }) => swing)),
    luck: sum(rolls.map(({ swing }) => swing)),
    observedRolls: observedRolls + unpaired.length,
    assessedRolls: rolls.length,
    estimatedRolls: rolls.filter(({ exactness }) => exactness === "estimate").length,
  };
}

export function createReviewReport(match: ReviewMatch, values: readonly Assessment[], modelVersion: string = match.solo ? reviewModel.version : productReviewModel.version, openings: readonly OpeningAssessment[] = []): ReviewReport {
  const criterion = match.solo ? "score" : "win";
  const unit = match.solo ? "points" : "percentage-points";
  const multiplier = match.solo ? 1 : 100;
  const byIndex = new Map(values.map((row) => [row.index, row]));
  const players = match.players.slice(0, match.solo ? 1 : 2).map((name, seat) => {
    const unpaired = (match.unpairedFirstRolls ?? []).flatMap((position, index): UnpairedRoll[] => {
      if (position.player !== seat) return [];
      const row = openings[index];
      const expected = match.solo ? row?.preRollScore : row?.preRollValue;
      const difference = match.solo ? row?.firstLuck : row?.firstWinLuck;
      const roll = expected === undefined || difference === undefined ? null :
        rollResult("first", position, expected, difference, multiplier, match.solo || row.exactness === "exact" ? "exact" : "estimate");
      return [{ position, roll }];
    }).sort((a, b) => a.position.round - b.position.round);
    let openingIndex = 0;
    let cumulativeLoss: number | null = null;
    let cumulativeLuck: number | null = null;
    const actions = match.steps.flatMap((step, index): ReviewedAction[] => {
      if (step.before.player !== seat) return [];
      while (unpaired[openingIndex]?.position.round < step.before.round) {
        const { roll } = unpaired[openingIndex++];
        if (roll) cumulativeLuck = add(cumulativeLuck, roll.swing);
      }
      const row = byIndex.get(index);
      const loss = row && decisionLoss(row, criterion);
      const recommendation = row && recommended(row, criterion);
      const exactness: Exactness = match.solo || row?.exactness === "exact" ? "exact" : "estimate";
      let evaluation: ReviewedAction["evaluation"];
      if (row && recommendation && loss !== undefined && !step.automatic) {
        const value = (option: Value) => match.solo ? option.expected : option.winCredit! * multiplier;
        evaluation = { state: "assessed", exactness, recommended: recommendation.action, actualValue: value(row.actual),
          bestValue: value(recommendation), loss, accuracy: decisionAccuracy(loss, criterion), grade: grade(row) };
        cumulativeLoss = add(cumulativeLoss, loss);
      } else {
        evaluation = { state: "unassessed", reason: step.automatic ? "automatic" :
          recommendation ? "no-distinct-choice" : "model-unavailable" };
      }
      const rolls: ReviewedRoll[] = [];
      const criterionValue = match.solo ? row?.actual.expected : row?.actual.winCredit;
      for (const [kind, outcome, baseline, difference] of [
        ["first", firstRollPosition(step), match.solo ? row?.preRollScore : row?.preRollValue, match.solo ? row?.firstLuck : row?.firstWinLuck],
        ["reroll", step.afterRoll, criterionValue, match.solo ? row?.luck : row?.winLuck],
      ] as const) {
        if (!outcome || baseline === undefined || difference === undefined) continue;
        const roll = rollResult(kind, outcome, baseline, difference, multiplier, exactness);
        rolls.push(roll);
        cumulativeLuck = add(cumulativeLuck, roll.swing);
      }
      return [{ index, position: step.before, actual: step.action, evaluation, rolls, cumulativeLoss, cumulativeLuck }];
    });
    const events = [
      ...actions.flatMap(({ index, position, rolls }) => rolls.map((roll) => ({ index, round: position.round, roll }))),
      ...unpaired.flatMap(({ position, roll }) => roll ? [{ index: null, round: position.round, roll }] : []),
    ];
    const rounds = [...new Set([...actions, ...unpaired].map(({ position }) => position.round))].sort((a, b) => a - b).map((round) => {
      const entries = actions.filter(({ position }) => position.round === round);
      const unpairedFirstRolls = unpaired.filter(({ position }) => position.round === round);
      return { round, totals: summarize(entries, match, unpairedFirstRolls), actions: entries, unpairedFirstRolls };
    });
    return {
      seat, name, rounds, totals: summarize(actions, match, unpaired),
      highlights: {
        mistakes: actions.flatMap(({ index, evaluation }) => evaluation.state === "assessed" &&
          ["?!", "?", "??"].includes(evaluation.grade) ? [{ index, loss: evaluation.loss }] : [])
          .sort((a, b) => b.loss - a.loss).slice(0, 3),
        lucky: events.filter(({ roll }) => roll.swing > 0).sort((a, b) => b.roll.swing - a.roll.swing).slice(0, 3),
        unlucky: events.filter(({ roll }) => roll.swing < 0).sort((a, b) => a.roll.swing - b.roll.swing).slice(0, 3),
      },
    };
  });
  return { schema: "yachtlab-review-a5-v1", replayId: match.id, modelVersion, algorithmVersion: reviewAlgorithmVersion, criterion, unit, players };
}
