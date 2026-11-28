import { randomToken, sha256 } from "../oidc";
import { GRANT_CAPS, type ActionKind, type Role } from "./roles";

/**
 * ADMIN-1 — the logic of the one global `AdminHub` Durable Object (runtime-free; tested in Node with
 * node:sqlite). It holds ONLY what the admin console needs and nothing an account object already keeps:
 *
 *  - admin sessions (hashed tokens), the append-only audit log;
 *  - a privacy-light member index (account id, public nickname, join time, last active UTC day,
 *    sanction status) that accounts write themselves at most once per active day — so the console never
 *    walks every account object, and the index only knows accounts active since it was deployed;
 *  - daily activity aggregates (DAU, first-in-week / first-in-month for exact WAU / MAU without ids,
 *    sign-ups, deletions, return gaps);
 *  - drafted actions and their approvals, reward campaigns and their per-account deliveries, redeem
 *    codes and redemptions, notices, reports, the sanction registry and appeals.
 *
 * Coins and gems are NEVER changed here: deliveries go to the account's own mailbox, and claiming
 * posts one row to that account's existing economy ledger (worker/src/economy.ts, idempotent by id).
 */
export interface AdminSql {
  exec<T = Record<string, unknown>>(query: string, ...params: unknown[]): { toArray(): T[] };
  transaction?<T>(fn: () => T): T;
}

export const ADMIN_LIMITS = {
  /** Safety caps per recipient = C5 `operator` grant limits (NOT the reward policy: amounts need approval). */
  maxCoinsEach: GRANT_CAPS.operator.coins,
  maxGemsEach: GRANT_CAPS.operator.gems,
  maxRecipients: 100_000,
  maxScheduleAheadMs: 60 * 86_400_000,
  maxExpiryMs: 90 * 86_400_000,
  minExpiryMs: 3600_000,
  deliveryBatch: 25,
  deliveryAttempts: 6,
  auditPage: 100,
  pageSize: 50,
  codeMaxTotal: 100_000,
  codeMaxPerAccount: 10,
} as const;

export const DAY_MS = 86_400_000;
export const utcDay = (t: number) => Math.floor(t / DAY_MS);
/**
 * Member activity days are KST (UTC+9, no DST) — the same day the economy, quests and LIVE-1 daily
 * content reset on (`economyDay`). A KST day number d covers [d·24h − 9h, (d+1)·24h − 9h) UTC.
 * MatchHub counters stay UTC days (C3); the console labels each.
 */
export const KST_OFFSET_MS = 9 * 3600_000;
export const kstDay = (t: number) => Math.floor((t + KST_OFFSET_MS) / DAY_MS);
/** Monday-based week number (1970-01-01 was a Thursday). */
export const weekOf = (day: number) => Math.floor((day + 3) / 7);
export const monthOf = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 7);
const iso = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

export type ActivityReport = {
  userId: string;
  nickname: string | null;
  createdAt: number;
  day: number;
  /** First active day of this account in this week / month (decided by the account, which knows its last day). */
  firstInWeek: boolean;
  firstInMonth: boolean;
  /** Days since the previous active day; null = first ever report. */
  gapDays: number | null;
};
/**
 * Retention of moderation data (D-ADM-7, proposal pending the privacy policy #126 — operator approval):
 *  - a deleted account's sanctions still in force are kept (minimal fields) until they end, so deletion
 *    is not a way out; a permanent suspension is kept for at most `permanentSanctionMs`, then deleted;
 *  - finished sanctions (warning, nickname reset, expired, lifted) of a deleted account lose their
 *    reason text at deletion and the rows go after `closedRecordMs`;
 *  - appeals of a deleted account lose their text at deletion; reports it filed lose the reporter id.
 */
export const RETENTION = { closedRecordMs: 365 * DAY_MS, permanentSanctionMs: 365 * DAY_MS, reauthTicketMs: 2 * 60_000 } as const;

export type Target =
  | { type: "users"; userIds: string[] }
  | { type: "segment"; joinedAfter?: number; joinedBefore?: number; activeWithinDays?: number }
  | { type: "all" };
export type RewardPayload = { title: string; message: string; coins: number; gems: number; target: Target; scheduledAt: number; expiresAt: number; policyVersion?: string };
export type CodePayload = { codeId: string };
export type SanctionKind = "warning" | "nickname_reset" | "restrict" | "suspend";
export type SanctionPayload = { userId: string; kind: SanctionKind; reason: string; days: number | null; reportId: string | null };
export type SuggestionRewardPayload = { suggestionId: string; userId: string; coins: number; gems: number; reason: string; policyVersion?: string };

export type InboxItem = {
  id: string;
  kind: "reward" | "sanction" | "notice" | "suggestion";
  title: string;
  body: string;
  coins: number;
  gems: number;
  expiresAt: number | null;
};
export type DeliverResult = "ok" | "absent";

type Fail = { ok: false; code: string; message: string };
const fail = (code: string, message: string): Fail => ({ ok: false, code, message });

const USER = /^u_[A-Za-z0-9_-]{22}$/;
const CODE = /^[A-Z0-9]{6,20}$/;
/** Plain text: control characters removed, trimmed, length-capped. Rendered as text only (never HTML). */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.normalize("NFC").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "").replace(/\r\n?/g, "\n").trim().slice(0, max);
}
export const normalizeRedeemCode = (v: unknown) => (typeof v === "string" ? v.toUpperCase().replace(/[\s-]/g, "") : "");

export class AdminCore {
  constructor(private readonly sql: AdminSql) {}

  private tx<T>(fn: () => T): T {
    return this.sql.transaction ? this.sql.transaction(fn) : fn();
  }
  private one<T>(q: string, ...p: unknown[]): T | undefined {
    return this.sql.exec<T>(q, ...p).toArray()[0];
  }
  private all<T>(q: string, ...p: unknown[]): T[] {
    return this.sql.exec<T>(q, ...p).toArray();
  }

  init() {
    const s = (q: string) => this.sql.exec(q);
    s("CREATE TABLE IF NOT EXISTS admin_sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at INTEGER NOT NULL, last_used INTEGER NOT NULL, reauth_at INTEGER)");
    s("CREATE TABLE IF NOT EXISTS admin_reauth (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, cs_hash TEXT NOT NULL, auth_time INTEGER NOT NULL, expires INTEGER NOT NULL)");
    s("CREATE TABLE IF NOT EXISTS deletions (user_id TEXT NOT NULL, deleted_at INTEGER NOT NULL, PRIMARY KEY (user_id, deleted_at))");
    s("CREATE TABLE IF NOT EXISTS self_approvals (day INTEGER PRIMARY KEY, n INTEGER NOT NULL)");
    s("CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL, role TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, result TEXT NOT NULL, detail TEXT NOT NULL, client TEXT NOT NULL)");
    s("CREATE INDEX IF NOT EXISTS audit_actor ON audit (actor, seq)");
    s("CREATE TABLE IF NOT EXISTS members (user_id TEXT PRIMARY KEY, nickname TEXT, created_at INTEGER NOT NULL, last_day INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'ok', status_until INTEGER)");
    s("CREATE INDEX IF NOT EXISTS members_created ON members (created_at)");
    s("CREATE INDEX IF NOT EXISTS members_last ON members (last_day)");
    s("CREATE TABLE IF NOT EXISTS activity_days (day INTEGER PRIMARY KEY, data TEXT NOT NULL)");
    s("CREATE TABLE IF NOT EXISTS actions (id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, preview TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, decided_by TEXT, decided_at INTEGER, result TEXT)");
    s("CREATE INDEX IF NOT EXISTS actions_status ON actions (status, created_at)");
    s("CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY, action_id TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, status TEXT NOT NULL, scheduled_at INTEGER NOT NULL, created_at INTEGER NOT NULL)");
    s("CREATE TABLE IF NOT EXISTS deliveries (campaign_id TEXT NOT NULL, user_id TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL, next_at INTEGER NOT NULL, at INTEGER, PRIMARY KEY (campaign_id, user_id))");
    s("CREATE INDEX IF NOT EXISTS deliveries_due ON deliveries (status, next_at)");
    s("CREATE TABLE IF NOT EXISTS codes (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, title TEXT NOT NULL, coins INTEGER NOT NULL, gems INTEGER NOT NULL, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, max_total INTEGER NOT NULL, per_account INTEGER NOT NULL, joined_before INTEGER, status TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL)");
    s("CREATE TABLE IF NOT EXISTS redemptions (id TEXT NOT NULL, code_id TEXT NOT NULL, user_id TEXT NOT NULL, n INTEGER NOT NULL, status TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (code_id, user_id, n))");
    s("CREATE INDEX IF NOT EXISTS redemptions_code ON redemptions (code_id, user_id)");
    s("CREATE TABLE IF NOT EXISTS notices (id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, important INTEGER NOT NULL, publish_at INTEGER NOT NULL, end_at INTEGER, status TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL)");
    s("CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, reporter TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, reason TEXT NOT NULL, detail TEXT NOT NULL, match_id TEXT, status TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
    s("CREATE INDEX IF NOT EXISTS reports_status ON reports (status, created_at)");
    s("CREATE INDEX IF NOT EXISTS reports_reporter ON reports (reporter, created_at)");
    s("CREATE TABLE IF NOT EXISTS sanctions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, reason TEXT NOT NULL, starts_at INTEGER NOT NULL, until INTEGER, status TEXT NOT NULL, report_id TEXT, action_id TEXT, created_by TEXT NOT NULL, lifted_by TEXT, lifted_at INTEGER, lift_reason TEXT, purge_at INTEGER)");
    s("CREATE INDEX IF NOT EXISTS sanctions_user ON sanctions (user_id, starts_at)");
    s("CREATE TABLE IF NOT EXISTS appeals (id TEXT PRIMARY KEY, sanction_id TEXT NOT NULL, user_id TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL, answer TEXT NOT NULL DEFAULT '', answered_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
    s("CREATE INDEX IF NOT EXISTS appeals_status ON appeals (status, created_at)");
  }

  /* ------------------------------------------------------------ admin sessions ------------------------------------------------------------ */

  /**
   * A Google re-authentication of an administrator → one-time ticket (2 minutes), bound to the browser
   * tab that started it (client-state hash) and to the account.
   */
  async createReauth(userId: string, csHash: string, authTime: number, now: number): Promise<string> {
    const ticket = randomToken();
    this.sql.exec("DELETE FROM admin_reauth WHERE expires <= ? OR user_id = ?", now, userId);
    this.sql.exec("INSERT INTO admin_reauth (hash, user_id, cs_hash, auth_time, expires) VALUES (?, ?, ?, ?, ?)", await sha256(ticket), userId, csHash, authTime, now + RETENTION.reauthTicketMs);
    return ticket;
  }
  /** Use a ticket once: same account, same tab (client state), not expired → the Google auth time. */
  async consumeReauth(ticket: unknown, userId: string, clientState: unknown, now: number): Promise<number | null> {
    if (typeof ticket !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(ticket) || typeof clientState !== "string" || clientState.length < 20 || clientState.length > 128) return null;
    const hash = await sha256(ticket);
    const row = this.one<{ user_id: string; cs_hash: string; auth_time: number; expires: number }>("SELECT user_id, cs_hash, auth_time, expires FROM admin_reauth WHERE hash = ?", hash);
    this.sql.exec("DELETE FROM admin_reauth WHERE hash = ?", hash);
    if (!row || row.expires <= now || row.user_id !== userId || row.cs_hash !== (await sha256(clientState))) return null;
    return row.auth_time;
  }
  /** `reauthAt`: time of the Google re-authentication behind this session (null = session-only mode, local tests). */
  async createSession(userId: string, role: Role, now: number, reauthAt: number | null = null): Promise<string> {
    const token = "a1." + randomToken();
    this.sql.exec("DELETE FROM admin_sessions WHERE user_id = ? AND hash NOT IN (SELECT hash FROM admin_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 2)", userId, userId);
    this.sql.exec("INSERT INTO admin_sessions (hash, user_id, role, created_at, last_used, reauth_at) VALUES (?, ?, ?, ?, ?, ?)", await sha256(token), userId, role, now, now, reauthAt);
    return token;
  }
  /** A live admin session (idle and absolute expiry), touched at most once a minute. */
  async checkSession(token: string, now: number, limits: { idleMs: number; absoluteMs: number }): Promise<{ userId: string; createdAt: number; reauthAt: number | null } | null> {
    if (!/^a1\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const hash = await sha256(token);
    const row = this.one<{ user_id: string; created_at: number; last_used: number; reauth_at: number | null }>("SELECT user_id, created_at, last_used, reauth_at FROM admin_sessions WHERE hash = ?", hash);
    if (!row) return null;
    if (now - row.last_used > limits.idleMs || now - row.created_at > limits.absoluteMs) {
      this.sql.exec("DELETE FROM admin_sessions WHERE hash = ?", hash);
      return null;
    }
    if (now - row.last_used > 60_000) this.sql.exec("UPDATE admin_sessions SET last_used = ? WHERE hash = ?", now, hash);
    return { userId: row.user_id, createdAt: row.created_at, reauthAt: row.reauth_at };
  }
  async endSession(token: string) {
    if (/^a1\./.test(token)) this.sql.exec("DELETE FROM admin_sessions WHERE hash = ?", await sha256(token));
  }
  endSessionsOf(userId: string) {
    this.sql.exec("DELETE FROM admin_sessions WHERE user_id = ?", userId);
  }
  pruneSessions(now: number, absoluteMs: number) {
    this.sql.exec("DELETE FROM admin_sessions WHERE created_at < ?", now - absoluteMs);
  }

  /* ---------------------------------------------------------------- audit ---------------------------------------------------------------- */

  audit(e: { at: number; actor: string; role: string; action: string; target?: string; result: string; detail?: unknown; client?: string }) {
    const detail = JSON.stringify(e.detail ?? {}).slice(0, 2000);
    this.sql.exec("INSERT INTO audit (at, actor, role, action, target, result, detail, client) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", e.at, e.actor, e.role, e.action, e.target ?? "", e.result, detail, e.client ?? "");
  }
  auditLog(q: { actor?: string; action?: string; before?: number; limit?: number }) {
    const limit = Math.max(1, Math.min(ADMIN_LIMITS.auditPage, q.limit ?? 50));
    const rows = this.all<{ seq: number; at: number; actor: string; role: string; action: string; target: string; result: string; detail: string }>(
      "SELECT seq, at, actor, role, action, target, result, detail FROM audit WHERE (? = '' OR actor = ?) AND (? = '' OR action LIKE ?) AND seq < ? ORDER BY seq DESC LIMIT ?",
      q.actor ?? "", q.actor ?? "", q.action ?? "", (q.action ?? "") + "%", q.before ?? Number.MAX_SAFE_INTEGER, limit,
    );
    return { entries: rows.map((r) => ({ ...r, detail: JSON.parse(r.detail) as unknown })), next: rows.length === limit ? rows[rows.length - 1].seq : null };
  }

  /* --------------------------------------------------------- members and activity --------------------------------------------------------- */

  private bump(day: number, counts: Record<string, number>) {
    const row = this.one<{ data: string }>("SELECT data FROM activity_days WHERE day = ?", day);
    const data = row ? (JSON.parse(row.data) as Record<string, number>) : {};
    for (const [k, n] of Object.entries(counts)) if (n) data[k] = (data[k] ?? 0) + n;
    this.sql.exec("INSERT INTO activity_days (day, data) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET data = excluded.data", day, JSON.stringify(data));
  }
  /**
   * Reports of one account, oldest first (the account sends its whole unsent queue in one call, so they
   * arrive in order). Each (account, day) counts once: a retried report whose answer was lost is ignored.
   */
  activityBatch(reports: ActivityReport[]): number {
    let applied = 0;
    for (const r of [...reports].sort((a, b) => a.day - b.day)) if (this.activity(r)) applied++;
    return applied;
  }
  /** One account's first activity of a KST day (sent by the account object itself). True = counted. */
  activity(r: ActivityReport): boolean {
    if (!USER.test(r.userId) || !Number.isInteger(r.day)) return false;
    return this.tx(() => {
      const known = this.one<{ last_day: number }>("SELECT last_day FROM members WHERE user_id = ?", r.userId);
      if (known && known.last_day >= r.day) return false;
      this.sql.exec(
        "INSERT INTO members (user_id, nickname, created_at, last_day) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET nickname = excluded.nickname, last_day = excluded.last_day",
        r.userId, r.nickname, r.createdAt, r.day,
      );
      const gap = r.gapDays;
      this.bump(r.day, {
        active: 1,
        weekFirst: r.firstInWeek ? 1 : 0,
        monthFirst: r.firstInMonth ? 1 : 0,
        "return.new": gap === null ? 1 : 0,
        "return.1d": gap === 1 ? 1 : 0,
        "return.2-7d": gap !== null && gap >= 2 && gap <= 7 ? 1 : 0,
        "return.8-30d": gap !== null && gap >= 8 && gap <= 30 ? 1 : 0,
        "return.31d+": gap !== null && gap > 30 ? 1 : 0,
      });
      return true;
    });
  }
  /**
   * A new account. Returns the sanctions still in force for this id (an account deleted while
   * restricted or suspended gets them back when it signs up again: deletion is not a way out).
   */
  signup(userId: string, now: number): { id: string; kind: SanctionKind; reason: string; until: number | null }[] {
    if (!USER.test(userId)) return [];
    this.bump(kstDay(now), { signup: 1 });
    return this.all<{ id: string; kind: SanctionKind; reason: string; until: number | null }>(
      "SELECT id, kind, reason, until FROM sanctions WHERE user_id = ? AND status = 'active' AND kind IN ('restrict', 'suspend') AND (until IS NULL OR until > ?)", userId, now);
  }
  /**
   * A deleted account leaves the index; only a counter remains. Idempotent and GENERATION-SAFE (it is
   * retried by the deleted account's cleanup queue, possibly after the same Google account re-joined):
   * only rows that existed before `deletedAt` are touched, and the deletion is counted once.
   * Moderation data follows the retention rules (RETENTION).
   */
  deleted(userId: string, deletedAt: number) {
    if (!USER.test(userId) || !Number.isFinite(deletedAt)) return;
    this.tx(() => {
      const first = !this.one("SELECT 1 FROM deletions WHERE user_id = ? AND deleted_at = ?", userId, deletedAt);
      this.sql.exec("DELETE FROM members WHERE user_id = ? AND created_at <= ?", userId, deletedAt);
      this.sql.exec("DELETE FROM deliveries WHERE user_id = ? AND status = 'pending'", userId);
      // finished sanctions: reason text goes now, the row after closedRecordMs
      this.sql.exec("UPDATE sanctions SET reason = '(탈퇴 계정)', lift_reason = NULL, purge_at = ? WHERE user_id = ? AND starts_at <= ? AND (status != 'active' OR kind IN ('warning', 'nickname_reset'))", deletedAt + RETENTION.closedRecordMs, userId, deletedAt);
      // sanctions still in force: kept until they end (permanent: at most permanentSanctionMs)
      this.sql.exec("UPDATE sanctions SET purge_at = coalesce(until, ?) WHERE user_id = ? AND starts_at <= ? AND status = 'active' AND kind IN ('restrict', 'suspend')", deletedAt + RETENTION.permanentSanctionMs, userId, deletedAt);
      this.sql.exec("UPDATE appeals SET text = '(탈퇴 계정)' WHERE user_id = ? AND created_at <= ?", userId, deletedAt);
      this.sql.exec("UPDATE reports SET reporter = 'deleted' WHERE reporter = ? AND created_at <= ?", userId, deletedAt);
      if (first) {
        this.sql.exec("INSERT INTO deletions (user_id, deleted_at) VALUES (?, ?)", userId, deletedAt);
        this.bump(kstDay(deletedAt), { deleted: 1 });
      }
    });
  }
  /** Retention sweep (alarm): moderation rows past `purge_at`, appeals of purged sanctions, old deletion marks. */
  purgeRetention(now: number) {
    this.tx(() => {
      this.sql.exec("DELETE FROM appeals WHERE sanction_id IN (SELECT id FROM sanctions WHERE purge_at IS NOT NULL AND purge_at <= ?)", now);
      this.sql.exec("DELETE FROM sanctions WHERE purge_at IS NOT NULL AND purge_at <= ?", now);
      this.sql.exec("DELETE FROM reports WHERE reporter = 'deleted' AND status IN ('resolved', 'dismissed') AND updated_at <= ?", now - RETENTION.closedRecordMs);
      this.sql.exec("DELETE FROM deletions WHERE deleted_at <= ?", now - 90 * DAY_MS);
      this.sql.exec("DELETE FROM admin_reauth WHERE expires <= ?", now);
    });
  }
  nicknameChanged(userId: string, nickname: string | null) {
    this.sql.exec("UPDATE members SET nickname = ? WHERE user_id = ?", nickname, userId);
  }

  activityReport(days: number, now: number) {
    const today = kstDay(now);
    const from = today - Math.max(1, Math.min(120, days)) + 1;
    const rows = this.all<{ day: number; data: string }>("SELECT day, data FROM activity_days WHERE day >= ? ORDER BY day", from - 31);
    const byDay = new Map(rows.map((r) => [r.day, JSON.parse(r.data) as Record<string, number>]));
    const list = [] as { day: string; dau: number; wau: number; mau: number; signups: number; deleted: number; returns: Record<string, number> }[];
    for (let d = from; d <= today; d++) {
      const m = byDay.get(d) ?? {};
      // WAU/MAU of the week/month containing d, counted up to d (distinct by construction).
      let wau = 0, mau = 0;
      for (let x = d; x >= d - 31; x--) {
        const mx = byDay.get(x);
        if (!mx) continue;
        if (weekOf(x) === weekOf(d)) wau += mx.weekFirst ?? 0;
        if (monthOf(x) === monthOf(d)) mau += mx.monthFirst ?? 0;
      }
      list.push({
        day: iso(d), dau: m.active ?? 0, wau, mau, signups: m.signup ?? 0, deleted: m.deleted ?? 0,
        returns: Object.fromEntries(Object.entries(m).filter(([k]) => k.startsWith("return.")).map(([k, v]) => [k.slice(7), v])),
      });
    }
    const first = this.one<{ day: number }>("SELECT min(day) AS day FROM activity_days");
    const members = this.one<{ n: number }>("SELECT count(*) AS n FROM members")?.n ?? 0;
    return { timezone: "Asia/Seoul", since: first?.day == null ? null : iso(first.day), indexedMembers: members, days: list };
  }

  searchMembers(q: { nickname?: string; userId?: string; status?: string; sort?: "created" | "active"; page?: number }) {
    const page = Math.max(0, Math.floor(q.page ?? 0));
    const like = q.nickname ? "%" + q.nickname.replace(/[%_\\]/g, (c) => "\\" + c) + "%" : "";
    const order = q.sort === "active" ? "last_day DESC, created_at DESC" : "created_at DESC";
    const where = "(? = '' OR user_id = ?) AND (? = '' OR nickname LIKE ? ESCAPE '\\') AND (? = '' OR status = ?)";
    const args = [q.userId ?? "", q.userId ?? "", like, like, q.status ?? "", q.status ?? ""];
    const total = this.one<{ n: number }>(`SELECT count(*) AS n FROM members WHERE ${where}`, ...args)?.n ?? 0;
    const rows = this.all<{ user_id: string; nickname: string | null; created_at: number; last_day: number; status: string; status_until: number | null }>(
      `SELECT user_id, nickname, created_at, last_day, status, status_until FROM members WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, ...args, ADMIN_LIMITS.pageSize, page * ADMIN_LIMITS.pageSize,
    );
    return { total, page, pageSize: ADMIN_LIMITS.pageSize, members: rows.map((r) => ({ userId: r.user_id, nickname: r.nickname, createdAt: r.created_at, lastActive: iso(r.last_day), status: r.status, statusUntil: r.status_until })) };
  }
  member(userId: string) {
    return this.one<{ user_id: string; created_at: number; status: string }>("SELECT user_id, created_at, status FROM members WHERE user_id = ?", userId) ?? null;
  }

  /** Account ids a target selects (members index only; a "users" target is validated per id at delivery). */
  resolveTarget(t: Target, now: number): string[] {
    if (t.type === "users") return [...new Set(t.userIds.filter((id) => USER.test(id)))].slice(0, ADMIN_LIMITS.maxRecipients);
    if (t.type === "all") return this.all<{ user_id: string }>("SELECT user_id FROM members ORDER BY created_at LIMIT ?", ADMIN_LIMITS.maxRecipients).map((r) => r.user_id);
    const since = t.activeWithinDays ? kstDay(now) - t.activeWithinDays + 1 : -1;
    return this.all<{ user_id: string }>(
      "SELECT user_id FROM members WHERE created_at >= ? AND created_at < ? AND last_day >= ? ORDER BY created_at LIMIT ?",
      t.joinedAfter ?? 0, t.joinedBefore ?? Number.MAX_SAFE_INTEGER, since, ADMIN_LIMITS.maxRecipients,
    ).map((r) => r.user_id);
  }

  /* ------------------------------------------------------------- actions ------------------------------------------------------------- */

  draft(kind: ActionKind, payload: unknown, preview: unknown, by: string, now: number): string {
    const id = "act_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
    this.sql.exec("INSERT INTO actions (id, kind, status, payload, preview, created_by, created_at) VALUES (?, ?, 'pending', ?, ?, ?, ?)", id, kind, JSON.stringify(payload), JSON.stringify(preview), by, now);
    return id;
  }
  action(id: string) {
    const r = this.one<{ id: string; kind: ActionKind; status: string; payload: string; preview: string; created_by: string; created_at: number; decided_by: string | null; decided_at: number | null; result: string | null }>("SELECT * FROM actions WHERE id = ?", id);
    return r ? { ...r, payload: JSON.parse(r.payload) as unknown, preview: JSON.parse(r.preview) as unknown, result: r.result ? (JSON.parse(r.result) as unknown) : null } : null;
  }
  actions(status: string | null, page = 0) {
    return this.all<{ id: string; kind: string; status: string; preview: string; created_by: string; created_at: number; decided_by: string | null; decided_at: number | null; result: string | null }>(
      "SELECT id, kind, status, preview, created_by, created_at, decided_by, decided_at, result FROM actions WHERE (? IS NULL OR status = ?) ORDER BY created_at DESC LIMIT ? OFFSET ?", status, status, ADMIN_LIMITS.pageSize, page * ADMIN_LIMITS.pageSize,
    ).map((r) => ({ ...r, preview: JSON.parse(r.preview) as unknown, result: r.result ? (JSON.parse(r.result) as unknown) : null }));
  }
  /** pending → approved (by an approver; the creator only when self-approval is configured) or rejected/cancelled. */
  /** Single-operator policy: count one self-approval against today's (KST) budget; false = budget spent. */
  useSelfApproval(now: number, perDay: number): boolean {
    const day = kstDay(now);
    const n = this.one<{ n: number }>("SELECT n FROM self_approvals WHERE day = ?", day)?.n ?? 0;
    if (n >= perDay) return false;
    this.sql.exec("INSERT INTO self_approvals (day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1", day);
    this.sql.exec("DELETE FROM self_approvals WHERE day < ?", day - 30);
    return true;
  }
  /** `selfApprove` = the caller already checked the single-operator rules for this draft. */
  decide(id: string, by: string, decision: "approved" | "rejected" | "cancelled", now: number, selfApprove: boolean): { ok: true } | Fail {
    const a = this.action(id);
    if (!a) return fail("NOT_FOUND", "작업을 찾을 수 없어요.");
    if (a.status !== "pending") return fail("STATE", "이미 처리된 작업이에요.");
    if (decision === "cancelled" && a.created_by !== by) return fail("FORBIDDEN", "작성자만 취소할 수 있어요.");
    if (decision === "approved" && a.created_by === by && !selfApprove) return fail("SECOND_APPROVER", "작성자가 아닌 다른 관리자가 승인해야 해요.");
    this.sql.exec("UPDATE actions SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'", decision, by, now, id);
    return { ok: true };
  }
  finishAction(id: string, status: "executed" | "failed", result: unknown) {
    this.sql.exec("UPDATE actions SET status = ?, result = ? WHERE id = ?", status, JSON.stringify(result).slice(0, 4000), id);
  }

  /* ------------------------------------------------------------ reward campaigns ------------------------------------------------------------ */

  /** Validate a reward request (amounts, schedule, expiry, target). The economy owner sets real amounts. */
  checkReward(raw: unknown, now: number): { ok: true; payload: RewardPayload } | Fail {
    const r = (raw ?? {}) as Record<string, unknown>;
    const title = cleanText(r.title, 60);
    const message = cleanText(r.message, 500);
    const coins = Number(r.coins ?? 0), gems = Number(r.gems ?? 0);
    if (title.length < 2) return fail("INVALID", "보상 제목을 입력해 주세요.");
    if (!Number.isInteger(coins) || !Number.isInteger(gems) || coins < 0 || gems < 0 || coins + gems === 0) return fail("INVALID", "지급량은 0 이상의 정수이고 하나 이상이어야 해요.");
    if (coins > ADMIN_LIMITS.maxCoinsEach || gems > ADMIN_LIMITS.maxGemsEach) return fail("LIMIT", `1인당 안전 상한(코인 ${ADMIN_LIMITS.maxCoinsEach}, 보석 ${ADMIN_LIMITS.maxGemsEach})을 넘어요.`);
    const scheduledAt = r.scheduledAt === undefined || r.scheduledAt === null ? now : Number(r.scheduledAt);
    const expiresAt = Number(r.expiresAt);
    if (!Number.isFinite(scheduledAt) || scheduledAt < now - 60_000 || scheduledAt > now + ADMIN_LIMITS.maxScheduleAheadMs) return fail("INVALID", "지급 예약 시각이 올바르지 않아요.");
    if (!Number.isFinite(expiresAt) || expiresAt < scheduledAt + ADMIN_LIMITS.minExpiryMs || expiresAt > scheduledAt + ADMIN_LIMITS.maxExpiryMs) return fail("INVALID", "만료 시각은 지급 후 1시간~90일 사이여야 해요.");
    const t = (r.target ?? {}) as Record<string, unknown>;
    let target: Target;
    if (t.type === "users" && Array.isArray(t.userIds)) {
      const ids = (t.userIds as unknown[]).filter((x): x is string => typeof x === "string" && USER.test(x));
      if (!ids.length || ids.length !== (t.userIds as unknown[]).length) return fail("INVALID", "회원 ID 형식이 올바르지 않아요.");
      target = { type: "users", userIds: [...new Set(ids)] };
    } else if (t.type === "segment") {
      const num = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : Number(v));
      const seg = { joinedAfter: num(t.joinedAfter), joinedBefore: num(t.joinedBefore), activeWithinDays: num(t.activeWithinDays) };
      if (Object.values(seg).some((v) => v !== undefined && (!Number.isFinite(v) || v < 0))) return fail("INVALID", "조건 값이 올바르지 않아요.");
      if (seg.activeWithinDays !== undefined && (seg.activeWithinDays < 1 || seg.activeWithinDays > 365)) return fail("INVALID", "최근 활동 일수는 1~365일이에요.");
      target = { type: "segment", ...seg };
    } else if (t.type === "all") target = { type: "all" };
    else return fail("INVALID", "지급 대상을 골라 주세요.");
    return { ok: true, payload: { title, message, coins, gems, target, scheduledAt, expiresAt } };
  }
  previewReward(p: RewardPayload, now: number) {
    const ids = this.resolveTarget(p.target, now);
    return { recipients: ids.length, coinsEach: p.coins, gemsEach: p.gems, totalCoins: ids.length * p.coins, totalGems: ids.length * p.gems, target: p.target.type === "users" ? { type: "users", count: p.target.userIds.length } : p.target, scheduledAt: p.scheduledAt, expiresAt: p.expiresAt, note: p.target.type === "users" ? "존재하지 않는 계정은 지급 시 건너뜀" : "회원 색인 기준(색인 배포 이후 활동한 계정만 포함)" };
  }
  /** After approval: one campaign per action (unique), deliveries materialised at the scheduled time. */
  scheduleCampaign(actionId: string, p: RewardPayload, now: number) {
    const id = "rw_" + actionId.slice(4);
    // the mailbox item / grant id follows the C5 RewardGrants txId rule: op:<campaignId> (one per account)
    this.sql.exec("INSERT OR IGNORE INTO campaigns (id, action_id, payload, status, scheduled_at, created_at) VALUES (?, ?, ?, 'scheduled', ?, ?)", id, actionId, JSON.stringify(p), p.scheduledAt, now);
    return id;
  }
  campaigns(page = 0) {
    return this.all<{ id: string; action_id: string; payload: string; status: string; scheduled_at: number; created_at: number }>("SELECT * FROM campaigns ORDER BY created_at DESC LIMIT ? OFFSET ?", ADMIN_LIMITS.pageSize, page * ADMIN_LIMITS.pageSize).map((c) => {
      const counts = Object.fromEntries(this.all<{ status: string; n: number }>("SELECT status, count(*) AS n FROM deliveries WHERE campaign_id = ? GROUP BY status", c.id).map((r) => [r.status, r.n]));
      const p = JSON.parse(c.payload) as RewardPayload;
      return { id: c.id, actionId: c.action_id, status: c.status, scheduledAt: c.scheduled_at, createdAt: c.created_at, title: p.title, coins: p.coins, gems: p.gems, expiresAt: p.expiresAt, target: p.target.type, deliveries: counts };
    });
  }
  cancelCampaign(id: string) {
    return this.tx(() => {
      const c = this.one<{ status: string }>("SELECT status FROM campaigns WHERE id = ?", id);
      if (!c) return fail("NOT_FOUND", "캠페인을 찾을 수 없어요.");
      this.sql.exec("UPDATE campaigns SET status = 'cancelled' WHERE id = ?", id);
      this.sql.exec("UPDATE deliveries SET status = 'cancelled' WHERE campaign_id = ? AND status IN ('pending', 'failed')", id);
      return { ok: true as const, delivered: this.one<{ n: number }>("SELECT count(*) AS n FROM deliveries WHERE campaign_id = ? AND status = 'done'", id)?.n ?? 0 };
    });
  }
  /** Failed deliveries back to pending (safe: the mailbox item and the ledger id are both idempotent). */
  retryFailed(id: string, now: number) {
    const c = this.one<{ status: string }>("SELECT status FROM campaigns WHERE id = ?", id);
    if (!c || c.status === "cancelled") return fail("STATE", "다시 보낼 수 없는 캠페인이에요.");
    this.tx(() => {
      this.sql.exec("UPDATE deliveries SET status = 'pending', attempts = 0, next_at = ? WHERE campaign_id = ? AND status = 'failed'", now, id);
      if (c.status === "sent") this.sql.exec("UPDATE campaigns SET status = 'sending' WHERE id = ?", id);
    });
    return { ok: true as const };
  }
  /** Due campaigns materialise their deliveries; due deliveries are handed to `deliver` in a small batch. */
  async process(now: number, deliver: (userId: string, item: InboxItem) => Promise<DeliverResult>) {
    for (const c of this.all<{ id: string; payload: string }>("SELECT id, payload FROM campaigns WHERE status = 'scheduled' AND scheduled_at <= ?", now)) {
      const p = JSON.parse(c.payload) as RewardPayload;
      const ids = this.resolveTarget(p.target, now);
      this.tx(() => {
        for (const uid of ids) this.sql.exec("INSERT OR IGNORE INTO deliveries (campaign_id, user_id, status, attempts, next_at) VALUES (?, ?, 'pending', 0, ?)", c.id, uid, now);
        this.sql.exec("UPDATE campaigns SET status = 'sending' WHERE id = ?", c.id);
      });
    }
    const due = this.all<{ campaign_id: string; user_id: string; attempts: number; payload: string }>(
      "SELECT d.campaign_id, d.user_id, d.attempts, c.payload FROM deliveries d JOIN campaigns c ON c.id = d.campaign_id WHERE d.status = 'pending' AND d.next_at <= ? AND c.status = 'sending' ORDER BY d.next_at LIMIT ?",
      now, ADMIN_LIMITS.deliveryBatch,
    );
    const stats = { done: 0, skipped: 0, failed: 0, retry: 0 };
    for (const d of due) {
      const p = JSON.parse(d.payload) as RewardPayload;
      if (p.expiresAt <= now) {
        this.sql.exec("UPDATE deliveries SET status = 'expired', at = ? WHERE campaign_id = ? AND user_id = ?", now, d.campaign_id, d.user_id);
        continue;
      }
      try {
        const r = await deliver(d.user_id, { id: "op:" + d.campaign_id, kind: "reward", title: p.title, body: p.message, coins: p.coins, gems: p.gems, expiresAt: p.expiresAt });
        this.sql.exec("UPDATE deliveries SET status = ?, at = ? WHERE campaign_id = ? AND user_id = ?", r === "ok" ? "done" : "skipped", now, d.campaign_id, d.user_id);
        stats[r === "ok" ? "done" : "skipped"]++;
      } catch {
        const attempts = d.attempts + 1;
        const failed = attempts >= ADMIN_LIMITS.deliveryAttempts;
        this.sql.exec("UPDATE deliveries SET status = ?, attempts = ?, next_at = ? WHERE campaign_id = ? AND user_id = ?", failed ? "failed" : "pending", attempts, now + 60_000 * 2 ** attempts, d.campaign_id, d.user_id);
        stats[failed ? "failed" : "retry"]++;
      }
    }
    for (const c of this.all<{ id: string }>("SELECT id FROM campaigns WHERE status = 'sending'")) {
      if (!this.one("SELECT 1 FROM deliveries WHERE campaign_id = ? AND status = 'pending'", c.id)) this.sql.exec("UPDATE campaigns SET status = 'sent' WHERE id = ?", c.id);
    }
    return stats;
  }
  /** Next time `process` has work (for the object's alarm). */
  nextWorkAt(): number | null {
    const a = this.one<{ t: number | null }>("SELECT min(scheduled_at) AS t FROM campaigns WHERE status = 'scheduled'")?.t ?? null;
    const b = this.one<{ t: number | null }>("SELECT min(d.next_at) AS t FROM deliveries d JOIN campaigns c ON c.id = d.campaign_id WHERE d.status = 'pending' AND c.status = 'sending'")?.t ?? null;
    const xs = [a, b].filter((x): x is number => x !== null);
    return xs.length ? Math.min(...xs) : null;
  }

  /* --------------------------------------------------------------- redeem codes --------------------------------------------------------------- */

  createCode(raw: unknown, by: string, now: number): { ok: true; id: string; code: string } | Fail {
    const r = (raw ?? {}) as Record<string, unknown>;
    const code = r.code ? normalizeRedeemCode(r.code) : Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
    if (!CODE.test(code)) return fail("INVALID", "코드는 영문 대문자·숫자 6~20자예요.");
    if (this.one("SELECT 1 FROM codes WHERE code = ?", code)) return fail("DUPLICATE", "이미 있는 코드예요.");
    const title = cleanText(r.title, 60);
    const coins = Number(r.coins ?? 0), gems = Number(r.gems ?? 0);
    const startsAt = Number(r.startsAt ?? now), endsAt = Number(r.endsAt);
    const maxTotal = Number(r.maxTotal), perAccount = Number(r.perAccount ?? 1);
    const joinedBefore = r.joinedBefore === undefined || r.joinedBefore === null || r.joinedBefore === "" ? null : Number(r.joinedBefore);
    if (title.length < 2) return fail("INVALID", "코드 이름을 입력해 주세요.");
    if (!Number.isInteger(coins) || !Number.isInteger(gems) || coins < 0 || gems < 0 || coins + gems === 0 || coins > GRANT_CAPS["redeem-code"].coins || gems > GRANT_CAPS["redeem-code"].gems) return fail("INVALID", `보상량이 올바르지 않아요(1회 상한 코인 ${GRANT_CAPS["redeem-code"].coins}·보석 ${GRANT_CAPS["redeem-code"].gems}).`);
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt || endsAt > now + ADMIN_LIMITS.maxExpiryMs) return fail("INVALID", "사용 기간이 올바르지 않아요(최대 90일).");
    if (!Number.isInteger(maxTotal) || maxTotal < 1 || maxTotal > ADMIN_LIMITS.codeMaxTotal) return fail("INVALID", "전체 사용 횟수가 올바르지 않아요.");
    if (!Number.isInteger(perAccount) || perAccount < 1 || perAccount > ADMIN_LIMITS.codeMaxPerAccount) return fail("INVALID", "계정별 사용 횟수가 올바르지 않아요.");
    if (joinedBefore !== null && !Number.isFinite(joinedBefore)) return fail("INVALID", "가입일 조건이 올바르지 않아요.");
    const id = "cd_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    this.sql.exec("INSERT INTO codes (id, code, title, coins, gems, starts_at, ends_at, max_total, per_account, joined_before, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)",
      id, code, title, coins, gems, startsAt, endsAt, maxTotal, perAccount, joinedBefore, by, now);
    return { ok: true, id, code };
  }
  code(id: string) {
    return this.one<{ id: string; code: string; title: string; coins: number; gems: number; starts_at: number; ends_at: number; max_total: number; per_account: number; joined_before: number | null; status: string }>("SELECT * FROM codes WHERE id = ?", id) ?? null;
  }
  codes(page = 0) {
    return this.all<Record<string, unknown> & { id: string }>("SELECT * FROM codes ORDER BY created_at DESC LIMIT ? OFFSET ?", ADMIN_LIMITS.pageSize, page * ADMIN_LIMITS.pageSize).map((c) => ({
      ...c, used: this.one<{ n: number }>("SELECT count(*) AS n FROM redemptions WHERE code_id = ? AND status = 'done'", c.id)?.n ?? 0,
    }));
  }
  setCodeStatus(id: string, status: "active" | "inactive") {
    const c = this.code(id);
    if (!c) return fail("NOT_FOUND", "코드를 찾을 수 없어요.");
    if (status === "active" && c.status !== "draft") return fail("STATE", "초안 상태의 코드만 활성화할 수 있어요.");
    this.sql.exec("UPDATE codes SET status = ? WHERE id = ?", status, id);
    return { ok: true as const };
  }
  redemptions(codeId: string, page = 0) {
    return this.all<{ id: string; user_id: string; n: number; status: string; at: number }>("SELECT id, user_id, n, status, at FROM redemptions WHERE code_id = ? ORDER BY at DESC LIMIT ? OFFSET ?", codeId, ADMIN_LIMITS.pageSize, page * ADMIN_LIMITS.pageSize);
  }
  /**
   * Reserve one use of a code for an account. An unfinished reservation of the same account is returned
   * again (its grant is retried with the same id, which the account's ledger makes idempotent).
   */
  redeem(userId: string, accountCreatedAt: number, raw: unknown, now: number): { ok: true; redemptionId: string; item: InboxItem } | Fail {
    const text = normalizeRedeemCode(raw);
    if (!CODE.test(text)) return fail("INVALID_CODE", "코드를 확인해 주세요.");
    return this.tx(() => {
      const c = this.one<{ id: string; title: string; coins: number; gems: number; starts_at: number; ends_at: number; max_total: number; per_account: number; joined_before: number | null; status: string }>("SELECT * FROM codes WHERE code = ?", text);
      // one neutral answer for unknown, draft and inactive codes (no code enumeration)
      if (!c || c.status !== "active") return fail("INVALID_CODE", "사용할 수 없는 코드예요.");
      const item = (rid: string): InboxItem => ({ id: rid, kind: "reward", title: c.title, body: "쿠폰 보상", coins: c.coins, gems: c.gems, expiresAt: null });
      const open = this.one<{ id: string }>("SELECT id FROM redemptions WHERE code_id = ? AND user_id = ? AND status = 'reserved'", c.id, userId);
      if (open) return { ok: true as const, redemptionId: open.id, item: item(open.id) };
      if (now < c.starts_at || now >= c.ends_at) return fail("CODE_PERIOD", "사용 기간이 아닌 코드예요.");
      if (c.joined_before !== null && accountCreatedAt >= c.joined_before) return fail("CODE_TARGET", "이 계정은 사용할 수 없는 코드예요.");
      const mine = this.one<{ n: number }>("SELECT count(*) AS n FROM redemptions WHERE code_id = ? AND user_id = ?", c.id, userId)?.n ?? 0;
      if (mine >= c.per_account) return fail("CODE_USED", "이미 사용한 코드예요.");
      const total = this.one<{ n: number }>("SELECT count(*) AS n FROM redemptions WHERE code_id = ?", c.id)?.n ?? 0;
      if (total >= c.max_total) return fail("CODE_EXHAUSTED", "모두 사용된 코드예요.");
      // C5 txId rule: code:<codeId> (per account); a code usable more than once per account adds :<n>
      const rid = mine === 0 ? `code:${c.id}` : `code:${c.id}:${mine + 1}`;
      this.sql.exec("INSERT INTO redemptions (id, code_id, user_id, n, status, at) VALUES (?, ?, ?, ?, 'reserved', ?)", rid, c.id, userId, mine + 1, now);
      return { ok: true as const, redemptionId: rid, item: item(rid) };
    });
  }
  /** Redemption ids are per account (the account's grant id), so the account is part of the key. */
  confirmRedeem(userId: string, redemptionId: string, ok: boolean) {
    if (ok) this.sql.exec("UPDATE redemptions SET status = 'done' WHERE user_id = ? AND id = ?", userId, redemptionId);
    else this.sql.exec("DELETE FROM redemptions WHERE user_id = ? AND id = ? AND status = 'reserved'", userId, redemptionId);
  }

  /* --------------------------------------------------------------- notices --------------------------------------------------------------- */

  saveNotice(raw: unknown, by: string, now: number): { ok: true; id: string } | Fail {
    const r = (raw ?? {}) as Record<string, unknown>;
    const kind = ["notice", "maintenance", "update", "event"].includes(String(r.kind)) ? String(r.kind) : "notice";
    const title = cleanText(r.title, 80), body = cleanText(r.body, 4000);
    const publishAt = Number(r.publishAt ?? now);
    const endAt = r.endAt === undefined || r.endAt === null || r.endAt === "" ? null : Number(r.endAt);
    if (title.length < 2 || body.length < 2) return fail("INVALID", "제목과 내용을 입력해 주세요.");
    if (!Number.isFinite(publishAt) || (endAt !== null && (!Number.isFinite(endAt) || endAt <= publishAt))) return fail("INVALID", "게시 기간이 올바르지 않아요.");
    const status = r.status === "published" ? "published" : "draft";
    const id = typeof r.id === "string" && /^nt_[a-z0-9]{16}$/.test(r.id) ? r.id : "nt_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const exists = this.one<{ status: string }>("SELECT status FROM notices WHERE id = ?", id);
    if (typeof r.id === "string" && !exists) return fail("NOT_FOUND", "공지를 찾을 수 없어요.");
    if (exists?.status === "ended") return fail("STATE", "종료된 공지는 수정할 수 없어요.");
    this.sql.exec(
      "INSERT INTO notices (id, kind, title, body, important, publish_at, end_at, status, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, title = excluded.title, body = excluded.body, important = excluded.important, publish_at = excluded.publish_at, end_at = excluded.end_at, status = excluded.status, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
      id, kind, title, body, r.important ? 1 : 0, publishAt, endAt, status, by, now,
    );
    return { ok: true, id };
  }
  endNotice(id: string, by: string, now: number) {
    if (!this.one("SELECT 1 FROM notices WHERE id = ?", id)) return fail("NOT_FOUND", "공지를 찾을 수 없어요.");
    this.sql.exec("UPDATE notices SET status = 'ended', end_at = min(coalesce(end_at, ?), ?), updated_by = ?, updated_at = ? WHERE id = ?", now, now, by, now, id);
    return { ok: true as const };
  }
  notices(all: boolean, now: number) {
    const rows = this.all<{ id: string; kind: string; title: string; body: string; important: number; publish_at: number; end_at: number | null; status: string; updated_at: number }>(
      all ? "SELECT * FROM notices ORDER BY publish_at DESC LIMIT 100" : "SELECT * FROM notices WHERE status = 'published' AND publish_at <= ? AND (end_at IS NULL OR end_at > ?) ORDER BY important DESC, publish_at DESC LIMIT 20",
      ...(all ? [] : [now, now]),
    );
    return rows.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, important: !!n.important, publishAt: n.publish_at, endAt: n.end_at, ...(all ? { status: n.status, updatedAt: n.updated_at } : {}) }));
  }

  /* --------------------------------------------------------------- reports --------------------------------------------------------------- */

  static REPORT_REASONS = ["cheating", "abusive_name", "harassment", "spam", "inappropriate_post", "other"] as const;
  createReport(reporter: string, raw: unknown, now: number): { ok: true; id: string } | Fail {
    const r = (raw ?? {}) as Record<string, unknown>;
    const targetType = r.targetType === "suggestion" ? "suggestion" : r.targetType === "user" ? "user" : null;
    const targetId = String(r.targetId ?? "");
    if (!targetType || (targetType === "user" ? !USER.test(targetId) : !/^sg_[a-z0-9]{16}$/.test(targetId))) return fail("INVALID", "신고 대상이 올바르지 않아요.");
    if (targetType === "user" && targetId === reporter) return fail("INVALID", "자기 자신은 신고할 수 없어요.");
    const reason = (AdminCore.REPORT_REASONS as readonly string[]).includes(String(r.reason)) ? String(r.reason) : null;
    if (!reason) return fail("INVALID", "신고 유형을 골라 주세요.");
    const matchId = typeof r.matchId === "string" && /^[A-Za-z0-9_:-]{4,80}$/.test(r.matchId) ? r.matchId : null;
    const today = this.one<{ n: number }>("SELECT count(*) AS n FROM reports WHERE reporter = ? AND created_at > ?", reporter, now - DAY_MS)?.n ?? 0;
    if (today >= 10) return fail("RATE_LIMITED", "오늘은 더 신고할 수 없어요.");
    if (this.one("SELECT 1 FROM reports WHERE reporter = ? AND target_type = ? AND target_id = ? AND status IN ('open', 'reviewing')", reporter, targetType, targetId)) return fail("DUPLICATE", "이미 접수된 신고가 있어요.");
    const id = "rp_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    this.sql.exec("INSERT INTO reports (id, reporter, target_type, target_id, reason, detail, match_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)",
      id, reporter, targetType, targetId, reason, cleanText(r.detail, 1000), matchId, now, now);
    return { ok: true, id };
  }
  reports(q: { status?: string; page?: number }) {
    const page = Math.max(0, q.page ?? 0);
    return this.all("SELECT * FROM reports WHERE (? = '' OR status = ?) ORDER BY created_at DESC LIMIT ? OFFSET ?", q.status ?? "", q.status ?? "", ADMIN_LIMITS.pageSize, page * ADMIN_LIMITS.pageSize);
  }
  report(id: string) {
    return this.one<{ id: string; reporter: string; target_type: string; target_id: string; reason: string; detail: string; match_id: string | null; status: string; note: string }>("SELECT * FROM reports WHERE id = ?", id) ?? null;
  }
  updateReport(id: string, status: unknown, note: unknown, now: number) {
    if (!["open", "reviewing", "resolved", "dismissed"].includes(String(status))) return fail("INVALID", "상태가 올바르지 않아요.");
    if (!this.report(id)) return fail("NOT_FOUND", "신고를 찾을 수 없어요.");
    this.sql.exec("UPDATE reports SET status = ?, note = ?, updated_at = ? WHERE id = ?", String(status), cleanText(note, 1000), now, id);
    return { ok: true as const };
  }

  /* -------------------------------------------------------------- sanctions -------------------------------------------------------------- */

  checkSanction(raw: unknown): { ok: true; payload: SanctionPayload } | Fail {
    const r = (raw ?? {}) as Record<string, unknown>;
    const kinds: SanctionKind[] = ["warning", "nickname_reset", "restrict", "suspend"];
    const kind = kinds.find((k) => k === r.kind);
    if (!kind) return fail("INVALID", "제재 종류를 골라 주세요.");
    const userId = String(r.userId ?? "");
    if (!USER.test(userId)) return fail("INVALID", "회원 ID가 올바르지 않아요.");
    const reason = cleanText(r.reason, 500);
    if (reason.length < 4) return fail("INVALID", "제재 사유를 4자 이상 기록해 주세요.");
    const days = r.days === undefined || r.days === null || r.days === "" ? null : Number(r.days);
    if (kind === "restrict" && (days === null || !Number.isInteger(days) || days < 1 || days > 365)) return fail("INVALID", "이용 제한 기간은 1~365일이에요.");
    if (kind === "suspend" && days !== null && (!Number.isInteger(days) || days < 1 || days > 3650)) return fail("INVALID", "정지 기간이 올바르지 않아요(비우면 무기한).");
    const reportId = typeof r.reportId === "string" && /^rp_[a-z0-9]{16}$/.test(r.reportId) ? r.reportId : null;
    return { ok: true, payload: { userId, kind, reason, days: kind === "warning" || kind === "nickname_reset" ? null : days, reportId } };
  }
  recordSanction(id: string, p: SanctionPayload, by: string, actionId: string | null, now: number) {
    const until = p.days === null ? null : now + p.days * DAY_MS;
    const durable = p.kind === "restrict" || p.kind === "suspend";
    this.tx(() => {
      this.sql.exec("INSERT OR IGNORE INTO sanctions (id, user_id, kind, reason, starts_at, until, status, report_id, action_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        id, p.userId, p.kind, p.reason, now, until, durable ? "active" : "done", p.reportId, actionId, by);
      if (durable) this.sql.exec("UPDATE members SET status = ?, status_until = ? WHERE user_id = ?", p.kind === "suspend" ? "suspended" : "restricted", until, p.userId);
      else if (p.kind === "warning") this.sql.exec("UPDATE members SET status = 'warned' WHERE user_id = ? AND status = 'ok'", p.userId);
      if (p.reportId) this.sql.exec("UPDATE reports SET status = 'resolved', updated_at = ? WHERE id = ?", now, p.reportId);
    });
    return { id, until };
  }
  sanction(id: string) {
    return this.one<{ id: string; user_id: string; kind: string; reason: string; starts_at: number; until: number | null; status: string }>("SELECT * FROM sanctions WHERE id = ?", id) ?? null;
  }
  sanctions(q: { userId?: string; status?: string; page?: number }) {
    return this.all("SELECT * FROM sanctions WHERE (? = '' OR user_id = ?) AND (? = '' OR status = ?) ORDER BY starts_at DESC LIMIT ? OFFSET ?", q.userId ?? "", q.userId ?? "", q.status ?? "", q.status ?? "", ADMIN_LIMITS.pageSize, Math.max(0, q.page ?? 0) * ADMIN_LIMITS.pageSize);
  }
  liftSanction(id: string, by: string, reason: string, now: number) {
    const s = this.sanction(id);
    if (!s) return fail("NOT_FOUND", "제재를 찾을 수 없어요.");
    if (s.status !== "active") return fail("STATE", "진행 중인 제재가 아니에요.");
    this.tx(() => {
      this.sql.exec("UPDATE sanctions SET status = 'lifted', lifted_by = ?, lifted_at = ?, lift_reason = ? WHERE id = ?", by, now, cleanText(reason, 500), id);
      const other = this.one("SELECT 1 FROM sanctions WHERE user_id = ? AND status = 'active' AND (until IS NULL OR until > ?)", s.user_id, now);
      if (!other) this.sql.exec("UPDATE members SET status = 'ok', status_until = NULL WHERE user_id = ?", s.user_id);
    });
    return { ok: true as const, userId: s.user_id };
  }
  /** Time-limited sanctions past their end (registry only; the account object enforces `until` itself). */
  expireSanctions(now: number) {
    this.sql.exec("UPDATE sanctions SET status = 'expired' WHERE status = 'active' AND until IS NOT NULL AND until <= ?", now);
    this.sql.exec("UPDATE members SET status = 'ok', status_until = NULL WHERE status IN ('restricted', 'suspended') AND status_until IS NOT NULL AND status_until <= ?", now);
  }

  /* --------------------------------------------------------------- appeals --------------------------------------------------------------- */

  createAppeal(userId: string, sanctionId: unknown, text: unknown, now: number): { ok: true; id: string } | Fail {
    const s = typeof sanctionId === "string" ? this.sanction(sanctionId) : null;
    if (!s || s.user_id !== userId) return fail("NOT_FOUND", "이의를 제기할 제재를 찾을 수 없어요.");
    const body = cleanText(text, 2000);
    if (body.length < 10) return fail("INVALID", "이의제기 내용을 10자 이상 적어 주세요.");
    if (this.one("SELECT 1 FROM appeals WHERE sanction_id = ? AND status IN ('submitted', 'reviewing')", s.id)) return fail("DUPLICATE", "이미 처리 중인 이의제기가 있어요.");
    if ((this.one<{ n: number }>("SELECT count(*) AS n FROM appeals WHERE sanction_id = ?", s.id)?.n ?? 0) >= 3) return fail("LIMIT", "이 제재에는 더 이상 이의를 제기할 수 없어요.");
    const id = "ap_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    this.sql.exec("INSERT INTO appeals (id, sanction_id, user_id, text, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'submitted', ?, ?)", id, s.id, userId, body, now, now);
    return { ok: true, id };
  }
  appeals(q: { userId?: string; status?: string; page?: number }) {
    return this.all<{ id: string; sanction_id: string; user_id: string; text: string; status: string; answer: string; created_at: number; updated_at: number }>(
      "SELECT a.*, s.kind AS sanction_kind, s.reason AS sanction_reason, s.status AS sanction_status FROM appeals a JOIN sanctions s ON s.id = a.sanction_id WHERE (? = '' OR a.user_id = ?) AND (? = '' OR a.status = ?) ORDER BY a.created_at DESC LIMIT ? OFFSET ?",
      q.userId ?? "", q.userId ?? "", q.status ?? "", q.status ?? "", ADMIN_LIMITS.pageSize, Math.max(0, q.page ?? 0) * ADMIN_LIMITS.pageSize,
    );
  }
  appeal(id: string) {
    return this.one<{ id: string; sanction_id: string; user_id: string; status: string }>("SELECT id, sanction_id, user_id, status FROM appeals WHERE id = ?", id) ?? null;
  }
  answerAppeal(id: string, status: unknown, answer: unknown, by: string, now: number) {
    const a = this.appeal(id);
    if (!a) return fail("NOT_FOUND", "이의제기를 찾을 수 없어요.");
    if (!["reviewing", "accepted", "rejected"].includes(String(status))) return fail("INVALID", "처리 상태가 올바르지 않아요.");
    if (a.status === "accepted" || a.status === "rejected") return fail("STATE", "이미 최종 처리된 이의제기예요.");
    const text = cleanText(answer, 2000);
    if (status !== "reviewing" && text.length < 4) return fail("INVALID", "최종 처리에는 답변이 필요해요.");
    this.sql.exec("UPDATE appeals SET status = ?, answer = ?, answered_by = ?, updated_at = ? WHERE id = ?", String(status), text, by, now, id);
    return { ok: true as const, appeal: a };
  }
}
