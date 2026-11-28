import { GRANT_CAPS } from "./roles";
import type { InboxItem } from "./store";

/**
 * ADMIN-1 → C5 RewardGrants (#140, docs/economy/c5/REWARD-GRANT-CONTRACT.md) adapter. PREPARED, NOT
 * WIRED: #140 is not merged, so the active path is still MemberOps mailbox → EconomyStore.adminGrant.
 * When INT-1 integrates #140, the account object's `deliver` / `claim` / `redeemGrant` call
 * `grants.issue(userId, toGrantRequest(...), now, { operator: true })` / `grants.claim(txId)` instead —
 * the admin side does not change, because its ids already follow the C5 txId rules:
 *
 *   operator campaign   op:<campaignId>          source operator     delivery inbox (+ expiresAt)
 *   adopted suggestion  sug:<suggestionId>       source suggestion   delivery inbox (30 days)
 *   redeem code         code:<codeId>[:<n>]      source redeem-code  delivery direct
 *
 * The structural type below mirrors C5 `GrantRequest` (no import: the module is not on main).
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
