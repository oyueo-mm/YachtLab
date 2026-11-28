import { categories, names, type Card } from "../engine";

/**
 * Daily result sharing. Only the outcome is shared — score, rank and which categories scored —
 * never dice faces, so a shared result says nothing about the day's tape to someone who has not
 * played yet (and the text is the same before and after the day closes).
 */
export type ShareInput = { date: string; score: number; card: Card; rank?: number | null; players?: number | null; url: string };

const mark = (card: Card, c: (typeof categories)[number]) => {
  const v = card[c];
  if (v === undefined) return "⬜";
  if (v === 0) return "⬛";
  if (c === "yacht") return "⭐";
  return "🟩";
};

export function shareText(input: ShareInput): string {
  const { card } = input;
  const upperRow = categories.slice(0, 6).map((c) => mark(card, c)).join("");
  const lowerRow = categories.slice(6).map((c) => mark(card, c)).join("");
  const upper = categories.slice(0, 6).reduce((s, c) => s + (card[c] ?? 0), 0);
  const lines = [
    `오늘의 요트 ${input.date} · ${input.score}점`,
    input.rank && input.players ? `전체 ${input.rank}위 / ${input.players}명` : null,
    `${upperRow} ${upper >= 63 ? "보너스 +35" : `상단 ${upper}/63`}`,
    lowerRow,
    input.url,
  ];
  return lines.filter(Boolean).join("\n");
}

/** Accessible one-line summary (alt text of the share image). */
export function shareSummary(input: ShareInput) {
  const zeros = categories.filter((c) => input.card[c] === 0).map((c) => names[c]);
  return `오늘의 요트 ${input.date} ${input.score}점` + (input.rank ? `, ${input.rank}위` : "") + (zeros.length ? `, 0점 칸: ${zeros.join(", ")}` : "");
}
