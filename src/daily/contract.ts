/**
 * Integration contracts for other owners (LIVE-1). Nothing here grants anything.
 *
 * 07 (economy: attendance, streaks, daily rewards) — the daily service emits DailyActivity events
 * through `DailyRewardHook`. Until 07 publishes an approved contract, the only implementation is
 * `NO_DAILY_REWARDS`: it returns no grants, and the Worker never writes the ledger for daily play.
 *
 * 06 (operations) — `DailyAdminReport` is what `GET /api/admin/daily?date=` returns (ADMIN_TOKEN only):
 * participation, completion and puzzle quality numbers without any account id or nickname.
 */
export type DailyActivity =
  | { kind: "daily.official.started"; userId: string; date: string; rules: string; at: number }
  | { kind: "daily.official.completed"; userId: string; date: string; rules: string; score: number; ranked: boolean; at: number }
  | { kind: "daily.puzzle.answered"; userId: string; date: string; puzzleId: string; correct: boolean; at: number };

/** A reward the economy owner would grant for an activity (shape reserved; nothing produces one yet). */
export type DailyGrantProposal = { reason: string; currency: "coins" | "gems"; amount: number; idempotencyKey: string };

export interface DailyRewardHook {
  /** Must be idempotent per (userId, date, kind). Returning [] means "no reward". */
  proposals(activity: DailyActivity): DailyGrantProposal[];
}
export const NO_DAILY_REWARDS: DailyRewardHook = { proposals: () => [] };
/** Flipped only together with an approved 07 contract (docs/context/DAILY-LIVE-1.md §6). */
export const DAILY_REWARDS_APPROVED = false;

export type DailyAdminReport = {
  date: string;
  rules: string;
  phase: string;
  official: { started: number; completed: number; ranked: number; completionRate: number | null; scoreBuckets: Record<string, number>; average: number | null; best: number | null };
  practice: { games: number };
  puzzles: { id: string; level: string; kind: string; answered: number; correct: number; correctRate: number | null; disabled: boolean }[];
};
