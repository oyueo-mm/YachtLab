import { afterAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { startLocalWorker, type LocalWorker } from "./helpers/wrangler";
import { startFakeIdp, type FakeIdp } from "./helpers/fake-idp";

/**
 * C4.2 upgrade check: state written by the PREVIOUS Worker code is served by THIS code — accounts, valid
 * sessions, friendships, pending requests, blocks and invites survive the switch, and the new deletion
 * cleanup works on that older data. Both Workers run locally (`wrangler dev --local`) on the SAME
 * persisted Durable Object storage, one after the other. Nothing touches a deployed Worker.
 *
 * Needs a checkout of the base version with its own node_modules (it is not part of the default CI run):
 *
 *   git worktree add ../yl-base origin/main && (cd ../yl-base && npm ci)
 *   YL_UPGRADE_BASE=../yl-base npx vitest run tests/account-upgrade-worker.test.ts
 */
const BASE = process.env.YL_UPGRADE_BASE;
const ORIGIN = "http://127.0.0.1:5173";
const VARS = { ALLOWED_ORIGINS: ORIGIN, TURN_TIMEOUT_MS: "0", CREATE_PER_MINUTE: "500", JOIN_PER_MINUTE: "500", GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret", AUTH_SECRET: "s".repeat(40), APP_URL: ORIGIN + "/YachtLab/" };

let idp: FakeIdp | undefined;
let running: LocalWorker | undefined;
afterAll(async () => {
  await running?.stop();
  idp?.close();
});

describe.skipIf(!BASE)("이전 Worker → C4.2 Worker 전환 시 계정·세션·친구 데이터 보존", () => {
  it("이전 코드가 만든 세션·친구·요청·차단·초대가 그대로 동작하고, 새 탈퇴 정리가 이전 데이터에도 적용된다", async () => {
    idp = await startFakeIdp();
    const vars = { ...VARS, TEST_OIDC_ISSUER: idp.issuer };
    const old = (await import(join(BASE!, "tests/helpers/wrangler.ts"))) as { startLocalWorker: typeof startLocalWorker };
    running = await old.startLocalWorker(vars);
    const persistDir = running.persistDir;
    let ip = 0;
    const login = async (sub: string) => {
      const headers = { "cf-connecting-ip": "10.1.0." + (++ip % 250) };
      idp!.next(sub);
      const cs = "client-state-" + sub.padEnd(30, "x");
      const hash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cs))).toString("base64url");
      const start = await fetch(running!.url + "/auth/google/start?cs=" + hash, { redirect: "manual", headers });
      const cookie = start.headers.get("set-cookie")!.split(";")[0];
      const auth = await fetch(start.headers.get("location")!, { redirect: "manual" });
      const back = await fetch(auth.headers.get("location")!, { redirect: "manual", headers: { cookie, ...headers } });
      const code = decodeURIComponent(new URL(back.headers.get("location")!).hash.slice("#login=".length));
      const ex = await (await fetch(running!.url + "/api/auth/exchange", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", ...headers }, body: JSON.stringify({ code, clientState: cs }) })).json();
      return ex.session as string;
    };
    const call = async (session: string | null, path: string, body?: unknown) => {
      const r = await fetch(running!.url + path, { method: body === undefined ? "GET" : "POST", headers: { origin: ORIGIN, "content-type": "application/json", ...(session ? { authorization: "Bearer " + session } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> };
    };
    const friends = async (s: string) => (await call(s, "/api/me/friends")).body;

    /* ---------------- previous Worker: build ordinary member data ---------------- */
    const [a, b, c, d, e] = [await login("up-a"), await login("up-b"), await login("up-c"), await login("up-d"), await login("up-e")];
    const a2nd = await login("up-a"); // a second device of A
    for (const [s, n] of [[a, "업에이"], [b, "업비"], [c, "업씨"], [d, "업디"], [e, "업이"]] as const) await call(s, "/api/me/nickname", { nickname: n });
    const code = Object.fromEntries(await Promise.all(([["a", a], ["b", b], ["c", c], ["d", d], ["e", e]] as const).map(async ([k, s]) => [k, (await friends(s)).me.code as string])));
    await call(a, "/api/me/friends/request", { code: code.b });
    expect((await call(b, "/api/me/friends/accept", { code: code.a })).body).toEqual({ status: "friends" });
    await call(e, "/api/me/friends/request", { code: code.b });
    expect((await call(b, "/api/me/friends/accept", { code: code.e })).body).toEqual({ status: "friends" });
    await call(c, "/api/me/friends/request", { code: code.b }); // pending
    await call(b, "/api/me/friends/block", { code: code.d }); // block (no reverse index in old data)
    const room = await fetch(running.url + "/api/rooms", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", authorization: "Bearer " + a }, body: JSON.stringify({ name: "x", maxPlayers: 3 }) });
    const seat = (await room.json()) as { code: string };
    expect((await call(a, `/api/rooms/${seat.code}/invite`, { friends: [code.b] })).body.results).toEqual({ [code.b]: "sent" });
    const beforeB = await friends(b);
    const beforeMe = await Promise.all([a, b, c, d, e].map(async (s) => (await call(s, "/api/me")).body));
    await running.stop();

    /* ---------------- this Worker on the same storage ---------------- */
    running = await startLocalWorker(vars, { persistDir });
    // every session issued by the previous Worker is still valid; profiles unchanged
    for (const [i, s] of [a, b, c, d, e].entries()) {
      const me = await call(s, "/api/me");
      expect(me.status).toBe(200);
      expect(me.body).toEqual(beforeMe[i]);
    }
    expect((await call(a2nd, "/api/me")).status).toBe(200);
    // friend lists exactly as before (same codes, friendships, pending, block)
    const afterB = await friends(b);
    // INT-1: SOC-1 adds response fields (me.settings, presence) — everything the previous Worker stored is unchanged
    const { presence: _p, ...afterRest } = afterB;
    const { settings: _s, ...afterMe } = afterB.me;
    expect({ ...afterRest, me: afterMe, friends: afterB.friends.map((f: { status: string }) => ({ ...f, status: "-" })) }).toEqual({ ...beforeB, friends: beforeB.friends.map((f: { status: string }) => ({ ...f, status: "-" })) });
    expect(afterB.friends.map((f: { code: string }) => f.code).sort()).toEqual([code.a, code.e].sort());
    // presence between existing friends, the invite made by the previous Worker, a pending request
    await call(a, "/api/me/inbox");
    expect((await friends(b)).friends.find((f: { code: string }) => f.code === code.a).status).toBe("online");
    expect((await call(b, "/api/me/inbox")).body.invites).toHaveLength(1);
    expect((await call(b, "/api/me/friends/accept", { code: code.c })).body).toEqual({ status: "friends" });
    // logout of one device keeps the other
    expect((await call(a2nd, "/api/me/logout", {})).status).toBe(200);
    expect((await call(a2nd, "/api/me")).status).toBe(401);
    expect((await call(a, "/api/me")).status).toBe(200);

    // the new deletion cleanup on data written by the previous Worker
    expect((await call(a, "/api/me/delete", { confirm: "DELETE" })).status).toBe(200);
    const afterDel = await friends(b);
    expect(afterDel.friends.map((f: { code: string }) => f.code).sort()).toEqual([code.c, code.e].sort());
    expect((await call(b, "/api/me/inbox")).body.invites).toEqual([]);
    // known limitation (documented): a block made by the previous Worker has no reverse index, so the
    // blocked account's deletion cannot reach it; the residue check (approval) is the path for it
    expect((await call(d, "/api/me/delete", { confirm: "DELETE" })).status).toBe(200);
    // (a base that already has the C4.2 reverse index — e.g. main d775ecb — anonymises it instead: both are safe)
    const leftBlock = (await friends(b)).blocked as { code: string; nickname: string }[];
    expect(leftBlock).toHaveLength(1);
    expect(leftBlock[0].nickname === "탈퇴한 사용자" || (leftBlock[0].code === code.d && leftBlock[0].nickname === "업디")).toBe(true);
    // a block made by THIS Worker is anonymised on deletion
    await call(b, "/api/me/friends/unblock", { code: leftBlock[0].code });
    await call(b, "/api/me/friends/block", { code: code.e });
    expect((await call(e, "/api/me/delete", { confirm: "DELETE" })).status).toBe(200);
    expect((await friends(b)).blocked.map((x: { nickname: string }) => x.nickname)).toEqual(["탈퇴한 사용자"]);
    // re-join after the switch: same id, new code, no friends
    const a3 = await login("up-a");
    expect(a3.split(".")[1]).toBe(a.split(".")[1]);
    expect((await friends(a3)).me.code).not.toBe(code.a);
    expect((await friends(a3)).friends).toEqual([]);
    // logout-all still ends every session
    expect((await call(b, "/api/me/logout-all", {})).status).toBe(200);
    expect((await call(b, "/api/me")).status).toBe(401);
  }, 240_000);
});
