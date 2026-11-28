import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startLocalWorker, type LocalWorker } from "./helpers/wrangler";
import { fakeLogin, startFakeIdp, type FakeIdp } from "./helpers/fake-idp";
import { Client, closeAllClients } from "./helpers/online-client";

/**
 * SOC-1 + SEC-1 in the real Workers runtime (wrangler dev --local, FAKE loopback sign-in, never production):
 * friend code at sign-in, relation / request by account id (room members), central presence per tab,
 * direct challenge with duplicate / decline, pins validation, blocks on the public profile and search,
 * request body limits checked before reading.
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
const call = async (session: string | null, path: string, body?: unknown, method?: string, headers: Record<string, string> = {}) => {
  const r = await fetch(worker.url + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { origin: ORIGIN, "content-type": "application/json", ...(session ? { authorization: "Bearer " + session } : {}), ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> };
};

describe("SOC-1 소셜 (wrangler dev + 가짜 로컬 로그인)", () => {
  it("로그인 시 친구 코드 자동 등록 → 방 상대에게 계정 ID로 요청 → 탭별 접속 상태 → 대전 신청 중복·거절 → 대표 업적 검증 → 차단 반영", async () => {
    const features = (await call(null, "/api/features")).body;
    expect(features).toMatchObject({ lobbyWatch: true, social: true });
    const a = await fakeLogin(worker.url, idp, "soc-a", ORIGIN);
    const b = await fakeLogin(worker.url, idp, "soc-b", ORIGIN);
    await call(a, "/api/me/nickname", { nickname: "소셜에이" });
    await call(b, "/api/me/nickname", { nickname: "소셜비" });
    // b never opened the friend page: the code made at sign-in is already searchable (nickname kept in step)
    const found = (await call(a, "/api/me/friends/search", { query: "소셜비" })).body.results;
    expect(found).toHaveLength(1);
    const bCode = found[0].code as string;

    // a and b in one friend room: a learns b's account id from the room (members), never from a nickname
    const room = await call(a, "/api/rooms", { name: "x", maxPlayers: 2 });
    const joined = await call(b, `/api/rooms/${room.body.code}/join`, { name: "y" });
    expect(joined.status).toBe(201);
    const ca = new Client(worker.url, room.body.code);
    const welcome = (await ca.hello(room.body.token)) as any;
    const members = welcome.members as Record<string, string>;
    const bUser = Object.entries(members).find(([pid]) => pid !== welcome.playerId)![1];
    expect(bUser).toMatch(/^u_/);
    // not shown without the room (no record of a match yet)
    expect((await call(a, `/api/me/friends/relation?userId=${bUser}`)).status).toBe(404);
    const rel = await call(a, `/api/me/friends/relation?userId=${bUser}&room=${room.body.code}`);
    expect(rel.body).toEqual({ relation: "none", code: bCode, nickname: "소셜비" });
    expect((await call(a, "/api/me/friends/request", { userId: bUser, room: room.body.code })).body).toEqual({ status: "sent" });
    const aCode = (await call(a, "/api/me/friends")).body.me.code;
    expect((await call(b, "/api/me/friends/accept", { code: aCode })).body).toEqual({ status: "friends" });

    // presence per tab: two tabs, one says goodbye → still online; both → offline
    await call(b, "/api/me/inbox?device=tab-one-aaaa");
    await call(b, "/api/me/inbox?device=tab-two-bbbb");
    expect((await call(a, "/api/me/friends")).body.friends[0].status).toBe("online");
    await call(b, "/api/me/presence", { device: "tab-one-aaaa", state: "offline" });
    expect((await call(a, "/api/me/friends")).body.friends[0].status).toBe("online");
    await call(b, "/api/me/presence", { device: "tab-two-bbbb", state: "offline" });
    expect((await call(a, "/api/me/friends")).body.friends[0].status).toBe("offline");
    expect(JSON.stringify((await call(a, "/api/me/friends")).body)).not.toContain(room.body.code);

    // direct challenge: a new 1:1 room + invite; a repeat returns the same pending challenge
    const ch = await call(a, "/api/me/friends/challenge", { code: bCode });
    expect(ch.status).toBe(201);
    expect(ch.body.code).toMatch(/^[A-Z2-9]{6}$/);
    const again = await call(a, "/api/me/friends/challenge", { code: bCode });
    expect(again.body.status).toBe("pending");
    expect(again.body.invite.room).toBe(ch.body.code);
    const inv = (await call(b, "/api/me/inbox")).body.invites;
    expect(inv.map((i: any) => i.room)).toContain(ch.body.code);
    const mine = inv.find((i: any) => i.room === ch.body.code);
    expect((await call(b, "/api/me/invites/decline", { id: mine.id })).body).toEqual({ ok: true });
    expect((await call(a, "/api/me/inbox")).body.sent.find((s: any) => s.id === mine.id).state).toBe("declined");
    expect((await call(b, "/api/me/invites/decline", { id: "../../x" })).status).toBe(400);

    // pins: only earned achievements (a new account has none)
    expect((await call(a, "/api/me/profile/pins", { ids: ["a.match.10"] }, "PUT")).body.error.code).toBe("PINS_NOT_EARNED");
    expect((await call(a, "/api/me/profile/pins")).body).toMatchObject({ pins: [], visibility: "public" });

    // blocks (SEC-1): b blocks a → a's signed-in public-profile view, search and friend profile hide b;
    // an anonymous visitor still sees the public profile (no session to block)
    expect((await call(a, `/api/profiles/${bUser}`)).status).toBe(200);
    expect((await call(b, "/api/me/friends/block", { code: aCode })).body).toEqual({ ok: true });
    const blocked = await call(a, `/api/profiles/${bUser}`);
    expect(blocked.status).toBe(404);
    expect(blocked.body.error.message).toBe("프로필을 찾을 수 없어요.");
    expect((await call(null, `/api/profiles/${bUser}`)).status).toBe(200);
    expect((await call(a, "/api/me/friends/search", { query: "소셜비" })).body.results).toEqual([]);
    expect((await call(a, `/api/me/friends/profile?code=${bCode}`)).status).toBe(404);
    expect((await call(a, `/api/me/friends/relation?userId=${bUser}&room=${room.body.code}`)).body.relation).toBe("none");
    // a request to the blocker looks sent, stores nothing
    expect((await call(a, "/api/me/friends/request", { userId: bUser, room: room.body.code })).body).toEqual({ status: "sent" });
    expect((await call(b, "/api/me/friends")).body.incoming).toEqual([]);
    expect((await call(a, "/api/me/friends")).body.friends).toEqual([]);
  }, 90_000);

  it("요청 본문 크기는 읽기 전에 검사한다(선언된 길이·실제 바이트), 잘못된 입력은 400", async () => {
    const a = await fakeLogin(worker.url, idp, "soc-c", ORIGIN);
    const big = JSON.stringify({ query: "x".repeat(5000) });
    expect((await call(a, "/api/me/friends/search", big)).status).toBe(400);
    expect((await call(a, "/api/rooms", JSON.stringify({ name: "y".repeat(2000) }))).status).toBe(400);
    expect((await call(a, "/api/me/presence", { device: "no", state: "offline" })).status).toBe(400);
    expect((await call(a, "/api/me/friends/settings", { presence: "everyone" })).status).toBe(400);
    expect((await call(a, "/api/me/friends/relation?userId=nobody")).status).toBe(400);
    expect((await call(a, "/api/me/friends/request", { userId: 42 })).status).toBe(400);
    expect((await call(a, "/api/me/profile/pins", { ids: "x" }, "PUT")).status).toBe(400);
    expect((await call(a, "/api/me/friends/challenge", { code: "nope" })).status).toBe(400);
    // a normal small body still works
    expect((await call(a, "/api/me/friends/settings", { presence: "hidden" })).body.settings.presence).toBe("hidden");
  }, 60_000);
});
