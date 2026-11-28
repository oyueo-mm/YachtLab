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
/**
 * C5 (docs/economy/c5/INTEGRATION-C5.md §4): only this kind is continuous ACTIVITY. Puzzles, starts,
 * same-day practice and archive replays are not (they never reach the C5 sink).
 */
export const ACTIVITY_KINDS: ReadonlySet<DailyActivity["kind"]> = new Set(["daily.official.completed"]);

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
  /** Puzzle bank run-out: last scheduled date, scheduled days left after today (warn < 14), whether `date` is a re-run. */
  puzzleBank: { lastScheduledDate: string; runwayDays: number; rerun: boolean };
  puzzles: { id: string; level: string; kind: string; answered: number; correct: number; correctRate: number | null; disabled: boolean }[];
};
