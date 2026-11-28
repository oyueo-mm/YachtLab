import { describe, expect, it } from "vitest";
import { adminSettings, can, parseAdminAccounts } from "../worker/src/admin/roles";
import { AdminCore, DAY_MS, cleanText } from "../worker/src/admin/store";
import { BoardCore, checkAttachment } from "../worker/src/feedback/board";
import { handleAdminRoute, handleEngagementRoute } from "../worker/src/admin/api";
import { economyStats, itemStats, matchStats, matchingStats } from "../worker/src/admin/stats";
import { FakeAccount, reply, req, sqlite, uid, world } from "./helpers/admin-fakes";

/**
 * ADMIN-1 / FEEDBACK-1 over real SQLite (node:sqlite, the SQL the Durable Objects run) and the real
 * account / economy stores. No Cloudflare account, no production data: an isolated in-memory world.
 */
const A = uid("A"), B = uid("B"), V = uid("V"), U = uid("U"), W = uid("W");
const ADMINS = `${A}:owner,${B}:owner,${V}:viewer`;

describe("roles", () => {
  it("parses the allowlist strictly and keeps the first role of a repeated id", () => {
    const m = parseAdminAccounts(`${A}:owner, bad:owner, ${B}:root, ${A}:viewer,${V}:viewer`);
    expect([...m]).toEqual([[A, "owner"], [V, "viewer"]]);
    expect(parseAdminAccounts(undefined).size).toBe(0);
  });
  it("is least privilege: viewers read aggregates only, only owners approve", () => {
    expect(can("viewer", "stats.read")).toBe(true);
    expect(can("viewer", "users.read")).toBe(false);
    expect(can("support", "rewards.write")).toBe(false);
    expect(can("operator", "approve")).toBe(false);
    expect(can("owner", "approve")).toBe(true);
    const s = adminSettings({});
    expect(s.writes).toBe(false);
    expect(s.selfApprove).toBe(false);
  });
});

describe("AdminCore", () => {
  const core = () => {
    const c = new AdminCore(sqlite());
    c.init();
    return c;
  };
  it("counts DAU / WAU / MAU exactly from first-in-period reports (no ids per day)", () => {
    const c = core();
    const day = 20_420; // a Monday-based week
    const r = (u: string, d: number, w: boolean, m: boolean, gap: number | null) => c.activity({ userId: u, nickname: "n", createdAt: 0, day: d, firstInWeek: w, firstInMonth: m, gapDays: gap });
    r(U, day, true, true, null);
    r(W, day, true, true, 3);
    r(U, day, true, true, null); // repeated: ignored (last_day already this day)
    r(U, day + 1, false, false, 1);
    const report = c.activityReport(3, (day + 1) * DAY_MS + 1000);
    const d0 = report.days.find((x) => x.day === new Date(day * DAY_MS).toISOString().slice(0, 10))!;
    const d1 = report.days.at(-1)!;
    expect(d0.dau).toBe(2);
    expect(d1.dau).toBe(1);
    expect(d1.returns).toEqual({ "1d": 1 });
    expect(d1.wau === 2 || d1.wau === 1).toBe(true); // 2 when both days share a week
    expect(report.indexedMembers).toBe(2);
  });

  it("validates rewards with safety caps and previews recipients and totals", () => {
    const c = core();
    const now = Date.now();
    expect(c.checkReward({ title: "보상", coins: 5_001, expiresAt: now + DAY_MS }, now).ok).toBe(false);
    expect(c.checkReward({ title: "보상", coins: 0, gems: 0, expiresAt: now + DAY_MS }, now).ok).toBe(false);
    expect(c.checkReward({ title: "보상", coins: 10, expiresAt: now + 10, target: { type: "all" } }, now).ok).toBe(false); // expiry < 1 h
    const ok = c.checkReward({ title: "보상", coins: 100, expiresAt: now + DAY_MS, target: { type: "users", userIds: [U, W, U] } }, now);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(c.previewReward(ok.payload, now)).toMatchObject({ recipients: 2, totalCoins: 200 });
    expect(c.checkReward({ title: "보상", coins: 1, expiresAt: now + DAY_MS, target: { type: "users", userIds: ["nope"] } }, now).ok).toBe(false);
  });

  it("delivers a campaign once per account, retries transient failures and recovers failed ones", async () => {
    const c = core();
    let now = Date.UTC(2026, 10, 28);
    const box = new Map<string, number>();
    let flaky = 0;
    const deliver = async (u: string) => {
      if (u === W && flaky-- > 0) throw new Error("down");
      box.set(u, (box.get(u) ?? 0) + 1);
      return "ok" as const;
    };
    const checked = c.checkReward({ title: "점검 보상", coins: 50, expiresAt: now + 7 * DAY_MS, target: { type: "users", userIds: [U, W] } }, now);
    if (!checked.ok) throw Error();
    const act = c.draft("reward.campaign", checked.payload, {}, A, now);
    expect(c.decide(act, A, "approved", now, false)).toMatchObject({ ok: false, code: "SECOND_APPROVER" });
    expect(c.decide(act, B, "approved", now, false).ok).toBe(true);
    const id = c.scheduleCampaign(act, checked.payload, now);
    expect(c.scheduleCampaign(act, checked.payload, now)).toBe(id); // idempotent
    flaky = 100;
    await c.process(now, deliver);
    expect(box.get(U)).toBe(1);
    for (let i = 0; i < 10; i++) {
      now += 3 * 3600_000;
      await c.process(now, deliver);
    }
    expect(c.campaigns()[0].deliveries).toMatchObject({ done: 1, failed: 1 });
    flaky = 0;
    c.retryFailed(id, now);
    await c.process(now, deliver);
    await c.process(now, deliver);
    expect([box.get(U), box.get(W)]).toEqual([1, 1]);
    expect(c.campaigns()[0].status).toBe("sent");
  });

  it("redeem codes: neutral for unknown/draft, period, target, per-account and total limits", () => {
    const c = core();
    const now = Date.UTC(2026, 10, 28);
    const made = c.createCode({ code: "WELCOME-2026", title: "감사 쿠폰", coins: 30, endsAt: now + DAY_MS, maxTotal: 2, perAccount: 1, joinedBefore: now }, A, now);
    if (!made.ok) throw Error(made.message);
    expect(made.code).toBe("WELCOME2026");
    expect(c.redeem(U, 0, "welcome2026", now)).toMatchObject({ ok: false, code: "INVALID_CODE" }); // still a draft
    expect(c.redeem(U, 0, "NOPE000", now)).toMatchObject({ ok: false, code: "INVALID_CODE" });
    c.setCodeStatus(made.id, "active");
    expect(c.redeem(U, now + 1, "WELCOME2026", now)).toMatchObject({ ok: false, code: "CODE_TARGET" });
    const first = c.redeem(U, 0, "WELCOME2026", now);
    if (!first.ok) throw Error();
    // an unconfirmed reservation is handed back again (grant retried with the same id)
    expect(c.redeem(U, 0, "WELCOME2026", now)).toMatchObject({ ok: true, redemptionId: first.redemptionId });
    c.confirmRedeem(U, first.redemptionId, true);
    expect(c.redeem(U, 0, "WELCOME2026", now)).toMatchObject({ ok: false, code: "CODE_USED" });
    const second = c.redeem(W, 0, "WELCOME2026", now);
    if (second.ok) c.confirmRedeem(W, second.redemptionId, true);
    expect(c.redeem(uid("Z"), 0, "WELCOME2026", now)).toMatchObject({ ok: false, code: "CODE_EXHAUSTED" });
    expect(c.redeem(uid("Y"), 0, "WELCOME2026", now + DAY_MS)).toMatchObject({ ok: false, code: "CODE_PERIOD" });
    c.setCodeStatus(made.id, "inactive");
    expect(c.redeem(uid("Y"), 0, "WELCOME2026", now)).toMatchObject({ ok: false, code: "INVALID_CODE" });
  });

  it("publishes notices only inside their window and never re-opens an ended one", () => {
    const c = core();
    const now = Date.UTC(2026, 10, 28);
    const a = c.saveNotice({ title: "점검 안내", body: "12/1 02:00 점검", kind: "maintenance", important: true, status: "published", publishAt: now + 3600_000 }, A, now);
    if (!a.ok) throw Error();
    expect(c.notices(false, now)).toHaveLength(0);
    expect(c.notices(false, now + 3600_001)[0]).toMatchObject({ kind: "maintenance", important: true });
    c.endNotice(a.id, A, now + 7200_000);
    expect(c.notices(false, now + 7200_001)).toHaveLength(0);
    expect(c.saveNotice({ id: a.id, title: "다시", body: "다시 열기" }, A, now).ok).toBe(false);
  });

  it("sanctions, expiry, carry-over on re-join, appeals", () => {
    const c = core();
    const now = Date.UTC(2026, 10, 28);
    c.activity({ userId: U, nickname: "u", createdAt: 0, day: 1, firstInWeek: true, firstInMonth: true, gapDays: null });
    const p = c.checkSanction({ userId: U, kind: "restrict", reason: "욕설 반복", days: 3 });
    if (!p.ok) throw Error();
    expect(c.checkSanction({ userId: U, kind: "restrict", reason: "x", days: 3 }).ok).toBe(false); // reason too short
    c.recordSanction("sn_aaaaaaaaaaaaaaaa", p.payload, A, null, now);
    expect(c.searchMembers({ status: "restricted" }).total).toBe(1);
    expect(c.signup(U, now + DAY_MS)).toHaveLength(1); // deleted and re-joined: carried over
    expect(c.createAppeal(W, "sn_aaaaaaaaaaaaaaaa", "제 제재가 아닌데요 확인 부탁", now).ok).toBe(false);
    const ap = c.createAppeal(U, "sn_aaaaaaaaaaaaaaaa", "오해가 있었습니다. 기록을 확인해 주세요.", now);
    expect(ap.ok).toBe(true);
    expect(c.createAppeal(U, "sn_aaaaaaaaaaaaaaaa", "한 번 더 이의제기 합니다아", now)).toMatchObject({ code: "DUPLICATE" });
    c.expireSanctions(now + 4 * DAY_MS);
    expect(c.sanction("sn_aaaaaaaaaaaaaaaa")?.status).toBe("expired");
    expect(c.searchMembers({ status: "ok" }).total).toBe(1);
  });

  it("plain text only: control and bidi characters are removed", () => {
    expect(cleanText("a‮b\u0000c <script>", 100)).toBe("abc <script>");
  });
});

describe("account mailbox and the economy ledger", () => {
  it("claims through the existing ledger exactly once; expired and revoked items are refused", async () => {
    let now = Date.UTC(2026, 10, 28);
    const a = new FakeAccount(U, "회원", () => now);
    const item = { id: "rw_x1", kind: "reward" as const, title: "점검 보상", body: "", coins: 120, gems: 3, expiresAt: now + DAY_MS };
    await a.deliver(item);
    await a.deliver(item); // re-delivery: still one item
    expect((await a.inbox()).items).toHaveLength(1);
    expect(await a.claim("rw_x1")).toMatchObject({ ok: true, coins: 120, gems: 3 });
    expect(await a.claim("rw_x1")).toMatchObject({ ok: false, code: "CLAIMED" });
    expect(a.econ.verify()).toMatchObject({ ok: true, wallet: { coins: 120, gems: 3 } });
    expect(a.econ.snapshot(U, now).ledger[0]).toMatchObject({ id: "admin:rw_x1", coins: 120 });
    await a.deliver({ ...item, id: "rw_x2" });
    expect(await a.revokeItem("rw_x2")).toBe(true);
    expect(await a.claim("rw_x2")).toMatchObject({ code: "REVOKED" });
    await a.deliver({ ...item, id: "rw_x3" });
    now += 2 * DAY_MS;
    expect(await a.claim("rw_x3")).toMatchObject({ code: "EXPIRED" });
    expect(a.econ.verify().ok).toBe(true);
  });
  it("standing: restrict and suspend until their end, lifted early", () => {
    const now = Date.UTC(2026, 10, 28);
    const a = new FakeAccount(U, "회원", () => now);
    a.member.applySanction({ id: "s1", kind: "suspend", reason: "부정 행위", until: now + DAY_MS }, now);
    expect(a.member.standing(now)).toMatchObject({ suspended: true, restricted: true });
    expect(a.member.standing(now + DAY_MS)).toMatchObject({ suspended: false, restricted: false });
    a.member.liftSanction("s1", now);
    expect(a.member.standing(now).suspended).toBe(false);
    expect(a.member.inbox(now).map((i) => i.title)).toEqual(expect.arrayContaining(["제재 해제 안내"]));
  });
});

describe("suggestion board", () => {
  const board = () => {
    const b = new BoardCore(sqlite());
    b.init();
    return b;
  };
  const t0 = Date.UTC(2026, 10, 28);
  it("validates, rate-limits and keeps security reports private", () => {
    const b = board();
    const me = { userId: U, nickname: "제안왕" };
    expect(b.create({ userId: U, nickname: null }, { category: "feature", title: "새 모드", body: "내용입니다 충분히 길게" }, t0)).toMatchObject({ code: "NICKNAME" });
    expect(b.create(me, { category: "feature", title: "좋은 기능", body: "javascript:alert(1) 눌러보세요" }, t0)).toMatchObject({ code: "LINK" });
    expect(b.create(me, { category: "feature", title: "링크 많음", body: "https://a.b https://c.d https://e.f https://g.h" }, t0)).toMatchObject({ code: "LINK" });
    expect(b.create(me, { category: "uiux", title: "첨부 있음", body: "스크린샷을 붙였어요 확인", attachments: [] }, t0)).toMatchObject({ code: "ATTACHMENTS_OFF" });
    const ok = b.create(me, { category: "uiux", title: "버튼 크게", body: "모바일 버튼이 작아요 <b>크게</b>" }, t0);
    expect(ok.ok).toBe(true);
    expect(b.create(me, { category: "uiux", title: "다른 제목", body: "연속 작성 테스트입니다" }, t0 + 1000)).toMatchObject({ code: "RATE_LIMITED" });
    const sec = b.create(me, { category: "security", title: "보안 취약점", body: "비공개로 알려드릴 내용이 있어요" }, t0 + 3 * 60_000);
    expect(sec.ok).toBe(true);
    const pub = b.list({ viewer: W });
    expect(pub.items.map((i) => i.title)).toEqual(["버튼 크게"]);
    expect(pub.items[0].body).toContain("<b>"); // stored as text; the page renders text nodes
    expect(b.list({ viewer: U, mine: true }).total).toBe(2);
    if (sec.ok) expect(b.get(sec.id, W)).toBeNull();
    for (let i = 0; i < 3; i++) b.create(me, { category: "bug", title: "버그 " + i, body: "재현 방법을 적어요 " + i }, t0 + (i + 2) * 3 * 60_000);
    expect(b.create(me, { category: "bug", title: "버그 하나 더", body: "하루 한도를 넘는 글" }, t0 + 30 * 60_000)).toMatchObject({ code: "RATE_LIMITED" });
  });
  it("votes per account (no own vote), search, sort, report auto-hide, adoption credit and deletion", () => {
    const b = board();
    const p1 = b.create({ userId: U, nickname: "작성자" }, { category: "mode", title: "토너먼트 모드", body: "친구 8명 토너먼트를 원해요" }, t0);
    const p2 = b.create({ userId: W, nickname: "다른이" }, { category: "item", title: "주사위 스킨", body: "별빛 주사위를 추가해 주세요" }, t0 + 1);
    if (!p1.ok || !p2.ok) throw Error();
    expect(b.vote(p1.id, U, true, t0)).toMatchObject({ code: "OWN" });
    expect(b.vote(p1.id, W, true, t0)).toMatchObject({ ok: true, votes: 1 });
    expect(b.vote(p1.id, W, true, t0)).toMatchObject({ votes: 1 });
    expect(b.list({ viewer: null, sort: "top" }).items[0].id).toBe(p1.id);
    expect(b.list({ viewer: null, q: "별빛" }).items.map((i) => i.id)).toEqual([p2.id]);
    expect(b.list({ viewer: null, category: "mode" }).total).toBe(1);
    for (let i = 0; i < 5; i++) b.report(p2.id, uid(String.fromCharCode(70 + i)), "spam", t0);
    expect(b.get(p2.id, null)).toBeNull();
    expect(b.get(p2.id, null, true)?.hidden).toBe(true);
    expect(b.moderate(p1.id, A, { status: "adopted" }, t0)).toMatchObject({ code: "INVALID" }); // reason required
    expect(b.moderate(p1.id, A, { status: "adopted", adoptReason: "다음 시즌 반영", answer: "좋은 제안 감사합니다" }, t0).ok).toBe(true);
    expect(b.contributors()).toHaveLength(0);
    b.setCredit(p1.id, U, true, t0);
    expect(b.contributors()[0]).toMatchObject({ nickname: "작성자" });
    expect(b.rewardTarget(p1.id)).toMatchObject({ ok: true, userId: U });
    b.markReward(p1.id, "act_x");
    expect(b.rewardTarget(p1.id)).toMatchObject({ code: "DUPLICATE" });
    b.forget(U);
    b.forget(W);
    expect(b.get(p1.id, null)).toMatchObject({ author: "탈퇴한 사용자", votes: 0 });
    expect(b.contributors()).toHaveLength(0);
  });
  it("attachment validator (upload itself is disabled)", () => {
    expect(checkAttachment(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), "image/png").ok).toBe(true);
    expect(checkAttachment(new TextEncoder().encode("<svg onload=alert(1)>"), "image/png").ok).toBe(false);
    expect(checkAttachment(new Uint8Array(1_000_001), "image/jpeg").ok).toBe(false);
  });
});

describe("statistics never invent numbers", () => {
  it("returns null for counters that were never collected", () => {
    const days = [{ day: "2026-11-27", "queue.join": 10, "match.random": 4, "queue.cancel": 2, "econ.coins": 500 }];
    expect(matchingStats(days, null)).toMatchObject({ requests: 10, successRate: 0.8, cancelRate: 0.2, byHour: null });
    expect(matchStats(days).players).toBeNull();
    expect(economyStats(days)).toMatchObject({ spent: null, ledgerProblems: null, issued: { coins: 500, adminCoins: null } });
    expect(itemStats(days)).toMatchObject({ purchasesByItem: null, drawDuplicates: null });
  });
});

describe("admin routes (fakes, isolated)", () => {
  const route = async (w: ReturnType<typeof world>, path: string, token: string | null, body?: unknown) => {
    const r = await handleAdminRoute(req(path, token, body), new URL("https://w.example" + path), w.backends(), reply);
    return { status: r.status, body: (await r.json()) as Record<string, any> };
  };
  const eng = async (w: ReturnType<typeof world>, path: string, token: string | null, body?: unknown) => {
    const r = await handleEngagementRoute(req(path, token, body), new URL("https://w.example" + path), w.backends(), reply);
    return { status: r!.status, body: (await r!.json()) as Record<string, any> };
  };
  const login = async (w: ReturnType<typeof world>, session: string) => (await w.adminLogin(session)).token as string;

  it("hides everything from non-admins and when no admin is configured", async () => {
    const empty = world({});
    const { session } = empty.account(A);
    expect((await route(empty, "/api/admin/session", session, {})).status).toBe(404);
    const w = world({ ADMIN_ACCOUNTS: ADMINS });
    const user = w.account(U);
    expect((await route(w, "/api/admin/session", user.session, {})).status).toBe(404);
    expect((await route(w, "/api/admin/overview", null)).status).toBe(404);
    expect((await route(w, "/api/admin/overview", "a1." + "z".repeat(43))).status).toBe(404);
    expect(w.admin.auditLog({}).entries.map((e: any) => e.action)).toContain("session.denied");
  });

  it("checks the role on every request: viewer is limited, removal revokes an open session", async () => {
    const env = { ADMIN_ACCOUNTS: ADMINS };
    const w = world(env);
    const viewer = await login(w, w.account(V).session);
    expect((await route(w, "/api/admin/overview", viewer)).status).toBe(200);
    expect((await route(w, "/api/admin/members", viewer)).status).toBe(403);
    expect(w.admin.auditLog({ action: "denied" }).entries).toHaveLength(1);
    env.ADMIN_ACCOUNTS = `${A}:owner`;
    expect((await route(w, "/api/admin/overview", viewer)).status).toBe(404);
    w.advance(31 * 60_000);
    const w2 = world({ ADMIN_ACCOUNTS: ADMINS });
    const t = await login(w2, w2.account(A).session);
    w2.advance(31 * 60_000); // idle expiry
    expect((await route(w2, "/api/admin/me", t)).status).toBe(404);
  });

  it("refuses all writes while ADMIN_WRITES is off (previews still work)", async () => {
    const w = world({ ADMIN_ACCOUNTS: ADMINS });
    const t = await login(w, w.account(A).session);
    w.account(U);
    const body = { title: "보상", coins: 10, expiresAt: w.clock() + DAY_MS, target: { type: "users", userIds: [U] } };
    expect((await route(w, "/api/admin/rewards/preview", t, body)).body.preview).toMatchObject({ recipients: 1, totalCoins: 10 });
    expect((await route(w, "/api/admin/rewards", t, body))).toMatchObject({ status: 403, body: { error: { code: "WRITES_DISABLED" } } });
    expect((await route(w, "/api/admin/notices", t, { title: "공지", body: "내용" })).status).toBe(403);
  });

  it("reward: draft → second-admin approval (fresh session + typed id) → delivery → member claim", async () => {
    const w = world({ ADMIN_ACCOUNTS: ADMINS, ADMIN_WRITES: "on", ADMIN_REWARD_POLICY: "test-policy" });
    const a = await login(w, w.account(A).session);
    const member = w.account(U);
    const draft = await route(w, "/api/admin/rewards", a, { title: "점검 보상", message: "불편을 드려 죄송해요", coins: 100, gems: 2, expiresAt: w.clock() + 7 * DAY_MS, target: { type: "users", userIds: [U] } });
    expect(draft.status).toBe(201);
    const id = draft.body.actionId as string;
    expect((await route(w, `/api/admin/actions/${id}/approve`, a, { confirm: id })).body.error.code).toBe("SECOND_APPROVER");
    w.advance(11 * 60_000);
    const b = await login(w, w.account(B).session);
    expect((await route(w, `/api/admin/actions/${id}/approve`, b, { confirm: "wrong" })).body.error.code).toBe("CONFIRM");
    const done = await route(w, `/api/admin/actions/${id}/approve`, b, { confirm: id });
    expect(done).toMatchObject({ status: 200, body: { ok: true } });
    expect((await route(w, `/api/admin/actions/${id}/approve`, b, { confirm: id })).status).toBe(409); // not twice
    await w.admin.process(w.clock(), (u, item) => w.accounts.get(u)!.deliver(item));
    const inbox = await eng(w, "/api/me/mailbox", member.session);
    expect(inbox.body.unclaimed).toBe(1);
    const claim = await eng(w, `/api/me/mailbox/${inbox.body.items[0].id}/claim`, member.session, {});
    expect(claim.body).toMatchObject({ ok: true, coins: 100, gems: 2 });
    expect((await eng(w, `/api/me/mailbox/${inbox.body.items[0].id}/claim`, member.session, {})).status).toBe(409);
    expect(member.account.econ.verify()).toMatchObject({ ok: true, wallet: { coins: 100, gems: 2 } });
    expect(w.counts["grant.admin.coins"]).toBe(100);
    const log = w.admin.auditLog({}).entries.map((e: any) => `${e.action}:${e.result}`);
    expect(log).toEqual(expect.arrayContaining(["action.draft:pending", "action.approve:refused", "action.execute:ok"]));
  });

  it("an old admin session must sign in again before approving", async () => {
    const w = world({ ADMIN_ACCOUNTS: ADMINS, ADMIN_WRITES: "on", ADMIN_REWARD_POLICY: "test-policy" });
    const a = await login(w, w.account(A).session);
    const b = await login(w, w.account(B).session);
    w.account(U);
    const id = (await route(w, "/api/admin/codes", a, { title: "쿠폰", coins: 10, endsAt: w.clock() + DAY_MS, maxTotal: 5 })).body.actionId;
    for (let i = 0; i < 2; i++) {
      w.advance(6 * 60_000);
      await route(w, "/api/admin/me", b); // keep the session alive (idle), but it gets older
    }
    expect((await route(w, `/api/admin/actions/${id}/approve`, b, { confirm: id })).body.error.code).toBe("REAUTH_REQUIRED");
  });

  it("suspend: approval, enforcement, appeal accepted → lifted; restrict blocks posting", async () => {
    const w = world({ ADMIN_ACCOUNTS: ADMINS, ADMIN_WRITES: "on", ADMIN_REWARD_POLICY: "test-policy" });
    const a = await login(w, w.account(A).session);
    const b = await login(w, w.account(B).session);
    const member = w.account(U);
    const d = await route(w, "/api/admin/sanctions", a, { userId: U, kind: "suspend", reason: "부정 프로그램 사용 정황", days: 7 });
    const id = d.body.actionId;
    expect((await route(w, `/api/admin/actions/${id}/approve`, b, { confirm: id })).body.ok).toBe(true);
    expect((await eng(w, "/api/me/redeem", member.session, { code: "ANYCODE1" })).body.error.code).toBe("SUSPENDED");
    const sanctions = await eng(w, "/api/me/sanctions", member.session);
    expect(sanctions.body.standing.suspended).toBe(true);
    const sid = sanctions.body.sanctions[0].id;
    const ap = await eng(w, "/api/me/appeals", member.session, { sanctionId: sid, text: "제 계정은 부정 프로그램을 쓰지 않았어요." });
    expect(ap.status).toBe(201);
    const ans = await route(w, `/api/admin/appeals/${ap.body.id}`, a, { status: "accepted", answer: "재검토 결과 해제합니다" });
    expect(ans.body).toMatchObject({ ok: true, lifted: true });
    expect((await eng(w, "/api/me/sanctions", member.session)).body.standing.suspended).toBe(false);
    // warning: immediate, still audited
    expect((await route(w, "/api/admin/sanctions", a, { userId: U, kind: "warning", reason: "채팅 비매너 경고" })).body.ok).toBe(true);
    const r = await route(w, "/api/admin/sanctions", a, { userId: U, kind: "restrict", reason: "도배 반복", days: 2 });
    await route(w, `/api/admin/actions/${r.body.actionId}/approve`, b, { confirm: r.body.actionId });
    expect((await eng(w, "/api/suggestions", member.session, { category: "feature", title: "제안합니다", body: "제한 중 작성 시도입니다" })).body.error.code).toBe("RESTRICTED");
  });

  it("nickname reset removes the nickname; member view is audited and has no secrets", async () => {
    const w = world({ ADMIN_ACCOUNTS: ADMINS, ADMIN_WRITES: "on", ADMIN_REWARD_POLICY: "test-policy" });
    const a = await login(w, w.account(A).session);
    const b = await login(w, w.account(B).session);
    const m = w.account(U, "나쁜닉네임");
    const d = await route(w, "/api/admin/sanctions", a, { userId: U, kind: "nickname_reset", reason: "부적절한 닉네임" });
    await route(w, `/api/admin/actions/${d.body.actionId}/approve`, b, { confirm: d.body.actionId });
    expect((await m.account.me())!.nickname).toBeNull();
    const view = await route(w, `/api/admin/members/${U}`, a);
    expect(view.status).toBe(200);
    expect(JSON.stringify(view.body)).not.toMatch(/hash|secret|s1\./);
    expect(w.admin.auditLog({ action: "member.view" }).entries).toHaveLength(1);
  });

  it("redeem codes through the routes: approval, one grant per account, retry-safe", async () => {
    const w = world({ ADMIN_ACCOUNTS: ADMINS, ADMIN_WRITES: "on", ADMIN_REWARD_POLICY: "test-policy" });
    const a = await login(w, w.account(A).session);
    const b = await login(w, w.account(B).session);
    const m = w.account(U);
    const c = await route(w, "/api/admin/codes", a, { code: "THANKS2026", title: "감사 쿠폰", coins: 40, endsAt: w.clock() + DAY_MS, maxTotal: 100 });
    expect((await eng(w, "/api/me/redeem", m.session, { code: "THANKS2026" })).body.error.code).toBe("INVALID_CODE");
    await route(w, `/api/admin/actions/${c.body.actionId}/approve`, b, { confirm: c.body.actionId });
    expect((await eng(w, "/api/me/redeem", m.session, { code: "thanks-2026" })).body).toMatchObject({ ok: true, coins: 40 });
    expect((await eng(w, "/api/me/redeem", m.session, { code: "THANKS2026" })).body.error.code).toBe("CODE_USED");
    expect(m.account.econ.verify()).toMatchObject({ ok: true, wallet: { coins: 40 } });
  });

  it("suggestions: public board, admin answer + adoption reward via approval", async () => {
    const w = world({ ADMIN_ACCOUNTS: ADMINS, ADMIN_WRITES: "on", ADMIN_REWARD_POLICY: "test-policy" });
    const a = await login(w, w.account(A).session);
    const b = await login(w, w.account(B).session);
    const author = w.account(U, "제안자");
    const voter = w.account(W, "추천인");
    const post = await eng(w, "/api/suggestions", author.session, { category: "mode", title: "팀전 모드", body: "2대2 팀전을 추가해 주세요" });
    expect(post.status).toBe(201);
    expect((await eng(w, `/api/suggestions/${post.body.id}/vote`, voter.session, { on: true })).body.votes).toBe(1);
    expect((await eng(w, "/api/suggestions?sort=top", null)).body.items[0]).toMatchObject({ title: "팀전 모드", votes: 1 });
    // writing earns nothing
    expect(author.account.econ.wallet()).toEqual({ coins: 0, gems: 0 });
    expect((await route(w, `/api/admin/suggestions/${post.body.id}/reward`, a, { coins: 100 })).body.error.code).toBe("STATE");
    await route(w, `/api/admin/suggestions/${post.body.id}`, a, { status: "adopted", adoptReason: "다음 업데이트 반영", answer: "채택했어요!" });
    const r = await route(w, `/api/admin/suggestions/${post.body.id}/reward`, a, { coins: 100 });
    expect(r.status).toBe(201);
    expect((await route(w, `/api/admin/suggestions/${post.body.id}/reward`, a, { coins: 100 })).body.error.code).toBe("DUPLICATE");
    await route(w, `/api/admin/actions/${r.body.actionId}/approve`, b, { confirm: r.body.actionId });
    const inbox = await eng(w, "/api/me/mailbox", author.session);
    const item = inbox.body.items.find((i: any) => i.kind === "suggestion");
    expect((await eng(w, `/api/me/mailbox/${item.id}/claim`, author.session, {})).body.coins).toBe(100);
    expect((await eng(w, `/api/suggestions/${post.body.id}`, null)).body.suggestion).toMatchObject({ status: "adopted", answer: "채택했어요!" });
  });

  it("reports: a member reports another with a match id; admins see the evidence and resolve", async () => {
    const w = world({ ADMIN_ACCOUNTS: ADMINS, ADMIN_WRITES: "on", ADMIN_REWARD_POLICY: "test-policy" });
    const a = await login(w, w.account(A).session);
    const reporter = w.account(U);
    w.account(W);
    const rep = await eng(w, "/api/reports", reporter.session, { targetType: "user", targetId: W, reason: "abusive_name", detail: "닉네임이 욕설이에요", matchId: "m_test_1" });
    expect(rep.status).toBe(201);
    expect((await eng(w, "/api/reports", reporter.session, { targetType: "user", targetId: W, reason: "abusive_name" })).body.error.code).toBe("DUPLICATE");
    const view = await route(w, `/api/admin/reports/${rep.body.id}`, a);
    expect(view.body.report).toMatchObject({ target_id: W, status: "open" });
    expect(view.body.evidence).toBeNull(); // no such server-verified record: shown as missing, not invented
    expect((await route(w, `/api/admin/reports/${rep.body.id}`, a, { status: "dismissed", note: "증거 없음" })).body.ok).toBe(true);
  });

  it("overview/stats show uncollected metrics as null", async () => {
    const w = world({ ADMIN_ACCOUNTS: ADMINS });
    const t = await login(w, w.account(V).session);
    const o = await route(w, "/api/admin/overview", t);
    expect(o.body.concurrentVisitors).toBeNull();
    const s = await route(w, "/api/admin/stats?days=7", t);
    expect(s.body.matches.byKind.random).toMatchObject({ completed: 3, forfeit: 1, avgDurationSec: 600 });
    expect(s.body.items.purchasesByItem).toBeNull();
  });
});
