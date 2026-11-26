import { bonus, categories, total, upper, type Card, type Category } from "../engine";
import { RULES_ID } from "../identity/records";

/**
 * 1인 플레이 records (2026-11-27). One record per completed solo game.
 *
 * Trust is explicit: every solo record is produced by this browser ("client-reported"), including the
 * copies kept on an account. They are personal records only — never a ranking, never coins or
 * server achievements (docs/context/SOLO-2026-11-27.md).
 */
export type SoloRecord = {
  recordId: string;
  rules: typeof RULES_ID;
  source: "device";
  verification: "client-reported";
  startedAt: number;
  endedAt: number;
  score: number;
  card: Card;
  /** Local replay id (IndexedDB) when this device has the replay. */
  replayId?: string;
  /** This device only: the account (user id) that was signed in when the game was played; absent for guests. */
  owner?: string;
};

export const MAX_SOLO_RECORDS = 1000;
const ID = /^s_[A-Za-z0-9_-]{8,40}$/;
const isInt = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/** Strict shape check (local storage and account uploads). The score must match the full card. */
export function sanitizeSoloRecord(raw: unknown, now = Date.now()): SoloRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.recordId !== "string" || !ID.test(r.recordId) || r.rules !== RULES_ID) return null;
  if (!isInt(r.startedAt, 1_600_000_000_000, now + 86_400_000) || !isInt(r.endedAt, r.startedAt as number, now + 86_400_000)) return null;
  if (typeof r.card !== "object" || r.card === null) return null;
  const card: Card = {};
  for (const [k, v] of Object.entries(r.card as Record<string, unknown>)) {
    if (!(categories as readonly string[]).includes(k) || !isInt(v, 0, 50)) return null;
    card[k as Category] = v as number;
  }
  // A solo record is a finished game: all 12 categories filled.
  if (Object.keys(card).length !== categories.length) return null;
  if (!isInt(r.score, 0, 400) || total(card) !== r.score) return null;
  const replayId = typeof r.replayId === "string" && r.replayId.length <= 100 ? r.replayId : undefined;
  const owner = typeof r.owner === "string" && /^u_[A-Za-z0-9_-]{22}$/.test(r.owner) ? r.owner : undefined;
  return { recordId: r.recordId, rules: RULES_ID, source: "device", verification: "client-reported", startedAt: r.startedAt as number, endedAt: r.endedAt as number, score: r.score, card, ...(replayId ? { replayId } : {}), ...(owner ? { owner } : {}) };
}

/* ------------------------------------------------------------------- stats ------------------------------------------------------------------- */

export const SOLO_BUCKETS = [
  { from: 0, to: 99, label: "~99" },
  { from: 100, to: 149, label: "100~149" },
  { from: 150, to: 174, label: "150~174" },
  { from: 175, to: 199, label: "175~199" },
  { from: 200, to: 224, label: "200~224" },
  { from: 225, to: 249, label: "225~249" },
  { from: 250, to: 400, label: "250~" },
] as const;

export type SoloStats = {
  plays: number;
  best: number | null;
  bestAt: number | null;
  average: number | null;
  /** Average of the last 10 games (null with fewer than 3). */
  recentAverage: number | null;
  yachts: number;
  bonusRate: number | null;
  distribution: { label: string; count: number }[];
  /** Oldest first, at most 30. */
  recent: { score: number; at: number }[];
};

export function soloStats(records: SoloRecord[]): SoloStats {
  const sorted = [...records].sort((a, b) => a.endedAt - b.endedAt);
  const n = sorted.length;
  let best: SoloRecord | null = null;
  let sum = 0;
  let yachts = 0;
  let bonuses = 0;
  const counts: number[] = SOLO_BUCKETS.map(() => 0);
  for (const r of sorted) {
    sum += r.score;
    if (!best || r.score > best.score) best = r;
    if ((r.card.yacht ?? 0) > 0) yachts++;
    if (bonus(r.card) > 0 || upper(r.card) >= 63) bonuses++;
    const i = SOLO_BUCKETS.findIndex((b) => r.score >= b.from && r.score <= b.to);
    if (i >= 0) counts[i]++;
  }
  const last = sorted.slice(-10);
  return {
    plays: n,
    best: best?.score ?? null,
    bestAt: best?.endedAt ?? null,
    average: n ? sum / n : null,
    recentAverage: last.length >= 3 ? last.reduce((a, r) => a + r.score, 0) / last.length : null,
    yachts,
    bonusRate: n ? bonuses / n : null,
    distribution: SOLO_BUCKETS.map((b, i) => ({ label: b.label, count: counts[i] })),
    recent: sorted.slice(-30).map((r) => ({ score: r.score, at: r.endedAt })),
  };
}
/** Best before this game (to say "new record" honestly: the first game is a first record, not a new best). */
export function previousBest(records: SoloRecord[], exceptId?: string): number | null {
  let best: number | null = null;
  for (const r of records) if (r.recordId !== exceptId && (best === null || r.score > best)) best = r.score;
  return best;
}
