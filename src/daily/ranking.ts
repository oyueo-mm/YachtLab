/**
 * Daily ranking rules (LIVE-1, D-103). Pure functions shared by the board object and tests.
 *
 *  - Only a member's FIRST official attempt of a date counts (practice / archive plays never do).
 *  - Order: higher score first. Equal scores share a rank (standard competition ranking 1, 1, 3);
 *    among equal scores the earlier finish is listed first (display order only, not a better rank).
 *  - Every date and rules version is its own board (`boardName`); records never mix.
 *  - Visibility: "public" (everyone), "friends" (friends only), "private" (only me). Blocks either
 *    way hide the entry from each other in every list.
 */
export type Visibility = "public" | "friends" | "private";
export const VISIBILITIES: readonly Visibility[] = ["public", "friends", "private"];
export const isVisibility = (v: unknown): v is Visibility => typeof v === "string" && (VISIBILITIES as readonly string[]).includes(v);

export type BoardEntry = { userId: string; nickname: string; score: number; finishedAt: number; visibility: Visibility; yacht: boolean; bonus: boolean };
export type RankedEntry = { rank: number; nickname: string; score: number; finishedAt: number; yacht: boolean; bonus: boolean; me?: true };

export const boardName = (rules: string, date: string) => `daily:${rules}:${date}`;

export function compareEntries(a: { score: number; finishedAt: number; userId?: string }, b: { score: number; finishedAt: number; userId?: string }) {
  return b.score - a.score || a.finishedAt - b.finishedAt || String(a.userId ?? "").localeCompare(String(b.userId ?? ""));
}

/** Competition ranks for an already sorted list. */
export function withRanks<T extends { score: number }>(sorted: T[], firstRank = 1, previous?: { score: number; rank: number }): (T & { rank: number })[] {
  const out: (T & { rank: number })[] = [];
  sorted.forEach((e, i) => {
    const prev = i > 0 ? out[i - 1] : previous;
    const rank = prev && prev.score === e.score ? prev.rank : firstRank + i;
    out.push({ ...e, rank });
  });
  return out;
}

/** Rank of a score among all ranked entries: 1 + number of strictly higher scores. */
export const rankOf = (higher: number) => higher + 1;

export const PAGE_MAX = 50;
export function pageParams(offset: unknown, limit: unknown) {
  const o = Number(offset), l = Number(limit);
  return { offset: Number.isInteger(o) && o >= 0 && o <= 100_000 ? o : 0, limit: Number.isInteger(l) && l >= 1 && l <= PAGE_MAX ? l : 20 };
}
