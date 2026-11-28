import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { b64url } from "../worker/src/oidc";
import { Client, closeAllClients } from "./helpers/online-client";
import { startLocalWorker, type LocalWorker } from "./helpers/wrangler";

/**
 * C5-CORE in the real Workers runtime (wrangler dev --local, a FAKE local identity provider):
 * RETENTION="on" → attendance claim once per KST day, a server-verified friend match marks the activity
 * day in the same transaction as the record, the ledger and the grant records stay consistent
 * (admin verify). A Worker without RETENTION keeps every reward route off (404 RETENTION_OFF).
 */
const ORIGIN = "http://127.0.0.1:5173";
const ADMIN = "c".repeat(40);
let idp: Server;
let issuer = "";
let on: LocalWorker;
let off: LocalWorker;
const codes = new Map<string, { sub: string; nonce: string }>();
let keys: CryptoKeyPair;
let jwk: JsonWebKey;

async function sign(claims: Record<string, unknown>) {
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const head = enc({ alg: "RS256", kid: "k1", typ: "JWT" }) + "." + enc(claims);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(head)));
  return head + "." + b64url(sig);
}
const vars = () => ({
  ALLOWED_ORIGINS: ORIGIN, TURN_TIMEOUT_MS: "0", CREATE_PER_MINUTE: "500", JOIN_PER_MINUTE: "500",
  GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret", AUTH_SECRET: "s".repeat(40), APP_URL: ORIGIN + "/YachtLab/",
  TEST_OIDC_ISSUER: issuer, ECONOMY: "on", ADMIN_TOKEN: ADMIN,
});

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  jwk = (await crypto.subtle.exportKey("jwk", keys.publicKey)) as JsonWebKey;
  idp = createServer(async (req, res) => {
    if (req.url === "/jwks") return res.end(JSON.stringify({ keys: [{ ...jwk, kid: "k1", alg: "RS256", use: "sig" }] }));
    if (req.url === "/token") {
      let body = "";
      for await (const c of req) body += c;
      const who = codes.get(new URLSearchParams(body).get("code")!)!;
      const now = Math.floor(Date.now() / 1000);
      return res.end(JSON.stringify({ id_token: await sign({ iss: issuer, aud: "test-client", sub: who.sub, iat: now, exp: now + 300, nonce: who.nonce }) }));
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => idp.listen(0, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${(idp.address() as { port: number }).port}`;
  [on, off] = await Promise.all([startLocalWorker({ ...vars(), RETENTION: "on" }), startLocalWorker(vars())]);
}, 180_000);
afterAll(async () => {
  await Promise.all([on?.stop(), off?.stop()]);
  idp?.close();
});
afterEach(() => closeAllClients());

async function login(w: LocalWorker, sub: string): Promise<{ session: string; userId: string }> {
  const cs = "client-state-" + sub.padEnd(30, "x");
  const csHash = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cs))));
  const start = await fetch(w.url + "/auth/google/start?cs=" + csHash, { redirect: "manual" });
  const to = new URL(start.headers.get("location")!);
  const cookie = start.headers.get("set-cookie")!.split(";")[0];
  const code = "code-" + sub + "-" + Math.random().toString(36).slice(2);
  codes.set(code, { sub, nonce: to.searchParams.get("nonce")! });
  const back = await fetch(w.url + `/auth/google/callback?state=${to.searchParams.get("state")}&code=${code}`, { redirect: "manual", headers: { cookie } });
  const hash = new URL(back.headers.get("location")!).hash;
  const ex = await (await fetch(w.url + "/api/auth/exchange", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ code: decodeURIComponent(hash.slice(7)), clientState: cs }) })).json();
  return { session: ex.session, userId: ex.profile.userId };
}
const call = async (w: LocalWorker, session: string, path: string, body?: unknown) => {
  const r = await fetch(w.url + path, { method: body === undefined ? "GET" : "POST", headers: { origin: ORIGIN, "content-type": "application/json", authorization: "Bearer " + session }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> };
};
async function playOut(clients: Client[]) {
  for (let guard = 0; guard < 200; guard++) {
    await new Promise((r) => setTimeout(r, 30));
    if (clients.some((c) => c.view?.status === "finished")) return;
    const current = clients.find((c) => c.view?.legal);
    if (!current) continue;
    if (current.view!.turn!.rolls === 0) await current.cmd({ type: "roll", keep: [] });
    else await current.cmd({ type: "score", category: [...current.view!.legal!.scores].sort((x, y) => y.points - x.points)[0].category });
  }
}

describe("C5-CORE 보상 (wrangler dev)", () => {
  it("RETENTION이 없으면 보상 경로는 모두 404 RETENTION_OFF, 지급 없음", async () => {
    const a = await login(off, "c5-off-a");
    expect((await call(off, a.session, "/api/me/economy")).status).toBe(200);
    for (const [path, body] of [["/api/me/rewards", undefined], ["/api/me/rewards/attendance", {}], ["/api/me/rewards/claim", { txId: "all" }]] as const) {
      const r = await call(off, a.session, path, body);
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe("RETENTION_OFF");
    }
  }, 60_000);

  it("출석은 하루 한 번(동시 요청 포함), 서버 검증 경기가 연속 활동을 같은 트랜잭션에 기록하고, 원장 검증이 통과한다", async () => {
    const a = await login(on, "c5-on-alice");
    const b = await login(on, "c5-on-bob");
    const start = await call(on, a.session, "/api/me/rewards");
    expect(start.status).toBe(200);
    expect(start.body.status).toMatchObject({ policy: "C5-CORE@1", attendance: { claimed: 0, claimedToday: false }, activity: { current: 0 } });
    const before = start.body.wallet.coins;
    // two devices tap at once: one 200, one 409
    const both = await Promise.all([call(on, a.session, "/api/me/rewards/attendance", {}), call(on, a.session, "/api/me/rewards/attendance", {})]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    const okBody = both.find((r) => r.status === 200)!.body;
    expect(okBody.granted).toEqual([expect.objectContaining({ txId: "att:0:1", source: "attendance", coins: 10, gems: 0 })]);
    expect(okBody.snapshot.wallet.coins).toBe(before + 10);
    // attendance alone is not activity
    expect((await call(on, a.session, "/api/me/rewards")).body.status.activity.current).toBe(0);

    const create = await call(on, a.session, "/api/rooms", { name: "앨리스", maxPlayers: 2 });
    const joined = await call(on, b.session, "/api/rooms/" + create.body.code + "/join", { name: "밥" });
    const ca = new Client(on.url, create.body.code);
    const cb = new Client(on.url, create.body.code);
    await ca.hello(create.body.token);
    await cb.hello(joined.body.token);
    expect((await ca.cmd({ type: "start" })).ok).toBe(true);
    await playOut([ca, cb]);
    await expect.poll(async () => (await call(on, a.session, "/api/me/rewards")).body.status.activity.current, { timeout: 10_000 }).toBe(1);
    expect((await call(on, b.session, "/api/me/rewards")).body.status.activity.current).toBe(1);
    // friend matches never touch the weekly best streak
    expect((await call(on, a.session, "/api/me/rewards")).body.status.weeklyStreak.best).toBe(0);

    expect((await call(on, a.session, "/api/me/rewards/claim", { txId: "nope-0001" })).status).toBe(404);
    // SEC-1 2차 ECO-2: the reward page coupon form reaches the admin code directory (one redeem flow);
    // an unknown code is refused, and the coupon form stays closed while redeem-code grants are unapproved
    const coupon = await call(on, a.session, "/api/me/rewards/redeem", { code: "ABCD-1234" });
    expect([coupon.status, coupon.body.error.code]).toEqual([400, "INVALID_CODE"]);
    expect((await call(on, a.session, "/api/me/rewards")).body.redeem).toBe(false);
    const verify = await fetch(on.url + "/api/admin/ledger/" + a.userId, { headers: { authorization: "Bearer " + ADMIN } });
    expect(await verify.json()).toMatchObject({ ok: true, grants: 1, problems: [] });
  }, 90_000);

  it("SEC-1 2차 ECO-1: 탈퇴 뒤 같은 객체에서 재가입해도 보상 경로가 정상(테이블 재생성), 출석은 새 계정 기준", async () => {
    const a = await login(on, "c5-eco1-rejoin");
    expect((await call(on, a.session, "/api/me/rewards/attendance", {})).status).toBe(200);
    expect((await call(on, a.session, "/api/me/delete", { confirm: "DELETE" })).status).toBe(200);
    const again = await login(on, "c5-eco1-rejoin");
    expect(again.userId).toBe(a.userId);
    const view = await call(on, again.session, "/api/me/rewards");
    expect(view.status).toBe(200);
    expect(view.body.inbox).toEqual([]);
    expect(view.body.history).toEqual([]);
    const att = await call(on, again.session, "/api/me/rewards/attendance", {});
    expect(att.status).toBe(200);
    expect(att.body.granted).toEqual([expect.objectContaining({ source: "attendance" })]);
  }, 60_000);
});
