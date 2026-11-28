import { GRANT_CAPS } from "./roles";
import type { InboxItem } from "./store";
import type { MemberOps } from "./member";
import type { GrantRequest, RewardGrants } from "../grants";

/**
 * ADMIN-1 → C5 RewardGrants (#140, docs/economy/c5/REWARD-GRANT-CONTRACT.md) adapter — WIRED by INT-1.
 * Every coin/gem an administrator decides (campaign, adopted suggestion, redeem code) is a C5 grant:
 * `grants.issue(userId, toGrantRequest(...), now, { operator: true })` → `EconomyStore.grantCredit`
 * (ledger `g:<txId>`), the single crediting path. The ADMIN mailbox keeps the message only (amount 0);
 * the C5 reward inbox (`grant_tx`) is the single source of claimable rewards. Both approval gates apply:
 * ADMIN_REWARD_POLICY when the draft is made, C5 APPROVED_SOURCES when the grant is issued. The ids
 * already follow the C5 txId rules:
 *
 *   operator campaign   op:<campaignId>          source operator     delivery inbox (+ expiresAt)
 *   adopted suggestion  sug:<suggestionId>       source suggestion   delivery inbox (30 days)
 *   redeem code         code:<codeId>[:<n>]      source redeem-code  delivery direct
 *
 * The structural type below mirrors C5 `GrantRequest` (checked by `toGrant` below).
 */
export type C5GrantRequest = {
  txId: string;
  source: "operator" | "suggestion" | "redeem-code";
  coins: number;
  gems: number;
  items?: string[];
  policyVersion: string;
  label: string;
  actor: string;
  delivery: "direct" | "inbox";
  expiresAt?: number | null;
  ref?: string;
};
export const C5_TX_ID = /^[A-Za-z0-9:._-]{4,96}$/;

export function sourceOf(itemId: string): C5GrantRequest["source"] | null {
  if (/^op:rw_[a-z0-9]{16,20}$/.test(itemId)) return "operator";
  if (/^sug:sg_[a-z0-9]{16}$/.test(itemId)) return "suggestion";
  if (/^code:cd_[a-z0-9]{16}(:\d{1,2})?$/.test(itemId)) return "redeem-code";
  return null;
}

/**
 * Map one admin delivery to a C5 grant request. `actor` is the APPROVING administrator ("admin:<id>"),
 * `policyVersion` the approved amount policy recorded on the action. Throws on anything C5 would refuse,
 * so a mismatch is caught at integration time rather than in production.
 */
export function toGrantRequest(item: InboxItem, approver: string, policyVersion: string): C5GrantRequest {
  const source = sourceOf(item.id);
  if (!source || !C5_TX_ID.test(item.id)) throw Error("not a C5 txId: " + item.id);
  if (!/^u_[A-Za-z0-9_-]{22}$/.test(approver)) throw Error("approver must be an admin account id");
  const cap = GRANT_CAPS[source];
  if (!Number.isInteger(item.coins) || !Number.isInteger(item.gems) || item.coins < 0 || item.gems < 0 || item.coins + item.gems === 0) throw Error("amount");
  if (item.coins > cap.coins || item.gems > cap.gems) throw Error("over the C5 limit for " + source);
  if (!policyVersion || policyVersion.length > 40) throw Error("policy version required");
  const inbox = source !== "redeem-code";
  return {
    txId: item.id,
    source,
    coins: item.coins,
    gems: item.gems,
    policyVersion,
    label: item.title.slice(0, 80) || "운영 보상",
    actor: "admin:" + approver,
    delivery: inbox ? "inbox" : "direct",
    ...(inbox ? { expiresAt: item.expiresAt } : {}),
    ref: item.id.split(":")[1],
  };
}

const toGrant = (r: C5GrantRequest): GrantRequest => r;

/** A refused grant: the admin action / delivery fails and nothing reaches the player. */
export class GrantRefused extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/** The account-object parts the admin delivery paths use (UserStore, and the same in the test fakes). */
export type AdminGrantContext = {
  userId: string;
  grants: RewardGrants;
  member: MemberOps;
  transaction<T>(fn: () => T): T;
  /**
   * SEC-1 2차 INT-3: the C5 master switch (ECONOMY=on AND RETENTION=on). Every coin/gem path through
   * RewardGrants — admin delivery, mailbox claim, redeem code — is closed while it is off, exactly like the
   * C5 reward routes (rollback = unset RETENTION stops all non-match payouts).
   */
  rewardsOn: boolean;
};
const RETENTION_OFF = { ok: false as const, code: "RETENTION_OFF", message: "보상 기능은 아직 준비 중이에요." };
/** Admin-delivered inbox ids only (the compatibility claim route must not claim other C5 grants). */
const ADMIN_INBOX_ID = /^(op:rw_[a-z0-9]{16,20}|sug:sg_[a-z0-9]{16})$/;

/**
 * Deliver one admin item to this account. A message goes to the mailbox. A reward is issued as a C5 grant
 * (inbox delivery, claimable from the reward inbox) together with its message, in ONE transaction; a
 * refusal (source not approved, over the cap, invalid id, missing approval record) throws — nothing is
 * delivered, so a campaign or approval never shows a reward the player cannot receive.
 */
export function deliverAdminItem(c: AdminGrantContext, item: InboxItem, now: number): "ok" {
  if (!(item.coins > 0 || item.gems > 0)) {
    c.member.deliver(item, now);
    return "ok";
  }
  if (!c.rewardsOn) throw new GrantRefused(RETENTION_OFF.code, RETENTION_OFF.message);
  if (!item.grant) throw new GrantRefused("APPROVAL_MISSING", "승인 기록이 없는 보상은 보낼 수 없어요.");
  const request = toGrant(toGrantRequest(item, item.grant.approver, item.grant.policyVersion));
  return c.transaction(() => {
    const r = c.grants.issue(c.userId, request, now, { operator: true });
    if (!r.ok) throw new GrantRefused(r.code, r.message);
    c.member.deliver({ ...item, coins: 0, gems: 0 }, now);
    return "ok" as const;
  });
}

/** `/api/me/mailbox/:id/claim` (compatibility) = C5 claim of the same txId. Never credits twice. */
export function claimAdminItem(c: AdminGrantContext, id: string, now: number): { ok: true; coins: number; gems: number } | { ok: false; code: string; message: string } {
  if (!c.rewardsOn) return RETENTION_OFF;
  if (!ADMIN_INBOX_ID.test(id)) return { ok: false, code: "NOT_FOUND", message: "받을 보상을 찾을 수 없어요." };
  const r = c.grants.claim(id, now);
  if (!r.ok) return r;
  return r.duplicate ? { ok: false, code: "CLAIMED", message: "이미 받은 보상이에요." } : { ok: true, coins: r.record.coins, gems: r.record.gems };
}

/**
 * Redeem code: a direct C5 grant keyed `code:<codeId>[:<n>]` (one per account per use). A retry of the
 * same reservation is the same txId, so it is reported as done without crediting again.
 */
export function redeemAdminItem(c: AdminGrantContext, item: InboxItem, now: number): { ok: true; coins: number; gems: number } | { ok: false; code: string; message: string } {
  if (!c.rewardsOn) return RETENTION_OFF;
  if (!item.grant) return { ok: false, code: "APPROVAL_MISSING", message: "승인 기록이 없는 코드예요." };
  let request: GrantRequest;
  try {
    request = toGrant(toGrantRequest(item, item.grant.approver, item.grant.policyVersion));
  } catch {
    return { ok: false, code: "INVALID_GRANT", message: "코드 보상을 확인할 수 없어요." };
  }
  const r = c.grants.issue(c.userId, request, now, { operator: true });
  return r.ok ? { ok: true, coins: r.record.coins, gems: r.record.gems } : r;
}

/**
 * Take back an unclaimed admin item. A reward is a C5 grant: only an unclaimed (inboxed) one can be revoked,
 * a claimed one stays (the ledger is append-only) and the call reports false. Only an id with NO grant —
 * a plain message — falls back to hiding it in the mailbox.
 */
export function revokeAdminItem(c: AdminGrantContext, id: string, actor: string, now: number): boolean {
  const r = c.grants.revoke(id, actor, now);
  if (r.ok) return true;
  return r.code === "NOT_FOUND" ? c.member.revoke(id) : false;
}
