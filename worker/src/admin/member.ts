import { kstDay, weekOf, monthOf, type ActivityReport, type InboxItem, type SanctionKind } from "./store";

/**
 * ADMIN-1 — what ONE account object (`UserStore`) keeps for the admin and engagement features
 * (runtime-free; node:sqlite in tests). Lives in the account's own SQLite next to AccountStore and
 * EconomyStore, so it is removed with the account.
 *
 *  - `member_activity`: the last active UTC day (one row write per active day) → the activity report;
 *  - `inbox`: rewards (claimable until `expires_at`), sanction and adoption notices. A reward is
 *    credited ONLY by `claim`, which posts one row to the existing economy ledger with the id
 *    `admin:<item id>` (idempotent: a repeated claim or a re-delivered item changes nothing);
 *  - `sanctions`: the restrictions this account is under; enforcement reads `standing()` from here.
 */
export interface MemberSql {
  exec<T = Record<string, unknown>>(query: string, ...params: unknown[]): { toArray(): T[] };
}
export type Standing = { suspendedUntil: number | null; restrictedUntil: number | null; suspended: boolean; restricted: boolean };
export type InboxView = InboxItem & { at: number; claimedAt: number | null; revoked: boolean; expired: boolean };
const FOREVER = 8.64e15;

export class MemberOps {
  constructor(private readonly sql: MemberSql) {}
  init() {
    this.sql.exec("CREATE TABLE IF NOT EXISTS member_activity (id INTEGER PRIMARY KEY CHECK (id = 1), last_day INTEGER NOT NULL)");
    // reports not yet acknowledged by the admin index (sent again until acknowledged; at most 14 days)
    this.sql.exec("CREATE TABLE IF NOT EXISTS activity_outbox (day INTEGER PRIMARY KEY, report TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS inbox (id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, coins INTEGER NOT NULL, gems INTEGER NOT NULL, expires_at INTEGER, at INTEGER NOT NULL, claimed_at INTEGER, revoked INTEGER NOT NULL DEFAULT 0)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS sanctions (id TEXT PRIMARY KEY, kind TEXT NOT NULL, reason TEXT NOT NULL, starts_at INTEGER NOT NULL, until INTEGER, lifted_at INTEGER)");
  }

  /**
   * First call of a KST day queues that day's report (and stores the day); later calls that day: null.
   * The report stays in the outbox until the admin index acknowledges it (`ack`), so a failed or lost
   * delivery is sent again; the index counts each (account, day) once, so a repeat is harmless.
   */
  activity(profile: { userId: string; nickname: string | null; createdAt: number }, now: number): ActivityReport | null {
    const day = kstDay(now);
    const last = this.sql.exec<{ last_day: number }>("SELECT last_day FROM member_activity WHERE id = 1").toArray()[0]?.last_day ?? null;
    if (last !== null && last >= day) return null;
    const report: ActivityReport = {
      userId: profile.userId, nickname: profile.nickname, createdAt: profile.createdAt, day,
      firstInWeek: last === null || weekOf(last) !== weekOf(day),
      firstInMonth: last === null || monthOf(last) !== monthOf(day),
      gapDays: last === null ? null : day - last,
    };
    this.sql.exec("INSERT INTO member_activity (id, last_day) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET last_day = excluded.last_day", day);
    this.sql.exec("INSERT OR REPLACE INTO activity_outbox (day, report) VALUES (?, ?)", day, JSON.stringify(report));
    this.sql.exec("DELETE FROM activity_outbox WHERE day < ?", day - 14);
    return report;
  }
  /** Unacknowledged reports, oldest first. */
  outbox(): ActivityReport[] {
    return this.sql.exec<{ report: string }>("SELECT report FROM activity_outbox ORDER BY day").toArray().map((r) => JSON.parse(r.report) as ActivityReport);
  }
  ack(days: number[]) {
    for (const d of days) this.sql.exec("DELETE FROM activity_outbox WHERE day = ?", d);
  }
  lastActiveDay(): number | null {
    return this.sql.exec<{ last_day: number }>("SELECT last_day FROM member_activity WHERE id = 1").toArray()[0]?.last_day ?? null;
  }

  /* ---------------------------------------------------------------- inbox ---------------------------------------------------------------- */

  /** Idempotent by item id: a re-delivery never adds a second item (or a second reward). */
  deliver(item: InboxItem, now: number): boolean {
    const before = this.sql.exec("SELECT 1 FROM inbox WHERE id = ?", item.id).toArray().length;
    this.sql.exec("INSERT OR IGNORE INTO inbox (id, kind, title, body, coins, gems, expires_at, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      item.id, item.kind, item.title.slice(0, 80), item.body.slice(0, 1000), Math.max(0, item.coins | 0), Math.max(0, item.gems | 0), item.expiresAt, now);
    // keep the mailbox bounded: claimed / expired / revoked items older than 90 days go
    this.sql.exec("DELETE FROM inbox WHERE at < ? AND (claimed_at IS NOT NULL OR revoked = 1 OR (expires_at IS NOT NULL AND expires_at < ?) OR (coins = 0 AND gems = 0))", now - 90 * 86_400_000, now);
    return !before;
  }
  inbox(now: number, limit = 50): InboxView[] {
    return this.sql.exec<{ id: string; kind: InboxItem["kind"]; title: string; body: string; coins: number; gems: number; expires_at: number | null; at: number; claimed_at: number | null; revoked: number }>(
      "SELECT * FROM inbox ORDER BY at DESC LIMIT ?", Math.max(1, Math.min(100, limit)),
    ).toArray().map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, coins: r.coins, gems: r.gems, expiresAt: r.expires_at, at: r.at, claimedAt: r.claimed_at, revoked: !!r.revoked, expired: r.claimed_at === null && (r.expires_at ?? FOREVER) <= now }));
  }
  unclaimed(now: number): number {
    return this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM inbox WHERE claimed_at IS NULL AND revoked = 0 AND (coins > 0 OR gems > 0) AND (expires_at IS NULL OR expires_at > ?)", now).toArray()[0]?.n ?? 0;
  }
  // SEC-1 2차 ECO-4: the old `claim` (ledger `admin:<id>`) was removed — rewards are C5 grants (grant-port.ts).
  /** Take back an UNCLAIMED reward (recovery of a wrong campaign). Claimed ones stay (ledger is append-only). */
  revoke(id: string): boolean {
    const r = this.sql.exec<{ claimed_at: number | null }>("SELECT claimed_at FROM inbox WHERE id = ?", id).toArray()[0];
    if (!r || r.claimed_at !== null) return false;
    this.sql.exec("UPDATE inbox SET revoked = 1 WHERE id = ?", id);
    return true;
  }

  /* -------------------------------------------------------------- sanctions -------------------------------------------------------------- */

  applySanction(s: { id: string; kind: SanctionKind; reason: string; until: number | null }, now: number) {
    if (this.sql.exec("SELECT 1 FROM sanctions WHERE id = ?", s.id).toArray().length) return false;
    this.sql.exec("INSERT INTO sanctions (id, kind, reason, starts_at, until) VALUES (?, ?, ?, ?, ?)", s.id, s.kind, s.reason.slice(0, 500), now, s.until);
    const label = { warning: "경고", nickname_reset: "닉네임 초기화", restrict: "이용 제한", suspend: "이용 정지" }[s.kind];
    const period = s.until ? ` (${new Date(s.until).toISOString().slice(0, 10)}까지)` : s.kind === "suspend" ? " (무기한)" : "";
    this.deliver({ id: "sn:" + s.id, kind: "sanction", title: `${label} 안내${period}`, body: `사유: ${s.reason}\n이의가 있으면 알림함에서 이의제기를 할 수 있어요.`, coins: 0, gems: 0, expiresAt: null }, now);
    return true;
  }
  liftSanction(id: string, now: number) {
    const r = this.sql.exec<{ kind: string }>("SELECT kind FROM sanctions WHERE id = ? AND lifted_at IS NULL", id).toArray()[0];
    if (!r) return false;
    this.sql.exec("UPDATE sanctions SET lifted_at = ? WHERE id = ?", now, id);
    this.deliver({ id: "sl:" + id, kind: "sanction", title: "제재 해제 안내", body: "운영진이 제재를 해제했어요.", coins: 0, gems: 0, expiresAt: null }, now);
    return true;
  }
  sanctions() {
    return this.sql.exec<{ id: string; kind: string; reason: string; starts_at: number; until: number | null; lifted_at: number | null }>("SELECT * FROM sanctions ORDER BY starts_at DESC LIMIT 50").toArray()
      .map((s) => ({ id: s.id, kind: s.kind, reason: s.reason, startsAt: s.starts_at, until: s.until, liftedAt: s.lifted_at }));
  }
  standing(now: number): Standing {
    const active = this.sql.exec<{ kind: string; until: number | null }>("SELECT kind, until FROM sanctions WHERE lifted_at IS NULL AND kind IN ('restrict', 'suspend') AND (until IS NULL OR until > ?)", now).toArray();
    const end = (k: string) => {
      const xs = active.filter((a) => a.kind === k).map((a) => a.until ?? FOREVER);
      return xs.length ? Math.max(...xs) : null;
    };
    const s = end("suspend"), r = end("restrict");
    return { suspendedUntil: s, restrictedUntil: r, suspended: s !== null, restricted: r !== null || s !== null };
  }
}
