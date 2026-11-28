/**
 * Redeem codes (C5 prototype, inactive). A code turns into ONE grant per account with the deterministic
 * transaction id `code:<codeId>`, so a retried redemption never pays twice.
 *
 * Only a SHA-256 hash of the normalised code is stored or shipped. Plain codes never go into the
 * repository, the bundle or logs. Global limits (total redemptions) need a global object. The design
 * in docs/economy/c5/REWARD-GRANT-CONTRACT.md §교환 코드 reserves a slot there first (idempotent per
 * user), then issues the grant in the account object.
 */
import type { GrantRequest } from "../../../worker/src/grants";

export type CodeDef = {
  /** Stable id (also the tx id suffix). */
  id: string;
  /** hex SHA-256 of `normalizeCode(code)`. */
  hash: string;
  coins: number;
  gems: number;
  items?: string[];
  start: number;
  end: number;
  /** Total redemptions across all accounts, null = unlimited (still once per account). */
  maxRedemptions: number | null;
  /** Only accounts created before this time (e.g. launch compensation). */
  accountCreatedBefore?: number | null;
  policyVersion: string;
  label: string;
};

/** Upper-case, remove spaces and dashes, keep [A-Z0-9]. */
export const normalizeCode = (raw: string) => raw.toUpperCase().replace(/[\s-]/g, "").replace(/[^A-Z0-9]/g, "");

export async function hashCode(raw: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizeCode(raw))));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type CodeCheck = { ok: true; request: GrantRequest } | { ok: false; code: "UNKNOWN" | "NOT_STARTED" | "ENDED" | "SOLD_OUT" | "NOT_ELIGIBLE"; message: string };

/** Pure check of one code for one account. `redeemed` is the global count reserved so far. */
export function checkCode(def: CodeDef | null, now: number, account: { createdAt: number }, redeemed: number): CodeCheck {
  if (!def) return { ok: false, code: "UNKNOWN", message: "없는 코드예요." };
  if (now < def.start) return { ok: false, code: "NOT_STARTED", message: "아직 사용할 수 없는 코드예요." };
  if (now >= def.end) return { ok: false, code: "ENDED", message: "사용 기간이 끝난 코드예요." };
  if (def.maxRedemptions !== null && redeemed >= def.maxRedemptions) return { ok: false, code: "SOLD_OUT", message: "모두 사용된 코드예요." };
  if (def.accountCreatedBefore != null && account.createdAt >= def.accountCreatedBefore) return { ok: false, code: "NOT_ELIGIBLE", message: "이 코드를 사용할 수 없는 계정이에요." };
  return {
    ok: true,
    request: { txId: `code:${def.id}`, source: "redeem-code", coins: def.coins, gems: def.gems, items: def.items ?? [], policyVersion: def.policyVersion, label: def.label, actor: "system", delivery: "direct", ref: def.id },
  };
}
