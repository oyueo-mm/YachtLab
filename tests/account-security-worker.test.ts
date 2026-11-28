import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startLocalWorker, type LocalWorker } from "./helpers/wrangler";
import { startFakeIdp, type FakeIdp } from "./helpers/fake-idp";
import { SESSION_CAP } from "../worker/src/account";
import { FRIEND_LIMITS } from "../worker/src/friends";

/**
 * C4.2 account security in the real Workers runtime (wrangler dev --local: UserStore / FriendIndex SQLite
 * objects, alarms) with a FAKE local sign-in (loopback only). Deletion, re-join with the same Google
 * subject (= same internal id), requests both ways, friendship + room invite, blocks, delete-vs-accept
 * races, and the session cap / logout paths. Nothing here talks to a deployed Worker.
 */
const ORIGIN = "http://127.0.0.1:5173";
let worker: LocalWorker;
let idp: FakeIdp;
beforeAll(async () => {
  idp = await startFakeIdp();
  worker = await startLocalWorker({ ALLOWED_ORIGINS: ORIGIN, TURN_TIMEOUT_MS: "0", CREATE_PER_MINUTE: "500", JOIN_PER_MINUTE: "500", GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret", AUTH_SECRET: "s".repeat(40), APP_URL: ORIGIN + "/YachtLab/", TEST_OIDC_ISSUER: idp.issuer });
}, 120_000);
afterAll(async () => {
  await worker?.stop();
  idp?.close();
});

let ip = 0;
/** fakeLogin with a distinct client address per sign-in (the per-address sign-in limit is 10 a minute). */
async function login(sub: string): Promise<string> {
  const headers = { "cf-connecting-ip": "10.0.0." + (++ip % 250) };
  idp.next(sub);
  const cs = "client-state-" + sub.padEnd(30, "x");
  const hash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cs))).toString("base64url");
  const start = await fetch(worker.url + "/auth/google/start?cs=" + hash, { redirect: "manual", headers });
  expect(start.status).toBe(302);
  const cookie = start.headers.get("set-cookie")!.split(";")[0];
  const auth = await fetch(start.headers.get("location")!, { redirect: "manual" });
  const back = await fetch(auth.headers.get("location")!, { redirect: "manual", headers: { cookie, ...headers } });
  const code = decodeURIComponent(new URL(back.headers.get("location")!).hash.slice("#login=".length));
  const ex = await (await fetch(worker.url + "/api/auth/exchange", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", ...headers }, body: JSON.stringify({ code, clientState: cs }) })).json();
  expect(typeof ex.session).toBe("string");
  return ex.session as string;
}
const call = async (session: string | null, path: string, body?: unknown) => {
  const r = await fetch(worker.url + path, { method: body === undefined ? "GET" : "POST", headers: { origin: ORIGIN, "content-type": "application/json", ...(session ? { authorization: "Bearer " + session } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> };
};
const userIdOf = (session: string) => session.split(".")[1];
const friends = async (s: string) => (await call(s, "/api/me/friends")).body;
const del = async (s: string) => expect((await call(s, "/api/me/delete", { confirm: "DELETE" })).status).toBe(200);
async function pair(prefix: string) {
  const a = await login(prefix + "-a");
  const b = await login(prefix + "-b");
  await call(a, "/api/me/nickname", { nickname: prefix + "에이" });
  await call(b, "/api/me/nickname", { nickname: prefix + "비" });
  return { a, b, aCode: (await friends(a)).me.code as string, bCode: (await friends(b)).me.code as string };
}

describe("탈퇴·재가입과 친구 관계 (SEC-03, wrangler dev)", () => {
  it("R1/R2: 보낸 요청은 탈퇴 즉시 상대에게서 사라지고, 재가입 계정은 새 친구 코드로 시작하며 옛 코드로 친구가 되지 않는다", async () => {
    const { a, b, aCode, bCode } = await pair("r1");
    expect((await call(a, "/api/me/friends/request", { code: bCode })).body).toEqual({ status: "sent" });
    expect((await call(b, "/api/me/inbox")).body.requests).toBe(1);
    await del(a);
    expect((await friends(b)).incoming).toEqual([]);
    expect((await call(b, "/api/me/inbox")).body.requests).toBe(0);
    // same Google subject → same internal id, but a NEW friend code; the old one names nobody
    const a2 = await login("r1-a");
    expect(userIdOf(a2)).toBe(userIdOf(a));
    expect((await call(a, "/api/me")).status).toBe(401); // sessions of the deleted account are gone
    const me2 = await friends(a2);
    expect(me2.me.code).not.toBe(aCode);
    expect(me2.friends).toEqual([]);
    expect((await call(b, "/api/me/friends/accept", { code: aCode })).status).toBe(404);
    expect((await call(b, "/api/me/friends/search", { query: aCode })).body.results).toEqual([]);
    expect((await friends(a2)).friends).toEqual([]);
  });

  it("받은 요청: 나에게 요청을 보낸 상대의 '보낸 요청'에서도 사라진다", async () => {
    const { a, b, aCode } = await pair("in");
    await call(b, "/api/me/friends/request", { code: aCode });
    expect((await friends(b)).outgoing).toHaveLength(1);
    await del(a);
    expect((await friends(b)).outgoing).toEqual([]);
  });

  it("친구 관계와 그 친구가 받은 방 초대가 정리되고 접속 상태도 사라진다", async () => {
    const { a, b, aCode, bCode } = await pair("fr");
    await call(a, "/api/me/friends/request", { code: bCode });
    expect((await call(b, "/api/me/friends/accept", { code: aCode })).body).toEqual({ status: "friends" });
    await call(a, "/api/me/inbox"); // "I am here"
    expect((await friends(b)).friends).toMatchObject([{ code: aCode, status: "online" }]);
    const room = await fetch(worker.url + "/api/rooms", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", authorization: "Bearer " + a }, body: JSON.stringify({ name: "x", maxPlayers: 3 }) });
    const seat = (await room.json()) as { code: string };
    expect((await call(a, `/api/rooms/${seat.code}/invite`, { friends: [bCode] })).body.results).toEqual({ [bCode]: "sent" });
    expect((await call(b, "/api/me/inbox")).body.invites).toHaveLength(1);
    await del(a);
    expect((await friends(b)).friends).toEqual([]);
    // SOC-1: `sent` (B's own sent invites) is part of the inbox; nothing about the deleted account remains
    expect((await call(b, "/api/me/inbox")).body).toEqual({ requests: 0, invites: [], sent: [] });
  });

  it("차단: 탈퇴하면 차단 목록에 '탈퇴한 사용자'로만 남고, 재가입해도 차단이 유지된다(차단 회피 불가)", async () => {
    const { a, b, aCode, bCode } = await pair("bl");
    await call(b, "/api/me/friends/block", { code: aCode });
    await del(a);
    const blocked = (await friends(b)).blocked;
    expect(blocked).toHaveLength(1);
    expect(blocked[0].nickname).toBe(FRIEND_LIMITS.deletedName);
    expect(blocked[0].code).not.toBe(aCode);
    expect(JSON.stringify(await friends(b))).not.toContain("bl에이");
    const a2 = await login("bl-a");
    expect((await call(a2, "/api/me/friends/request", { code: bCode })).body).toEqual({ status: "sent" }); // block not revealed
    expect((await call(b, "/api/me/inbox")).body.requests).toBe(0);
    expect((await call(b, "/api/me/friends/unblock", { code: blocked[0].code })).status).toBe(200);
    expect((await friends(b)).blocked).toEqual([]);
  });

  it("경합: 탈퇴와 동시에 상대가 요청을 수락해도 한쪽에만 남는 친구·요청이 없다(반복)", async () => {
    const outcomes: number[] = [];
    // > 0: the deletion starts that many ms after the accept; < 0: the accept starts after the deletion
    const delays = [-40, -15, -5, -1, 0, 1, 5, 15, 40];
    for (let i = 0; i < delays.length; i++) {
      const { a, b, aCode, bCode } = await pair("race" + i);
      await call(a, "/api/me/friends/request", { code: bCode });
      const wait = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
      const [, accepted] = await Promise.all([wait(delays[i]).then(() => del(a)), wait(-delays[i]).then(() => call(b, "/api/me/friends/accept", { code: aCode }))]);
      outcomes.push(accepted.status);
      expect([200, 404]).toContain(accepted.status);
      // the cleanup runs inline at deletion; allow a moment for an alarm retry, if any
      await new Promise((r) => setTimeout(r, 300));
      const lb = await friends(b);
      expect(lb.friends).toEqual([]);
      expect(lb.incoming).toEqual([]);
      const a2 = await login("race" + i + "-a");
      expect((await friends(a2)).friends).toEqual([]);
    }
    console.log("delete-vs-accept outcomes:", outcomes.join(","));
  }, 120_000);
});

describe("세션 (SEC-04, wrangler dev)", () => {
  it(`계정당 유효 세션 ${SESSION_CAP}개: 초과 로그인 때 가장 오래된 세션만 끝나고, 로그아웃·전체 로그아웃은 그대로`, async () => {
    const s: string[] = [];
    for (let i = 0; i <= SESSION_CAP; i++) s.push(await login("sess"));
    expect((await call(s[0], "/api/me")).status).toBe(401);
    for (const x of [s[1], s[10], s[SESSION_CAP]]) expect((await call(x, "/api/me")).status).toBe(200);
    expect((await call(s[SESSION_CAP], "/api/me/logout", {})).status).toBe(200);
    expect((await call(s[SESSION_CAP], "/api/me")).status).toBe(401);
    expect((await call(s[1], "/api/me")).status).toBe(200);
    expect((await call(s[1], "/api/me/logout-all", {})).status).toBe(200);
    for (const x of [s[1], s[10]]) expect((await call(x, "/api/me")).status).toBe(401);
    // sign-in again works after logout-all
    expect((await call(await login("sess"), "/api/me")).status).toBe(200);
  }, 120_000);
});
