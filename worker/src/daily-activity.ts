import type { DailyActivity } from "../../src/daily/contract";

/**
 * LIVE-1 → C5 retention adapter (docs/economy/c5/INTEGRATION-C5.md §4, PR #140).
 *
 * C5 adds `UserStore.dailyContentDone({ kind, at })` (RetentionStore.onDailyContent): one active day for the
 * continuous-activity streak, milestone grants inside C5's own transaction. Daily-content COINS stay
 * unapproved (`NO_DAILY_REWARDS`). This adapter is the only caller:
 *
 *  - only `daily.official.completed`, only after the server judged the OFFICIAL attempt finished;
 *    practice, archive replays, puzzle answers and starts are never activity
 *  - `at` is the server's finish time (never a client value)
 *  - idempotent from LIVE-1's side: it runs in the board-submission flush, which marks the attempt
 *    submitted only after both the board and this sink accepted it (C5 also counts one active day per day)
 *  - while C5 is not merged the sink is absent and this is a no-op
 */
export type DailyContentSink = { dailyContentDone(activity: { kind: string; at: number }): Promise<unknown> | unknown };
export type CompletedAttempt = { mode: "official" | "practice"; status: string; finishedAt: number | null };

export function activityFor(a: CompletedAttempt, userId: string, date: string, rules: string, score: number, ranked: boolean): Extract<DailyActivity, { kind: "daily.official.completed" }> | null {
  if (a.mode !== "official" || a.status !== "finished" || a.finishedAt === null) return null;
  return { kind: "daily.official.completed", userId, date, rules, score, ranked, at: a.finishedAt };
}

/** Throws when the sink throws, so the caller keeps the attempt pending and retries later. */
export async function reportCompletion(sink: Partial<DailyContentSink> | null | undefined, activity: DailyActivity | null): Promise<"sent" | "skipped"> {
  if (!activity || activity.kind !== "daily.official.completed") return "skipped";
  if (!sink || typeof sink.dailyContentDone !== "function") return "skipped";
  await sink.dailyContentDone({ kind: activity.kind, at: activity.at });
  return "sent";
}
