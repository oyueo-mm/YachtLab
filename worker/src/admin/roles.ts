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
  "approve", // approve (and so execute) drafted dangerous actions
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const GRANTS: Record<Role, readonly Permission[]> = {
  viewer: ["stats.read"],
  support: ["stats.read", "users.read", "reports.read", "reports.write"],
  operator: ["stats.read", "users.read", "audit.read", "reports.read", "reports.write", "notices.write", "rewards.write", "codes.write", "sanctions.write", "suggestions.write"],
  owner: ["stats.read", "users.read", "audit.read", "reports.read", "reports.write", "notices.write", "rewards.write", "codes.write", "sanctions.write", "suggestions.write", "approve"],
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

/** Admin settings from Worker vars. Every write path is off unless explicitly enabled. */
export type AdminSettings = {
  accounts: Map<string, Role>;
  /** "on" lets drafted writes be approved and executed. Default off: drafts/previews only are refused too. */
  writes: boolean;
  /** "self" lets an owner approve their own draft (single-operator service). Default: a second admin must approve. */
  selfApprove: boolean;
  /** Admin session lifetime: idle and absolute (ms), and how recent a session must be for dangerous actions. */
  idleMs: number;
  absoluteMs: number;
  freshMs: number;
};
export function adminSettings(env: { ADMIN_ACCOUNTS?: string; ADMIN_WRITES?: string; ADMIN_APPROVAL?: string }): AdminSettings {
  return {
    accounts: parseAdminAccounts(env.ADMIN_ACCOUNTS),
    writes: env.ADMIN_WRITES === "on",
    selfApprove: env.ADMIN_APPROVAL === "self",
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
