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
  if (actual === undefined) return undefined;
  return Math.max(0, ...entry.options.map((row) => (row.winCredit ?? actual) - actual)) * 100;
}

export function accuracy(rows: Assessment[], criterion: "score" | "win") {
  const losses = rows.flatMap((row) => {
    const loss = criterion === "score" ? row.loss : winLoss(row);
    // Once the result is forced for all legal choices, win accuracy has no decision to assess.
    if (loss === undefined || (criterion === "win" &&
      row.options.every(({ winCredit }) => winCredit === row.actual.winCredit) &&
      [0, 0.5, 1].includes(row.actual.winCredit!))) return [];
    return [loss];
  });
  if (!losses.length) return undefined;
  const [tolerance, scale] = criterion === "score" ? [0.1, 8] : [0.25, 10];
  return (100 / losses.length) * losses.reduce((sum, loss) => sum + Math.exp(-Math.max(0, loss - tolerance) / scale), 0);
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
    if (Number.isFinite(gap) && gap >= 20 && entry.loss >= 3) return "!!";
    if (Number.isFinite(gap) && gap >= 10 && entry.loss >= 1) return "!";
  }
  if (loss <= best) return "★";
  if (loss <= good) return "✓";
  if (loss <= inaccurate) return "?!";
  if (loss <= mistake) return "?";
  return "??";
}
