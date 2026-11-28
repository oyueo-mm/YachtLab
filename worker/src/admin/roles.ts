import { GRANT_LIMITS } from "../grants";
/**
 * ADMIN-1 — administrator roles and permissions (runtime-free).
 *
 * Who is an administrator is decided ONLY by the Worker secret `ADMIN_ACCOUNTS` (never by the web
 * bundle, a URL or a client flag). It lists existing YachtLab account ids (the `u_…` id of a Google
 * sign-in) with one role each:
 *
 *   ADMIN_ACCOUNTS = "u_AAAAAAAAAAAAAAAAAAAAAA:viewer,u_BBBBBBBBBBBBBBBBBBBBBB:owner"
 *
 * The role is re-read from the secret on EVERY admin request, so removing an id revokes access at the
 * next request (open admin sessions included). Least privilege: `viewer` reads aggregates only,
 * `support` adds individual member lookups and report triage, `operator` may draft writes, `owner`
 * may also approve them. Unknown roles and malformed entries are ignored (fail closed).
 */
export const ROLES = ["viewer", "support", "operator", "owner"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "stats.read", // dashboard, matches, matching, economy, items, quests, system (aggregates only)
  "users.read", // member search and one member's detail (audited)
  "audit.read",
  "reports.read",
  "reports.write", // report status / notes, suggestion moderation, appeal answers
  "notices.write",
  "rewards.write", // draft reward campaigns
  "codes.write", // draft / deactivate redeem codes
  "sanctions.write", // draft sanctions, lift
  "suggestions.write", // status, answer, adopt
  "content.write", // LIVE-1 daily content operations (e.g. withdraw a puzzle) via admin extensions
  "approve", // approve (and so execute) drafted dangerous actions
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const GRANTS: Record<Role, readonly Permission[]> = {
  viewer: ["stats.read"],
  support: ["stats.read", "users.read", "reports.read", "reports.write"],
  operator: ["stats.read", "users.read", "audit.read", "reports.read", "reports.write", "notices.write", "rewards.write", "codes.write", "sanctions.write", "suggestions.write", "content.write"],
  owner: ["stats.read", "users.read", "audit.read", "reports.read", "reports.write", "notices.write", "rewards.write", "codes.write", "sanctions.write", "suggestions.write", "content.write", "approve"],
};

export const can = (role: Role, p: Permission) => GRANTS[role].includes(p);
export const permissionsOf = (role: Role): Permission[] => [...GRANTS[role]];

const USER = /^u_[A-Za-z0-9_-]{22}$/;
/** Parse the allowlist. Malformed entries are dropped; a duplicated id keeps its FIRST (and so a typo cannot widen it) role. */
export function parseAdminAccounts(raw: string | undefined): Map<string, Role> {
  const out = new Map<string, Role>();
  for (const part of (raw ?? "").split(",")) {
    const [id, role] = part.trim().split(":").map((s) => s?.trim());
    if (!id || !USER.test(id) || !(ROLES as readonly string[]).includes(role ?? "")) continue;
    if (!out.has(id)) out.set(id, role as Role);
  }
  return out;
}

/**
 * Approval policy (D-ADM-6):
 *  - "two-person" (DEFAULT): the approver must be a different administrator.
 *  - "single-operator": an owner may approve their OWN draft only under SINGLE_OPERATOR rules — a Google
 *    re-authentication made AFTER the draft, a cooling-off delay, a small blast radius per action kind
 *    and a daily budget; every such approval is marked `self-approved` in the audit log for review.
 * The old value "self" is read as "single-operator" (never as unrestricted self-approval).
 */
export type ApprovalPolicy = "two-person" | "single-operator";
export const SINGLE_OPERATOR = {
  cooldownMs: 10 * 60_000,
  perDay: 3,
  rewardMaxRecipients: 20,
  sanctionMaxDays: 30,
  codeMaxTotal: 100,
} as const;

/** Admin settings from Worker vars. Every write path is off unless explicitly enabled. */
export type AdminSettings = {
  accounts: Map<string, Role>;
  /** "on" lets drafted writes be approved and executed. Default off: drafts/previews only are refused too. */
  writes: boolean;
  approval: ApprovalPolicy;
  /** True when approval is "single-operator" (kept for the console's display). */
  selfApprove: boolean;
  /**
   * "google" (default): an admin session needs a fresh Google re-authentication (prompt=login, max_age=0,
   * auth_time checked) and high-risk actions need one within `freshMs`. "off" is honoured ONLY for a
   * loopback APP_URL (local tests); a deployed Worker always uses "google".
   */
  reauth: "google" | "off";
  /**
   * The approved reward-amount policy version (Worker var ADMIN_REWARD_POLICY). Unset = amounts not
   * approved yet → reward, code and adoption-reward drafts are refused (POLICY_PENDING).
   */
  rewardPolicy: string | null;
  /** Admin session lifetime: idle and absolute (ms), and how recent a session must be for dangerous actions. */
  idleMs: number;
  absoluteMs: number;
  freshMs: number;
};
export function adminSettings(env: { ADMIN_ACCOUNTS?: string; ADMIN_WRITES?: string; ADMIN_APPROVAL?: string; ADMIN_REAUTH?: string; ADMIN_REWARD_POLICY?: string; APP_URL?: string }): AdminSettings {
  const approval: ApprovalPolicy = env.ADMIN_APPROVAL === "single-operator" || env.ADMIN_APPROVAL === "self" ? "single-operator" : "two-person";
  const loopback = /^http:\/\/127\.0\.0\.1:\d+\//.test(env.APP_URL ?? "");
  const policy = (env.ADMIN_REWARD_POLICY ?? "").trim();
  return {
    accounts: parseAdminAccounts(env.ADMIN_ACCOUNTS),
    writes: env.ADMIN_WRITES === "on",
    approval,
    selfApprove: approval === "single-operator",
    reauth: env.ADMIN_REAUTH === "off" && loopback ? "off" : "google",
    rewardPolicy: /^[A-Za-z0-9._-]{1,40}$/.test(policy) ? policy : null,
    idleMs: 30 * 60_000,
    absoluteMs: 4 * 3600_000,
    freshMs: 10 * 60_000,
  };
}

/**
 * Action kinds and whether they need an approval step before they change anything. Lowering a risk
 * (deactivating a code, lifting a sanction, ending a notice) is never blocked behind an approval.
 */
export const ACTION_KINDS = {
  "reward.campaign": { approval: true, permission: "rewards.write" },
  "code.activate": { approval: true, permission: "codes.write" },
  "sanction.apply": { approval: true, permission: "sanctions.write" },
  "suggestion.reward": { approval: true, permission: "suggestions.write" },
} as const satisfies Record<string, { approval: boolean; permission: Permission }>;
export type ActionKind = keyof typeof ACTION_KINDS;

/**
 * Per-request ceilings aligned with the C5 RewardGrants contract (#140, GRANT_LIMITS for the matching
 * sources). They are SAFETY CAPS, not amounts: amounts need the approved policy (rewardPolicy).
 */
/** INT-1: the C5 per-source grant limits are the single set of caps (no second table to drift). */
export const GRANT_CAPS = {
  operator: GRANT_LIMITS.operator,
  "redeem-code": GRANT_LIMITS["redeem-code"],
  suggestion: GRANT_LIMITS.suggestion,
} as const;

/**
 * Legacy `ADMIN_TOKEN` (shared bearer, pre-ADMIN-1). Only these GET routes, every use audited
 * (actor `token:ADMIN_TOKEN`). ADMIN_TOKEN_ROUTES = "metrics" | "metrics,ledger" (default) | "off".
 * No new route may ever be added to the legacy path (D-ADM-9).
 */
export const LEGACY_TOKEN_ROUTES = ["metrics", "ledger"] as const;
export function legacyTokenRoutes(raw: string | undefined): Set<string> {
  if (raw === undefined || raw === "") return new Set(LEGACY_TOKEN_ROUTES);
  if (raw === "off") return new Set();
  return new Set(raw.split(",").map((x) => x.trim()).filter((x) => (LEGACY_TOKEN_ROUTES as readonly string[]).includes(x)));
}
