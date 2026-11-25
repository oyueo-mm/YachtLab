import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import WebSocket from "ws";
import { b64url } from "../worker/src/oidc";
import { authConfig } from "../worker/src/accounts-api";
import { Client, closeAllClients } from "./helpers/online-client";
import { startLocalWorker, type LocalWorker } from "./helpers/wrangler";

/**
 * Phase 4.5–6 end to end in the real Workers runtime (wrangler dev --local): sign-in through a FAKE
 * local identity provider → quick match between two members → 12 rounds → server-verified records →
 * coins/quests/achievements in the ledger → shop, duplicate requests, insufficient balance, equip
 * validation → the look reaches the next opponent → server AI match → delete + re-join (no second
 * welcome). The fake provider is only accepted for a loopback APP_URL (never in production).
 */
const ORIGIN = "http://127.0.0.1:5173";
const ADMIN = "a".repeat(40);
let idp: Server;
let issuer = "";
let worker: LocalWorker;
const codes = new Map<string, { sub: string; nonce: string }>();
let keys: CryptoKeyPair;
let jwk: JsonWebKey;

async function sign(claims: Record<string, unknown>) {
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const head = enc({ alg: "RS256", kid: "k1", typ: "JWT" }) + "." + enc(claims);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(head)));
  return head + "." + b64url(sig);
}

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  jwk = (await crypto.subtle.exportKey("jwk", keys.publicKey)) as JsonWebKey;
  idp = createServer(async (req, res) => {
    if (req.url === "/jwks") return res.end(JSON.stringify({ keys: [{ ...jwk, kid: "k1", alg: "RS256", use: "sig" }] }));
    if (req.url === "/token") {
      let body = "";
      for await (const c of req) body += c;
      const code = new URLSearchParams(body).get("code")!;
      const who = codes.get(code)!;
      const now = Math.floor(Date.now() / 1000);
      return res.end(JSON.stringify({ id_token: await sign({ iss: issuer, aud: "test-client", sub: who.sub, iat: now, exp: now + 300, nonce: who.nonce }) }));
    }
    res.statusCode = 404;
    res.end();
  });
  // Port 0: the OS picks a free port atomically (no window where another server can take it).
  await new Promise<void>((resolve) => idp.listen(0, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${(idp.address() as { port: number }).port}`;
  worker = await startLocalWorker({
    ALLOWED_ORIGINS: ORIGIN,
    TURN_TIMEOUT_MS: "0",
    CREATE_PER_MINUTE: "500",
    JOIN_PER_MINUTE: "500",
    GOOGLE_CLIENT_ID: "test-client",
    GOOGLE_CLIENT_SECRET: "test-secret",
    AUTH_SECRET: "s".repeat(40),
    APP_URL: ORIGIN + "/YachtLab/",
    TEST_OIDC_ISSUER: issuer,
    ECONOMY: "on",
    ADMIN_TOKEN: ADMIN,
  });
}, 120_000);
afterAll(async () => {
  await worker?.stop();
  idp?.close();
});
afterEach(() => closeAllClients());

/** Full sign-in: start → (provider) → callback → one-time code → session. */
async function login(sub: string): Promise<{ session: string; userId: string }> {
  const cs = "client-state-" + sub.padEnd(30, "x");
  const csHash = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cs))));
  const start = await fetch(worker.url + "/auth/google/start?cs=" + csHash, { redirect: "manual" });
  const to = new URL(start.headers.get("location")!);
  const cookie = start.headers.get("set-cookie")!.split(";")[0];
  const code = "code-" + sub + "-" + Math.random().toString(36).slice(2);
  codes.set(code, { sub, nonce: to.searchParams.get("nonce")! });
  const back = await fetch(worker.url + `/auth/google/callback?state=${to.searchParams.get("state")}&code=${code}`, { redirect: "manual", headers: { cookie } });
  const hash = new URL(back.headers.get("location")!).hash;
  expect(hash.startsWith("#login=")).toBe(true);
  const ex = await (await fetch(worker.url + "/api/auth/exchange", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ code: decodeURIComponent(hash.slice(7)), clientState: cs }) })).json();
  return { session: ex.session, userId: ex.profile.userId };
}
const call = async (session: string, path: string, body?: unknown) => {
  const r = await fetch(worker.url + path, { method: body === undefined ? "GET" : "POST", headers: { origin: ORIGIN, "content-type": "application/json", authorization: "Bearer " + session }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> };
};
function queue(session: string | null, name: string, n: number) {
  return new Promise<Record<string, any>>((resolve, reject) => {
    const ws = new WebSocket(worker.url.replace("http", "ws") + "/ws/match", { origin: ORIGIN });
    const timer = setTimeout(() => reject(new Error("no match")), 10_000);
    ws.on("open", () => ws.send(JSON.stringify({ t: "queue", name, ticket: ("ticket" + n + Date.now()).padEnd(30, "t"), device: ("device" + n).padEnd(30, "d"), ...(session ? { session } : {}) })));
    ws.on("message", (d) => {
      const m = JSON.parse(d.toString());
      if (m.t === "matched" || m.t === "error") {
        clearTimeout(timer);
        resolve(m);
      }
    });
  });
}
async function playOut(clients: Client[]) {
  for (let guard = 0; guard < 200; guard++) {
    await new Promise((r) => setTimeout(r, 30));
    const views = clients.map((c) => c.view!);
    if (views.some((v) => v?.status === "finished")) return;
    const current = clients.find((c) => c.view?.legal);
    if (!current) continue;
    if (current.view!.turn!.rolls === 0) await current.cmd({ type: "roll", keep: [] });
    else {
      const best = [...current.view!.legal!.scores].sort((x, y) => y.points - x.points)[0];
      await current.cmd({ type: "score", category: best.category });
    }
  }
}

describe("경제 통합 시나리오 (wrangler dev + 가짜 로컬 로그인)", () => {
  it("배포 환경(https APP_URL)에서는 테스트용 로그인 제공자를 절대 받지 않는다", () => {
    const cfg = authConfig({ GOOGLE_CLIENT_ID: "x", GOOGLE_CLIENT_SECRET: "y", AUTH_SECRET: "z".repeat(40), APP_URL: "https://oyueo-mm.github.io/YachtLab/", TEST_OIDC_ISSUER: "http://127.0.0.1:9999" });
    expect(cfg?.provider.tokenEndpoint).toBe("https://oauth2.googleapis.com/token");
  });

  it("회원 복기는 완료된 본인 전적에서만 읽고 일반 목록과 분리한다", async () => {
    const a = await login("review-alice");
    const b = await login("review-bob");
    const outsider = await login("review-outsider");
    const create = await call(a.session, "/api/rooms", { name: "복기A", maxPlayers: 2 });
    expect(create.status).toBe(201);
    const code = create.body.code;
    const joined = await call(b.session, "/api/rooms/" + code + "/join", { name: "복기B" });
    expect(joined.status).toBe(201);
    const ca = new Client(worker.url, code);
    const cb = new Client(worker.url, code);
    await ca.hello(create.body.token);
    await cb.hello(joined.body.token);
    expect((await ca.cmd({ type: "start" })).ok).toBe(true);
    await ca.settled();
    const reviewPath = `/api/me/records/${ca.view!.matchId}/review`;
    expect((await call(a.session, reviewPath)).status).toBe(404);
    await playOut([ca, cb]);
    await new Promise((resolve) => setTimeout(resolve, 800));
    const archived = await call(a.session, reviewPath);
    expect(archived.status).toBe(200);
    expect(archived.body.review).toMatchObject({ id: ca.view!.matchId, players: ["복기A", "복기B"], steps: expect.any(Array) });
    expect(archived.body.review.steps).toHaveLength(24);
    expect(JSON.stringify(archived.body.review)).not.toMatch(/userId|playerId|rng|seed|token/);
    expect((await call(a.session, "/api/me/records")).body.records[0]).not.toHaveProperty("review");
    expect((await call(b.session, reviewPath)).body).toEqual(archived.body);
    expect((await call(outsider.session, reviewPath)).status).toBe(404);
    expect((await fetch(worker.url + reviewPath, { headers: { origin: ORIGIN } })).status).toBe(401);
  });

  it("로그인 → 회원 빠른 대전 12라운드 → 서버 기록·코인·퀘스트 → 상점·중복 요청·잔액 부족·장착 검증 → 다음 상대에게 표시 → 서버 AI 대전 → 탈퇴·재가입", async () => {
    const a = await login("alice");
    const b = await login("bob");
    // first economy access: new-member grant once
    const e0 = await call(a.session, "/api/me/economy");
    expect((await fetch(worker.url + "/api/me/shop/draw", { headers: { origin: ORIGIN } })).status).toBe(401);
    expect((await call(a.session, "/api/me/shop/draw")).body.draw).toMatchObject({ remaining: 5, history: [] });
    expect((await call(a.session, "/api/me/shop/draw", { pool: "standard", requestId: "not-enough-coins" })).status).toBe(402);
    const fullReroll = { index: "all", period: "weekly", expected: e0.body.snapshot.state.week };
    const replacements = await Promise.all([call(a.session, "/api/me/quests/reroll", fullReroll), call(a.session, "/api/me/quests/reroll", fullReroll)]);
    expect(replacements.map((result) => result.status).sort()).toEqual([200, 400]);
    expect(e0.body.snapshot.wallet).toEqual({ coins: 200, gems: 20 });
    expect((await call(a.session, "/api/me/economy")).body.snapshot.wallet).toEqual({ coins: 200, gems: 20 });

    // quick match between the two members. A member's seat always shows the account nickname, whatever
    // name the page sends (D-045: one nickname, edited on the profile page).
    expect((await call(a.session, "/api/me/nickname", { nickname: "앨리스" })).status).toBe(200);
    const [ma, mb] = await Promise.all([queue(a.session, "다른이름", 1), queue(b.session, "밥", 2)]);
    expect(ma.code).toBe(mb.code);
    const ca = new Client(worker.url, ma.code);
    const cb = new Client(worker.url, mb.code);
    await ca.hello(ma.token);
    await cb.hello(mb.token);
    expect(ca.view!.players.map((p) => p.name)).toContain("앨리스");
    expect(ca.view!.players.map((p) => p.name)).not.toContain("다른이름");
    // friend room: the same rule for create / join
    const own = await fetch(worker.url + "/api/rooms", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", authorization: "Bearer " + a.session }, body: JSON.stringify({ name: "또다른이름" }) });
    const ownRoom = (await own.json()) as { code: string };
    expect(((await (await fetch(worker.url + "/api/rooms/" + ownRoom.code, { headers: { origin: ORIGIN } })).json()) as { players: string[] }).players).toEqual(["앨리스"]);
    await playOut([ca, cb]);
    await new Promise((r) => setTimeout(r, 800)); // outbox delivery
    const recA = (await call(a.session, "/api/me/records")).body.records[0];
    expect(recA).toMatchObject({ kind: "random", verification: "server-verified", recordId: ca.view!.matchId });
    const ea = (await call(a.session, "/api/me/economy")).body.snapshot;
    const matchRow = ea.ledger.find((l: { id: string }) => l.id === "m:" + ca.view!.matchId);
    // 10 completion (+3 win / +2 draw) + 5 new-member boost
    expect([15, 17, 18]).toContain(matchRow.coins);
    expect(ea.state.counters.match).toBe(1);
    const receiptPath = `/api/me/records/${ca.view!.matchId}/reward`;
    const receipt = await call(a.session, receiptPath);
    expect(receipt.status).toBe(200);
    expect(receipt.body.receipt).toMatchObject({
      before: e0.body.snapshot.wallet,
      after: ea.wallet,
      grants: expect.arrayContaining([expect.objectContaining({ kind: "match", coins: matchRow.coins })]),
    });
    expect(receipt.body.receipt.quests.every((row: { previous: number; progress: number }) => row.previous < row.progress)).toBe(true);
    expect((await call(a.session, receiptPath)).body).toEqual(receipt.body);
    expect((await call(a.session, "/api/me/economy")).body.snapshot.wallet).toEqual(ea.wallet);
    expect((await fetch(worker.url + receiptPath, { headers: { origin: ORIGIN } })).status).toBe(401);
    const ledgerCheck = await (await fetch(worker.url + "/api/admin/ledger/" + a.userId, { headers: { authorization: "Bearer " + ADMIN } })).json();
    expect(ledgerCheck).toMatchObject({ ok: true, problems: [] });
    expect((await fetch(worker.url + "/api/admin/metrics")).status).toBe(404); // no admin token → hidden

    // earn enough by playing (no test grants exist): Alice vs fresh guests until she has 500 coins
    for (let i = 0; i < 20; i++) {
      const coins = (await call(a.session, "/api/me/economy")).body.snapshot.wallet.coins;
      if (coins >= 500) break;
      const [x, y] = await Promise.all([queue(a.session, "앨리스", 100 + i), queue(null, "손님" + i, 200 + i)]);
      const cx = new Client(worker.url, x.code);
      const cy = new Client(worker.url, y.code);
      await cx.hello(x.token);
      await cy.hello(y.token);
      await playOut([cx, cy]);
      await new Promise((r) => setTimeout(r, 300));
    }
    // shop: insufficient, achievement-only, then a purchase with a retried request id
    expect((await call(a.session, "/api/me/shop/buy", { itemId: "dice.royal", currency: "coins", requestId: "req-royal-1" })).body.error.code).toBe("INSUFFICIENT");
    expect((await call(a.session, "/api/me/shop/buy", { itemId: "title.300", currency: "coins", requestId: "req-title-1" })).body.error.code).toBe("NOT_FOR_SALE");
    const buy1 = await call(a.session, "/api/me/shop/buy", { itemId: "emote.fire", currency: "coins", requestId: "req-fire-001" });
    const buy2 = await call(a.session, "/api/me/shop/buy", { itemId: "emote.fire", currency: "coins", requestId: "req-fire-001" });
    expect(buy1.status).toBe(200);
    expect(buy2.body.duplicate).toBe(true);
    expect(buy2.body.snapshot.wallet.coins).toBe(buy1.body.snapshot.wallet.coins);
    // upgrade costs coins even for a gem item
    const up = await call(a.session, "/api/me/shop/upgrade", { itemId: "emote.fire", requestId: "req-up-0001" });
    expect(up.body.snapshot.inventory.find((i: { id: string }) => i.id === "emote.fire").level).toBe(2);
    // equip: forged items / too many / locked level are refused; a valid loadout is saved
    const lo = up.body.snapshot.loadout;
    expect((await call(a.session, "/api/me/loadout", { loadout: { ...lo, dice: "dice.royal" } })).status).toBe(400);
    expect((await call(a.session, "/api/me/loadout", { loadout: { ...lo, levels: { "emote.fire": 3 } } })).status).toBe(400);
    expect((await call(a.session, "/api/me/loadout", { loadout: { ...lo, emotes: ["emote.fire", "emote.clap"] } })).status).toBe(200);

    // next match: the opponent sees Alice's equipped emote (server-validated), and she may send it
    const [m2a, m2b] = await Promise.all([queue(a.session, "앨리스", 3), queue(null, "손님", 4)]);
    const c2a = new Client(worker.url, m2a.code);
    const c2b = new Client(worker.url, m2b.code);
    await c2a.hello(m2a.token);
    const w = (await c2b.hello(m2b.token)) as Extract<import("../src/online/wire").ServerMessage, { t: "welcome" }>;
    expect(w.looks![m2a.playerId].emotes).toEqual([{ id: "emote.fire", lv: 2 }, { id: "emote.clap", lv: 1 }]);
    const said = c2b.next((m) => m.t === "said");
    c2a.ws.send(JSON.stringify({ t: "say", id: "emote.fire" }));
    expect(await said).toMatchObject({ id: "emote.fire" });
    // the guest cannot send a shop emote it does not own
    const err = c2b.next((m) => m.t === "error");
    c2b.ws.send(JSON.stringify({ t: "say", id: "emote.fire" }));
    expect(await err).toMatchObject({ code: "INVALID_SOCIAL" });
    // Alice resigns: no coins for her, the match is still recorded
    expect((await c2a.cmd({ type: "resign" })).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 800));
    const after = (await call(a.session, "/api/me/economy")).body.snapshot;
    expect(after.ledger.find((l: { id: string }) => l.id === "m:" + c2a.view!.matchId)).toBeUndefined();

    // server AI match (members only): the room plays the AI; completion pays 7 (+2 win) + boost
    const ai = await call(a.session, "/api/ai/start", { name: "앨리스" });
    expect(ai.status).toBe(201);
    const cai = new Client(worker.url, ai.body.code);
    const wai = (await cai.hello(ai.body.token)) as Extract<import("../src/online/wire").ServerMessage, { t: "welcome" }>;
    expect(wai.ai?.level).toBe("보통");
    for (let guard = 0; guard < 400 && cai.view?.status !== "finished"; guard++) {
      await new Promise((r) => setTimeout(r, 100));
      if (!cai.view?.legal) continue;
      if (cai.view.turn!.rolls === 0) await cai.cmd({ type: "roll", keep: [] });
      else await cai.cmd({ type: "score", category: [...cai.view.legal.scores].sort((x, y) => y.points - x.points)[0].category });
    }
    expect(cai.view!.status).toBe("finished");
    await new Promise((r) => setTimeout(r, 800));
    const aiRow = (await call(a.session, "/api/me/economy")).body.snapshot.ledger.find((l: { id: string }) => l.id === "m:" + cai.view!.matchId);
    // after 10 rewarded matches today the flat 11th–30th amount applies (3), otherwise 7 (+2 win) + 5 boost
    expect([3, 12, 14]).toContain(aiRow.coins);
    expect((await (await fetch(worker.url + "/api/admin/ledger/" + a.userId, { headers: { authorization: "Bearer " + ADMIN } })).json()).ok).toBe(true);

    // delete and sign in again: everything is gone and there is no second new-member grant
    expect((await call(a.session, "/api/me/delete", { confirm: "DELETE" })).status).toBe(200);
    const again = await login("alice");
    expect(again.userId).toBe(a.userId);
    expect((await call(again.session, "/api/me/economy")).body.snapshot.wallet).toEqual({ coins: 0, gems: 0 });
    const metrics = await (await fetch(worker.url + "/api/admin/metrics", { headers: { authorization: "Bearer " + ADMIN } })).json();
    expect(metrics.usage.roomsToday).toBeGreaterThanOrEqual(3);
  }, 180_000);
});
