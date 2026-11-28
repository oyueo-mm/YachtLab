import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startLocalWorker, type LocalWorker } from "./helpers/wrangler";
import { fakeLogin, startFakeIdp, type FakeIdp } from "./helpers/fake-idp";
import { Client, closeAllClients } from "./helpers/online-client";

/**
 * SEC-1-01 in the real Workers runtime (wrangler dev --local, fake local sign-in, loopback only):
 * with a device record of the same match id present, the server's own result, reward, review archive
 * and public totals are still stored — exactly once.
 */
const ORIGIN = "http://127.0.0.1:5173";
const ADMIN = "a".repeat(40);
let idp: FakeIdp;
let worker: LocalWorker;
beforeAll(async () => {
  idp = await startFakeIdp();
  worker = await startLocalWorker({ ALLOWED_ORIGINS: ORIGIN, TURN_TIMEOUT_MS: "0", CREATE_PER_MINUTE: "500", JOIN_PER_MINUTE: "500", GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret", AUTH_SECRET: "s".repeat(40), APP_URL: ORIGIN + "/YachtLab/", TEST_OIDC_ISSUER: idp.issuer, ECONOMY: "on", ADMIN_TOKEN: ADMIN });
}, 120_000);
afterAll(async () => {
  await worker?.stop();
  idp?.close();
});
afterEach(() => closeAllClients());

const call = async (session: string, path: string, body?: unknown) => {
  const r = await fetch(worker.url + path, { method: body === undefined ? "GET" : "POST", headers: { origin: ORIGIN, "content-type": "application/json", authorization: "Bearer " + session }, body: body === undefined ? undefined : JSON.stringify(body) });
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

describe("SEC-1-01 통합 (wrangler dev)", () => {
  it("같은 matchId의 기기 기록이 있어도 서버 결과·보상·복기·공개 전적이 한 번씩 저장된다", async () => {
    const a = await fakeLogin(worker.url, idp, "sec1-preempt-a", ORIGIN);
    const b = await fakeLogin(worker.url, idp, "sec1-preempt-b", ORIGIN);
    const userId = (await call(a, "/api/me")).body.profile.userId as string;
    const create = await call(a, "/api/rooms", { name: "기록A", maxPlayers: 2 });
    const joined = await call(b, "/api/rooms/" + create.body.code + "/join", { name: "기록B" });
    const ca = new Client(worker.url, create.body.code);
    const cb = new Client(worker.url, create.body.code);
    await ca.hello(create.body.token);
    await cb.hello(joined.body.token);
    expect((await ca.cmd({ type: "start" })).ok).toBe(true);
    await ca.settled();
    const matchId = ca.view!.matchId!;
    const now = Date.now();
    const claimed = { recordId: matchId, mode: "online", rules: "yacht12@1", startedAt: now - 1000, endedAt: now, name: "기록A", card: { aces: 0 }, score: 0, outcome: "draw", endReason: "completed", opponent: { name: "기록B", kind: "guest", score: 0 } };
    expect((await call(a, "/api/me/import", { records: [claimed] })).body).toEqual({ added: 1, skipped: 0 });
    await playOut([ca, cb]);
    expect(ca.view?.status).toBe("finished");
    await expect.poll(async () => (await call(a, `/api/me/records/${matchId}/reward`)).status, { timeout: 10_000, interval: 500 }).toBe(200);
    const records = (await call(a, "/api/me/records")).body.records.filter((r: { recordId: string }) => r.recordId === matchId);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ source: "server", verification: "server-verified" });
    expect((await call(a, `/api/me/records/${matchId}/review`)).body.review.steps).toHaveLength(24);
    const ledger = (await call(a, "/api/me/economy")).body.snapshot.ledger.filter((row: { id: string }) => row.id === `m:${matchId}`);
    expect(ledger).toHaveLength(1);
    expect((await call(a, `/api/profiles/${userId}`)).body.online.games).toBe(1);
    // the opponent's copy is unaffected, a second upload changes nothing, and the ledger still adds up
    expect((await call(b, "/api/me/records")).body.records.filter((r: { recordId: string }) => r.recordId === matchId)).toHaveLength(1);
    expect((await call(a, "/api/me/import", { records: [claimed] })).body).toEqual({ added: 0, skipped: 1 });
    expect((await call(ADMIN, `/api/admin/ledger/${userId}`)).body.ok).toBe(true);
  }, 40_000);
});
