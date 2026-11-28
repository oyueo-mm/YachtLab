import type { SoloRecord } from "../../src/solo/records";
import type { ReviewMatch } from "../../src/review/model";
import type { MatchReceipt } from "../../src/economy/live/receipt";
import { validateNickname } from "../../src/identity/nickname";
import type { MatchRecord, RecordSource } from "../../src/identity/records";
import { randomToken, sha256 } from "./oidc";

/**
 * One account's data (Phase 4) — the logic of the per-user `UserStore` Durable Object, runtime-free
 * (any SQLite with `exec(query, ...params)`), so it is tested in Node with node:sqlite.
 *
 * Why one SQLite Durable Object per user (docs/online/SOCIAL-AND-ACCOUNTS.md §저장소 비교):
 *  - isolation by construction: a request only ever reaches the object of the authenticated user id;
 *  - strong consistency and serial execution per user (no lost updates, no duplicate inserts);
 *  - available on Workers Free with the same deployment (a new class in wrangler.toml), no extra
 *    account resource; deleting an account is `deleteAll()` on one object.
 * Cross-user queries (rankings) are not possible here — a later D1/aggregate step when needed.
 *
 * Stored: internal user id, provider name, nickname, timestamps, hashed session / login-code secrets,
 * match records, linked guest ids. Not stored: e-mail, real name, picture, IP, Google tokens.
 */
export interface Sql {
  exec<T = Record<string, unknown>>(query: string, ...params: unknown[]): { toArray(): T[] };
}

export const SESSION_TTL_MS = 30 * 86_400_000;
/**
 * Live sessions kept per account (C4.2, SEC-04): a new sign-in beyond this ends the OLDEST session (the
 * device least likely still in use). Existing sessions are never ended by a deployment; only an account
 * that already has this many live sessions loses its oldest one at its next sign-in.
 */
export const SESSION_CAP = 20;
export const LOGIN_CODE_TTL_MS = 2 * 60_000;
export const LIMITS = { importPerDay: 1000, importPerRequest: 200, nicknamePerDay: 10, maxRecords: 5000, maxSoloRecords: 1000 } as const;

export type PrivateProfile = { userId: string; provider: string; nickname: string | null; createdAt: number };
export type PublicProfile = {
  userId: string;
  nickname: string;
  joinedAt: number;
  /** Server-verified online matches only. */
  online: { games: number; wins: number; losses: number; draws: number; best: number | null; average: number | null };
};

const day = (now: number) => Math.floor(now / 86_400_000);

export class AccountStore {
  private counters = new Map<string, { day: number; n: number }>();
  private prunedDay = -1;
  constructor(private readonly sql: Sql) {}

  init() {
    this.sql.exec("CREATE TABLE IF NOT EXISTS user (id INTEGER PRIMARY KEY CHECK (id = 1), user_id TEXT NOT NULL, provider TEXT NOT NULL, nickname TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS login_codes (hash TEXT PRIMARY KEY, cs_hash TEXT NOT NULL, expires_at INTEGER NOT NULL)");
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS matches (record_id TEXT PRIMARY KEY, ended_at INTEGER NOT NULL, mode TEXT NOT NULL, source TEXT NOT NULL, verification TEXT NOT NULL, outcome TEXT NOT NULL, score INTEGER NOT NULL, data TEXT NOT NULL)",
    );
    this.sql.exec("CREATE INDEX IF NOT EXISTS matches_ended ON matches (ended_at)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS review_archive (record_id TEXT PRIMARY KEY, ended_at INTEGER NOT NULL, data TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS guests (guest_id TEXT PRIMARY KEY, linked_at INTEGER NOT NULL)");
    // 1인 플레이 personal records (client-reported only; never rankings, coins or achievements).
    this.sql.exec("CREATE TABLE IF NOT EXISTS solo_records (record_id TEXT PRIMARY KEY, ended_at INTEGER NOT NULL, score INTEGER NOT NULL, data TEXT NOT NULL)");
  }

  private limited(kind: string, max: number, now: number, amount = 1): boolean {
    const c = this.counters.get(kind);
    const n = c && c.day === day(now) ? c.n : 0;
    if (n + amount > max) return true;
    this.counters.set(kind, { day: day(now), n: n + amount });
    return false;
  }

  exists(): boolean {
    return this.sql.exec("SELECT 1 FROM user WHERE id = 1").toArray().length > 0;
  }

  /** First sign-in creates the account (one row). */
  ensureUser(userId: string, provider: string, now: number) {
    if (this.exists()) return;
    this.sql.exec("INSERT INTO user (id, user_id, provider, nickname, created_at, updated_at) VALUES (1, ?, ?, NULL, ?, ?)", userId, provider, now, now);
  }

  profile(): PrivateProfile | null {
    const row = this.sql.exec<{ user_id: string; provider: string; nickname: string | null; created_at: number }>("SELECT user_id, provider, nickname, created_at FROM user WHERE id = 1").toArray()[0];
    return row ? { userId: row.user_id, provider: row.provider, nickname: row.nickname, createdAt: row.created_at } : null;
  }

  /* ------------------------------------------------------------- login / sessions ------------------------------------------------------------- */

  /** One-time code handed to the web page after the OAuth redirect, bound to the page's client state. */
  async createLoginCode(clientStateHash: string, now: number): Promise<string> {
    this.sql.exec("DELETE FROM login_codes WHERE expires_at < ?", now);
    const secret = randomToken();
    this.sql.exec("INSERT INTO login_codes (hash, cs_hash, expires_at) VALUES (?, ?, ?)", await sha256(secret), clientStateHash, now + LOGIN_CODE_TTL_MS);
    return secret;
  }

  /** Trade the one-time code for a new session (the code is deleted whatever happens). */
  async exchange(codeSecret: string, clientState: string, now: number): Promise<string | null> {
    const hash = await sha256(codeSecret);
    const row = this.sql.exec<{ cs_hash: string; expires_at: number }>("SELECT cs_hash, expires_at FROM login_codes WHERE hash = ?", hash).toArray()[0];
    if (!row) return null;
    this.sql.exec("DELETE FROM login_codes WHERE hash = ?", hash);
    if (row.expires_at < now || row.cs_hash !== (await sha256(clientState))) return null;
    if (!this.exists()) return null;
    const session = randomToken();
    const sessionHash = await sha256(session);
    this.pruneSessions(now);
    // keep the newest SESSION_CAP - 1 live sessions, then add this one
    this.sql.exec("DELETE FROM sessions WHERE hash IN (SELECT hash FROM sessions ORDER BY created_at DESC, hash DESC LIMIT -1 OFFSET ?)", SESSION_CAP - 1);
    this.sql.exec("INSERT INTO sessions (hash, created_at, expires_at) VALUES (?, ?, ?)", sessionHash, now, now + SESSION_TTL_MS);
    return session;
  }

  /**
   * Remove every expired session and login code of this account (SEC-04): run at each sign-in, at most
   * once a day from authentication, and by the account object's alarm at the next expiry — so expired
   * secrets do not stay stored for accounts that never come back. Returns how many sessions went.
   */
  pruneSessions(now: number): number {
    this.prunedDay = day(now);
    const n = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM sessions WHERE expires_at < ?", now).toArray()[0]?.n ?? 0;
    if (n) this.sql.exec("DELETE FROM sessions WHERE expires_at < ?", now);
    this.sql.exec("DELETE FROM login_codes WHERE expires_at < ?", now);
    return n;
  }
  /** When the next session expires (null: none stored) — the alarm that prunes it. */
  nextSessionExpiry(): number | null {
    return this.sql.exec<{ t: number | null }>("SELECT min(expires_at) AS t FROM sessions").toArray()[0]?.t ?? null;
  }
  sessionCount(): number {
    return this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM sessions").toArray()[0]?.n ?? 0;
  }

  /** Is this session secret valid now? (Expired sessions are removed when found.) */
  async authenticate(sessionSecret: string, now: number): Promise<boolean> {
    if (!this.exists()) return false;
    if (this.prunedDay !== day(now)) this.pruneSessions(now);
    const hash = await sha256(sessionSecret);
    const row = this.sql.exec<{ expires_at: number }>("SELECT expires_at FROM sessions WHERE hash = ?", hash).toArray()[0];
    if (!row) return false;
    if (row.expires_at < now) {
      this.sql.exec("DELETE FROM sessions WHERE hash = ?", hash);
      return false;
    }
    return true;
  }

  async logout(sessionSecret: string) {
    this.sql.exec("DELETE FROM sessions WHERE hash = ?", await sha256(sessionSecret));
  }
  logoutAll() {
    this.sql.exec("DELETE FROM sessions");
  }

  /* ------------------------------------------------------------- profile ------------------------------------------------------------- */

  setNickname(raw: unknown, now: number): { ok: true; nickname: string } | { ok: false; message: string } {
    const v = validateNickname(raw);
    if (!v.ok) return { ok: false, message: v.message };
    if (this.limited("nickname", LIMITS.nicknamePerDay, now)) return { ok: false, message: "오늘은 닉네임을 더 바꿀 수 없어요." };
    this.sql.exec("UPDATE user SET nickname = ?, updated_at = ? WHERE id = 1", v.name, now);
    return { ok: true, nickname: v.name };
  }

  publicProfile(): PublicProfile | null {
    const p = this.profile();
    if (!p) return null;
    const agg = this.sql
      .exec<{ games: number; wins: number; losses: number; draws: number; best: number | null; average: number | null }>(
        "SELECT count(*) AS games, sum(outcome = 'win') AS wins, sum(outcome = 'loss') AS losses, sum(outcome = 'draw') AS draws, max(score) AS best, avg(score) AS average FROM matches WHERE verification = 'server-verified'",
      )
      .toArray()[0];
    return {
      userId: p.userId,
      nickname: p.nickname ?? "이름 없음",
      // Month only: the exact sign-up time is private.
      joinedAt: Date.UTC(new Date(p.createdAt).getUTCFullYear(), new Date(p.createdAt).getUTCMonth(), 1),
      online: { games: agg?.games ?? 0, wins: agg?.wins ?? 0, losses: agg?.losses ?? 0, draws: agg?.draws ?? 0, best: agg?.best ?? null, average: agg?.average ?? null },
    };
  }

  /* ------------------------------------------------------------- records ------------------------------------------------------------- */

  /** A server-verified online result from a room (idempotent by matchId). */
  recordMatch(record: MatchRecord, reward?: () => MatchReceipt | undefined): boolean {
    if (!this.exists() || record.source !== "server" || record.verification !== "server-verified") return false;
    return this.insert(record, reward);
  }

  private insert(r: MatchRecord, reward?: () => MatchReceipt | undefined): boolean {
    const before = this.sql.exec<{ verification: string }>("SELECT verification FROM matches WHERE record_id = ?", r.recordId).toArray()[0];
    if (before) {
      // SEC-1-01 (D-101): the server's own result of a match outranks a device copy (client-reported)
      // with the same id — it replaces that row and is settled as usual. Anything else stays idempotent.
      if (!(r.verification === "server-verified" && before.verification !== "server-verified")) return false;
      this.sql.exec("DELETE FROM matches WHERE record_id = ?", r.recordId);
    }
    const receipt = reward?.();
    const { review, ...summary } = r;
    this.sql.exec(
      "INSERT OR IGNORE INTO matches (record_id, ended_at, mode, source, verification, outcome, score, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      r.recordId,
      r.endedAt,
      r.mode,
      r.source,
      r.verification,
      r.outcome,
      r.score,
      JSON.stringify(receipt ? { ...summary, reward: receipt } : summary),
    );
    if (review && r.verification === "server-verified") {
      this.sql.exec("INSERT INTO review_archive (record_id, ended_at, data) VALUES (?, ?, ?)", r.recordId, r.endedAt, JSON.stringify(review));
      this.sql.exec("DELETE FROM review_archive WHERE record_id IN (SELECT record_id FROM review_archive ORDER BY ended_at DESC, record_id DESC LIMIT -1 OFFSET 64)");
    }
    return true;
  }

  /**
   * Device records (already sanitized: client-reported) — the player's own AI/offline games, or a
   * guest's records being linked. Duplicates are ignored; the trust level is never raised.
   */
  importRecords(records: MatchRecord[], source: Exclude<RecordSource, "server">, now: number): { added: number; skipped: number } | { error: string } {
    if (!this.exists()) return { error: "계정을 찾을 수 없어요." };
    if (records.length > LIMITS.importPerRequest) return { error: `한 번에 ${LIMITS.importPerRequest}개까지 보낼 수 있어요.` };
    const total = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM matches").toArray()[0]?.n ?? 0;
    if (total + records.length > LIMITS.maxRecords) return { error: "저장할 수 있는 기록 수를 넘었어요." };
    if (this.limited("import", LIMITS.importPerDay, now, records.length)) return { error: "오늘은 기록을 더 가져올 수 없어요." };
    let added = 0;
    for (const r of records) if (this.insert({ ...r, source, verification: "client-reported" })) added++;
    return { added, skipped: records.length - added };
  }

  /** 1인 플레이 records from this account's devices (already sanitized). Duplicates are ignored. */
  importSolo(records: SoloRecord[], now: number): { added: number; skipped: number } | { error: string } {
    if (!this.exists()) return { error: "계정을 찾을 수 없어요." };
    if (records.length > LIMITS.importPerRequest) return { error: `한 번에 ${LIMITS.importPerRequest}개까지 보낼 수 있어요.` };
    const count = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM solo_records").toArray()[0]?.n ?? 0;
    if (count + records.length > LIMITS.maxSoloRecords) return { error: "저장할 수 있는 1인 플레이 기록 수를 넘었어요." };
    if (this.limited("solo", LIMITS.importPerDay, now, records.length)) return { error: "오늘은 기록을 더 저장할 수 없어요." };
    let added = 0;
    for (const r of records) {
      const exists = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM solo_records WHERE record_id = ?", r.recordId).toArray()[0]?.n ?? 0;
      if (exists) continue;
      const { replayId: _local, owner: _owner, ...stored } = r;
      this.sql.exec("INSERT INTO solo_records (record_id, ended_at, score, data) VALUES (?, ?, ?, ?)", r.recordId, r.endedAt, r.score, JSON.stringify({ ...stored, source: "device", verification: "client-reported" }));
      added++;
    }
    return { added, skipped: records.length - added };
  }

  soloRecords(limit = 1000): SoloRecord[] {
    return this.sql
      .exec<{ data: string }>("SELECT data FROM solo_records ORDER BY ended_at DESC LIMIT ?", Math.max(1, Math.min(1000, limit)))
      .toArray()
      .map((r) => JSON.parse(r.data) as SoloRecord);
  }

  records(limit = 300): MatchRecord[] {
    return this.sql
      .exec<{ data: string }>("SELECT data FROM matches ORDER BY ended_at DESC LIMIT ?", Math.max(1, Math.min(1000, limit)))
      .toArray()
      .map((r) => JSON.parse(r.data) as MatchRecord);
  }

  matchReward(recordId: string): { receipt: MatchReceipt | null } | null {
    const row = this.sql.exec<{ data: string }>(
      "SELECT data FROM matches WHERE record_id = ? AND verification = 'server-verified'",
      recordId,
    ).toArray()[0];
    return row ? { receipt: (JSON.parse(row.data) as MatchRecord).reward ?? null } : null;
  }

  matchReview(recordId: string): { review: ReviewMatch | null } | null {
    const row = this.sql.exec<{ review: string | null }>(
      "SELECT a.data AS review FROM matches m LEFT JOIN review_archive a USING(record_id) WHERE m.record_id = ? AND m.verification = 'server-verified'",
      recordId,
    ).toArray()[0];
    return row ? { review: row.review ? JSON.parse(row.review) as ReviewMatch : null } : null;
  }

  /* ---------------------------------------------------------- ADMIN-1 (read / sanction) ---------------------------------------------------------- */

  /** Sanction "닉네임 초기화": the account chooses a new nickname at its next visit. */
  resetNickname(now: number) {
    this.sql.exec("UPDATE user SET nickname = NULL, updated_at = ? WHERE id = 1", now);
  }
  /** Aggregates for the admin console — no session secrets, no provider subject, no guest ids. */
  adminSummary() {
    const p = this.profile();
    if (!p) return null;
    const byMode = this.sql.exec<{ mode: string; verification: string; outcome: string; n: number }>("SELECT mode, verification, outcome, count(*) AS n FROM matches GROUP BY mode, verification, outcome").toArray();
    const last = this.sql.exec<{ ended_at: number }>("SELECT max(ended_at) AS ended_at FROM matches").toArray()[0]?.ended_at ?? null;
    const sessions = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM sessions WHERE expires_at > ?", Date.now()).toArray()[0]?.n ?? 0;
    const solo = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM solo_records").toArray()[0]?.n ?? 0;
    return { userId: p.userId, provider: p.provider, nickname: p.nickname, createdAt: p.createdAt, lastMatchAt: last, liveSessions: sessions, soloRecords: solo, online: this.publicProfile()?.online ?? null, records: byMode };
  }
  /** One server-verified record (report evidence). The review archive is not included. */
  adminRecord(recordId: string): MatchRecord | null {
    const row = this.sql.exec<{ data: string }>("SELECT data FROM matches WHERE record_id = ? AND verification = 'server-verified'", recordId).toArray()[0];
    return row ? (JSON.parse(row.data) as MatchRecord) : null;
  }

  linkGuest(guestId: string, now: number) {
    this.sql.exec("INSERT OR IGNORE INTO guests (guest_id, linked_at) VALUES (?, ?)", guestId, now);
  }
  guests(): string[] {
    return this.sql.exec<{ guest_id: string }>("SELECT guest_id FROM guests").toArray().map((r) => r.guest_id);
  }
}
