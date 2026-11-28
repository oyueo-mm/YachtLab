import { describe, expect, it } from "vitest";
import { handleAdminRoute, type AdminExtensionRoute } from "../worker/src/admin/api";
import { adminSettings, legacyTokenRoutes, SINGLE_OPERATOR } from "../worker/src/admin/roles";
import { AdminCore, DAY_MS, KST_OFFSET_MS, RETENTION, kstDay, monthOf, weekOf, type ActivityReport } from "../worker/src/admin/store";
import { MemberOps } from "../worker/src/admin/member";
import { BoardCore } from "../worker/src/feedback/board";
import { C5_TX_ID, sourceOf, toGrantRequest } from "../worker/src/admin/grant-port";
import { CleanupQueue, runCleanup } from "../worker/src/account-cleanup";
import { GOOGLE, beginLogin, requireFreshAuth } from "../worker/src/oidc";
import { reply, req, sqlite, uid, world } from "./helpers/admin-fakes";

/**
 * ADMIN-1 follow-up (2026-11-28): Google re-authentication, single-operator approval, deletion cleanup
 * retry, retention, legacy token, KST activity accuracy, C5 grant adapter, LIVE-1 admin extensions.
 * Isolated in-memory world (node:sqlite); the Workers-runtime flow is in admin-worker.test.ts.
 */
const A = uid("A"), B = uid("B"), V = uid("V"), O = uid("O"), U = uid("U"), W = uid("W");
const ADMINS = `${A}:owner,${B}:owner,${V}:viewer,${O}:operator`;
const POLICY = "c5-test-1";
const route = async (w: ReturnType<typeof world>, path: string, token: string | null, body?: unknown) => {
  const r = await handleAdminRoute(req(path, token, body), new URL("https://w.example" + path), w.backends(), reply);
  return { status: r.status, body: (await r.json()) as Record<string, any> };
};
const core = () => {
  const c = new AdminCore(sqlite());
  c.init();
  return c;
};
const rewardBody = (w: ReturnType<typeof world>, target: unknown = { type: "users", userIds: [U] }) => ({ title: "점검 보상", coins: 10, expiresAt: w.clock() + DAY_MS, target });

describe("1 · real Google re-authentication", () => {
  it("admin logins ask Google to authenticate again and require a fresh auth_time", async () => {
    const { url, login } = await beginLogin({ provider: GOOGLE, clientId: "c", redirectUri: "https://w/cb", clientStateHash: "h".repeat(43), now: 1_000_000, purpose: "admin" });
    const q = new URL(url).searchParams;
    expect([q.get("prompt"), q.get("max_age")]).toEqual(["login", "0"]);
    const member = new URL((await beginLogin({ provider: GOOGLE, clientId: "c", redirectUri: "https://w/cb", clientStateHash: "h".repeat(43), now: 1 })).url).searchParams;
    expect([member.get("prompt"), member.get("max_age")]).toEqual(["select_account", null]);
    const claims = { iss: "x", aud: "c", sub: "s", exp: 0, iat: 0 };
    expect(() => requireFreshAuth(claims, login)).toThrow(); // no auth_time
    expect(() => requireFreshAuth({ ...claims, auth_time: (1_000_000 - 3600_000) / 1000 }, login)).toThrow(); // Google reused an old session
    expect(requireFreshAuth({ ...claims, auth_time: 1_000_000 / 1000 + 5 }, login)).toBe(1_005_000);
  });
  it("an admin session needs a one-time ticket bound to the account and the tab", async () => {
    const w = world({ ADMIN_ACCOUNTS: ADMINS });
    const { session } = w.account(A);
    expect((await route(w, "/api/admin/session", session, {})).body.error.code).toBe("REAUTH_REQUIRED");
    expect((await w.adminLogin(session, { tamper: "user" })).status).toBe(401);
    expect((await w.adminLogin(session, { tamper: "state" })).status).toBe(401);
    const ok = await w.adminLogin(session);
    expect(ok.body).toMatchObject({ reauth: "google", reauthAt: w.clock() });
    expect(w.admin.auditLog({ action: "session.reauth-missing" }).entries).toHaveLength(3); // every refused attempt
  });
  it("a ticket works once and expires after 2 minutes", async () => {
    const c = core();
    const t = await c.createReauth(A, "cs-hash", 1, 0);
    expect(await c.consumeReauth(t, A, "wrong-client-state-xxxxxxx", 1)).toBeNull(); // consumed even on mismatch
    const t2 = await c.createReauth(A, "x", 1, 0);
    expect(await c.consumeReauth(t2, A, "client-state-yyyyyyyyyyyyy", RETENTION.reauthTicketMs + 1)).toBeNull();
  });
  it("re-authentication can be switched off only on a loopback test server", () => {
    expect(adminSettings({ ADMIN_REAUTH: "off", APP_URL: "https://oyueo-mm.github.io/YachtLab/" }).reauth).toBe("google");
    expect(adminSettings({ ADMIN_REAUTH: "off", APP_URL: "http://127.0.0.1:5173/YachtLab/" }).reauth).toBe("off");
  });
  it("high-risk actions need a re-authentication within 10 minutes; reads do not", async () => {
    const w = world({ ADMIN_ACCOUNTS: ADMINS, ADMIN_WRITES: "on", ADMIN_REWARD_POLICY: POLICY });
    const a = await w.adminLogin(w.account(A).session);
    w.account(U);
    w.advance(11 * 60_000);
    expect((await route(w, "/api/admin/overview", a.token!)).status).toBe(200);
    for (const [path, body] of [["/api/admin/rewards", rewardBody(w)], ["/api/admin/codes", { title: "쿠폰", coins: 5, endsAt: w.clock() + DAY_MS, maxTotal: 5 }], ["/api/admin/sanctions", { userId: U, kind: "suspend", reason: "재인증 확인용", days: 1 }]] as const)
      expect((await route(w, path, a.token!, body)).body.error.code, path).toBe("REAUTH_REQUIRED");
    expect((await route(w, "/api/admin/sanctions", a.token!, { userId: U, kind: "warning", reason: "경고는 저위험" })).status).toBe(200);
  });
});

describe("2 · single-operator approval policy (two-person stays the default)", () => {
  const setup = async (approval?: string) => {
    const w = world({ ADMIN_ACCOUNTS: `${A}:owner`, ADMIN_WRITES: "on", ADMIN_REWARD_POLICY: POLICY, ...(approval ? { ADMIN_APPROVAL: approval } : {}) });
    const member = w.account(A);
    w.account(U);
    return { w, member, a: (await w.adminLogin(member.session)).token! };
  };
  it("default two-person: one's own draft is never approved", async () => {
    const { w, member, a } = await setup();
    const d = await route(w, "/api/admin/rewards", a, rewardBody(w));
    w.advance(11 * 60_000);
    const again = (await w.adminLogin(member.session)).token!;
    expect((await route(w, `/api/admin/actions/${d.body.actionId}/approve`, again, { confirm: d.body.actionId })).body.error.code).toBe("SECOND_APPROVER");
  });
  it("single-operator: cooling-off, re-authentication after the draft, then approval marked self-approved", async () => {
    const { w, member, a } = await setup("single-operator");
    const d = await route(w, "/api/admin/rewards", a, rewardBody(w));
    const id = d.body.actionId;
    expect((await route(w, `/api/admin/actions/${id}/approve`, a, { confirm: id })).body.error.code).toBe("COOLDOWN");
    w.advance(SINGLE_OPERATOR.cooldownMs + 1000);
    expect((await route(w, `/api/admin/actions/${id}/approve`, a, { confirm: id })).body.error.code).toBe("REAUTH_REQUIRED"); // > 10 min since the re-auth
    const fresh = (await w.adminLogin(member.session)).token!;
    const ok = await route(w, `/api/admin/actions/${id}/approve`, fresh, { confirm: id });
    expect(ok.body.ok).toBe(true);
    expect(w.admin.auditLog({ action: "action.execute" }).entries[0].detail).toMatchObject({ approval: "self-approved" });
  });
  it("a re-authentication made BEFORE the draft does not count (cooling-off ≥ freshness window)", async () => {
    const { w, member } = await setup("single-operator");
    const early = (await w.adminLogin(member.session)).token!;
    w.advance(1000);
    const d = await route(w, "/api/admin/rewards", early, rewardBody(w));
    w.advance(SINGLE_OPERATOR.cooldownMs);
    // a ticket whose Google auth_time predates the draft (e.g. replayed from an earlier login) is refused
    const old = await w.adminLogin(member.session, { authTime: w.clock() - SINGLE_OPERATOR.cooldownMs - 500 });
    expect((await route(w, `/api/admin/actions/${d.body.actionId}/approve`, old.token!, { confirm: d.body.actionId })).body.error.code).toBe("REAUTH_REQUIRED");
    expect((await route(w, `/api/admin/actions/${d.body.actionId}/approve`, early, { confirm: d.body.actionId })).body.error.code).toBe("REAUTH_REQUIRED");
  });
  it("blast radius: no segment/all rewards, no long or permanent sanctions, no big codes; daily budget", async () => {
    const { w, member, a } = await setup("single-operator");
    w.admin.activity({ userId: U, nickname: "u", createdAt: 0, day: kstDay(w.clock()), firstInWeek: true, firstInMonth: true, gapDays: null });
    const seg = await route(w, "/api/admin/rewards", a, rewardBody(w, { type: "all" }));
    const perm = await route(w, "/api/admin/sanctions", a, { userId: U, kind: "suspend", reason: "무기한 정지 시도", days: null });
    const code = await route(w, "/api/admin/codes", a, { title: "큰 쿠폰", coins: 5, endsAt: w.clock() + DAY_MS, maxTotal: SINGLE_OPERATOR.codeMaxTotal + 1 });
    const small = await Promise.all([1, 2, 3, 4].map(() => route(w, "/api/admin/rewards", a, rewardBody(w))));
    w.advance(SINGLE_OPERATOR.cooldownMs + 1000);
    const t = (await w.adminLogin(member.session)).token!;
    for (const d of [seg, perm, code]) expect((await route(w, `/api/admin/actions/${d.body.actionId}/approve`, t, { confirm: d.body.actionId })).body.error.code).toBe("SCOPE");
    const results = [];
    for (const d of small) results.push((await route(w, `/api/admin/actions/${d.body.actionId}/approve`, t, { confirm: d.body.actionId })).status);
    expect(results).toEqual([200, 200, 200, 429]);
  });
  it('the old value "self" means single-operator rules, never unrestricted self-approval', () => {
    expect(adminSettings({ ADMIN_APPROVAL: "self" }).approval).toBe("single-operator");
    expect(adminSettings({}).approval).toBe("two-person");
  });
});

describe("3 · deletion cleanup: durable, idempotent, generation-safe retries", () => {
  it("the admin index and the board are queue targets retried until they succeed", async () => {
    const q = new CleanupQueue(sqlite());
    q.init();
    q.enqueue(U, ["@admin", "@board"], null, 0);
    let fail = true;
    const sent: string[] = [];
    const send = async (job: { target: string }) => {
      if (fail && job.target === "@admin") throw new Error("down");
      sent.push(job.target);
    };
    expect(await runCleanup(q, send as never, () => 0)).toMatchObject({ done: 1, failed: 1, remaining: 1 });
    fail = false;
    expect(await runCleanup(q, send as never, () => 120_000)).toMatchObject({ done: 1, remaining: 0 });
    expect(sent).toEqual(["@board", "@admin"]);
  });
  it("AdminCore.deleted counts once, and a late retry never touches the re-joined account", () => {
    const c = core();
    const t0 = Date.UTC(2026, 10, 28, 3);
    c.activity({ userId: U, nickname: "옛 계정", createdAt: t0 - DAY_MS, day: kstDay(t0), firstInWeek: true, firstInMonth: true, gapDays: null });
    c.deleted(U, t0);
    c.deleted(U, t0); // retry: no second count
    // re-joined after the deletion, then the old job is retried once more
    c.activity({ userId: U, nickname: "새 계정", createdAt: t0 + 60_000, day: kstDay(t0) + 1, firstInWeek: true, firstInMonth: true, gapDays: null });
    c.deleted(U, t0);
    expect(c.searchMembers({ userId: U }).members.map((m) => m.nickname)).toEqual(["새 계정"]);
    expect(c.activityReport(3, t0 + DAY_MS).days.reduce((n, d) => n + d.deleted, 0)).toBe(1);
  });
  it("board.forget(before) leaves posts and votes made after the deletion alone", () => {
    const b = new BoardCore(sqlite());
    b.init();
    const t0 = Date.UTC(2026, 10, 28);
    const old = b.create({ userId: U, nickname: "옛" }, { category: "feature", title: "옛 제안", body: "탈퇴 전에 쓴 제안" }, t0);
    const other = b.create({ userId: W, nickname: "남" }, { category: "feature", title: "남의 제안", body: "다른 사람이 쓴 제안" }, t0);
    if (!old.ok || !other.ok) throw Error();
    const fresh = b.create({ userId: U, nickname: "새" }, { category: "uiux", title: "새 제안", body: "재가입 뒤에 쓴 제안" }, t0 + 10 * 60_000);
    b.vote(other.id, U, true, t0 + 10 * 60_000);
    b.forget(U, t0 + 60_000);
    b.forget(U, t0 + 60_000);
    expect(b.get(old.id, null)?.author).toBe("탈퇴한 사용자");
    if (fresh.ok) expect(b.get(fresh.id, null)?.author).toBe("새");
    expect(b.get(other.id, null)?.votes).toBe(1);
  });
});

describe("4 · retention of moderation data after deletion", () => {
  it("finished sanctions lose their reason and go after a year; sanctions in force stay until they end", () => {
    const c = core();
    const t0 = Date.UTC(2026, 10, 28);
    const p = (kind: string, days: number | null) => {
      const r = c.checkSanction({ userId: U, kind, reason: "보존 정책 확인", days });
      if (!r.ok) throw Error(r.message);
      return r.payload;
    };
    c.recordSanction("sn_warnwarnwarnwarn", p("warning", null), A, null, t0);
    c.recordSanction("sn_restrictrestrict", p("restrict", 30), A, null, t0);
    c.recordSanction("sn_permpermpermperm", p("suspend", null), A, null, t0);
    c.createAppeal(U, "sn_restrictrestrict", "이의제기 원문 텍스트입니다", t0);
    c.deleted(U, t0 + DAY_MS);
    const s = (id: string) => c.sanction(id) as Record<string, unknown> | null;
    expect(s("sn_warnwarnwarnwarn")?.reason).toBe("(탈퇴 계정)");
    expect(s("sn_restrictrestrict")?.reason).toBe("보존 정책 확인"); // still in force: kept as is
    expect(c.appeals({ userId: U })[0].text).toBe("(탈퇴 계정)");
    expect(c.signup(U, t0 + 2 * DAY_MS).map((x) => x.id).sort()).toEqual(["sn_permpermpermperm", "sn_restrictrestrict"]); // re-join: carried over
    c.purgeRetention(t0 + 31 * DAY_MS);
    expect(s("sn_restrictrestrict")).toBeNull(); // ended → purged with its appeal
    expect(c.appeals({ userId: U })).toHaveLength(0);
    expect(s("sn_warnwarnwarnwarn")).not.toBeNull();
    c.purgeRetention(t0 + DAY_MS + RETENTION.closedRecordMs + 1);
    expect(s("sn_warnwarnwarnwarn")).toBeNull();
    expect(s("sn_permpermpermperm")).toBeNull(); // permanent: at most permanentSanctionMs after deletion
  });
});

describe("5 · legacy ADMIN_TOKEN", () => {
  it("is a read-only allowlist that can be narrowed or switched off", () => {
    expect([...legacyTokenRoutes(undefined)]).toEqual(["metrics", "ledger"]);
    expect([...legacyTokenRoutes("metrics")]).toEqual(["metrics"]);
    expect([...legacyTokenRoutes("off")]).toEqual([]);
    expect([...legacyTokenRoutes("metrics,rewards,daily")]).toEqual(["metrics"]); // nothing new can be added by config
  });
});

describe("6 · DAU / WAU / MAU accuracy (KST)", () => {
  const report = (userId: string, t: number, last: number | null): ActivityReport => {
    const day = kstDay(t);
    return { userId, nickname: null, createdAt: 0, day, firstInWeek: last === null || weekOf(last) !== weekOf(day), firstInMonth: last === null || monthOf(last) !== monthOf(day), gapDays: last === null ? null : day - last };
  };
  it("KST day, week (Monday) and month boundaries", () => {
    const midnight = Date.UTC(2026, 10, 29, 15) ; // 2026-11-30 00:00 KST (a Monday)
    expect(kstDay(midnight - 1) + 1).toBe(kstDay(midnight));
    expect(new Date(kstDay(midnight) * DAY_MS).toISOString().slice(0, 10)).toBe("2026-11-30");
    expect(weekOf(kstDay(midnight - 1))).toBe(weekOf(kstDay(midnight)) - 1); // Sunday 23:59 KST vs Monday 00:00 KST
    const dec = Date.UTC(2026, 10, 30, 15); // 2026-12-01 00:00 KST
    expect([monthOf(kstDay(dec - 1)), monthOf(kstDay(dec))]).toEqual(["2026-11", "2026-12"]);
    expect(KST_OFFSET_MS).toBe(9 * 3600_000);
  });
  it("matches a brute-force count over 70 days of random activity, with duplicates, retries and reordering", () => {
    const c = core();
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const start = Date.UTC(2026, 8, 30, 14, 59); // 23:59 KST: boundary-heavy times below
    const truth = new Map<number, Set<string>>();
    const users = Array.from({ length: 40 }, (_, i) => uid(String.fromCharCode(65 + (i % 26)) + i));
    const last = new Map<string, number | null>();
    const batches: ActivityReport[][] = [];
    for (let d = 0; d < 70; d++) {
      for (const u of users) {
        if (rnd() > 0.35) continue;
        const t = start + d * DAY_MS + Math.floor(rnd() * 2) * 2 * 60_000; // 23:59 or 00:01 KST
        const day = kstDay(t);
        const prev = last.get(u) ?? null;
        if (prev !== null && prev >= day) continue;
        const r = report(u, t, prev);
        last.set(u, day);
        (truth.get(day) ?? truth.set(day, new Set()).get(day)!).add(u);
        batches.push([r]);
      }
    }
    // delivery: every report sent twice (lost answer → retry), some pairs batched in reverse order
    for (let i = 0; i < batches.length; i++) {
      c.activityBatch(batches[i]);
      c.activityBatch(i % 3 === 0 && batches[i + 1] && batches[i + 1][0].userId === batches[i][0].userId ? [batches[i + 1][0], batches[i][0]] : batches[i]);
    }
    const end = start + 70 * DAY_MS;
    const rep = c.activityReport(60, end);
    for (const row of rep.days) {
      const d = Math.round(Date.parse(row.day) / DAY_MS);
      const distinct = (pred: (x: number) => boolean) => new Set([...truth].filter(([x]) => pred(x) && x <= d).flatMap(([, s]) => [...s])).size;
      expect(row.dau, row.day).toBe(truth.get(d)?.size ?? 0);
      expect(row.wau, row.day).toBe(distinct((x) => weekOf(x) === weekOf(d)));
      expect(row.mau, row.day).toBe(distinct((x) => monthOf(x) === monthOf(d)));
    }
    expect(rep.timezone).toBe("Asia/Seoul");
  });
  it("the account keeps unacknowledged reports and resends them (outbox)", () => {
    const m = new MemberOps(sqlite());
    m.init();
    const t0 = Date.UTC(2026, 10, 28, 3);
    const p = { userId: U, nickname: null, createdAt: 0 };
    expect(m.activity(p, t0)).not.toBeNull();
    expect(m.activity(p, t0 + 60_000)).toBeNull(); // same KST day
    m.activity(p, t0 + DAY_MS);
    expect(m.outbox().map((r) => r.day)).toEqual([kstDay(t0), kstDay(t0) + 1]); // nothing acknowledged yet
    m.ack([kstDay(t0)]);
    expect(m.outbox()).toHaveLength(1);
    expect(m.outbox()[0]).toMatchObject({ gapDays: 1, firstInWeek: false });
  });
});

describe("7 · C5 RewardGrants adapter and the amount-policy gate", () => {
  it("drafts with amounts are refused until a reward policy is approved; the version is recorded", async () => {
    const off = world({ ADMIN_ACCOUNTS: ADMINS, ADMIN_WRITES: "on" });
    const a = (await off.adminLogin(off.account(A).session)).token!;
    off.account(U);
    expect((await route(off, "/api/admin/rewards", a, rewardBody(off))).body.error.code).toBe("POLICY_PENDING");
    expect((await route(off, "/api/admin/codes", a, { title: "쿠폰", coins: 5, endsAt: off.clock() + DAY_MS, maxTotal: 5 })).body.error.code).toBe("POLICY_PENDING");
    const on = world({ ADMIN_ACCOUNTS: ADMINS, ADMIN_WRITES: "on", ADMIN_REWARD_POLICY: POLICY });
    const t = (await on.adminLogin(on.account(A).session)).token!;
    on.account(U);
    const d = await route(on, "/api/admin/rewards", t, rewardBody(on));
    expect((on.admin.action(d.body.actionId)!.payload as { policyVersion: string }).policyVersion).toBe(POLICY);
  });
  it("every admin delivery id is a valid C5 txId and maps to the matching source and caps", () => {
    const now = Date.UTC(2026, 10, 28);
    const op = toGrantRequest({ id: "op:rw_0123456789abcdef0123", kind: "reward", title: "점검 보상", body: "", coins: 100, gems: 2, expiresAt: now + DAY_MS }, A, POLICY);
    expect(op).toMatchObject({ source: "operator", delivery: "inbox", actor: "admin:" + A, policyVersion: POLICY, txId: "op:rw_0123456789abcdef0123" });
    expect(toGrantRequest({ id: "sug:sg_0123456789abcdef", kind: "suggestion", title: "채택", body: "", coins: 50, gems: 0, expiresAt: now }, A, POLICY).source).toBe("suggestion");
    const code = toGrantRequest({ id: "code:cd_0123456789abcdef", kind: "reward", title: "쿠폰", body: "", coins: 30, gems: 0, expiresAt: null }, A, POLICY);
    expect(code).toMatchObject({ source: "redeem-code", delivery: "direct" });
    expect(code).not.toHaveProperty("expiresAt");
    for (const id of ["op:rw_0123456789abcdef0123", "sug:sg_0123456789abcdef", "code:cd_0123456789abcdef:2"]) expect(C5_TX_ID.test(id) && sourceOf(id)).toBeTruthy();
    expect(() => toGrantRequest({ id: "op:rw_0123456789abcdef0123", kind: "reward", title: "x", body: "", coins: 5001, gems: 0, expiresAt: null }, A, POLICY)).toThrow();
    expect(() => toGrantRequest({ id: "rw_legacy", kind: "reward", title: "x", body: "", coins: 1, gems: 0, expiresAt: null }, A, POLICY)).toThrow();
  });
  it("the store produces those ids (campaign op:, code code:, adoption sug:)", async () => {
    const c = core();
    const now = Date.UTC(2026, 10, 28);
    const ch = c.checkReward({ title: "보상", coins: 1, expiresAt: now + DAY_MS, target: { type: "users", userIds: [U] } }, now);
    if (!ch.ok) throw Error();
    const act = c.draft("reward.campaign", ch.payload, {}, A, now);
    c.decide(act, B, "approved", now, false);
    c.scheduleCampaign(act, ch.payload, now);
    const ids: string[] = [];
    await c.process(now, async (_u, item) => (ids.push(item.id), "ok"));
    const made = c.createCode({ title: "쿠폰", coins: 1, endsAt: now + DAY_MS, maxTotal: 2 }, A, now);
    if (!made.ok) throw Error();
    c.setCodeStatus(made.id, "active");
    const r = c.redeem(U, 0, made.code, now);
    if (!r.ok) throw Error();
    for (const id of [ids[0], r.redemptionId]) expect(sourceOf(id), id).not.toBeNull();
  });
});

describe("8 · LIVE-1 admin routes through the same auth, permissions and audit", () => {
  const daily: AdminExtensionRoute[] = [
    { method: "GET", path: /^\/api\/admin\/daily$/, permission: "stats.read", write: false, action: "daily.report", handle: async ({ url }) => ({ status: 200, body: { date: url.searchParams.get("date"), official: { started: 3 } } }) },
    { method: "POST", path: /^\/api\/admin\/daily\/puzzle$/, permission: "content.write", write: true, action: "daily.puzzle", handle: async ({ body }) => ({ status: 200, body: { ok: true }, target: String(body?.puzzleId), detail: { disabled: body?.disabled } }) },
  ];
  const run = async (w: ReturnType<typeof world>, path: string, token: string | null, body?: unknown) => {
    const r = await handleAdminRoute(req(path, token, body), new URL("https://w.example" + path), { ...w.backends(), extensions: daily }, reply);
    return { status: r.status, body: (await r.json()) as Record<string, any> };
  };
  it("viewer reads the report; writes need content.write, ADMIN_WRITES and are audited", async () => {
    const off = world({ ADMIN_ACCOUNTS: ADMINS });
    const v = (await off.adminLogin(off.account(V).session)).token!;
    expect((await run(off, "/api/admin/daily?date=2026-11-28", v)).body.official.started).toBe(3);
    expect((await run(off, "/api/admin/daily/puzzle", v, { puzzleId: "p1", disabled: true })).status).toBe(403);
    const o = (await off.adminLogin(off.account(O).session)).token!;
    expect((await run(off, "/api/admin/daily/puzzle", o, { puzzleId: "p1", disabled: true })).body.error.code).toBe("WRITES_DISABLED");
    const on = world({ ADMIN_ACCOUNTS: ADMINS, ADMIN_WRITES: "on" });
    const o2 = (await on.adminLogin(on.account(O).session)).token!;
    expect((await run(on, "/api/admin/daily/puzzle", o2, { puzzleId: "p1", disabled: true })).body.ok).toBe(true);
    expect(on.admin.auditLog({ action: "daily." }).entries[0]).toMatchObject({ actor: O, action: "daily.puzzle", target: "p1", result: "ok" });
    expect((await run(on, "/api/admin/daily", null)).status).toBe(404); // no admin session: same 404
  });
});
