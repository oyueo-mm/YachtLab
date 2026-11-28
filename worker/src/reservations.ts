/**
 * PR118-03: account reservations of live matches (`playing_users`). One row per signed-in account in
 * a match; a second match is refused with IN_MATCH while it exists. Rows are removed when the match
 * ends (the room retries a failed release), when the room is deleted, and by the directory's 6-hour
 * sweep of rooms past retention. This module adds recovery for a lost release that does not wait
 * for those: the holding room is asked, and only a reservation it disowns is dropped. Time alone
 * never releases a match in progress.
 */
export interface ReservationSql {
  exec<T = Record<string, unknown>>(query: string, ...params: unknown[]): { toArray(): T[] };
}

/** Reservations younger than this are never questioned (the room may still be being created). */
export const STALE_RESERVATION_CHECK_MS = 120_000;

export function migrateReservations(sql: ReservationSql) {
  sql.exec("CREATE TABLE IF NOT EXISTS playing_users (user_id TEXT PRIMARY KEY, code TEXT NOT NULL, match_no INTEGER NOT NULL)");
  sql.exec("CREATE INDEX IF NOT EXISTS playing_users_code ON playing_users (code)");
  // When the reservation was made; rows from before this column read as old enough to verify.
  if (!sql.exec<{ name: string }>("PRAGMA table_info(playing_users)").toArray().some((c) => c.name === "at")) sql.exec("ALTER TABLE playing_users ADD COLUMN at INTEGER");
}

export function reserve(sql: ReservationSql, users: string[], code: string, matchNo: number, now: number) {
  for (const id of users) {
    sql.exec("INSERT INTO playing_users (user_id, code, match_no, at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET code = excluded.code, match_no = excluded.match_no, at = excluded.at", id, code, matchNo, now);
  }
}

/**
 * Drop the reservations of `users` (other than in room `except`) that their room no longer holds.
 * `holds` asks the room; a failed question counts as "still held". Returns true when any was dropped.
 */
export async function clearStaleReservations(
  sql: ReservationSql,
  users: string[],
  holds: (code: string, userId: string, matchNo: number) => Promise<boolean>,
  now: number,
  except?: string,
): Promise<boolean> {
  let cleared = false;
  for (const id of users) {
    const row = sql.exec<{ code: string; match_no: number; at: number | null }>("SELECT code, match_no, at FROM playing_users WHERE user_id = ?", id).toArray()[0];
    if (!row || row.code === except || (row.at ?? 0) > now - STALE_RESERVATION_CHECK_MS) continue;
    const held = await holds(row.code, id, row.match_no).catch(() => true);
    if (held) continue;
    // Conditional delete: a new reservation made meanwhile (other code or match) is kept.
    sql.exec("DELETE FROM playing_users WHERE user_id = ? AND code = ? AND match_no = ?", id, row.code, row.match_no);
    cleared = true;
  }
  return cleared;
}
