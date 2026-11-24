import { bonus, categories, total, upper, type Card, type Category } from "../engine";

/**
 * Match records (Phase 4) — one shape for every place a result is kept: this device, the account
 * (server), and the import of guest records into an account.
 *
 * Trust is explicit on every record (docs/online/SOCIAL-AND-ACCOUNTS.md §신뢰 수준):
 *  - source "server" + "server-verified": written by the online room from its own authoritative engine
 *    state. The only kind that may ever feed ratings, coins or achievements.
 *  - source "device" + "client-reported": AI / offline games recorded by this browser.
 *  - source "guest-import" + "client-reported": device records moved into an account. Never promoted.
 * A record is identified by `recordId`: the online matchId, or `d_<random>` for device games, so a
 * retried upload or a second import of the same record is a no-op (idempotent).
 */
export const RULES_ID = "yacht12@1";
export type RecordMode = "online" | "ai";
export type RecordSource = "server" | "device" | "guest-import";
export type Verification = "server-verified" | "client-reported";
export type Outcome = "win" | "loss" | "draw";
export type EndReason = "completed" | "resign" | "timeout";
export type Opponent = { name: string; kind: "ai" | "guest" | "member"; score: number; userId?: string; aiLevel?: string };

export type MatchRecord = {
  recordId: string;
  mode: RecordMode;
  rules: typeof RULES_ID;
  source: RecordSource;
  verification: Verification;
  startedAt: number;
  endedAt: number;
  name: string;
  score: number;
  card: Card;
  outcome: Outcome;
  endReason: EndReason;
  opponent: Opponent;
  /** Public AI difficulty id for AI games (e.g. "보통"). */
  aiLevel?: string;
};

/** Domain event emitted when a match result is final — the hook for quests/coins/achievements later. */
export type MatchFinishedEvent = { eventId: string; type: "match.finished"; userId: string; record: MatchRecord };

const ID = /^[A-Za-z0-9_-]{4,64}$/;
const isInt = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const text = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : null);

/** Strict shape check for untrusted records (device uploads). Scores must match the card. */
export function sanitizeRecord(raw: unknown, now = Date.now()): MatchRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.recordId !== "string" || !ID.test(r.recordId)) return null;
  if (r.mode !== "online" && r.mode !== "ai") return null;
  if (r.rules !== RULES_ID) return null;
  if (!isInt(r.startedAt, 1_600_000_000_000, now + 86_400_000) || !isInt(r.endedAt, r.startedAt as number, now + 86_400_000)) return null;
  const name = text(r.name, 80);
  if (name === null) return null;
  if (typeof r.card !== "object" || r.card === null) return null;
  const card: Card = {};
  for (const [k, v] of Object.entries(r.card as Record<string, unknown>)) {
    if (!(categories as readonly string[]).includes(k) || !isInt(v, 0, 50)) return null;
    card[k as Category] = v as number;
  }
  if (!isInt(r.score, 0, 400) || total(card) !== r.score) return null;
  if (r.outcome !== "win" && r.outcome !== "loss" && r.outcome !== "draw") return null;
  if (r.endReason !== "completed" && r.endReason !== "resign" && r.endReason !== "timeout") return null;
  const o = r.opponent as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return null;
  const oName = text(o.name, 80);
  if (oName === null || (o.kind !== "ai" && o.kind !== "guest" && o.kind !== "member") || !isInt(o.score, 0, 400)) return null;
  const aiLevel = r.aiLevel === undefined ? undefined : text(r.aiLevel, 40);
  if (aiLevel === null) return null;
  return {
    recordId: r.recordId,
    mode: r.mode,
    rules: RULES_ID,
    // Whatever the client claims, an uploaded record is never server-verified.
    source: "device",
    verification: "client-reported",
    startedAt: r.startedAt as number,
    endedAt: r.endedAt as number,
    name,
    score: r.score,
    card,
    outcome: r.outcome,
    endReason: r.endReason,
    // A device cannot vouch for an account opponent: the link to a userId is dropped.
    opponent: { name: oName, kind: o.kind === "member" ? "guest" : o.kind, score: o.score as number, ...(typeof o.aiLevel === "string" && o.aiLevel.length <= 40 ? { aiLevel: o.aiLevel } : {}) },
    ...(aiLevel ? { aiLevel } : {}),
  };
}

/* ------------------------------------------------------------------ stats ------------------------------------------------------------------ */

export type Stats = {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** Win rate with draws counted as half (null with no games). */
  winRate: number | null;
  best: number | null;
  average: number | null;
  yachts: number;
  largeStraights: number;
  bonuses: number;
  byMode: Record<RecordMode, number>;
  byAiLevel: { level: string; games: number; wins: number; losses: number; draws: number }[];
  byCategory: { category: Category; filled: number; average: number; hits: number }[];
  /** Most recent last (for a trend line). */
  recentScores: number[];
  opponents: { key: string; name: string; games: number; wins: number; losses: number; draws: number }[];
};

export function computeStats(records: MatchRecord[]): Stats {
  const sorted = [...records].sort((a, b) => a.endedAt - b.endedAt);
  const s: Stats = {
    games: sorted.length,
    wins: 0,
    losses: 0,
    draws: 0,
    winRate: null,
    best: null,
    average: null,
    yachts: 0,
    largeStraights: 0,
    bonuses: 0,
    byMode: { online: 0, ai: 0 },
    byAiLevel: [],
    byCategory: [],
    recentScores: sorted.slice(-20).map((r) => r.score),
    opponents: [],
  };
  const levels = new Map<string, Stats["byAiLevel"][number]>();
  const opps = new Map<string, Stats["opponents"][number]>();
  const cats = new Map<Category, { filled: number; sum: number; hits: number }>(categories.map((c) => [c, { filled: 0, sum: 0, hits: 0 }]));
  let sum = 0;
  for (const r of sorted) {
    s[r.outcome === "win" ? "wins" : r.outcome === "loss" ? "losses" : "draws"]++;
    s.byMode[r.mode]++;
    sum += r.score;
    s.best = Math.max(s.best ?? 0, r.score);
    if ((r.card.yacht ?? 0) > 0) s.yachts++;
    if ((r.card.large ?? 0) > 0) s.largeStraights++;
    if (bonus(r.card) > 0 || upper(r.card) >= 63) s.bonuses++;
    for (const c of categories) {
      const v = r.card[c];
      if (v === undefined) continue;
      const e = cats.get(c)!;
      e.filled++;
      e.sum += v;
      if (v > 0) e.hits++;
    }
    const tally = <T extends { games: number; wins: number; losses: number; draws: number }>(t: T) => {
      t.games++;
      t[r.outcome === "win" ? "wins" : r.outcome === "loss" ? "losses" : "draws"]++;
    };
    if (r.mode === "ai") {
      const level = r.aiLevel ?? r.opponent.aiLevel ?? "AI";
      if (!levels.has(level)) levels.set(level, { level, games: 0, wins: 0, losses: 0, draws: 0 });
      tally(levels.get(level)!);
    } else {
      // Account opponents are told apart by id; guests only by name (names are not unique).
      const key = r.opponent.userId ? "u:" + r.opponent.userId : "n:" + r.opponent.name;
      if (!opps.has(key)) opps.set(key, { key, name: r.opponent.name, games: 0, wins: 0, losses: 0, draws: 0 });
      const o = opps.get(key)!;
      o.name = r.opponent.name;
      tally(o);
    }
  }
  if (s.games) {
    s.winRate = (s.wins + s.draws / 2) / s.games;
    s.average = sum / s.games;
  }
  s.byAiLevel = [...levels.values()].sort((a, b) => b.games - a.games);
  s.opponents = [...opps.values()].sort((a, b) => b.games - a.games).slice(0, 10);
  s.byCategory = categories.map((c) => {
    const e = cats.get(c)!;
    return { category: c, filled: e.filled, average: e.filled ? e.sum / e.filled : 0, hits: e.hits };
  });
  return s;
}
