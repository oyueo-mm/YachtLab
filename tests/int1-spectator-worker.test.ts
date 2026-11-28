import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import WebSocket from "ws";
import { b64url } from "../worker/src/oidc";
import { authConfig } from "../worker/src/accounts-api";
import { Client, closeAllClients } from "./helpers/online-client";
import { startLocalWorker, type LocalWorker } from "./helpers/wrangler";

/**
 * INT-1 (SOC-1 × C5 × economy) in the real Workers runtime: a signed-in room member who chooses "watch"
 * gets no match record, no reward and no match lock. Setup copied from economy-worker.test.ts.
 *
 * Original header — Phase 4.5–6 end to end in the real Workers runtime (wrangler dev --local): sign-in through a FAKE
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

const intent = (c: Client, value: "watch" | "ready") => c.ws.send(JSON.stringify({ t: "intent", value }));

describe("INT-1 · 관전 구성원 격리 (wrangler dev)", () => {
  it("관전을 고른 회원은 경기 기록·보상·경기 잠금에서 빠지고, 참가자 두 명만 기록·코인을 받는다", async () => {
    const a = await login("int1-watch-a"), b = await login("int1-watch-b"), w = await login("int1-watch-w");
    for (const m of [a, b, w]) await call(m.session, "/api/me/economy"); // welcome grant first, so the ledgers compare cleanly
    const before = (await call(w.session, "/api/me/economy")).body.snapshot;
    const created = await call(a.session, "/api/rooms", { name: "방장", maxPlayers: 3 });
    expect(created.status).toBe(201);
    const { code, token } = created.body;
    const jb = await call(b.session, `/api/rooms/${code}/join`, { name: "참가" });
    const jw = await call(w.session, `/api/rooms/${code}/join`, { name: "관전" });
    expect([jb.status, jw.status]).toEqual([201, 201]);
    const host = new Client(worker.url, code), guest = new Client(worker.url, code), watcher = new Client(worker.url, code);
    await host.hello(token);
    await guest.hello(jb.body.token);
    await watcher.hello(jw.body.token);
    intent(watcher, "watch");
    intent(guest, "ready");
    // wait until the host sees both choices (one ready player, one watcher)
    await expect.poll(() => {
      const lobby = [...(host.messages as Record<string, any>[])].reverse().find((m) => m.t === "lobby")?.lobby;
      return lobby ? Object.values(lobby.intent ?? {}).sort().join(",") : "";
    }, { timeout: 5000 }).toBe("idle,ready,watch");
    const st = await host.cmd({ type: "start" });
    expect(st.ok).toBe(true);
    await expect.poll(() => (watcher.messages as Record<string, any>[]).some((m) => m.t === "view" || m.t === "welcome"), { timeout: 5000 }).toBe(true);
    // match lock: the players are busy, the watcher may start a server AI match elsewhere
    expect((await call(a.session, "/api/ai/start", { name: "방장" })).status).toBe(409);
    const ai = await call(w.session, "/api/ai/start", { name: "관전" });
    expect(ai.status).toBeLessThan(300);
    // the watcher cannot play in the room match
    const refused = await watcher.cmd({ type: "roll", keep: [] }).catch(() => null);
    expect(refused?.ok ?? false).toBe(false);
    await playOut([host, guest]);
    expect(host.view?.status).toBe("finished");
    await expect.poll(async () => (await call(a.session, "/api/me/records")).body.records?.length ?? 0, { timeout: 10_000 }).toBe(1);
    await expect.poll(async () => (await call(b.session, "/api/me/records")).body.records?.length ?? 0, { timeout: 10_000 }).toBe(1);
    const matchId = (await call(a.session, "/api/me/records")).body.records[0].recordId as string;
    expect(matchId).toMatch(/^m_/);
    // the watcher: no record of this match, no receipt, no ledger change from it
    const wr = (await call(w.session, "/api/me/records")).body.records ?? [];
    expect(wr.some((r: Record<string, unknown>) => r.recordId === matchId)).toBe(false);
    const after = (await call(w.session, "/api/me/economy")).body.snapshot;
    expect(after.wallet).toEqual(before.wallet);
    expect(after.ledger.some((l: { id: string }) => l.id === "m:" + matchId)).toBe(false);
    expect(after.ledger.map((l: { id: string }) => l.id)).toEqual(before.ledger.map((l: { id: string }) => l.id));
    const ea = (await call(a.session, "/api/me/economy")).body.snapshot;
    expect(ea.ledger.some((l: { id: string }) => l.id === "m:" + matchId)).toBe(true);
  }, 60_000);
});
