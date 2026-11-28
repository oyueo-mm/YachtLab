import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { handleAdminRoute, handleEngagementRoute } from "../worker/src/admin/api";
import { DAY_MS } from "../worker/src/admin/store";
import { reply, req, uid, world } from "./helpers/admin-fakes";

/**
 * SEC-1 release-blocking conditions for ADMIN-1 / FEEDBACK-1, one test group each
 * (docs/admin/ADMIN-FEEDBACK.md §6 maps them to code). Isolated in-memory world, no real data.
 */
const A = uid("A"), B = uid("B"), S = uid("S"), U = uid("U"), W = uid("W");
const ADMINS = `${A}:owner,${B}:owner,${S}:support`;
const route = async (w: ReturnType<typeof world>, path: string, token: string | null, body?: unknown) => {
  const r = await handleAdminRoute(req(path, token, body), new URL("https://w.example" + path), w.backends(), reply);
  return { status: r.status, body: (await r.json()) as Record<string, any> };
};
const eng = async (w: ReturnType<typeof world>, path: string, token: string | null, body?: unknown) => {
  const r = await handleEngagementRoute(req(path, token, body), new URL("https://w.example" + path), w.backends(), reply);
  return { status: r!.status, body: (await r!.json()) as Record<string, any> };
};
const login = async (w: ReturnType<typeof world>, s: string) => (await w.adminLogin(s)).token as string;
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));

describe("SEC-1 · server-side roles, read/write separation, blocked member access", () => {
  it("a member session (s1.) is never accepted as an admin credential, on any admin path", async () => {
    const w = world({ ADMIN_ACCOUNTS: ADMINS, ADMIN_WRITES: "on", ADMIN_REWARD_POLICY: "test-policy" });
    const { session } = w.account(U);
    for (const p of ["/api/admin/overview", "/api/admin/members", "/api/admin/audit", "/api/admin/actions"]) expect((await route(w, p, session)).status).toBe(404);
    expect((await route(w, "/api/admin/rewards", session, { title: "x", coins: 1 })).status).toBe(404);
    // an admin's own MEMBER session is not an admin session either
    const own = w.account(A).session;
    expect((await route(w, "/api/admin/overview", own)).status).toBe(404);
  });
  it("support can read members and triage reports but cannot draft rewards, codes, sanctions or approve", async () => {
    const w = world({ ADMIN_ACCOUNTS: ADMINS, ADMIN_WRITES: "on", ADMIN_REWARD_POLICY: "test-policy" });
    const t = await login(w, w.account(S).session);
    w.account(U);
    expect((await route(w, "/api/admin/members", t)).status).toBe(200);
    expect((await route(w, "/api/admin/rewards", t, { title: "보상", coins: 1, expiresAt: w.clock() + DAY_MS, target: { type: "all" } })).status).toBe(403);
    expect((await route(w, "/api/admin/codes", t, { title: "쿠폰", coins: 1, endsAt: w.clock() + DAY_MS, maxTotal: 1 })).status).toBe(403);
    expect((await route(w, "/api/admin/sanctions", t, { userId: U, kind: "warning", reason: "경고합니다" })).status).toBe(403);
    expect((await route(w, "/api/admin/actions/act_aaaaaaaaaaaaaaaaaaaa/approve", t, { confirm: "act_aaaaaaaaaaaaaaaaaaaa" })).status).toBe(403);
    expect(w.admin.auditLog({ action: "denied" }).entries.length).toBe(4);
  });
});

describe("SEC-1 · admin session separation and re-authentication", () => {
  it("admin tokens are a distinct a1. credential, expire on idle and absolute age, and approvals need a fresh one", async () => {
    const w = world({ ADMIN_ACCOUNTS: ADMINS, ADMIN_WRITES: "on", ADMIN_REWARD_POLICY: "test-policy" });
    const a = await login(w, w.account(A).session);
    expect(a).toMatch(/^a1\.[A-Za-z0-9_-]{43}$/);
    for (let i = 0; i < 8; i++) {
      w.advance(29 * 60_000);
      expect((await route(w, "/api/admin/me", a)).status).toBe(200);
    }
    w.advance(29 * 60_000); // > 4 h absolute
    expect((await route(w, "/api/admin/me", a)).status).toBe(404);
    const b = await login(w, w.account(B).session);
    const fresh = await login(w, w.account(A).session);
    w.account(U);
    const d = await route(w, "/api/admin/rewards", fresh, { title: "보상", coins: 5, expiresAt: w.clock() + DAY_MS, target: { type: "users", userIds: [U] } });
    w.advance(11 * 60_000);
    await route(w, "/api/admin/me", b);
    expect((await route(w, `/api/admin/actions/${d.body.actionId}/approve`, b, { confirm: d.body.actionId })).body.error.code).toBe("REAUTH_REQUIRED");
    const again = await login(w, w.account(B).session);
    expect((await route(w, `/api/admin/actions/${d.body.actionId}/approve`, again, { confirm: d.body.actionId })).body.ok).toBe(true);
  });
  it("logout ends the admin session on the server", async () => {
    const w = world({ ADMIN_ACCOUNTS: ADMINS });
    const a = await login(w, w.account(A).session);
    await route(w, "/api/admin/logout", a, {});
    expect((await route(w, "/api/admin/me", a)).status).toBe(404);
  });
});

describe("SEC-1 · every admin write is audited", () => {
  it("each write route leaves an audit row with the actor", async () => {
    const w = world({ ADMIN_ACCOUNTS: ADMINS, ADMIN_WRITES: "on", ADMIN_REWARD_POLICY: "test-policy" });
    const a = await login(w, w.account(A).session);
    const b = await login(w, w.account(B).session);
    const m = w.account(U);
    const writes: [string, unknown, string?][] = [
      ["/api/admin/notices", { title: "공지 제목", body: "공지 내용" }],
      ["/api/admin/rewards", { title: "보상", coins: 5, expiresAt: w.clock() + DAY_MS, target: { type: "users", userIds: [U] } }],
      ["/api/admin/codes", { title: "쿠폰", coins: 5, endsAt: w.clock() + DAY_MS, maxTotal: 3 }],
      ["/api/admin/sanctions", { userId: U, kind: "warning", reason: "경고 사유입니다" }],
      ["/api/admin/sanctions", { userId: U, kind: "restrict", reason: "제한 사유입니다", days: 1 }],
    ];
    for (const [path, body] of writes) {
      const before = w.admin.auditLog({ limit: 100 }).entries.length;
      const r = await route(w, path, a, body);
      expect(r.status, path).toBeLessThan(300);
      const after = w.admin.auditLog({ limit: 100 }).entries;
      expect(after.length, path).toBeGreaterThan(before);
      expect(after[0].actor).toBe(A);
    }
    const rep = await eng(w, "/api/reports", m.session, { targetType: "user", targetId: W, reason: "spam" });
    w.account(W);
    await route(w, `/api/admin/reports/${rep.body.id}`, a, { status: "reviewing" });
    const pending = w.admin.actions("pending");
    for (const act of pending) await route(w, `/api/admin/actions/${act.id}/approve`, b, { confirm: act.id });
    const actions = w.admin.auditLog({ limit: 100 }).entries.map((e: any) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["notice.save", "action.draft", "code.create", "sanction.warning", "report.update", "action.execute"]));
    // SEC-1 2차 ADM-2: each execution writes a "started" row before any effect and one outcome row after it
    const exec = w.admin.auditLog({ limit: 100 }).entries.filter((e: any) => e.action === "action.execute");
    expect(exec.filter((e: any) => e.result === "started")).toHaveLength(pending.length);
    expect(exec.filter((e: any) => e.result !== "started")).toHaveLength(pending.length);
  });
  it("the audit log has no delete or update path", () => {
    const src = readFileSync("worker/src/admin/store.ts", "utf8");
    expect(src).not.toMatch(/(DELETE FROM|UPDATE) audit\b/);
  });
});

describe("SEC-1 · stored XSS, input and attachment validation", () => {
  it("suggestion text is stored and returned as plain text; the pages never render HTML", async () => {
    const w = world({ ADMIN_ACCOUNTS: ADMINS });
    const m = w.account(U);
    const payload = '<img src=x onerror="alert(1)"> <script>alert(2)</script>';
    const post = await eng(w, "/api/suggestions", m.session, { category: "uiux", title: "<b>제목</b>", body: payload });
    expect(post.status).toBe(201);
    const got = await eng(w, `/api/suggestions/${post.body.id}`, null);
    expect(got.body.suggestion.body).toBe(payload); // returned as data (JSON), escaped by React text nodes
    for (const f of [...files("src/engagement"), ...files("src/admin")].filter((x) => /\.tsx?$/.test(x))) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/dangerouslySetInnerHTML|innerHTML\s*=|insertAdjacentHTML|<a\s[^>]*href=\{/);
    }
  });
  it("javascript: / data: links, oversized and malformed input are refused", async () => {
    const w = world({});
    const m = w.account(U);
    expect((await eng(w, "/api/suggestions", m.session, { category: "bug", title: "링크 테스트", body: "data:text/html,<script>" })).body.error.code).toBe("LINK");
    expect((await eng(w, "/api/suggestions", m.session, { category: "nope", title: "분류 오류", body: "분류가 이상한 글" })).status).toBe(400);
    const big = await handleEngagementRoute(new Request("https://w.example/api/suggestions", { method: "POST", headers: { authorization: "Bearer " + m.session, "content-type": "application/json", "content-length": "99999" }, body: "{}" }), new URL("https://w.example/api/suggestions"), w.backends(), reply);
    expect(big!.status).toBe(400);
  });
});

describe("SEC-1 · duplicate votes and duplicate adoption rewards", () => {
  it("one vote per account; repeated adoption reward requests and claims grant once", async () => {
    const w = world({ ADMIN_ACCOUNTS: ADMINS, ADMIN_WRITES: "on", ADMIN_REWARD_POLICY: "test-policy" });
    const a = await login(w, w.account(A).session);
    const b = await login(w, w.account(B).session);
    const author = w.account(U);
    const voter = w.account(W);
    const post = await eng(w, "/api/suggestions", author.session, { category: "feature", title: "중복 테스트", body: "중복 처리 확인용 제안" });
    for (let i = 0; i < 3; i++) await eng(w, `/api/suggestions/${post.body.id}/vote`, voter.session, { on: true });
    expect((await eng(w, `/api/suggestions/${post.body.id}`, null)).body.suggestion.votes).toBe(1);
    await route(w, `/api/admin/suggestions/${post.body.id}`, a, { status: "adopted", adoptReason: "중복 방지 확인" });
    const r1 = await route(w, `/api/admin/suggestions/${post.body.id}/reward`, a, { coins: 50 });
    expect((await route(w, `/api/admin/suggestions/${post.body.id}/reward`, a, { coins: 50 })).body.error.code).toBe("DUPLICATE");
    await route(w, `/api/admin/actions/${r1.body.actionId}/approve`, b, { confirm: r1.body.actionId });
    // a forced second delivery of the same item (e.g. a retried execution) adds nothing
    await author.account.deliver({ id: "sug:" + post.body.id, kind: "suggestion", title: "x", body: "", coins: 50, gems: 0, expiresAt: w.clock() + DAY_MS, grant: { approver: "u_" + "a".repeat(22), policyVersion: "test-policy" } });
    const box = await eng(w, "/api/me/mailbox", author.session);
    expect(box.body.items.filter((i: any) => i.kind === "suggestion")).toHaveLength(1);
    await eng(w, `/api/me/mailbox/sug:${post.body.id}/claim`, author.session, {});
    await eng(w, `/api/me/mailbox/sug:${post.body.id}/claim`, author.session, {});
    expect(author.account.econ.verify()).toMatchObject({ ok: true });
    expect(author.account.econ.snapshot(author.account.userId, w.clock()).ledger.filter((l) => l.id.startsWith("g:sug:"))).toEqual([expect.objectContaining({ coins: 50 })]); // one C5 grant (welcome is separate)
  });
});

describe("SEC-1 · private intake of sensitive reports", () => {
  it("security and privacy posts are visible to the author and admins only, never listed or votable", async () => {
    const w = world({ ADMIN_ACCOUNTS: ADMINS });
    const s = await login(w, w.account(S).session);
    const m = w.account(U);
    const o = w.account(W);
    const sec = await eng(w, "/api/suggestions", m.session, { category: "security", title: "취약점 제보", body: "재현 절차를 비공개로 알려요" });
    w.advance(3 * 60_000);
    const priv = await eng(w, "/api/suggestions", m.session, { category: "privacy", title: "개인정보 문의", body: "제 기록 삭제를 문의합니다" });
    for (const id of [sec.body.id, priv.body.id]) {
      expect((await eng(w, `/api/suggestions/${id}`, null)).status).toBe(404);
      expect((await eng(w, `/api/suggestions/${id}`, o.session)).status).toBe(404);
      expect((await eng(w, `/api/suggestions/${id}`, m.session)).body.suggestion.private).toBe(true);
      expect((await eng(w, `/api/suggestions/${id}/vote`, o.session, { on: true })).status).toBe(404);
    }
    expect((await eng(w, "/api/suggestions", null)).body.total).toBe(0);
    expect((await route(w, "/api/admin/suggestions", s)).body.total).toBe(2);
  });
});

describe("SEC-1 · no reward path around the C5 economy ledger", () => {
  it("admin and board code never write balances or ledger rows themselves", () => {
    for (const f of [...files("worker/src/admin"), ...files("worker/src/feedback")]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/INSERT INTO ledger|UPDATE econ|coins\s*=\s*coins\s*\+/i);
    }
    // INT-1: the single crediting path is C5 RewardGrants → EconomyStore.grantCredit (ledger g:<txId>);
    // the former EconomyStore.adminGrant (admin:<id>) and the creditAdminClaim adapter are gone
    for (const f of [...files("worker/src")]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/adminGrant\(|creditAdminClaim/);
      if (!f.endsWith("grants.ts") && !f.endsWith("economy.ts")) expect(src, f).not.toMatch(/\.grantCredit\(/);
    }
  });
  it("a claim is one C5 ledger row g:<txId> that verify() re-adds; unapproved or malformed rewards are refused (INT-1)", async () => {
    const w = world({});
    const m = w.account(U);
    const id = "op:rw_" + "c".repeat(16);
    const grant = { approver: "u_" + "a".repeat(22), policyVersion: "test-policy" };
    await expect(m.account.deliver({ id, kind: "reward", title: "t", body: "", coins: 9, gems: 1, expiresAt: w.clock() + DAY_MS })).rejects.toThrow(); // no approval record
    await expect(m.account.deliver({ id: "rw_check", kind: "reward", title: "t", body: "", coins: 9, gems: 1, expiresAt: w.clock() + DAY_MS, grant })).rejects.toThrow(); // not a C5 txId
    await expect(m.account.deliver({ id, kind: "reward", title: "t", body: "", coins: 99_999, gems: 0, expiresAt: w.clock() + DAY_MS, grant })).rejects.toThrow(); // over the C5 cap
    await m.account.deliver({ id, kind: "reward", title: "t", body: "", coins: 9, gems: 1, expiresAt: w.clock() + DAY_MS, grant });
    await m.account.claim(id);
    await m.account.claim(id);
    const ledger = m.account.econ.snapshot(U, w.clock()).ledger.filter((l) => !l.id.startsWith("welcome"));
    expect(ledger.filter((l) => l.id === "g:" + id)).toHaveLength(1);
    expect(ledger.some((l) => l.id.startsWith("admin:"))).toBe(false);
    expect(m.account.econ.verify().ok).toBe(true);
  });
});

describe("SEC-1 · admin writes stay off by default", () => {
  it("production config keeps ADMIN_WRITES off, two-person approval and the board closed; no admin id in the repo", () => {
    const toml = readFileSync("worker/wrangler.toml", "utf8");
    expect(toml).toMatch(/^ADMIN_WRITES = "off"$/m);
    expect(toml).toMatch(/^ADMIN_APPROVAL = "two-person"$/m);
    expect(toml).toMatch(/^FEEDBACK_BOARD = "off"$/m);
    expect(toml).not.toMatch(/^ADMIN_ACCOUNTS\s*=/m);
    // re-authentication can never be switched off in production; amounts stay unapproved
    expect(toml).not.toMatch(/^ADMIN_REAUTH\s*=/m);
    expect(toml).not.toMatch(/^ADMIN_REWARD_POLICY\s*=/m);
  });
});
