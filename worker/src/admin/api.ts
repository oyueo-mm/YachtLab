import { BODY_LIMITS, readJsonObject } from "../limits";
import type { PrivateProfile } from "../account";
import type { SessionUser } from "../accounts-api";
import { ACTION_KINDS, GRANT_CAPS, SINGLE_OPERATOR, can, permissionsOf, type ActionKind, type AdminSettings, type Permission, type Role } from "./roles";
import { cleanText, type DeliverResult, type InboxItem, type RewardPayload, type SanctionPayload, type SuggestionRewardPayload } from "./store";
import { economyStats, itemStats, matchStats, matchingStats, questStats, systemStats, type DayCounters } from "./stats";
import type { InboxView } from "./member";

/**
 * ADMIN-1 / FEEDBACK-1 HTTP routes (runtime-free: the Worker passes Durable Object stubs, tests pass
 * in-memory fakes). Contract for independent security review: docs/admin/ADMIN-FEEDBACK.md §6.
 *
 * Admin authentication (every /api/admin/* request, checked on the server):
 *   1. POST /api/admin/session with the member session (`Authorization: Bearer s1.…`). The account id
 *      must be in the Worker secret ADMIN_ACCOUNTS → a short admin session `a1.…` (30 min idle, 4 h max).
 *   2. Every other admin call sends `Authorization: Bearer a1.…`. The role is re-read from ADMIN_ACCOUNTS
 *      on each call (removal = immediate revocation) and checked against the route's permission.
 *   3. Writes need ADMIN_WRITES=on; dangerous ones are drafted, then approved by an `approve` holder
 *      (a different admin unless ADMIN_APPROVAL=self) with a session younger than 10 minutes and the
 *      action id typed as confirmation. Every write, member lookup and refusal is in the audit log.
 * Unknown admin paths and non-admins get the same 404 as a missing route.
 */
export type AdminOp = string;
export interface AdminHubApi {
  op<T = unknown>(name: AdminOp, ...args: unknown[]): Promise<T>;
  /** Re-arm the delivery alarm after scheduling work. */
  schedule(): Promise<void>;
}
export interface BoardApi {
  op<T = unknown>(name: string, ...args: unknown[]): Promise<T>;
}
export interface AdminUserApi {
  me(): Promise<PrivateProfile | null>;
  adminView?(): Promise<unknown | null>;
  adminRecord?(matchId: string): Promise<unknown | null>;
  deliver?(item: InboxItem): Promise<DeliverResult>;
  revokeItem?(id: string): Promise<boolean>;
  applySanction?(s: { id: string; kind: string; reason: string; until: number | null }): Promise<DeliverResult>;
  liftSanction?(id: string): Promise<boolean>;
  inbox?(): Promise<{ items: InboxView[]; unclaimed: number }>;
  claim?(id: string): Promise<{ ok: true; coins: number; gems: number; snapshot?: unknown } | { ok: false; code: string; message: string }>;
  redeemGrant?(item: InboxItem): Promise<{ ok: true; coins: number; gems: number } | { ok: false; code: string; message: string }>;
  mySanctions?(): Promise<unknown[]>;
  /** C5 reward page view (GET /api/me/rewards shape) — the reply of POST /api/me/rewards/redeem. */
  rewards?(): Promise<{ ok: true } & Record<string, unknown> | { ok: false; code: string; message: string }>;
}
/**
 * LIVE-1 and later modules add admin routes HERE instead of using ADMIN_TOKEN (D-115): the router does
 * authentication, the permission check, the ADMIN_WRITES gate for writes, the re-authentication window
 * for high-risk routes and one audit row per write (and per sensitive read when `auditRead`).
 */
export type AdminExtensionRoute = {
  method: "GET" | "POST";
  /** Matched against the full path, e.g. /^\/api\/admin\/daily$/ */
  path: RegExp;
  permission: Permission;
  /** Writes need ADMIN_WRITES=on and are always audited. */
  write: boolean;
  /** Needs a Google re-authentication within freshMs. */
  highRisk?: boolean;
  auditRead?: boolean;
  /** Audit action name, e.g. "daily.puzzle". */
  action: string;
  handle(ctx: { url: URL; match: RegExpExecArray; body: Record<string, unknown> | null; actor: string; now: number }): Promise<{ status: number; body: unknown; target?: string; detail?: unknown }>;
};

export type AdminBackends = {
  settings: AdminSettings;
  admin: AdminHubApi;
  board: BoardApi;
  user(id: string): AdminUserApi;
  sessionUser(request: Request): Promise<SessionUser | null>;
  hubReport(days: number): Promise<{ days: DayCounters[]; now?: { waiting?: number; publicRooms?: number; activeRandom?: number; waitMsToday?: { n: number; p50: number | null; p90: number | null } } }>;
  usage(): Promise<unknown>;
  liveActivity(): Promise<unknown>;
  flags: Record<string, unknown>;
  limited(key: string, perMinute: number): Promise<boolean>;
  count?(name: string, n?: number): Promise<void>;
  /** Hashed client key (never the IP). */
  client: string;
  now(): number;
  /** FEEDBACK=on: suggestions, reports and appeals. */
  feedback: boolean;
  economy: boolean;
  /** SEC-1 2차 INT-3: C5 reward master switch (ECONOMY+RETENTION). false → claim / redeem answer before any AdminHub call. */
  rewards?: boolean;
  /** Admin routes contributed by other modules (LIVE-1 daily, …). */
  extensions?: AdminExtensionRoute[];
};
type Reply = (status: number, body: unknown) => Response;

/** SEC-1 2차 INT-1: the shared limited reader (declared length AND streamed bytes), never the unbounded body readers. */
const readJson = (request: Request, max: number = BODY_LIMITS.admin): Promise<Record<string, unknown>> => readJsonObject(request, max);
const bearer = (request: Request) => (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
const days = (url: URL, def = 14) => Math.max(1, Math.min(120, Math.floor(Number(url.searchParams.get("days") ?? def)) || def));
const page = (url: URL) => Math.max(0, Math.floor(Number(url.searchParams.get("page") ?? 0)) || 0);
const USER = /^u_[A-Za-z0-9_-]{22}$/;

/* ================================================================== admin ================================================================== */

export async function handleAdminRoute(request: Request, url: URL, b: AdminBackends, reply: Reply): Promise<Response> {
  const path = url.pathname;
  const method = request.method;
  const notFound = () => reply(404, { error: { code: "NOT_FOUND", message: "없는 주소입니다." } });
  const fail = (status: number, code: string, message: string) => reply(status, { error: { code, message } });
  const now = b.now();
  if (!b.settings.accounts.size) return notFound();
  if (await b.limited("admin:" + b.client, 120)) return fail(429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.");

  /* ------------------------------------------------------------- sign in / out ------------------------------------------------------------- */
  if (path === "/api/admin/session" && method === "POST") {
    if (await b.limited("admin-login:" + b.client, 10)) return fail(429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.");
    const me = await b.sessionUser(request);
    const role = me ? b.settings.accounts.get(me.userId) : undefined;
    if (!me || !role) {
      if (me) await b.admin.op("audit", { at: now, actor: me.userId, role: "-", action: "session.denied", result: "denied", client: b.client });
      return notFound();
    }
    // Real re-authentication (D-107/1b): the one-time ticket from a Google prompt=login/max_age=0 flow,
    // bound to this account and to the tab that started it. Only loopback test servers may skip it.
    let reauthAt: number | null = null;
    if (b.settings.reauth === "google") {
      const input = await readJson(request, BODY_LIMITS.adminLogin).catch(() => ({} as Record<string, unknown>));
      reauthAt = await b.admin.op<number | null>("consumeReauth", input.reauth, me.userId, input.clientState, now);
      if (reauthAt === null) {
        await b.admin.op("audit", { at: now, actor: me.userId, role, action: "session.reauth-missing", result: "denied", client: b.client });
        return fail(401, "REAUTH_REQUIRED", "관리자 세션은 Google 재인증 후에만 시작할 수 있어요.");
      }
    }
    const token = await b.admin.op<string>("createSession", me.userId, role, now, reauthAt);
    await b.admin.op("audit", { at: now, actor: me.userId, role, action: "session.create", result: "ok", client: b.client, detail: { reauth: b.settings.reauth, reauthAt } });
    return reply(200, { token, role, permissions: permissionsOf(role), writes: b.settings.writes, approval: b.settings.approval, selfApprove: b.settings.selfApprove, reauth: b.settings.reauth, reauthAt, rewardPolicy: b.settings.rewardPolicy, idleMs: b.settings.idleMs, absoluteMs: b.settings.absoluteMs, freshMs: b.settings.freshMs });
  }

  const token = bearer(request);
  const session = token.startsWith("a1.") ? await b.admin.op<{ userId: string; createdAt: number; reauthAt: number | null } | null>("checkSession", token, now, { idleMs: b.settings.idleMs, absoluteMs: b.settings.absoluteMs }) : null;
  const role = session ? b.settings.accounts.get(session.userId) : undefined;
  if (!session || !role) {
    if (session) await b.admin.op("endSessionsOf", session.userId); // removed from ADMIN_ACCOUNTS
    return notFound();
  }
  const actor = session.userId;
  const audit = (action: string, result: string, target = "", detail: unknown = {}) => b.admin.op("audit", { at: now, actor, role, action, target, result, detail, client: b.client });
  /** SEC-1 2차 ADM-2: a write of the admin index together with its audit row (one transaction there). */
  const audited = <T>(name: string, args: unknown[], action: string, result: string, target = "", detail: unknown = {}) =>
    b.admin.op<T>("audited", name, args, { at: now, actor, role, action, target, result, detail, client: b.client });
  const deny = async (p: Permission) => {
    await audit("denied", "forbidden", path, { need: p });
    return fail(403, "FORBIDDEN", "이 작업을 할 권한이 없어요.");
  };
  const need = (p: Permission) => (can(role, p) ? null : deny(p));
  const writable = () => (b.settings.writes ? null : fail(403, "WRITES_DISABLED", "관리자 쓰기 기능이 꺼져 있어요(ADMIN_WRITES)."));
  /** When this session last proved a Google re-authentication (session-only test mode: its creation). */
  const reauthAt = b.settings.reauth === "google" ? session.reauthAt : session.createdAt;
  const fresh = () => (reauthAt !== null && now - reauthAt <= b.settings.freshMs ? null : fail(401, "REAUTH_REQUIRED", "위험한 작업 전에는 Google로 다시 인증해 주세요."));
  const policy = () => (b.settings.rewardPolicy ? null : fail(409, "POLICY_PENDING", "지급액 정책이 아직 승인되지 않았어요(ADMIN_REWARD_POLICY)."));

  if (path === "/api/admin/logout" && method === "POST") {
    await b.admin.op("endSession", token);
    await audit("session.end", "ok");
    return reply(200, { ok: true });
  }
  if (path === "/api/admin/me" && method === "GET") return reply(200, { userId: actor, role, permissions: permissionsOf(role), writes: b.settings.writes, approval: b.settings.approval, selfApprove: b.settings.selfApprove, reauth: b.settings.reauth, reauthAt, rewardPolicy: b.settings.rewardPolicy, sessionAgeMs: now - session.createdAt, freshMs: b.settings.freshMs });

  /* ------------------------------------------------- module extensions (LIVE-1 …) ------------------------------------------------- */
  for (const ext of b.extensions ?? []) {
    const match = ext.method === method ? ext.path.exec(path) : null;
    if (!match) continue;
    const denied = need(ext.permission); if (denied) return denied;
    if (ext.write) { const off = writable(); if (off) return off; }
    if (ext.highRisk) { const stale = fresh(); if (stale) return stale; }
    try {
      const body = method === "POST" ? await readJson(request) : null;
      // ADM-2: the effect lives in another object — the intent row is written first
      if (ext.write) await audit(ext.action, "started", path);
      const out = await ext.handle({ url, match, body, actor, now });
      if (ext.write || ext.auditRead) await audit(ext.action, out.status < 400 ? "ok" : "failed", out.target ?? path, out.detail ?? {});
      return reply(out.status, out.body);
    } catch (error) {
      if (error instanceof SyntaxError || (error instanceof Error && error.message === "too large")) return fail(400, "INVALID", "요청 형식이 올바르지 않아요.");
      if (ext.write) await audit(ext.action, "error", path);
      throw error;
    }
  }

  try {
    /* -------------------------------------------------------------- read-only -------------------------------------------------------------- */
    if (method === "GET") {
      if (path === "/api/admin/overview") {
        const denied = need("stats.read"); if (denied) return denied;
        const d = days(url, 30);
        const [activity, hub, usage, live] = await Promise.all([b.admin.op<{ days: { dau: number }[] }>("activityReport", d, now), b.hubReport(d), b.usage(), b.liveActivity().catch(() => null)]);
        return reply(200, { activity, live, usage, matches: matchStats(hub.days), matching: matchingStats(hub.days, hub.now ?? null), hubNow: hub.now ?? null, flags: b.flags, concurrentVisitors: null });
      }
      if (path === "/api/admin/stats") {
        const denied = need("stats.read"); if (denied) return denied;
        const d = days(url, 30);
        const [hub, activity] = await Promise.all([b.hubReport(d), b.admin.op<{ days: { dau: number }[] }>("activityReport", d, now)]);
        const dau = activity.days.reduce((a, x) => a + x.dau, 0);
        return reply(200, { days: d, from: hub.days[0]?.day ?? null, matches: matchStats(hub.days), matching: matchingStats(hub.days, hub.now ?? null), economy: economyStats(hub.days), items: itemStats(hub.days), quests: questStats(hub.days, dau || null), system: systemStats(hub.days) });
      }
      if (path === "/api/admin/system") {
        const denied = need("stats.read"); if (denied) return denied;
        const hub = await b.hubReport(7);
        const events = can(role, "audit.read") ? (await b.admin.op<{ entries: unknown[] }>("auditLog", { limit: 20 })).entries : null;
        const suggestions = await b.board.op("stats").catch(() => null);
        return reply(200, { worker: { ok: true, at: now }, flags: b.flags, usage: await b.usage(), hubNow: hub.now ?? null, system: systemStats(hub.days), adminEvents: events, suggestions });
      }
      if (path === "/api/admin/members") {
        const denied = need("users.read"); if (denied) return denied;
        const sort = url.searchParams.get("sort") === "active" ? "active" : "created";
        return reply(200, await b.admin.op("searchMembers", { nickname: cleanText(url.searchParams.get("nickname") ?? "", 24), userId: USER.test(url.searchParams.get("userId") ?? "") ? url.searchParams.get("userId") : "", status: url.searchParams.get("status") ?? "", sort, page: page(url) }));
      }
      const member = /^\/api\/admin\/members\/(u_[A-Za-z0-9_-]{22})$/.exec(path);
      if (member) {
        const denied = need("users.read"); if (denied) return denied;
        const view = await b.user(member[1]).adminView?.();
        await audit("member.view", view ? "ok" : "absent", member[1]);
        if (!view) return fail(404, "NOT_FOUND", "계정을 찾을 수 없어요.");
        if ((view as { ledger?: { ok?: boolean } }).ledger?.ok === false) await b.count?.("ledger.problem").catch(() => undefined);
        return reply(200, { ...(view as object), sanctions: await b.admin.op("sanctions", { userId: member[1] }) });
      }
      if (path === "/api/admin/audit") {
        const denied = need("audit.read"); if (denied) return denied;
        const before = Number(url.searchParams.get("before") ?? "");
        return reply(200, await b.admin.op("auditLog", { actor: USER.test(url.searchParams.get("actor") ?? "") ? url.searchParams.get("actor") : "", action: cleanText(url.searchParams.get("action") ?? "", 40), before: Number.isFinite(before) && before > 0 ? before : undefined, limit: 50 }));
      }
      if (path === "/api/admin/reports") {
        const denied = need("reports.read"); if (denied) return denied;
        return reply(200, { reports: await b.admin.op("reports", { status: url.searchParams.get("status") ?? "", page: page(url) }) });
      }
      const report = /^\/api\/admin\/reports\/(rp_[a-z0-9]{16})$/.exec(path);
      if (report) {
        const denied = need("reports.read"); if (denied) return denied;
        const r = await b.admin.op<{ reporter: string; target_type: string; target_id: string; match_id: string | null } | null>("report", report[1]);
        if (!r) return fail(404, "NOT_FOUND", "신고를 찾을 수 없어요.");
        // Evidence: the server-verified match record as stored in the REPORTER's account (both seats' scores, names, end reason).
        const evidence = r.match_id ? await b.user(r.reporter).adminRecord?.(r.match_id).catch(() => null) ?? null : null;
        const suggestion = r.target_type === "suggestion" ? await b.board.op("get", r.target_id, null, true) : null;
        await audit("report.view", "ok", report[1]);
        return reply(200, { report: r, evidence, suggestion, history: r.target_type === "user" ? await b.admin.op("sanctions", { userId: r.target_id }) : [] });
      }
      if (path === "/api/admin/appeals") {
        const denied = need("reports.read"); if (denied) return denied;
        return reply(200, { appeals: await b.admin.op("appeals", { status: url.searchParams.get("status") ?? "", page: page(url) }) });
      }
      if (path === "/api/admin/sanctions") {
        const denied = need("reports.read"); if (denied) return denied;
        return reply(200, { sanctions: await b.admin.op("sanctions", { userId: USER.test(url.searchParams.get("userId") ?? "") ? url.searchParams.get("userId") : "", status: url.searchParams.get("status") ?? "", page: page(url) }) });
      }
      if (path === "/api/admin/notices") {
        const denied = need("notices.write"); if (denied) return denied;
        return reply(200, { notices: await b.admin.op("notices", true, now) });
      }
      if (path === "/api/admin/rewards") {
        const denied = need("rewards.write"); if (denied) return denied;
        return reply(200, { campaigns: await b.admin.op("campaigns", page(url)) });
      }
      if (path === "/api/admin/codes") {
        const denied = need("codes.write"); if (denied) return denied;
        return reply(200, { codes: await b.admin.op("codes", page(url)) });
      }
      const red = /^\/api\/admin\/codes\/(cd_[a-z0-9]{16})\/redemptions$/.exec(path);
      if (red) {
        const denied = need("codes.write"); if (denied) return denied;
        return reply(200, { redemptions: await b.admin.op("redemptions", red[1], page(url)) });
      }
      if (path === "/api/admin/actions") {
        // any role that drafts or approves actions may list them
        if (!(["approve", "rewards.write", "codes.write", "sanctions.write", "suggestions.write"] as Permission[]).some((p) => can(role, p))) return deny("approve");
        return reply(200, { actions: await b.admin.op("actions", url.searchParams.get("status") || null, page(url)) });
      }
      if (path === "/api/admin/suggestions") {
        const denied = need("reports.read"); if (denied) return denied;
        return reply(200, await b.board.op("list", { viewer: null, q: url.searchParams.get("q") ?? "", category: url.searchParams.get("category") ?? "", status: url.searchParams.get("status") ?? "", sort: url.searchParams.get("sort") ?? "latest", page: page(url), admin: true }));
      }
      const sg = /^\/api\/admin\/suggestions\/(sg_[a-z0-9]{16})$/.exec(path);
      if (sg) {
        const denied = need("reports.read"); if (denied) return denied;
        const s = await b.board.op("get", sg[1], null, true);
        return s ? reply(200, { suggestion: s, history: await b.board.op("history", sg[1]) }) : fail(404, "NOT_FOUND", "제안을 찾을 수 없어요.");
      }
      return notFound();
    }
    if (method !== "POST") return notFound();

    /* ---------------------------------------------------------- previews (no change) ---------------------------------------------------------- */
    if (path === "/api/admin/rewards/preview") {
      const denied = need("rewards.write"); if (denied) return denied;
      const checked = await b.admin.op<{ ok: true; payload: RewardPayload } | { ok: false; code: string; message: string }>("checkReward", await readJson(request), now);
      if (!checked.ok) return fail(400, checked.code, checked.message);
      return reply(200, { preview: await b.admin.op("previewReward", checked.payload, now) });
    }

    /* ---------------------------------------------------------------- writes ---------------------------------------------------------------- */
    const off = writable(); if (off) return off;
    const input = await readJson(request);

    const draft = async (kind: ActionKind, payload: unknown, preview: unknown, target: string) => {
      const denied = need(ACTION_KINDS[kind].permission); if (denied) return denied;
      const stale = fresh(); if (stale) return stale; // drafting a dangerous action is itself high-risk
      const id = await audited<string>("draft", [kind, payload, preview, actor, now], "action.draft", "pending", "", { kind, target, preview });
      return reply(201, { actionId: id, status: "pending", preview, note: "승인 권한을 가진 다른 관리자가 승인해야 실행돼요." });
    };

    if (path === "/api/admin/rewards") {
      const denied = need("rewards.write"); if (denied) return denied;
      const pending = policy(); if (pending) return pending;
      const checked = await b.admin.op<{ ok: true; payload: RewardPayload } | { ok: false; code: string; message: string }>("checkReward", input, now);
      if (!checked.ok) return fail(400, checked.code, checked.message);
      const preview = await b.admin.op<{ recipients: number }>("previewReward", checked.payload, now);
      if (!preview.recipients) return fail(400, "NO_RECIPIENTS", "지급 대상이 없어요.");
      const payload = { ...checked.payload, policyVersion: b.settings.rewardPolicy! };
      return draft("reward.campaign", payload, { ...preview, policyVersion: payload.policyVersion }, checked.payload.target.type);
    }
    const rw = /^\/api\/admin\/rewards\/(rw_[a-z0-9]{16,20})\/(cancel|retry)$/.exec(path);
    if (rw) {
      const denied = need("rewards.write"); if (denied) return denied;
      const r = await audited<{ ok: boolean }>(rw[2] === "cancel" ? "cancelCampaign" : "retryFailed", [rw[1], now], "reward." + rw[2], "ok", rw[1]);
      if (rw[2] === "retry") await b.admin.schedule();
      return reply(r.ok ? 200 : 400, r);
    }
    const revoke = /^\/api\/admin\/members\/(u_[A-Za-z0-9_-]{22})\/inbox\/([A-Za-z0-9_:-]{4,80})\/revoke$/.exec(path);
    if (revoke) {
      const denied = need("rewards.write"); if (denied) return denied;
      const stale = fresh(); if (stale) return stale;
      await audit("reward.revoke", "started", revoke[1], { item: revoke[2] }); // ADM-2: effect in the account object
      const ok = (await b.user(revoke[1]).revokeItem?.(revoke[2])) ?? false;
      await audit("reward.revoke", ok ? "ok" : "not-revocable", revoke[1], { item: revoke[2] });
      return ok ? reply(200, { ok: true }) : fail(409, "NOT_REVOCABLE", "이미 받았거나 없는 보상이에요(받은 보상은 원장에서 회수하지 않아요).");
    }

    if (path === "/api/admin/codes") {
      const denied = need("codes.write"); if (denied) return denied;
      const pending = policy(); if (pending) return pending;
      const stale = fresh(); if (stale) return stale;
      const made = await audited<{ ok: true; id: string; code: string } | { ok: false; code: string; message: string }>("createCode", [input, actor, now], "code.create", "draft");
      if (!made.ok) return fail(400, made.code, made.message);
      const c = await b.admin.op("code", made.id);
      return draft("code.activate", { codeId: made.id, policyVersion: b.settings.rewardPolicy }, { ...(c as object), policyVersion: b.settings.rewardPolicy }, made.id);
    }
    const deact = /^\/api\/admin\/codes\/(cd_[a-z0-9]{16})\/deactivate$/.exec(path);
    if (deact) {
      const denied = need("codes.write"); if (denied) return denied;
      const r = await audited<{ ok: boolean; code?: string; message?: string }>("setCodeStatus", [deact[1], "inactive"], "code.deactivate", "ok", deact[1]);
      return r.ok ? reply(200, r) : fail(400, r.code ?? "FAILED", r.message ?? "처리하지 못했어요.");
    }

    if (path === "/api/admin/notices") {
      const denied = need("notices.write"); if (denied) return denied;
      const r = await audited<{ ok: true; id: string } | { ok: false; code: string; message: string }>("saveNotice", [input, actor, now], "notice.save", "ok", "", { status: input.status === "published" ? "published" : "draft", important: !!input.important });
      if (!r.ok) return fail(400, r.code, r.message);
      return reply(200, r);
    }
    const endN = /^\/api\/admin\/notices\/(nt_[a-z0-9]{16})\/end$/.exec(path);
    if (endN) {
      const denied = need("notices.write"); if (denied) return denied;
      const r = await audited<{ ok: boolean }>("endNotice", [endN[1], actor, now], "notice.end", "ok", endN[1]);
      return reply(r.ok ? 200 : 404, r);
    }

    const rep = /^\/api\/admin\/reports\/(rp_[a-z0-9]{16})$/.exec(path);
    if (rep) {
      const denied = need("reports.write"); if (denied) return denied;
      const r = await audited<{ ok: boolean; code?: string; message?: string }>("updateReport", [rep[1], input.status, input.note, now], "report.update", "ok", rep[1], { status: input.status });
      return r.ok ? reply(200, r) : fail(400, r.code ?? "FAILED", r.message ?? "");
    }

    if (path === "/api/admin/sanctions") {
      const denied = need("sanctions.write"); if (denied) return denied;
      const checked = await b.admin.op<{ ok: true; payload: SanctionPayload } | { ok: false; code: string; message: string }>("checkSanction", input);
      if (!checked.ok) return fail(400, checked.code, checked.message);
      const target = await b.user(checked.payload.userId).me().catch(() => null);
      if (!target) return fail(404, "NOT_FOUND", "계정을 찾을 수 없어요.");
      if (checked.payload.kind === "warning") {
        // the mildest sanction: recorded and notified at once (still audited, still needs ADMIN_WRITES)
        const id = "sn_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
        await audit("sanction.warning", "started", checked.payload.userId, { id }); // ADM-2: effect in the account object
        const sent = await b.user(checked.payload.userId).applySanction?.({ id, kind: "warning", reason: checked.payload.reason, until: null });
        if (sent !== "ok") return fail(404, "NOT_FOUND", "계정을 찾을 수 없어요.");
        await audited("recordSanction", [id, checked.payload, actor, null, now], "sanction.warning", "ok", checked.payload.userId, { id, reportId: checked.payload.reportId });
        return reply(200, { ok: true, sanctionId: id });
      }
      return draft("sanction.apply", checked.payload, { ...checked.payload, nickname: target.nickname }, checked.payload.userId);
    }
    const lift = /^\/api\/admin\/sanctions\/(sn_[a-z0-9]{16})\/lift$/.exec(path);
    if (lift) {
      const denied = need("sanctions.write"); if (denied) return denied;
      const r = await liftSanction(b, lift[1], actor, cleanText(input.reason, 500) || "운영자 해제", now, { role, client: b.client, action: "sanction.lift" });
      return r.ok ? reply(200, r) : fail(400, r.code, r.message);
    }

    const ap = /^\/api\/admin\/appeals\/(ap_[a-z0-9]{16})$/.exec(path);
    if (ap) {
      const denied = need("reports.write"); if (denied) return denied;
      if (input.status === "accepted" && !can(role, "sanctions.write")) return deny("sanctions.write");
      const r = await audited<{ ok: true; appeal: { sanction_id: string; user_id: string } } | { ok: false; code: string; message: string }>("answerAppeal", [ap[1], input.status, input.answer, actor, now], "appeal.answer", "ok", ap[1], { status: input.status });
      if (!r.ok) return fail(400, r.code, r.message);
      let lifted = false;
      if (input.status === "accepted") lifted = (await liftSanction(b, r.appeal.sanction_id, actor, "이의제기 인용", now, { role, client: b.client, action: "sanction.lift" })).ok;
      if (input.status !== "reviewing") await b.user(r.appeal.user_id).deliver?.({ id: "ap:" + ap[1], kind: "sanction", title: input.status === "accepted" ? "이의제기가 받아들여졌어요" : "이의제기 처리 결과", body: cleanText(input.answer, 1000), coins: 0, gems: 0, expiresAt: null }).catch(() => undefined);
      return reply(200, { ok: true, lifted });
    }

    const msg = /^\/api\/admin\/suggestions\/(sg_[a-z0-9]{16})$/.exec(path);
    if (msg) {
      const onlyHide = Object.keys(input).every((k) => k === "hidden");
      const denied = need(onlyHide ? "reports.write" : "suggestions.write"); if (denied) return denied;
      await audit("suggestion.moderate", "started", msg[1]); // ADM-2: the board is another object — intent first
      const r = await b.board.op<{ ok: true; suggestion: { status: string } } | { ok: false; code: string; message: string }>("moderate", msg[1], actor, input, now);
      if (!r.ok) {
        await audit("suggestion.moderate", "failed", msg[1], { code: r.code });
        return fail(400, r.code, r.message);
      }
      await audit("suggestion.moderate", "ok", msg[1], { status: input.status, hidden: input.hidden, answered: input.answer !== undefined });
      return reply(200, r);
    }
    const sgr = /^\/api\/admin\/suggestions\/(sg_[a-z0-9]{16})\/reward$/.exec(path);
    if (sgr) {
      const denied = need("suggestions.write"); if (denied) return denied;
      const pending = policy(); if (pending) return pending;
      const coins = Number(input.coins ?? 0), gems = Number(input.gems ?? 0);
      // Amounts are not fixed yet (docs §4: set after the economy owner's study); the safety caps still apply.
      if (!Number.isInteger(coins) || !Number.isInteger(gems) || coins < 0 || gems < 0 || coins + gems === 0 || coins > GRANT_CAPS.suggestion.coins || gems > GRANT_CAPS.suggestion.gems) return fail(400, "INVALID", "감사 보상량을 확인해 주세요.");
      // SEC-1 2차 ADM-5: reserve on the board first (conditional), then draft, then record the action id
      const token = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      const t = await b.board.op<{ ok: true; userId: string; title: string } | { ok: false; code: string; message: string }>("reserveReward", sgr[1], token, now);
      if (!t.ok) return fail(400, t.code, t.message);
      const payload: SuggestionRewardPayload = { suggestionId: sgr[1], userId: t.userId, coins, gems, reason: cleanText(input.reason, 300) || "제안 채택 감사 보상", policyVersion: b.settings.rewardPolicy! };
      let res: Response;
      try {
        res = await draft("suggestion.reward", payload, { ...payload, title: t.title }, t.userId);
      } catch (error) {
        await b.board.op("releaseReward", sgr[1], token).catch(() => undefined);
        throw error;
      }
      if (res.status === 201) await b.board.op("markReward", sgr[1], ((await res.clone().json()) as { actionId: string }).actionId, token);
      else await b.board.op("releaseReward", sgr[1], token).catch(() => undefined);
      return res;
    }

    /* ------------------------------------------------------------- approvals ------------------------------------------------------------- */
    const act = /^\/api\/admin\/actions\/(act_[a-z0-9]{20})\/(approve|reject|cancel)$/.exec(path);
    if (act) {
      const [, id, verb] = act;
      if (verb !== "cancel") { const denied = need("approve"); if (denied) return denied; }
      if (verb === "approve") {
        const stale = fresh(); if (stale) return stale;
        if (input.confirm !== id) return fail(400, "CONFIRM", "확인을 위해 작업 ID를 정확히 입력해 주세요.");
      }
      // Single-operator policy (D-112): one's own draft only after the cooling-off delay, with a Google
      // re-authentication made AFTER the draft, inside the blast-radius limits and the daily budget.
      let self = false;
      if (verb === "approve") {
        const a = await b.admin.op<{ kind: ActionKind; created_by: string; created_at: number; payload: unknown; preview: unknown; status: string } | null>("action", id);
        if (a && a.status === "pending" && a.created_by === actor) {
          if (b.settings.approval !== "single-operator") {
            await audit("action.approve", "refused", id, { code: "SECOND_APPROVER" });
            return fail(409, "SECOND_APPROVER", "작성자가 아닌 다른 관리자가 승인해야 해요.");
          }
          const why = singleOperatorRefusal(a, reauthAt, now);
          if (why) {
            await audit("action.approve", "refused", id, { code: why.code });
            return fail(409, why.code, why.message);
          }
          self = true;
        }
      }
      // ADM-6: a self-approval checks and spends the daily budget inside the same transaction as the decision
      // ADM-2: the decision and its audit row in one transaction of the admin index (a refusal is logged as failed)
      type Decided = { ok: true } | { ok: false; code: string; message: string };
      const decided = self
        ? await audited<Decided>("decideSelf", [id, actor, now, SINGLE_OPERATOR.perDay], "action.approve", "ok", id, { approval: "self-approved" })
        : await audited<Decided>("decide", [id, actor, verb === "approve" ? "approved" : verb === "reject" ? "rejected" : "cancelled", now, false], "action." + verb, "ok", id);
      if (!decided.ok && decided.code === "SELF_BUDGET") return fail(429, "SELF_BUDGET", decided.message);
      if (!decided.ok) return fail(409, decided.code, decided.message);
      if (verb !== "approve") return reply(200, { ok: true, status: verb === "reject" ? "rejected" : "cancelled" });
      const result = await execute(b, id, actor, now, { role, client: b.client, detail: { approval: self ? "self-approved" : "second-admin" } });
      return reply(result.ok ? 200 : 500, result);
    }
    // SEC-1 2차 ADM-2: re-run an interrupted (`executing`) or failed approved action — same idempotent effect
    const resume = /^\/api\/admin\/actions\/(act_[a-z0-9]{20})\/resume$/.exec(path);
    if (resume) {
      const denied = need("approve"); if (denied) return denied;
      const stale = fresh(); if (stale) return stale;
      if (input.confirm !== resume[1]) return fail(400, "CONFIRM", "확인을 위해 작업 ID를 정확히 입력해 주세요.");
      const result = await execute(b, resume[1], actor, now, { role, client: b.client, resume: true });
      if (result.error === "RUNNING") return fail(409, "RUNNING", "아직 실행 중이에요. 2분 뒤에도 끝나지 않으면 다시 실행할 수 있어요.");
      if (result.error === "STATE" || result.error === "NOT_FOUND") return fail(409, String(result.error), "다시 실행할 수 있는 작업이 아니에요.");
      return reply(result.ok ? 200 : 500, result);
    }
    return notFound();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg === "too large" || error instanceof SyntaxError) return fail(400, "INVALID", "요청 형식이 올바르지 않아요.");
    throw error;
  }
}

/** Single-operator self-approval rules; null = allowed. */
export function singleOperatorRefusal(a: { kind: ActionKind; created_at: number; payload: unknown; preview?: unknown }, reauthAt: number | null, now: number): { code: string; message: string } | null {
  if (now - a.created_at < SINGLE_OPERATOR.cooldownMs) return { code: "COOLDOWN", message: `본인 초안은 작성 ${SINGLE_OPERATOR.cooldownMs / 60_000}분 뒤에 승인할 수 있어요.` };
  if (reauthAt === null || reauthAt <= a.created_at) return { code: "REAUTH_AFTER_DRAFT", message: "초안을 만든 뒤 Google로 다시 인증해야 본인 승인할 수 있어요." };
  const p = a.payload as Record<string, any>;
  if (a.kind === "reward.campaign" && (p.target?.type !== "users" || (p.target.userIds?.length ?? 0) > SINGLE_OPERATOR.rewardMaxRecipients))
    return { code: "SCOPE", message: `본인 승인 지급은 개별 회원 ${SINGLE_OPERATOR.rewardMaxRecipients}명 이하만 가능해요. 조건·전체 지급은 두 번째 관리자가 필요해요.` };
  if (a.kind === "sanction.apply" && (p.kind === "restrict" || p.kind === "suspend") && (p.days === null || p.days > SINGLE_OPERATOR.sanctionMaxDays))
    return { code: "SCOPE", message: `본인 승인 제재는 ${SINGLE_OPERATOR.sanctionMaxDays}일 이하만 가능해요(무기한 정지는 두 번째 관리자).` };
  if (a.kind === "code.activate" && Number((a.preview as { max_total?: number } | undefined)?.max_total ?? Infinity) > SINGLE_OPERATOR.codeMaxTotal)
    return { code: "SCOPE", message: `본인 승인 코드는 전체 ${SINGLE_OPERATOR.codeMaxTotal}회 이하만 가능해요.` };
  return null;
}

async function liftSanction(b: AdminBackends, id: string, by: string, reason: string, now: number, a: { role: string; client?: string; action: string }): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  // ADM-2: the admin index change and its audit row together; the account object follows (idempotent)
  const r = await b.admin.op<{ ok: true; userId: string } | { ok: false; code: string; message: string }>("audited", "liftSanction", [id, by, reason, now], { at: now, actor: by, role: a.role, action: a.action, target: id, result: "ok", detail: {}, client: a.client });
  if (!r.ok) return r;
  await b.user(r.userId).liftSanction?.(id).catch(() => undefined);
  return { ok: true };
}

/**
 * Run an approved action. Every branch is idempotent by an id derived from the action.
 * SEC-1 2차 ADM-2: the effects live in other objects (accounts, campaign queue), so no single SQL transaction
 * can cover them. Instead: (1) `beginExecution` marks the action `executing` and writes a "started" audit row
 * atomically BEFORE any effect; (2) the effect runs (idempotent ids); (3) `finishExecution` writes the status
 * and the outcome audit row atomically. A crash between (1) and (3) leaves `executing` + "started" in the log
 * — visible, and resumable with POST /api/admin/actions/:id/resume, which re-runs the same idempotent effect.
 */
async function execute(b: AdminBackends, actionId: string, by: string, now: number, ctx: { role: string; client?: string; resume?: boolean; detail?: Record<string, unknown> }): Promise<{ ok: boolean; [k: string]: unknown }> {
  const started = await b.admin.op<{ ok: true; kind: ActionKind; payload: unknown; attempt: number } | { ok: false; code: string; message: string }>("beginExecution", actionId, { at: now, actor: by, role: ctx.role, client: ctx.client, resume: !!ctx.resume });
  if (!started.ok) return { ok: false, error: started.code };
  const a = { kind: started.kind, payload: started.payload };
  let status: "executed" | "failed";
  let result: Record<string, unknown>;
  try {
    if (a.kind === "reward.campaign") {
      const campaignId = await b.admin.op<string>("scheduleCampaign", actionId, { ...(a.payload as RewardPayload), approvedBy: by }, now);
      await b.admin.schedule();
      result = { campaignId, scheduledAt: (a.payload as RewardPayload).scheduledAt };
    } else if (a.kind === "code.activate") {
      const cp = a.payload as { codeId: string; policyVersion?: string };
      const r = await b.admin.op<{ ok: boolean; message?: string }>("setCodeStatus", cp.codeId, "active", cp.policyVersion ? { approver: by, policyVersion: cp.policyVersion } : undefined);
      if (!r.ok) throw Error(r.message ?? "code");
      result = { codeId: (a.payload as { codeId: string }).codeId, status: "active" };
    } else if (a.kind === "sanction.apply") {
      const p = a.payload as SanctionPayload;
      const id = "sn_" + actionId.slice(4, 20);
      const until = p.days === null ? null : now + p.days * 86_400_000;
      const sent = await b.user(p.userId).applySanction?.({ id, kind: p.kind, reason: p.reason, until });
      if (sent !== "ok") throw Error("account not found");
      await b.admin.op("recordSanction", id, p, by, actionId, now);
      result = { sanctionId: id, until };
    } else if (a.kind === "suggestion.reward") {
      const p = a.payload as SuggestionRewardPayload;
      const sent = await b.user(p.userId).deliver?.({ id: "sug:" + p.suggestionId, kind: "suggestion", title: "제안 채택 감사 보상", body: p.reason, coins: p.coins, gems: p.gems, expiresAt: now + 30 * 86_400_000, ...(p.policyVersion ? { grant: { approver: by, policyVersion: p.policyVersion } } : {}) });
      if (sent !== "ok") throw Error("account not found");
      result = { delivered: p.userId };
    } else throw Error("unknown action");
    status = "executed";
  } catch (error) {
    status = "failed";
    result = { error: error instanceof Error ? (error as { code?: string }).code ?? error.message : "failed" };
  }
  const out = { ...result, attempt: started.attempt };
  // if this write fails the action stays `executing` with its "started" row: the console shows it as interrupted
  await b.admin.op("finishExecution", actionId, status, out, { at: now, actor: by, role: ctx.role, client: ctx.client, detail: ctx.detail });
  return { ok: status === "executed", ...out };
}

/* ========================================================= member-facing routes ========================================================= */

/**
 * Notices (public), suggestions board, reports, appeals, mailbox, redeem codes. Returns null when the
 * path is not one of these (the account routes handle the rest of /api/me).
 */
export async function handleEngagementRoute(request: Request, url: URL, b: AdminBackends, reply: Reply): Promise<Response | null> {
  const path = url.pathname;
  const method = request.method;
  const fail = (status: number, code: string, message: string) => reply(status, { error: { code, message } });
  const now = b.now();
  const ours = path === "/api/notices" || path.startsWith("/api/suggestions") || path === "/api/reports" || path === "/api/me/mailbox" || path.startsWith("/api/me/mailbox/") || path === "/api/me/redeem" || path === "/api/me/rewards/redeem" || path === "/api/me/sanctions" || path === "/api/me/appeals";
  if (!ours) return null;
  try {
    if (path === "/api/notices" && method === "GET") return reply(200, { notices: await b.admin.op("notices", false, now) });

    const suggestions = path.startsWith("/api/suggestions") || path === "/api/reports" || path === "/api/me/appeals";
    if (suggestions && !b.feedback) return fail(404, "FEEDBACK_OFF", "서비스 제안 기능은 아직 준비 중이에요.");
    if (path === "/api/suggestions/contributors" && method === "GET") return reply(200, { contributors: await b.board.op("contributors") });
    const me = await b.sessionUser(request);
    if (method === "GET" && path === "/api/suggestions") {
      if (await b.limited("sg-list:" + b.client, 60)) return fail(429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.");
      const q = url.searchParams;
      return reply(200, await b.board.op("list", { viewer: me?.userId ?? null, q: q.get("q") ?? "", category: q.get("category") ?? "", status: q.get("status") ?? "", sort: q.get("sort") ?? "latest", mine: q.get("mine") === "1", page: Number(q.get("page") ?? 0) }));
    }
    const one = /^\/api\/suggestions\/(sg_[a-z0-9]{16})$/.exec(path);
    if (one && method === "GET") {
      const s = await b.board.op("get", one[1], me?.userId ?? null, false);
      return s ? reply(200, { suggestion: s }) : fail(404, "NOT_FOUND", "제안을 찾을 수 없어요.");
    }

    if (!me) return fail(401, "UNAUTHENTICATED", "로그인이 필요해요.");
    if (await b.limited("me:" + me.userId, 120)) return fail(429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.");
    const user = b.user(me.userId);

    if (path === "/api/me/sanctions" && method === "GET") return reply(200, { sanctions: (await user.mySanctions?.()) ?? [], standing: { suspended: me.suspended, restricted: me.restricted, until: me.until } });
    if (path === "/api/me/appeals" && method === "GET") return reply(200, { appeals: await b.admin.op("appeals", { userId: me.userId }) });
    if (path === "/api/me/mailbox" && method === "GET") return reply(200, (await user.inbox?.()) ?? { items: [], unclaimed: 0 });
    if (method !== "POST") return fail(404, "NOT_FOUND", "없는 주소입니다.");
    const input = await readJson(request, BODY_LIMITS.engagement);

    // A suspended account may still appeal; nothing else here.
    if (path === "/api/me/appeals") {
      if (await b.limited("appeal:" + me.userId, 3)) return fail(429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.");
      const r = await b.admin.op<{ ok: true; id: string } | { ok: false; code: string; message: string }>("createAppeal", me.userId, input.sanctionId, input.text, now);
      return r.ok ? reply(201, r) : fail(400, r.code, r.message);
    }
    if (me.suspended) return fail(403, "SUSPENDED", "이용이 정지된 계정이에요.");

    const claim = /^\/api\/me\/mailbox\/([A-Za-z0-9_:-]{4,80})\/claim$/.exec(path);
    if (claim) {
      if (!b.economy) return fail(404, "ECONOMY_OFF", "재화 기능은 아직 준비 중이에요.");
      if (b.rewards === false) return fail(404, "RETENTION_OFF", "보상 기능은 아직 준비 중이에요.");
      const r = await user.claim?.(claim[1]);
      if (!r) return fail(404, "NOT_FOUND", "없는 주소입니다.");
      if (r.ok) await Promise.all([b.count?.("grant.admin.coins", r.coins), b.count?.("grant.admin.gems", r.gems)]).catch(() => undefined);
      return r.ok ? reply(200, r) : fail(r.code === "NOT_FOUND" ? 404 : 409, r.code, r.message);
    }
    // INT-1: one redeem flow for the C5 reward page (/api/me/rewards/redeem) and the ADMIN-1 route (/api/me/redeem).
    if (path === "/api/me/redeem" || path === "/api/me/rewards/redeem") {
      if (!b.economy) return fail(404, "ECONOMY_OFF", "재화 기능은 아직 준비 중이에요.");
      // switch off: no code lookup, no reservation, no AdminHub request
      if (b.rewards === false) return fail(404, "RETENTION_OFF", "보상 기능은 아직 준비 중이에요.");
      if ((await b.limited("redeem:" + me.userId, 5)) || (await b.limited("redeem-ip:" + b.client, 20))) return fail(429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.");
      const profile = await user.me();
      if (!profile) return fail(401, "UNAUTHENTICATED", "로그인이 필요해요.");
      const r = await b.admin.op<{ ok: true; redemptionId: string; item: InboxItem } | { ok: false; code: string; message: string }>("redeem", me.userId, profile.createdAt, input.code, now);
      if (!r.ok) {
        // SEC-1 2차 ECO-3: one answer for "no such code", "not started / ended", "not for this account" and
        // "used up" (only this account's own earlier use is told apart); the real reason goes to a counter.
        await b.count?.("code.refused." + r.code).catch(() => undefined);
        if (r.code === "CODE_USED" || r.code === "INVALID_CODE" && /확인해/.test(r.message)) return fail(400, r.code, r.message);
        return fail(400, "INVALID_CODE", "사용할 수 없는 코드예요.");
      }
      const granted = await user.redeemGrant?.(r.item).catch(() => null);
      if (!granted) return fail(503, "RETRY", "보상을 지급하지 못했어요. 같은 코드로 다시 시도해 주세요(중복 지급되지 않아요).");
      if (!granted.ok) {
        // a definite refusal (e.g. C5 SOURCE_DISABLED while redeem codes are not approved): release the reservation
        await b.admin.op("confirmRedeem", me.userId, r.redemptionId, false);
        return fail(409, granted.code, granted.message);
      }
      await b.admin.op("confirmRedeem", me.userId, r.redemptionId, true);
      await Promise.all([b.count?.("grant.admin.coins", granted.coins), b.count?.("grant.admin.gems", granted.gems), b.count?.("code.redeem")]).catch(() => undefined);
      if (path === "/api/me/rewards/redeem") {
        // C5 reward page contract: the refreshed RewardsView plus what this code just paid (`granted`).
        const view = await user.rewards?.().catch(() => null);
        const paid = { txId: r.redemptionId, source: "redeem", coins: granted.coins, gems: granted.gems, items: [], label: r.item.title, status: "claimed", createdAt: now, expiresAt: null };
        if (view?.ok) {
          const { ok: _ok, ...rest } = view;
          return reply(200, { ...rest, granted: [paid] });
        }
      }
      return reply(200, { ok: true, title: r.item.title, coins: granted.coins, gems: granted.gems });
    }

    if (me.restricted && (path === "/api/suggestions" || path === "/api/reports")) return fail(403, "RESTRICTED", "이용 제한 중에는 글을 쓰거나 신고할 수 없어요.");
    if (path === "/api/reports") {
      const r = await b.admin.op<{ ok: true; id: string } | { ok: false; code: string; message: string }>("createReport", me.userId, input, now);
      return r.ok ? reply(201, r) : fail(r.code === "RATE_LIMITED" ? 429 : 400, r.code, r.message);
    }
    if (path === "/api/suggestions") {
      if (await b.limited("sg-post:" + b.client, 10)) return fail(429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.");
      const profile = await user.me();
      const r = await b.board.op<{ ok: true; id: string } | { ok: false; code: string; message: string }>("create", { userId: me.userId, nickname: profile?.nickname ?? null }, input, now);
      return r.ok ? reply(201, r) : fail(r.code === "RATE_LIMITED" ? 429 : 400, r.code, r.message);
    }
    const act = /^\/api\/suggestions\/(sg_[a-z0-9]{16})\/(vote|report|credit)$/.exec(path);
    if (act) {
      const r = act[2] === "vote" ? await b.board.op<{ ok: boolean; code?: string; message?: string }>("vote", act[1], me.userId, input.on !== false, now)
        : act[2] === "report" ? await b.board.op<{ ok: boolean; code?: string; message?: string }>("report", act[1], me.userId, input.reason, now)
        : await b.board.op<{ ok: boolean; code?: string; message?: string }>("setCredit", act[1], me.userId, input.credit === true, now);
      return r.ok ? reply(200, r) : fail(r.code === "NOT_FOUND" ? 404 : r.code === "RATE_LIMITED" ? 429 : 400, r.code ?? "FAILED", r.message ?? "");
    }
    return fail(404, "NOT_FOUND", "없는 주소입니다.");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg === "too large" || error instanceof SyntaxError) return fail(400, "INVALID", "요청 형식이 올바르지 않아요.");
    throw error;
  }
}

export type { Role };
