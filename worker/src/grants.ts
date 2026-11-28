import { itemById } from "../../src/economy/live/catalog";
import { STREAK_TITLE_IDS } from "../../src/economy/retention/policy";
import type { EconSql, EconomyStore, Wallet } from "./economy";

/**
 * Common reward grant engine (C5, approved for Worker integration; operational activation is a separate
 * approval). Every non-match reward goes through `RewardGrants.issue` / `claim`:
 *   attendance · activity streak · weekly best streak · reward inbox · redeem codes · operator rewards
 *   (ADMIN-1) · adopted suggestions (ADMIN-1) · daily content (LIVE-1) · compensation · events
 *
 * Storage (the account's own SQLite Durable Object):
 *  - `grant_tx`: one row per grant request — tx id (idempotency key) · source · target user · coins · gems ·
 *    items · policy version · label · actor · delivery (direct / inbox) · status · payload fingerprint ·
 *    timestamps · expiry · ledger id · reference · skipped items
 *  - the balance, the ledger row `g:<txId>` and items are written ONLY by `EconomyStore.grantCredit`, the
 *    same `post` as every other balance change (one ledger writer; `EconomyStore.verify()` keeps holding)
 *
 * Contract (docs/economy/c5/REWARD-GRANT-CONTRACT.md):
 *  - Idempotency: deterministic `txId` per event. Same txId + same payload → the original record
 *    (`duplicate: true`); same txId + different payload → `TX_CONFLICT`.
 *  - Atomicity: grant row + ledger row + balance + items in ONE transaction (join the caller's when nested).
 *  - Concurrency: the account object is single-threaded; a second delivery finds the first row.
 *  - Sources must be ENABLED: only the approved C5-CORE sources are enabled by default. Operator,
 *    suggestion, daily content, redeem codes, compensation, events, daily play and return bonuses are
 *    refused with `SOURCE_DISABLED` until their amounts are approved and the Worker enables them.
 *  - No balance writes outside the ledger, no edits or deletes of a credited grant; operators can only
 *    issue (positive, capped, with an actor) or revoke an UNCLAIMED inbox entry.
 */

export type GrantSource =
  | "attendance"
  | "daily-play"
  | "daily-content"
  | "activity-streak"
  | "weekly-streak"
  | "return"
  | "operator"
  | "redeem-code"
  | "suggestion"
  | "compensation"
  | "event";
export const GRANT_SOURCES: readonly GrantSource[] = ["attendance", "daily-play", "daily-content", "activity-streak", "weekly-streak", "return", "operator", "redeem-code", "suggestion", "compensation", "event"];
/** Approved policy C5-CORE (2026-11-28): the only sources that may pay once the Worker turns retention on. */
export const APPROVED_SOURCES: ReadonlySet<GrantSource> = new Set(["attendance", "activity-streak", "weekly-streak"]);

/** Per-request ceilings (tool-error bounds, not the policy). */
export const GRANT_LIMITS: Record<GrantSource, { coins: number; gems: number; items: number }> = {
  attendance: { coins: 200, gems: 10, items: 0 },
  "daily-play": { coins: 50, gems: 0, items: 0 },
  "daily-content": { coins: 100, gems: 5, items: 0 },
  "activity-streak": { coins: 1000, gems: 30, items: 1 },
  "weekly-streak": { coins: 100, gems: 5, items: 0 },
  return: { coins: 300, gems: 10, items: 0 },
  operator: { coins: 5000, gems: 200, items: 3 },
  "redeem-code": { coins: 1000, gems: 50, items: 1 },
  suggestion: { coins: 2000, gems: 100, items: 1 },
  compensation: { coins: 10000, gems: 600, items: 3 },
  event: { coins: 1000, gems: 50, items: 1 },
};
/** Sources that only an authenticated operator call may use (never a client request). */
export const OPERATOR_SOURCES: ReadonlySet<GrantSource> = new Set(["operator", "suggestion", "compensation"]);

export type GrantRequest = {
  /** Idempotency key, 4–96 chars of [A-Za-z0-9:._-], unique per account. */
  txId: string;
  source: GrantSource;
  coins: number;
  gems: number;
  /** Catalog item ids. Achievement-only items are accepted only as activity-streak titles. */
  items?: string[];
  /** Version of the policy or campaign that decided the amount, stored on the ledger row. */
  policyVersion: string;
  /** Shown to the player (≤ 80 chars). */
  label: string;
  /** "system" for automatic rewards, "admin:<operatorId>" for operator actions. */
  actor: string;
  /** direct: credited now. inbox: waits in the reward inbox until the player claims it. */
  delivery: "direct" | "inbox";
  /** Inbox only: unclaimed after this time → expired, nothing credited. */
  expiresAt?: number | null;
  /** Free-form reference (suggestion id, campaign id). Not used for idempotency. */
  ref?: string;
};
export type GrantStatus = "granted" | "inboxed" | "claimed" | "expired" | "revoked";
export type GrantRecord = {
  txId: string;
  source: GrantSource;
  userId: string;
  coins: number;
  gems: number;
  items: string[];
  policyVersion: string;
  label: string;
  actor: string;
  delivery: "direct" | "inbox";
  status: GrantStatus;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
  ledgerId: string | null;
  ref: string | null;
  /** Items not delivered because the player already owned them. */
  skippedItems: string[];
};
type Fail = { ok: false; code: string; message: string };
export type IssueResult = { ok: true; duplicate: boolean; record: GrantRecord; wallet: Wallet } | Fail;

const TX_RE = /^[A-Za-z0-9:._-]{4,96}$/;
const fail = (code: string, message: string): Fail => ({ ok: false, code, message });

/** Stable payload fingerprint: the same txId must always mean the same grant. */
export function grantFingerprint(userId: string, r: GrantRequest): string {
  return JSON.stringify([userId, r.source, r.coins, r.gems, [...(r.items ?? [])].sort(), r.policyVersion, r.delivery]);
}

export function validateGrant(r: GrantRequest, opts: { operator: boolean }): Fail | null {
  if (!TX_RE.test(r.txId ?? "")) return fail("TX_ID", "거래 ID 형식이 올바르지 않아요.");
  if (!GRANT_SOURCES.includes(r.source)) return fail("SOURCE", "지급 출처가 올바르지 않아요.");
  if (OPERATOR_SOURCES.has(r.source) && !opts.operator) return fail("FORBIDDEN", "운영자만 지급할 수 있어요.");
  if (opts.operator !== r.actor.startsWith("admin:")) return fail("ACTOR", "지급 주체가 올바르지 않아요.");
  if (!opts.operator && r.actor !== "system") return fail("ACTOR", "지급 주체가 올바르지 않아요.");
  if (!Number.isInteger(r.coins) || !Number.isInteger(r.gems) || r.coins < 0 || r.gems < 0) return fail("AMOUNT", "지급량은 0 이상의 정수여야 해요.");
  const items = r.items ?? [];
  if (r.coins === 0 && r.gems === 0 && items.length === 0) return fail("EMPTY", "지급할 내용이 없어요.");
  const lim = GRANT_LIMITS[r.source];
  if (r.coins > lim.coins || r.gems > lim.gems || items.length > lim.items) return fail("LIMIT", "지급 한도를 넘었어요.");
  if (new Set(items).size !== items.length) return fail("ITEM", "같은 아이템이 두 번 들어 있어요.");
  for (const id of items) {
    const item = itemById(id);
    if (!item || item.retired || item.acquisition === "default") return fail("ITEM", "지급할 수 없는 아이템이에요.");
    // Achievement-only items keep their meaning: the only ones a grant may carry are the activity-streak
    // titles, and only from the activity-streak source.
    if (item.acquisition === "achievement" && !(r.source === "activity-streak" && STREAK_TITLE_IDS.has(id))) return fail("ITEM", "업적 전용 아이템은 지급할 수 없어요.");
  }
  if (!r.policyVersion || r.policyVersion.length > 40) return fail("POLICY", "정책 버전이 필요해요.");
  if (!r.label || r.label.length > 80) return fail("LABEL", "표시 문구가 필요해요.");
  if (r.delivery !== "direct" && r.delivery !== "inbox") return fail("DELIVERY", "지급 방식이 올바르지 않아요.");
  if (r.delivery === "direct" && r.expiresAt) return fail("DELIVERY", "즉시 지급에는 만료 시각이 없어요.");
  return null;
}

type Row = {
  tx_id: string; source: string; user_id: string; coins: number; gems: number; items: string; policy: string; label: string; actor: string;
  delivery: string; status: string; fingerprint: string; created_at: number; updated_at: number; expires_at: number | null; ledger_id: string | null; ref: string | null; skipped: string;
};
const toRecord = (r: Row): GrantRecord => ({
  txId: r.tx_id, source: r.source as GrantSource, userId: r.user_id, coins: r.coins, gems: r.gems, items: JSON.parse(r.items) as string[], policyVersion: r.policy, label: r.label,
  actor: r.actor, delivery: r.delivery as GrantRecord["delivery"], status: r.status as GrantStatus, createdAt: r.created_at, updatedAt: r.updated_at, expiresAt: r.expires_at,
  ledgerId: r.ledger_id, ref: r.ref, skippedItems: JSON.parse(r.skipped) as string[],
});

export class RewardGrants {
  private readonly enabled: ReadonlySet<GrantSource>;
  /**
   * `enabled`: the sources this Worker may pay. Default: the approved C5-CORE sources. Tests may pass
   * every source to exercise the contract; a Worker passes only sources whose amounts are approved.
   */
  constructor(private readonly sql: EconSql, private readonly econ: EconomyStore, opts: { enabled?: ReadonlySet<GrantSource> } = {}) {
    this.enabled = opts.enabled ?? APPROVED_SOURCES;
  }

  /** Additive schema only (rollback-safe). The economy tables are created by `EconomyStore.init()`. */
  init() {
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS grant_tx (tx_id TEXT PRIMARY KEY, source TEXT NOT NULL, user_id TEXT NOT NULL, coins INTEGER NOT NULL CHECK (coins >= 0), gems INTEGER NOT NULL CHECK (gems >= 0), items TEXT NOT NULL, policy TEXT NOT NULL, label TEXT NOT NULL, actor TEXT NOT NULL, delivery TEXT NOT NULL, status TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER, ledger_id TEXT, ref TEXT, skipped TEXT NOT NULL DEFAULT '[]')",
    );
    this.sql.exec("CREATE INDEX IF NOT EXISTS grant_tx_status ON grant_tx (status, created_at)");
  }

  isEnabled(source: GrantSource) {
    return this.enabled.has(source);
  }

  private get(txId: string): Row | null {
    return this.sql.exec<Row>("SELECT * FROM grant_tx WHERE tx_id = ?", txId).toArray()[0] ?? null;
  }

  /** Ledger + balance + items through the single writer (inside the caller's transaction). */
  private credit(rec: GrantRecord, now: number): { ledgerId: string | null; skipped: string[] } {
    const ledgerId = `g:${rec.txId}`;
    const r = this.econ.grantCredit(rec.userId, { id: ledgerId, kind: rec.source, coins: rec.coins, gems: rec.gems, label: rec.label, config: rec.policyVersion }, rec.items, now);
    if (!r) throw Error("ledger row exists without its grant");
    return { ledgerId: rec.coins || rec.gems ? ledgerId : null, skipped: r.skipped };
  }

  /**
   * Issue a grant. Direct grants are credited at once; inbox grants wait for `claim`.
   * `operator` must be true only for calls authenticated as an operator (admin session + audit actor).
   */
  issue(userId: string, req: GrantRequest, now: number, opts: { operator?: boolean } = {}): IssueResult {
    const operator = opts.operator === true;
    return this.sql.transaction((): IssueResult => {
      const invalid = validateGrant(req, { operator });
      if (invalid) return invalid;
      const fingerprint = grantFingerprint(userId, req);
      const existing = this.get(req.txId);
      if (existing) {
        if (existing.fingerprint !== fingerprint) return fail("TX_CONFLICT", "같은 거래 ID로 다른 지급을 요청했어요.");
        return { ok: true, duplicate: true, record: toRecord(existing), wallet: this.econ.balance() };
      }
      if (!this.enabled.has(req.source)) return fail("SOURCE_DISABLED", "아직 지급하지 않는 보상이에요.");
      if (!this.econ.hasEconomy()) return fail("NO_ECONOMY", "재화 기능을 아직 사용하지 않은 계정이에요.");
      if (req.delivery === "inbox" && req.expiresAt != null && req.expiresAt <= now) return fail("EXPIRED", "이미 만료된 보상이에요.");
      const rec: GrantRecord = {
        txId: req.txId, source: req.source, userId, coins: req.coins, gems: req.gems, items: [...(req.items ?? [])], policyVersion: req.policyVersion, label: req.label,
        actor: req.actor, delivery: req.delivery, status: req.delivery === "direct" ? "granted" : "inboxed", createdAt: now, updatedAt: now,
        expiresAt: req.delivery === "inbox" ? req.expiresAt ?? null : null, ledgerId: null, ref: req.ref ?? null, skippedItems: [],
      };
      if (rec.status === "granted") {
        const c = this.credit(rec, now);
        rec.ledgerId = c.ledgerId;
        rec.skippedItems = c.skipped;
      }
      this.sql.exec(
        "INSERT INTO grant_tx (tx_id, source, user_id, coins, gems, items, policy, label, actor, delivery, status, fingerprint, created_at, updated_at, expires_at, ledger_id, ref, skipped) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rec.txId, rec.source, userId, rec.coins, rec.gems, JSON.stringify(rec.items), rec.policyVersion, rec.label, rec.actor, rec.delivery, rec.status, fingerprint,
        now, now, rec.expiresAt, rec.ledgerId, rec.ref, JSON.stringify(rec.skippedItems),
      );
      return { ok: true, duplicate: false, record: rec, wallet: this.econ.balance() };
    });
  }

  /** Claim one inbox entry. Claiming twice returns the first claim (`duplicate: true`). */
  claim(txId: string, now: number): IssueResult {
    return this.sql.transaction(() => this.claimInner(txId, now));
  }

  private claimInner(txId: string, now: number): IssueResult {
    const row = this.get(txId);
    if (!row) return fail("NOT_FOUND", "보상을 찾을 수 없어요.");
    if (row.status === "claimed" || row.status === "granted") return { ok: true, duplicate: true, record: toRecord(row), wallet: this.econ.balance() };
    if (row.status === "revoked") return fail("REVOKED", "취소된 보상이에요.");
    if (row.status === "expired" || (row.expires_at != null && row.expires_at <= now)) {
      if (row.status !== "expired") this.sql.exec("UPDATE grant_tx SET status = 'expired', updated_at = ? WHERE tx_id = ?", now, txId);
      return fail("EXPIRED", "받을 수 있는 기간이 지났어요.");
    }
    // A source switched off after delivery keeps its entry, but nothing is paid until it is enabled again.
    if (!this.enabled.has(row.source as GrantSource)) return fail("SOURCE_DISABLED", "지금은 받을 수 없는 보상이에요.");
    const rec = toRecord(row);
    const c = this.credit(rec, now);
    this.sql.exec("UPDATE grant_tx SET status = 'claimed', updated_at = ?, ledger_id = ?, skipped = ? WHERE tx_id = ?", now, c.ledgerId, JSON.stringify(c.skipped), txId);
    return { ok: true, duplicate: false, record: { ...rec, status: "claimed", updatedAt: now, ledgerId: c.ledgerId, skippedItems: c.skipped }, wallet: this.econ.balance() };
  }

  /** Claim every claimable inbox entry, oldest first, in one transaction. */
  claimAll(now: number): { ok: true; claimed: GrantRecord[]; wallet: Wallet } {
    return this.sql.transaction(() => {
      const ids = this.sql.exec<{ tx_id: string }>("SELECT tx_id FROM grant_tx WHERE status = 'inboxed' AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at, tx_id", now).toArray().map((r) => r.tx_id);
      const claimed: GrantRecord[] = [];
      for (const id of ids) {
        const r = this.claimInner(id, now);
        if (r.ok && !r.duplicate) claimed.push(r.record);
      }
      return { ok: true as const, claimed, wallet: this.econ.balance() };
    });
  }

  /** Operator: cancel an UNCLAIMED inbox entry (a credited grant can never be revoked here). */
  revoke(txId: string, actor: string, now: number): { ok: true; record: GrantRecord } | Fail {
    return this.sql.transaction(() => {
      if (!actor.startsWith("admin:")) return fail("ACTOR", "운영자만 취소할 수 있어요.");
      const row = this.get(txId);
      if (!row) return fail("NOT_FOUND", "보상을 찾을 수 없어요.");
      if (row.status !== "inboxed") return fail("NOT_REVOCABLE", "이미 지급됐거나 끝난 보상은 취소할 수 없어요.");
      this.sql.exec("UPDATE grant_tx SET status = 'revoked', updated_at = ?, ref = ? WHERE tx_id = ?", now, `${row.ref ?? ""}|revoked-by:${actor}`.slice(0, 200), txId);
      return { ok: true as const, record: toRecord({ ...row, status: "revoked", updated_at: now }) };
    });
  }

  /** Mark inbox entries past their expiry (alarm or on read). Returns how many expired. */
  expire(now: number): number {
    return this.sql.transaction(() => {
      const n = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM grant_tx WHERE status = 'inboxed' AND expires_at IS NOT NULL AND expires_at <= ?", now).toArray()[0].n;
      if (n) this.sql.exec("UPDATE grant_tx SET status = 'expired', updated_at = ? WHERE status = 'inboxed' AND expires_at IS NOT NULL AND expires_at <= ?", now, now);
      return n;
    });
  }

  /** The reward inbox: claimable entries (expired ones are hidden but kept in the history). */
  inbox(now: number): GrantRecord[] {
    return this.sql.exec<Row>("SELECT * FROM grant_tx WHERE status = 'inboxed' AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at, tx_id", now).toArray().map(toRecord);
  }

  history(limit = 50, source?: GrantSource): GrantRecord[] {
    const n = Math.max(1, Math.min(200, limit));
    const rows = source
      ? this.sql.exec<Row>("SELECT * FROM grant_tx WHERE source = ? ORDER BY created_at DESC, tx_id DESC LIMIT ?", source, n).toArray()
      : this.sql.exec<Row>("SELECT * FROM grant_tx ORDER BY created_at DESC, tx_id DESC LIMIT ?", n).toArray();
    return rows.map(toRecord);
  }

  has(txId: string) {
    return this.get(txId) !== null;
  }

  /** Grant ↔ ledger consistency (run with `EconomyStore.verify()` for the balance chain). */
  verify(): { ok: boolean; grants: number; problems: string[] } {
    const problems: string[] = [];
    const rows = this.sql.exec<Row>("SELECT * FROM grant_tx").toArray();
    const ledger = new Map(this.sql.exec<{ event_id: string; coins: number; gems: number; kind: string; config: string }>("SELECT event_id, coins, gems, kind, config FROM ledger WHERE event_id LIKE 'g:%'").toArray().map((r) => [r.event_id, r]));
    for (const r of rows) {
      const id = `g:${r.tx_id}`;
      const l = ledger.get(id);
      const credited = r.status === "granted" || r.status === "claimed";
      const pays = r.coins > 0 || r.gems > 0;
      if (credited && pays) {
        if (!l) problems.push(`missing ledger row for ${r.tx_id}`);
        else if (l.coins !== r.coins || l.gems !== r.gems || l.kind !== r.source || l.config !== r.policy) problems.push(`ledger row differs for ${r.tx_id}`);
        if (r.ledger_id !== id) problems.push(`grant ${r.tx_id} does not point to its ledger row`);
      }
      if (!credited && l) problems.push(`uncredited grant ${r.tx_id} has a ledger row`);
      ledger.delete(id);
    }
    for (const id of ledger.keys()) problems.push(`ledger row ${id} has no grant`);
    return { ok: problems.length === 0, grants: rows.length, problems };
  }
}
