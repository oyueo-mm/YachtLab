import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { handleAdminRoute, handleEngagementRoute } from "../worker/src/admin/api";
import { DAY_MS } from "../worker/src/admin/store";
import { APPROVED_SOURCES } from "../worker/src/grants";
import { reply, req, sqlite, uid, world } from "./helpers/admin-fakes";
import { AccountStore } from "../worker/src/account";
import { EconomyStore } from "../worker/src/economy";
import { RewardGrants } from "../worker/src/grants";
import { RetentionStore } from "../worker/src/retention";
import { handleDailyRoute } from "../worker/src/daily-api";

/**
 * INT-1: ADMIN-1 rewards run on the C5 grant path (worker/src/admin/grant-port.ts). These checks use the
 * PRODUCTION grant gate (C5 APPROVED_SOURCES) unless a test simulates an owner approval of the admin sources.
 */
const A = uid("A"), B = uid("B"), U = uid("U");
const ADMINS = `${A}:owner,${B}:owner`;
const route = async (w: ReturnType<typeof world>, path: string, token: string | null, body?: unknown) => {
  const r = await handleAdminRoute(req(path, token, body), new URL("https://w.example" + path), w.backends(), reply);
  return { status: r.status, body: (await r.json()) as Record<string, any> };
};
const eng = async (w: ReturnType<typeof world>, path: string, token: string | null, body?: unknown) => {
  const r = await handleEngagementRoute(req(path, token, body), new URL("https://w.example" + path), w.backends(), reply);
  return { status: r!.status, body: (await r!.json()) as Record<string, any> };
};
const login = async (w: ReturnType<typeof world>, s: string) => (await w.adminLogin(s)).token as string;
const grant = { approver: A, policyVersion: "policy-1" };
const gLedger = (w: ReturnType<typeof world>, m: { account: { econ: any; userId: string } }) =>
  m.account.econ.snapshot(m.account.userId, w.clock()).ledger.filter((l: { id: string }) => l.id.startsWith("g:"));

describe("INT-1 · production grant gate keeps admin payouts off", () => {
  it("C5 approves only the automatic retention sources", () => {
    expect([...APPROVED_SOURCES].sort()).toEqual(["activity-streak", "attendance", "weekly-streak"]);
  });

  it("an approved admin reward is refused by C5 (SOURCE_DISABLED): nothing reaches the mailbox, inbox or ledger", async () => {
    const w = world({ GRANT_SOURCES: "production" });
    const m = w.account(U);
    const item = { id: "op:rw_" + "p".repeat(16), kind: "reward" as const, title: "보상", body: "", coins: 100, gems: 0, expiresAt: w.clock() + DAY_MS, grant };
    await expect(m.account.deliver(item)).rejects.toMatchObject({ code: "SOURCE_DISABLED" });
    expect((await m.account.inbox()).items).toHaveLength(0);
    expect(m.account.grants.inbox(w.clock())).toHaveLength(0);
    expect(gLedger(w, m)).toHaveLength(0);
    // the C5 suggestion source is off as well
    await expect(m.account.deliver({ ...item, id: "sug:sg_" + "p".repeat(16), kind: "suggestion" })).rejects.toMatchObject({ code: "SOURCE_DISABLED" });
  });

  it("a redeem code is refused by C5 and its reservation released — on both routes, without using up the code", async () => {
    const w = world({ ADMIN_ACCOUNTS: ADMINS, ADMIN_WRITES: "on", ADMIN_REWARD_POLICY: "policy-1", GRANT_SOURCES: "production" });
    const a = await login(w, w.account(A).session);
    const b = await login(w, w.account(B).session);
    const m = w.account(U);
    const c = await route(w, "/api/admin/codes", a, { code: "GATE2026", title: "쿠폰", coins: 30, endsAt: w.clock() + DAY_MS, maxTotal: 10 });
    await route(w, `/api/admin/actions/${c.body.actionId}/approve`, b, { confirm: c.body.actionId });
    for (const path of ["/api/me/rewards/redeem", "/api/me/redeem", "/api/me/rewards/redeem"]) {
      const r = await eng(w, path, m.session, { code: "GATE2026" });
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe("SOURCE_DISABLED"); // never CODE_USED: the reservation was released
    }
    expect(gLedger(w, m)).toHaveLength(0);
  });
});

describe("INT-1 · one crediting path, no duplicate payout", () => {
  it("concurrent claims of one admin reward credit once", async () => {
    const w = world({});
    const m = w.account(U);
    const id = "op:rw_" + "d".repeat(16);
    await m.account.deliver({ id, kind: "reward", title: "보상", body: "", coins: 70, gems: 1, expiresAt: w.clock() + DAY_MS, grant });
    const results = await Promise.all([m.account.claim(id), m.account.claim(id), m.account.claim(id)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(gLedger(w, m)).toEqual([expect.objectContaining({ id: "g:" + id, coins: 70, gems: 1 })]);
    expect(m.account.econ.verify().ok).toBe(true);
  });

  it("a redeem code pays once per account even when the same request repeats or races; the C5 and ADMIN routes share it", async () => {
    const w = world({ ADMIN_ACCOUNTS: ADMINS, ADMIN_WRITES: "on", ADMIN_REWARD_POLICY: "policy-1" });
    const a = await login(w, w.account(A).session);
    const b = await login(w, w.account(B).session);
    const m = w.account(U);
    const c = await route(w, "/api/admin/codes", a, { code: "ONCE2026", title: "쿠폰", coins: 25, endsAt: w.clock() + DAY_MS, maxTotal: 10 });
    await route(w, `/api/admin/actions/${c.body.actionId}/approve`, b, { confirm: c.body.actionId });
    const runs = await Promise.all([
      eng(w, "/api/me/rewards/redeem", m.session, { code: "ONCE2026" }),
      eng(w, "/api/me/redeem", m.session, { code: "ONCE2026" }),
      eng(w, "/api/me/rewards/redeem", m.session, { code: "once-2026" }),
    ]);
    // the racing requests share one reservation (one txId): each may report success, but C5 credits once
    expect(runs.every((r) => r.status === 200)).toBe(true);
    expect(gLedger(w, m)).toEqual([expect.objectContaining({ coins: 25 })]);
    expect(gLedger(w, m)[0].id).toMatch(/^g:code:cd_[a-z0-9]{16}$/);
    expect((await eng(w, "/api/me/rewards/redeem", m.session, { code: "ONCE2026" })).body.error.code).toBe("CODE_USED");
    expect(gLedger(w, m)).toHaveLength(1);
    expect(m.account.econ.verify().ok).toBe(true);
  });

  it("revoking an unclaimed admin reward removes it from the C5 inbox; a claimed one stays (append-only)", async () => {
    const w = world({});
    const m = w.account(U);
    const one = "op:rw_" + "r".repeat(16), two = "op:rw_" + "s".repeat(16);
    for (const id of [one, two]) await m.account.deliver({ id, kind: "reward", title: "보상", body: "", coins: 5, gems: 0, expiresAt: w.clock() + DAY_MS, grant });
    await m.account.claim(one);
    expect(await m.account.revokeItem(one)).toBe(false);
    expect(await m.account.revokeItem(two)).toBe(true);
    expect(await m.account.claim(two)).toMatchObject({ code: "REVOKED" });
    expect(gLedger(w, m)).toHaveLength(1);
  });
});

describe("INT-1 · suspended accounts receive nothing", () => {
  it("a suspended account cannot claim admin rewards or redeem codes", async () => {
    const w = world({ ADMIN_ACCOUNTS: ADMINS, ADMIN_WRITES: "on", ADMIN_REWARD_POLICY: "policy-1" });
    const m = w.account(U);
    const id = "op:rw_" + "z".repeat(16);
    await m.account.deliver({ id, kind: "reward", title: "보상", body: "", coins: 9, gems: 0, expiresAt: w.clock() + DAY_MS, grant });
    m.account.member.applySanction({ id: "sn_1", kind: "suspend", reason: "테스트", until: null }, w.clock());
    expect((await eng(w, `/api/me/mailbox/${id}/claim`, m.session, {})).body.error.code).toBe("SUSPENDED");
    for (const path of ["/api/me/rewards/redeem", "/api/me/redeem"]) expect((await eng(w, path, m.session, { code: "ANYCODE1" })).body.error.code).toBe("SUSPENDED");
    expect(gLedger(w, m)).toHaveLength(0);
  });

  it("the account router checks suspension before the C5 reward POSTs (attendance, claim, redeem)", () => {
    const src = readFileSync("worker/src/accounts-api.ts", "utf8");
    const guard = src.indexOf('if (me.suspended && path !== "/api/me/logout"');
    const rewards = src.indexOf('if (path === "/api/me/rewards/attendance"');
    expect(guard).toBeGreaterThan(0);
    expect(rewards).toBeGreaterThan(guard);
  });
});

describe("INT-1 · LIVE-1 → C5 activity day at the midnight grace", () => {
  // KST midnight = 15:00 UTC. Daily D's grace runs to D+1 00:30 KST.
  const D_2350 = Date.UTC(2026, 11, 9, 14, 50); // 2026-12-09 23:50 KST
  const D1_0010 = Date.UTC(2026, 11, 9, 15, 10); // 2026-12-10 00:10 KST (grace of 12-09)
  const D1_1200 = Date.UTC(2026, 11, 10, 3, 0); // 2026-12-10 12:00 KST
  function retention() {
    const db = sqlite();
    const account = new AccountStore(db);
    account.init();
    account.ensureUser(U, "google", D_2350 - 30 * DAY_MS);
    const econ = new EconomyStore(db);
    econ.init();
    econ.welcome(U, D_2350 - 30 * DAY_MS, null);
    const grants = new RewardGrants(db, econ);
    grants.init();
    const r = new RetentionStore(db, grants);
    r.init();
    return r;
  }
  it("a grace-time completion of yesterday's official game counts for the day it finished (KST, server time) — once", () => {
    const r = retention();
    r.onDailyContent(U, { kind: "daily.official.completed", at: D1_0010 }, D1_0010);
    const s1 = r.status(D1_1200).activity;
    expect(s1).toMatchObject({ activeToday: true, current: 1 });
    // today's own official game on the same KST day adds nothing
    r.onDailyContent(U, { kind: "daily.official.completed", at: D1_1200 }, D1_1200);
    expect(r.status(D1_1200).activity.current).toBe(1);
    // a client-chosen future time is never used: C5 takes min(at, now)
    const r2 = retention();
    r2.onDailyContent(U, { kind: "daily.official.completed", at: D1_1200 }, D_2350);
    expect(r2.status(D_2350).activity).toMatchObject({ activeToday: true, current: 1 });
    expect(r2.status(D1_1200).activity.activeToday).toBe(false);
  });
  it("practice, puzzles and other kinds are not activity", () => {
    const r = retention();
    for (const kind of ["daily.practice.completed", "daily.puzzle.answered", "daily.official.started"]) r.onDailyContent(U, { kind, at: D1_1200 } as never, D1_1200);
    expect(r.status(D1_1200).activity).toMatchObject({ activeToday: false, current: 0 });
  });
});

describe("INT-1 · suspended accounts cannot use daily content", () => {
  it("every daily write is refused for a suspended session (reads stay available)", async () => {
    const calls: string[] = [];
    const deps = {
      secretFor: () => "s".repeat(40), now: () => Date.UTC(2026, 11, 10, 3), limited: () => false, clientKey: async () => "c",
      me: async () => ({ userId: U, suspended: true }),
      user: () => new Proxy({}, { get: (_t, k) => async () => (calls.push(String(k)), null) }),
      board: () => new Proxy({}, { get: (_t, k) => async () => (calls.push("board." + String(k)), {}) }),
      reply: (status: number, body: unknown) => new Response(JSON.stringify(body), { status }),
    };
    for (const path of ["/api/daily/start", "/api/daily/step", "/api/daily/puzzle", "/api/daily/settings"]) {
      const res = await handleDailyRoute(new Request("https://w.example" + path, { method: "POST", body: "{}" }), new URL("https://w.example" + path), deps as never, async () => ({}));
      expect(res!.status, path).toBe(403);
      expect(((await res!.json()) as any).error.code).toBe("SUSPENDED");
    }
    expect(calls).toEqual([]); // nothing reached the account or the board
  });
  it("C5 itself ignores daily activity of a suspended account (defence in depth)", () => {
    const src = readFileSync("worker/src/index.ts", "utf8");
    const fn = src.slice(src.indexOf("async dailyContentDone("), src.indexOf("async dailyContentDone(") + 600);
    expect(fn).toMatch(/standing\(now\)\.suspended/);
  });
});

describe("INT-1 · one reward page, one redeem form, entry flags off by default", () => {
  it("POST /api/me/rewards/redeem answers in the C5 RewardsView shape with `granted` (the ADMIN route keeps its own shape)", async () => {
    const w = world({ ADMIN_ACCOUNTS: ADMINS, ADMIN_WRITES: "on", ADMIN_REWARD_POLICY: "policy-1" });
    const a = await login(w, w.account(A).session);
    const b = await login(w, w.account(B).session);
    const m = w.account(U);
    (m.account as unknown as { rewards: () => Promise<unknown> }).rewards = async () => ({ ok: true, status: { enabled: true }, inbox: [], history: [], redeem: true, wallet: { coins: 1, gems: 0 } });
    for (const code of ["VIEW2026", "VIEW2027"]) {
      const c = await route(w, "/api/admin/codes", a, { code, title: "쿠폰", coins: 20, endsAt: w.clock() + DAY_MS, maxTotal: 10 });
      await route(w, `/api/admin/actions/${c.body.actionId}/approve`, b, { confirm: c.body.actionId });
    }
    const c5 = await eng(w, "/api/me/rewards/redeem", m.session, { code: "VIEW2026" });
    expect(c5.status).toBe(200);
    expect(c5.body).toMatchObject({ redeem: true, wallet: { coins: 1 }, granted: [{ coins: 20, gems: 0, label: "쿠폰" }] });
    expect(c5.body.ok).toBeUndefined();
    const adm = await eng(w, "/api/me/redeem", m.session, { code: "VIEW2027" });
    expect(adm.body).toMatchObject({ ok: true, coins: 20, title: "쿠폰" });
    expect(gLedger(w, m)).toHaveLength(2);
  });

  it("the mailbox page has no claim button or coupon form; /api/features reports every entry flag from its own variable", () => {
    const page = readFileSync("src/engagement/EngagementPages.tsx", "utf8");
    expect(page).not.toMatch(/mailbox\/\$\{[^}]+\}\/claim/);
    expect(page).not.toContain("/api/me/redeem");
    const worker = readFileSync("worker/src/index.ts", "utf8");
    expect(worker).toContain('retention: !!auth && env.ECONOMY === "on" && env.RETENTION === "on"');
    expect(worker).toContain('feedback: !!auth && env.FEEDBACK_BOARD === "on"');
    expect(worker).toContain('mailbox: !!auth && env.MAILBOX === "on"');
    expect(worker).toContain('notices: env.NOTICES === "on"');
    const toml = readFileSync("worker/wrangler.toml", "utf8");
    for (const v of ["FEEDBACK_BOARD", "MAILBOX", "NOTICES", "ADMIN_WRITES", "DAILY"]) expect(toml).toMatch(new RegExp(`^${v} = "off"$`, "m"));
    expect(toml).not.toMatch(/^RETENTION\s*=/m);
  });
});
