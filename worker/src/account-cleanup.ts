/**
 * Account deletion across Durable Objects (C4.2, SEC-03 / B-10) — runtime-free, tested in Node.
 *
 * Deleting an account touches other objects: every account that holds a row about it (friends, requests
 * both ways, blocks either way) and the global friend-code index. Those calls can fail (object reset,
 * network, limits), so they are not fire-and-forget: the deleted account's own object keeps a small queue
 * (target + the deleted generation's friend code, nothing else) written in the SAME transaction that wipes
 * the account, works through it right away, and retries the rest from its alarm with back-off. Each step
 * is idempotent and generation-scoped (see FriendStore.forget / FriendIndexStore.removeCode), so a late
 * retry after a re-join never removes the new account's relations.
 */
export interface CleanupSql {
  exec<T = Record<string, unknown>>(query: string, ...params: unknown[]): { toArray(): T[] };
}

/** The global friend-code index (one per service). Other targets are account ids. */
export const INDEX_TARGET = "@index";
/** Retry delays after the 1st, 2nd, … failure (then the last one), and when to give up. */
export const CLEANUP_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 3600_000, 3 * 3600_000, 6 * 3600_000, 12 * 3600_000, 24 * 3600_000] as const;
export const CLEANUP_MAX_ATTEMPTS = 16; // ≈ 9.5 days of retries
/**
 * After CLEANUP_MAX_ATTEMPTS a job is PARKED, not dropped: the operator can have every parked job retried
 * (16 more attempts) by deploying the Worker with a new `ACCOUNT_CLEANUP_RETRY_EPOCH` value; a parked
 * account checks the value weekly. Parked jobs are dropped when the 30-day deletion record ends.
 */
export const CLEANUP_PARKED_CHECK_MS = 7 * 86_400_000;
/** Calls per invocation (a Workers Free request may make a bounded number of sub-requests). */
export const CLEANUP_BATCH = 40;

export type CleanupJob = { target: string; code: string | null; attempts: number; nextAt: number };

export class CleanupQueue {
  constructor(private readonly sql: CleanupSql) {}
  init() {
    // code '' = the deleted account never had a friend code
    this.sql.exec("CREATE TABLE IF NOT EXISTS acct_cleanup (target TEXT NOT NULL, code TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, parked INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (target, code))");
    // the operator's retry request (ACCOUNT_CLEANUP_RETRY_EPOCH) this object last acted on
    this.sql.exec("CREATE TABLE IF NOT EXISTS acct_cleanup_epoch (id INTEGER PRIMARY KEY CHECK (id = 1), epoch TEXT NOT NULL)");
    // the deleted account's internal id, kept only while its cleanup is pending (the calls name it)
    this.sql.exec("CREATE TABLE IF NOT EXISTS acct_cleanup_owner (id INTEGER PRIMARY KEY CHECK (id = 1), user_id TEXT NOT NULL)");
  }
  owner(): string | null {
    return this.sql.exec<{ user_id: string }>("SELECT user_id FROM acct_cleanup_owner WHERE id = 1").toArray()[0]?.user_id ?? null;
  }
  enqueue(owner: string, targets: string[], code: string | null, now: number) {
    this.sql.exec("INSERT OR REPLACE INTO acct_cleanup_owner (id, user_id) VALUES (1, ?)", owner);
    for (const t of new Set(targets)) this.sql.exec("INSERT OR IGNORE INTO acct_cleanup (target, code, attempts, next_at) VALUES (?, ?, 0, ?)", t, code ?? "", now);
  }
  due(now: number, limit = CLEANUP_BATCH): CleanupJob[] {
    return this.sql
      .exec<{ target: string; code: string; attempts: number; next_at: number }>("SELECT target, code, attempts, next_at FROM acct_cleanup WHERE parked = 0 AND next_at <= ? ORDER BY next_at, target LIMIT ?", now, limit)
      .toArray()
      .map((r) => ({ target: r.target, code: r.code === "" ? null : r.code, attempts: r.attempts, nextAt: r.next_at }));
  }
  done(job: CleanupJob) {
    this.sql.exec("DELETE FROM acct_cleanup WHERE target = ? AND code = ?", job.target, job.code ?? "");
    this.ownerIfEmpty();
  }
  private ownerIfEmpty() {
    if (!this.pending()) this.sql.exec("DELETE FROM acct_cleanup_owner");
  }
  /** A failed attempt: retry later, or park it (true) after CLEANUP_MAX_ATTEMPTS. */
  failed(job: CleanupJob, now: number): boolean {
    const attempts = job.attempts + 1;
    if (attempts >= CLEANUP_MAX_ATTEMPTS) {
      this.sql.exec("UPDATE acct_cleanup SET attempts = ?, parked = 1 WHERE target = ? AND code = ?", attempts, job.target, job.code ?? "");
      return true;
    }
    const wait = CLEANUP_BACKOFF_MS[Math.min(attempts - 1, CLEANUP_BACKOFF_MS.length - 1)];
    this.sql.exec("UPDATE acct_cleanup SET attempts = ?, next_at = ? WHERE target = ? AND code = ?", attempts, now + wait, job.target, job.code ?? "");
    return false;
  }
  /** Next retry of an active (not parked) job. */
  nextAt(): number | null {
    return this.sql.exec<{ t: number | null }>("SELECT min(next_at) AS t FROM acct_cleanup WHERE parked = 0").toArray()[0]?.t ?? null;
  }
  /** All jobs, active and parked. */
  pending(): number {
    return this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM acct_cleanup").toArray()[0]?.n ?? 0;
  }
  parked(): number {
    return this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM acct_cleanup WHERE parked = 1").toArray()[0]?.n ?? 0;
  }
  /**
   * Operator retry: when `epoch` (the deployed ACCOUNT_CLEANUP_RETRY_EPOCH) differs from the one this
   * object last acted on, every parked job becomes active again with a fresh attempt budget. Returns how
   * many. Safe at any time: every step is idempotent and limited to the deleted generation.
   */
  requeue(epoch: string, now: number): number {
    if (!epoch) return 0;
    const seen = this.sql.exec<{ epoch: string }>("SELECT epoch FROM acct_cleanup_epoch WHERE id = 1").toArray()[0]?.epoch;
    if (seen === epoch) return 0;
    const n = this.parked();
    if (!n) return 0; // nothing to do: remember nothing (no write)
    this.sql.exec("UPDATE acct_cleanup SET parked = 0, attempts = 0, next_at = ? WHERE parked = 1", now);
    this.sql.exec("INSERT OR REPLACE INTO acct_cleanup_epoch (id, epoch) VALUES (1, ?)", epoch);
    return n;
  }
  /** End of the 30-day deletion record: parked jobs are dropped (the peer-side residue check remains). */
  expireParked(): number {
    const n = this.parked();
    if (n) this.sql.exec("DELETE FROM acct_cleanup WHERE parked = 1");
    this.ownerIfEmpty();
    if (!this.pending()) this.sql.exec("DELETE FROM acct_cleanup_epoch");
    return n;
  }
}

/** One call for one job; `owner` is the deleted account's internal id. */
export type CleanupSend = (job: CleanupJob, owner: string) => Promise<void>;
/** `gaveUp` = parked this run after CLEANUP_MAX_ATTEMPTS. */
export type CleanupRun = { done: number; failed: number; gaveUp: number; remaining: number };

/** Work through the due jobs (at most `limit`), one call each; failures are rescheduled. */
export async function runCleanup(queue: CleanupQueue, send: CleanupSend, now: () => number, limit = CLEANUP_BATCH): Promise<CleanupRun> {
  const run: CleanupRun = { done: 0, failed: 0, gaveUp: 0, remaining: 0 };
  if (!queue.owner()) return { ...run, remaining: queue.pending() };
  for (const job of queue.due(now(), limit)) {
    try {
      await send(job, queue.owner()!);
      queue.done(job);
      run.done++;
    } catch {
      run.failed++;
      if (queue.failed(job, now())) run.gaveUp++;
    }
  }
  run.remaining = queue.pending();
  return run;
}
