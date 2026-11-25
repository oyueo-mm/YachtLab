import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startLocalWorker, type LocalWorker } from "./helpers/wrangler";
import { fakeLogin, startFakeIdp, type FakeIdp } from "./helpers/fake-idp";
import { Client, closeAllClients } from "./helpers/online-client";

/**
 * Friends & invites in the real Workers runtime (wrangler dev --local: UserStore + the new FriendIndex
 * SQLite object, migration v4) with a FAKE local sign-in (loopback only, never in production).
 */
const ORIGIN = "http://127.0.0.1:5173";
let worker: LocalWorker;
let idp: FakeIdp;
beforeAll(async () => {
  idp = await startFakeIdp();
  worker = await startLocalWorker({ ALLOWED_ORIGINS: ORIGIN, TURN_TIMEOUT_MS: "0", CREATE_PER_MINUTE: "500", JOIN_PER_MINUTE: "500", GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret", AUTH_SECRET: "s".repeat(40), APP_URL: ORIGIN + "/YachtLab/", TEST_OIDC_ISSUER: idp.issuer, ECONOMY: "on" });
}, 120_000);
afterAll(async () => {
  closeAllClients();
  await worker?.stop();
  idp?.close();
});
const call = async (session: string | null, path: string, body?: unknown, method?: string) => {
  const r = await fetch(worker.url + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { origin: ORIGIN, "content-type": "application/json", ...(session ? { authorization: "Bearer " + session } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> };
};

describe("친구·초대 (wrangler dev + 가짜 로컬 로그인)", () => {
  it("코드 요청 → 수락 → 접속 상태 → 친구 방 초대 → 초대 수락으로 회원 좌석 입장 → 경기 중 표시, 게스트는 친구 API 불가", async () => {
    const a = await fakeLogin(worker.url, idp, "fw-a", ORIGIN);
    const b = await fakeLogin(worker.url, idp, "fw-b", ORIGIN);
    await call(a, "/api/me/nickname", { nickname: "에이" });
    await call(b, "/api/me/nickname", { nickname: "비" });
    expect((await call(null, "/api/me/friends")).status).toBe(401);
    const bCode = (await call(b, "/api/me/friends")).body.me.code as string;
    expect(bCode).toMatch(/^YL[0-9A-Z]{8}$/);
    // exact nickname search works, partial does not
    expect((await call(a, "/api/me/friends/search", { query: "비" })).body.results).toEqual([{ code: bCode, nickname: "비", relation: "none" }]);
    expect((await call(a, "/api/me/friends/search", { query: "비비" })).body.results).toEqual([]);
    expect((await call(a, "/api/me/friends/request", { code: bCode })).body).toEqual({ status: "sent" });
    const aCode = (await call(a, "/api/me/friends")).body.me.code as string;
    expect((await call(b, "/api/me/inbox")).body.requests).toBe(1);
    expect((await call(b, "/api/me/friends/accept", { code: aCode })).body).toEqual({ status: "friends" });
    const list = await call(a, "/api/me/friends");
    expect(list.body.friends).toMatchObject([{ code: bCode, nickname: "비", status: "online" }]); // B checked the inbox
    expect(JSON.stringify(list.body)).not.toMatch(/u_[A-Za-z0-9_-]{22}/);

    // A opens a 3-seat friend room and invites B
    const room = await fetch(worker.url + "/api/rooms", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", authorization: "Bearer " + a }, body: JSON.stringify({ name: "x", maxPlayers: 3 }) });
    const seatA = (await room.json()) as { code: string; token: string };
    // B is not in that room: cannot invite from it
    expect((await call(b, `/api/rooms/${seatA.code}/invite`, { friends: [aCode] })).status).toBe(409);
    expect((await call(a, `/api/rooms/${seatA.code}/invite`, { friends: [bCode] })).body.results).toEqual({ [bCode]: "sent" });
    expect((await call(a, `/api/rooms/${seatA.code}/invite`, { friends: [bCode] })).body.results).toEqual({ [bCode]: "recent" });
    const inv = (await call(b, "/api/me/inbox")).body.invites;
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ from: { nickname: "에이", code: aCode }, room: seatA.code });
    const joined = await call(b, "/api/me/invites/accept", { id: inv[0].id });
    expect(joined.status).toBe(201);
    expect(joined.body.code).toBe(seatA.code);
    // B sits in the room with the account nickname; the invite is gone
    expect((await call(null, `/api/rooms/${seatA.code}`)).body.players).toEqual(["에이", "비"]);
    expect((await call(b, "/api/me/invites/accept", { id: inv[0].id })).status).toBe(404);
    // start the match: friends see "경기 중"
    const ca = new Client(worker.url, seatA.code);
    const cb = new Client(worker.url, seatA.code);
    await ca.hello(seatA.token);
    await cb.hello(joined.body.token);
    cb.ws.send(JSON.stringify({ t: "ready", ready: true }));
    await new Promise((r) => setTimeout(r, 300));
    expect((await ca.cmd({ type: "start" })).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect((await call(b, "/api/me/friends")).body.friends[0].status).toBe("playing");
    // invites to a started room are refused
    expect((await call(a, `/api/rooms/${seatA.code}/invite`, { friends: [bCode] })).body.error.code).toBe("INVITE_STARTED");
  }, 90_000);
});
