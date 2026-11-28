/**
 * 오늘의 요트 calendar (LIVE-1). A daily date is the Korea Standard Time calendar day (UTC+9, no
 * daylight saving): it starts at 00:00 KST = 15:00 UTC of the previous UTC day.
 *
 *   open    00:00 KST .. 24:00 KST     a member may START today's official attempt
 *   grace   24:00 KST .. +30 min       an attempt started that day may still be FINISHED
 *   closed  after the grace            ranking is final, the day key is revealed for verification and
 *                                      the date can be replayed by anyone (practice, no ranking)
 */
export const DAILY_RULES = "yacht-12@1" as const;
export type DailyRules = typeof DAILY_RULES;
export const KST_OFFSET_MS = 9 * 3600_000;
export const DAY_MS = 86_400_000;
export const GRACE_MS = 30 * 60_000;
/** The first daily date (archive and puzzle schedule start here). */
export const DAILY_EPOCH = "2026-12-01";

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDailyDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DATE.exec(value);
  if (!m) return false;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return new Date(t).toISOString().slice(0, 10) === value;
}

/** KST calendar date of an instant. */
export function kstDate(now: number): string {
  return new Date(now + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** UTC instant of 00:00 KST on `date`. */
export function dayStart(date: string): number {
  if (!isDailyDate(date)) throw Error("잘못된 날짜입니다.");
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - KST_OFFSET_MS;
}
export const dayEnd = (date: string) => dayStart(date) + DAY_MS;
export const closesAt = (date: string) => dayEnd(date) + GRACE_MS;

export function addDays(date: string, days: number): string {
  return new Date(dayStart(date) + KST_OFFSET_MS + days * DAY_MS).toISOString().slice(0, 10);
}
/** Whole days from `a` to `b` (b - a). */
export const daysBetween = (a: string, b: string) => Math.round((dayStart(b) - dayStart(a)) / DAY_MS);

export type DayPhase = "future" | "open" | "grace" | "closed";
export function dayPhase(date: string, now: number): DayPhase {
  const start = dayStart(date);
  if (now < start) return "future";
  if (now < start + DAY_MS) return "open";
  if (now < start + DAY_MS + GRACE_MS) return "grace";
  return "closed";
}

/** Archive dates (closed days since the epoch), newest first. */
export function archiveDates(now: number, limit = 60): string[] {
  const out: string[] = [];
  let date = addDays(kstDate(now), -1);
  while (out.length < limit && date >= DAILY_EPOCH) {
    if (dayPhase(date, now) === "closed") out.push(date);
    date = addDays(date, -1);
  }
  return out;
}

/** Consecutive participation days ending today or yesterday (for the attendance/streak contract). */
export function dailyStreak(dates: readonly string[], today: string): number {
  const set = new Set(dates);
  let day = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}
