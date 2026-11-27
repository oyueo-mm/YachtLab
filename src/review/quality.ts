import type { Assessment } from "./model";

export const grades = {
  "!!": { label: "탁월한 판단", tone: "excellent" },
  "!": { label: "훌륭한 판단", tone: "excellent" },
  "★": { label: "최선", tone: "best" },
  "✓": { label: "좋음", tone: "good" },
  "?!": { label: "부정확", tone: "inaccuracy" },
  "?": { label: "실수", tone: "mistake" },
  "??": { label: "큰 실수", tone: "blunder" },
} as const;

export function winLoss(entry: Assessment) {
  const actual = entry.actual.winCredit;
  if (actual === undefined || entry.options.some(({ winCredit }) => winCredit === undefined)) return undefined;
  return Math.max(0, ...entry.options.map((row) => (row.winCredit ?? actual) - actual)) * 100;
}

export type Criterion = "score" | "win";

export function decisionLoss(row: Assessment, criterion: Criterion) {
  const loss = criterion === "score" ? row.loss : winLoss(row);
  if (loss === undefined || row.options.length < 2) return undefined;
  if (criterion === "win" && row.exactness === "exact" && loss <= 1e-8 &&
      [0, 0.5, 1].includes(row.actual.winCredit!) &&
      row.options.every(({ winCredit }) => Math.abs(winCredit! - row.actual.winCredit!) <= 1e-8)) return undefined;
  return loss;
}

export function decisionAccuracy(loss: number, criterion: Criterion) {
  const [tolerance, scale] = criterion === "score" ? [0.1, 8] : [0.25, 10];
  return 100 * Math.exp(-Math.max(0, loss - tolerance) / scale);
}

export function accuracy(rows: Assessment[], criterion: Criterion) {
  const scores = rows.flatMap((row) => {
    const loss = decisionLoss(row, criterion);
    return loss === undefined ? [] : [decisionAccuracy(loss, criterion)];
  });
  return scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : undefined;
}

export function recommended(row: Assessment, criterion: Criterion) {
  if (criterion === "score") return row.options[0];
  if (winLoss(row) === undefined) return undefined;
  return row.options.reduce((best, option) => option.winCredit! > best.winCredit! ? option : best);
}

export function grade(entry: Assessment): keyof typeof grades {
  const win = winLoss(entry);
  const loss = win ?? entry.loss;
  const [best, good, inaccurate, mistake] = win === undefined ? [0.1, 1, 3, 8] : [0.25, 1.5, 4, 10];
  const played = entry.actual.action;
  if (entry.exactness === "exact" && win !== undefined && win <= 1e-8 && entry.options.length > 1) {
    const runnerUp = Math.max(...entry.options.filter(({ action }) => played.type !== action.type ||
      (played.type === "score" && action.type === "score" && played.category !== action.category) ||
      (played.type === "reroll" && action.type === "reroll" &&
        (played.ids.length !== action.ids.length || played.ids.some((id) => !action.ids.includes(id)))))
      .map(({ winCredit }) => winCredit ?? -Infinity));
    const gap = ((entry.actual.winCredit ?? 0) - runnerUp) * 100;
    if (Number.isFinite(gap) && gap >= 20) return "!!";
    if (Number.isFinite(gap) && gap >= 10) return "!";
  }
  if (loss <= best) return "★";
  if (loss <= good) return "✓";
  if (loss <= inaccurate) return "?!";
  if (loss <= mistake) return "?";
  return "??";
}
