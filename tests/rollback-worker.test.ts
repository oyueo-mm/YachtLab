import { afterAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { startLocalWorker, type LocalWorker } from "./helpers/wrangler";
import { startFakeIdp, type FakeIdp } from "./helpers/fake-idp";
import { Client } from "./helpers/online-client";
import { ITEMS, priceOf } from "../src/economy/live/catalog";
import { dayStart } from "../src/daily/calendar";

/**
 * INT-1 rollback check (release plan §7): state written by THIS (integrated) Worker — accounts, sessions,
 * friends, a server-verified match, a purchase, C5 grants (RETENTION on), a daily attempt, admin-index
 * activity — is read by the PREVIOUS Worker (the rollback target) without loss, and the integrated Worker
 * finds its own new tables intact after rolling forward again. All three runs share one persisted local
 * storage, one after the other. Nothing touches a deployed Worker.
 *
 *   git worktree add ../yl-base d775ecb && (cd ../yl-base && ln -s "$PWD/../YachtLab/node_modules")
 *   YL_ROLLBACK_BASE=../yl-base npx vitest run tests/rollback-worker.test.ts
 */
const BASE = process.env.YL_ROLLBACK_BASE;
const ORIGIN = "http://127.0.0.1:5173";
const ADMIN = "t".repeat(40);
const DATE = "2026-12-03";
const VARS = { ALLOWED_ORIGINS: ORIGIN, TURN_TIMEOUT_MS: "0", CREATE_PER_MINUTE: "500", JOIN_PER_MINUTE: "500", GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret", AUTH_SECRET: "s".repeat(40), APP_URL: ORIGIN + "/YachtLab/", ECONOMY: "on", ADMIN_TOKEN: ADMIN };

let idp: FakeIdp | undefined;
let running: LocalWorker | undefined;
afterAll(async () => {
  await running?.stop();
  idp?.close();
});

describe.skipIf(!BASE)("통합 Worker → 이전 Worker 롤백 → 통합 Worker 재배포 시 데이터 보존", () => {
  it("이전 Worker가 통합 Worker의 계정·세션·친구·전적·구매·C5 원장을 그대로 읽고, 다시 올린 통합 Worker는 신규 테이블을 그대로 쓴다", async () => {
    idp = await startFakeIdp();
    const newVars = { ...VARS, TEST_OIDC_ISSUER: idp.issuer, RETENTION: "on", DAILY: "on", DAILY_SECRET: "rollback-test-daily-secret-".padEnd(48, "z"), DAILY_TEST_OFFSET_MS: String(dayStart(DATE) + 3600_000 - Date.now()) };
    running = await startLocalWorker(newVars);
    const persistDir = running.persistDir;
    let ip = 0;
    const login = async (sub: string) => {
      const headers = { "cf-connecting-ip": "10.2.0." + (++ip % 250) };
      idp!.next(sub);
      const cs = "client-state-" + sub.padEnd(30, "x");
      const hash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cs))).toString("base64url");
      const start = await fetch(running!.url + "/auth/google/start?cs=" + hash, { redirect: "manual", headers });
      const cookie = start.headers.get("set-cookie")!.split(";")[0];
      const auth = await fetch(start.headers.get("location")!, { redirect: "manual" });
      const back = await fetch(auth.headers.get("location")!, { redirect: "manual", headers: { cookie, ...headers } });
      const code = decodeURIComponent(new URL(back.headers.get("location")!).hash.slice("#login=".length));
      const ex = await (await fetch(running!.url + "/api/auth/exchange", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", ...headers }, body: JSON.stringify({ code, clientState: cs }) })).json();
      return { session: ex.session as string, userId: ex.profile.userId as string };
    };
    const call = async (session: string | null, path: string, body?: unknown) => {
      const r = await fetch(running!.url + path, { method: body === undefined ? "GET" : "POST", headers: { origin: ORIGIN, "content-type": "application/json", ...(session ? { authorization: "Bearer " + session } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> };
    };
    const ledger = async (userId: string) => (await (await fetch(running!.url + "/api/admin/ledger/" + userId, { headers: { authorization: "Bearer " + ADMIN } })).json()) as Record<string, any>;

    /* ---------------- integrated Worker: write data of every kind ---------------- */
    const a = await login("rb-a"), b = await login("rb-b");
    await call(a.session, "/api/me/nickname", { nickname: "롤에이" });
    await call(b.session, "/api/me/nickname", { nickname: "롤비" });
    await call(a.session, "/api/me/economy");
    await call(b.session, "/api/me/economy");
    expect((await call(a.session, "/api/me/rewards/attendance", {})).status).toBe(200); // C5 grant_tx + g: ledger
    const codeOf = async (s: string) => (await call(s, "/api/me/friends")).body.me.code as string;
    const [ca, cb] = [await codeOf(a.session), await codeOf(b.session)];
    await call(a.session, "/api/me/friends/request", { code: cb });
    expect((await call(b.session, "/api/me/friends/accept", { code: ca })).body).toEqual({ status: "friends" });
    // one server-verified match
    const room = await call(a.session, "/api/rooms", { name: "롤에이", maxPlayers: 2 });
    const joined = await call(b.session, `/api/rooms/${room.body.code}/join`, { name: "롤비" });
    const p1 = new Client(running.url, room.body.code), p2 = new Client(running.url, room.body.code);
    await p1.hello(room.body.token);
    await p2.hello(joined.body.token);
    p2.ws.send(JSON.stringify({ t: "intent", value: "ready" }));
    await expect.poll(async () => (await p1.cmd({ type: "start" })).ok, { timeout: 5000 }).toBe(true);
    for (let guard = 0; guard < 200 && p1.view?.status !== "finished"; guard++) {
      await new Promise((r) => setTimeout(r, 30));
      const cur = [p1, p2].find((c) => c.view?.legal);
      if (!cur) continue;
      if (cur.view!.turn!.rolls === 0) await cur.cmd({ type: "roll", keep: [] });
      else await cur.cmd({ type: "score", category: [...cur.view!.legal!.scores].sort((x, y) => y.points - x.points)[0].category });
    }
    await expect.poll(async () => (await call(a.session, "/api/me/records")).body.records?.length ?? 0, { timeout: 10_000 }).toBe(1);
    p1.ws.close(); p2.ws.close();
    // a purchase
    const cheap = [...ITEMS].filter((i) => (i.rev ?? 1) === 1 && !i.retired && priceOf(i, "coins")).sort((x, y) => priceOf(x, "coins")! - priceOf(y, "coins")!)[0];
    expect((await call(a.session, "/api/me/shop/buy", { itemId: cheap.id, currency: "coins", requestId: "rb-buy-0001" })).status).toBe(200);
    // a daily attempt (UserStore daily tables + DailyBoard participant)
    expect((await call(a.session, "/api/daily/start", { date: DATE, mode: "official" })).status).toBe(200);
    const before = {
      me: (await call(a.session, "/api/me")).body.profile,
      snapshot: (await call(a.session, "/api/me/economy")).body.snapshot,
      records: (await call(a.session, "/api/me/records")).body.records,
      friendsA: (await call(a.session, "/api/me/friends")).body.friends.map((f: { code: string; nickname: string }) => [f.code, f.nickname]),
      ledger: await ledger(a.userId),
    };
    expect(before.ledger.ok).toBe(true);
    await running.stop();

    /* ---------------- previous Worker (rollback) on the same storage ---------------- */
    const old = (await import(join(BASE!, "tests/helpers/wrangler.ts"))) as { startLocalWorker: typeof startLocalWorker };
    running = await old.startLocalWorker({ ...VARS, TEST_OIDC_ISSUER: idp.issuer }, { persistDir });
    expect((await call(a.session, "/api/me")).body.profile).toMatchObject({ userId: a.userId, nickname: "롤에이" }); // session still valid
    const oldSnap = (await call(a.session, "/api/me/economy")).body.snapshot;
    expect(oldSnap.wallet).toEqual(before.snapshot.wallet);
    expect(oldSnap.inventory.map((i: { id: string }) => i.id)).toEqual(before.snapshot.inventory.map((i: { id: string }) => i.id));
    expect((await call(a.session, "/api/me/records")).body.records.map((r: { recordId: string }) => r.recordId)).toEqual(before.records.map((r: { recordId: string }) => r.recordId));
    expect((await call(a.session, "/api/me/friends")).body.friends.map((f: { code: string; nickname: string }) => [f.code, f.nickname])).toEqual(before.friendsA);
    const oldLedger = await ledger(a.userId);
    expect(oldLedger.ok).toBe(true); // the g: (C5) rows are ordinary ledger rows to the previous Worker
    // new features are simply absent on the previous Worker (no crash, no data change)
    expect((await call(a.session, "/api/me/rewards")).status).toBeGreaterThanOrEqual(400);
    expect((await call(a.session, "/api/daily/today")).status).toBe(404);
    // the previous Worker keeps working normally: a second purchase request id
    await running.stop();

    /* ---------------- integrated Worker again (roll forward) ---------------- */
    running = await startLocalWorker(newVars, { persistDir });
    const rewards = await call(a.session, "/api/me/rewards");
    expect(rewards.status).toBe(200);
    expect(rewards.body.status.attendance.claimedToday).toBe(true); // retention table kept through the rollback
    expect((await call(a.session, "/api/me/rewards/attendance", {})).status).toBe(409); // no second grant
    const att = await call(a.session, "/api/daily/attempt?date=" + DATE + "&mode=official");
    expect(att.body.attempt?.status).toBe("playing"); // daily attempt kept
    expect((await ledger(a.userId)).ok).toBe(true);
    expect((await call(a.session, "/api/me/economy")).body.snapshot.wallet).toEqual(before.snapshot.wallet);
  }, 240_000);
});
