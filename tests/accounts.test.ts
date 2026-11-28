import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { validateNickname } from "../src/identity/nickname";
import { computeStats, sanitizeRecord, RULES_ID, type MatchRecord } from "../src/identity/records";
import { AccountStore, SESSION_TTL_MS, type Sql } from "../worker/src/account";
import { GOOGLE, b64url, beginLogin, resetJwksCache, sha256, userIdFor, verifyIdToken, type OidcProvider } from "../worker/src/oidc";
import { authConfig, handleAccountRoute, type AccountBackends, type GuestApi, type UserApi } from "../worker/src/accounts-api";

/**
 * Phase 4 accounts. Everything here runs against a FAKE OpenID provider (a locally generated RSA key and
 * a fake token endpoint): it tests our verification and session logic, NOT a real Google sign-in.
 */

function sqlite(): Sql {
  const db = new DatabaseSync(":memory:");
  return {
    exec<T>(query: string, ...params: unknown[]) {
      const stmt = db.prepare(query);
      const rows = /^\s*(select|pragma)/i.test(query) ? (stmt.all(...(params as never[])) as T[]) : (stmt.run(...(params as never[])), [] as T[]);
      return { toArray: () => rows };
    },
  };
}

/* ----------------------------------------------------------- fake identity provider ----------------------------------------------------------- */
const CLIENT_ID = "test-client.apps.googleusercontent.com";
async function fakeProvider() {
  const keys = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", keys.publicKey)) as JsonWebKey;
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const sign = async (claims: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid: "k1", typ: "JWT" }) => {
    const head = enc(header) + "." + enc(claims);
    const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(head)));
    return head + "." + b64url(sig);
  };
  let nextIdToken: (body: URLSearchParams) => Promise<string> = async () => "";
  const tokenRequests: URLSearchParams[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === GOOGLE.jwksUri) return new Response(JSON.stringify({ keys: [{ ...jwk, kid: "k1", alg: "RS256", use: "sig" }] }));
    if (url === GOOGLE.tokenEndpoint) {
      const body = new URLSearchParams(String(init?.body));
      tokenRequests.push(body);
      return new Response(JSON.stringify({ id_token: await nextIdToken(body) }));
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { sign, fetcher, tokenRequests, setIdToken: (f: typeof nextIdToken) => (nextIdToken = f) };
}

describe("닉네임 정책", () => {
  it("공백·제어·숨김 문자·HTML·사칭·길이를 서버와 같은 규칙으로 검사한다", () => {
    expect(validateNickname("  요트  왕  ")).toEqual({ ok: true, name: "요트 왕" });
    expect(validateNickname("a\nb")).toEqual({ ok: true, name: "a b" }); // line breaks become one space
    expect(validateNickname("가나다라마바사아자차카타")).toMatchObject({ ok: true }); // 12 graphemes
    expect(validateNickname("가나다라마바사아자차카타파")).toMatchObject({ ok: false, code: "TOO_LONG" });
    expect(validateNickname("👨‍👩‍👧‍👦👍🏽🇰🇷")).toMatchObject({ ok: true }); // 3 user-perceived characters
    expect(validateNickname("👨‍👩‍👧‍👦".repeat(4))).toMatchObject({ ok: false, code: "TOO_LONG" }); // > 48 bytes
    for (const bad of ["", "   ", "​", "a‮b", "a\u0000b", "<b>x</b>", "z" + "́".repeat(6)]) expect(validateNickname(bad).ok).toBe(false);
    for (const staff of ["운영자", "관리 자", "ADMIN", "YachtLab공식", "GM", "Yacht Lab", "ａｄｍｉｎ"]) expect(validateNickname(staff)).toMatchObject({ ok: false, code: "RESERVED" });
    expect(validateNickname("ㅅㅂ")).toMatchObject({ ok: false, code: "BLOCKED" });
    expect(validateNickname("pigment").ok).toBe(true); // "gm" is only refused as a whole name
  });
});

describe("OIDC 검증 (가짜 제공자)", () => {
  beforeEach(() => resetJwksCache());
  it("로그인 시작: openid 범위만, state·nonce·PKCE S256", async () => {
    const { url, login } = await beginLogin({ provider: GOOGLE, clientId: CLIENT_ID, redirectUri: "https://w.example/auth/google/callback", clientStateHash: "x".repeat(43), now: 0 });
    const q = new URL(url).searchParams;
    expect(q.get("scope")).toBe("openid");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("code_challenge")).toBe(await sha256(login.verifier).then((h) => h)); // b64url(SHA-256(verifier))
    expect(q.get("state")).toBe(login.state);
    expect(q.get("nonce")).toBe(login.nonce);
    expect(login.state).not.toBe(login.nonce);
  });

  it("서명·발급자·대상·만료·nonce·알고리즘을 모두 검사한다", async () => {
    const idp = await fakeProvider();
    const now = Date.now();
    const sec = Math.floor(now / 1000);
    const base = { iss: "https://accounts.google.com", aud: CLIENT_ID, sub: "1234567890", iat: sec, exp: sec + 600, nonce: "n-1" };
    const verify = (token: string, nonce = "n-1") => verifyIdToken(token, { provider: GOOGLE, clientId: CLIENT_ID, nonce, now, fetcher: idp.fetcher });
    await expect(verify(await idp.sign(base))).resolves.toMatchObject({ sub: "1234567890" });
    await expect(verify(await idp.sign({ ...base, iss: "https://evil.example" }))).rejects.toMatchObject({ code: "ISS" });
    await expect(verify(await idp.sign({ ...base, aud: "other-client" }))).rejects.toMatchObject({ code: "AUD" });
    await expect(verify(await idp.sign({ ...base, exp: sec - 3600 }))).rejects.toMatchObject({ code: "EXP" });
    await expect(verify(await idp.sign({ ...base, iat: sec + 3600 }))).rejects.toMatchObject({ code: "IAT" });
    await expect(verify(await idp.sign(base), "other-nonce")).rejects.toMatchObject({ code: "NONCE" });
    await expect(verify(await idp.sign(base, { alg: "none", kid: "k1" }))).rejects.toMatchObject({ code: "ALG" });
    await expect(verify(await idp.sign(base, { alg: "HS256", kid: "k1" }))).rejects.toMatchObject({ code: "ALG" });
    await expect(verify(await idp.sign(base, { alg: "RS256", kid: "unknown" }))).rejects.toMatchObject({ code: "KID" });
    const good = await idp.sign(base);
    const [h, , s] = good.split(".");
    const forged = h + "." + b64url(new TextEncoder().encode(JSON.stringify({ ...base, sub: "victim" }))) + "." + s;
    await expect(verify(forged)).rejects.toMatchObject({ code: "SIGNATURE" });
  });
});

describe("계정 저장소 (UserStore 로직, node:sqlite)", () => {
  const record = (id: string, over: Partial<MatchRecord> = {}): MatchRecord => ({
    recordId: id,
    mode: "online",
    rules: RULES_ID,
    source: "server",
    verification: "server-verified",
    startedAt: 1_800_000_000_000,
    endedAt: 1_800_000_100_000,
    name: "민수",
    score: 50,
    card: { yacht: 50 },
    outcome: "win",
    endReason: "completed",
    opponent: { name: "지민", kind: "guest", score: 10 },
    ...over,
  });

  it("일회용 로그인 코드 → 세션, 만료·재사용·다른 브라우저 거부, 로그아웃", async () => {
    const s = new AccountStore(sqlite());
    s.init();
    const now = 1_800_000_000_000;
    s.ensureUser("u_" + "a".repeat(22), "google", now);
    const code = await s.createLoginCode(await sha256("client-state-123456789"), now);
    expect(await s.exchange(code, "another-browser-state-xyz", now)).toBeNull(); // bound to the page that started it
    const code2 = await s.createLoginCode(await sha256("client-state-123456789"), now);
    const session = await s.exchange(code2, "client-state-123456789", now);
    expect(session).toBeTruthy();
    expect(await s.exchange(code2, "client-state-123456789", now)).toBeNull(); // single use
    expect(await s.authenticate(session!, now + 1000)).toBe(true);
    expect(await s.authenticate(session! + "x", now)).toBe(false);
    expect(await s.authenticate(session!, now + SESSION_TTL_MS + 1)).toBe(false); // expired (and removed)
    const code3 = await s.createLoginCode(await sha256("client-state-123456789"), now);
    expect(await s.exchange(code3, "client-state-123456789", now + 3 * 60_000)).toBeNull(); // code expired
  });

  it("서버 기록은 matchId로 한 번만, 기기 기록은 검증 수준을 올리지 않는다", () => {
    const s = new AccountStore(sqlite());
    s.init();
    s.ensureUser("u_" + "b".repeat(22), "google", 1);
    expect(s.recordMatch(record("m_1"))).toBe(true);
    expect(s.recordMatch(record("m_1"))).toBe(false); // retry / duplicate delivery
    expect(s.recordMatch(record("m_2", { source: "device", verification: "client-reported" }))).toBe(false); // not via this path
    const imported = s.importRecords([record("d_abc1", { mode: "ai", source: "device", verification: "client-reported" }), record("d_abc1")], "guest-import", 1);
    expect(imported).toEqual({ added: 1, skipped: 1 });
    const all = s.records();
    expect(all.find((r) => r.recordId === "d_abc1")).toMatchObject({ source: "guest-import", verification: "client-reported" });
    expect(s.publicProfile()!.online.games).toBe(1); // only the server-verified match counts publicly
    expect(JSON.stringify(s.publicProfile())).not.toContain("google");
  });

  it("SEC-1-01: 먼저 올린 기기 기록이 같은 matchId의 서버 검증 결과·정산을 막지 못한다", () => {
    const s = new AccountStore(sqlite());
    s.init();
    s.ensureUser("u_" + "c".repeat(22), "google", 1);
    // a device copy (claimed draw) uploaded while the match is still running
    expect(s.importRecords([record("m_live1", { outcome: "draw" })], "device", 1)).toEqual({ added: 1, skipped: 0 });
    let settled = 0;
    expect(s.recordMatch(record("m_live1", { outcome: "loss" }), () => (settled++, undefined))).toBe(true);
    expect(settled).toBe(1);
    expect(s.records().filter((r) => r.recordId === "m_live1")).toEqual([expect.objectContaining({ outcome: "loss", verification: "server-verified" })]);
    expect(s.publicProfile()!.online).toMatchObject({ games: 1, losses: 1 });
    // still idempotent afterwards, and a later device upload never downgrades it
    expect(s.recordMatch(record("m_live1", { outcome: "loss" }), () => (settled++, undefined))).toBe(false);
    expect(s.importRecords([record("m_live1", { outcome: "win" })], "device", 1)).toEqual({ added: 0, skipped: 1 });
    expect(settled).toBe(1);
    expect(s.publicProfile()!.online).toMatchObject({ games: 1, losses: 1, wins: 0 });
  });
});

describe("기록 검증·통계", () => {
  it("업로드 기록은 점수판과 총점이 맞아야 하고, 항상 client-reported로 낮춰진다", () => {
    const ok = sanitizeRecord({ recordId: "d_xyz12", mode: "ai", rules: RULES_ID, source: "server", verification: "server-verified", startedAt: 1_800_000_000_000, endedAt: 1_800_000_000_500, name: "나", score: 85, card: { yacht: 50, choice: 20, four: 15 }, outcome: "win", endReason: "completed", opponent: { name: "AI", kind: "member", score: 10, userId: "u_x" } }, 1_800_000_001_000);
    expect(ok).toMatchObject({ source: "device", verification: "client-reported", opponent: { kind: "guest" } });
    expect(ok!.opponent.userId).toBeUndefined();
    expect(sanitizeRecord({ ...ok!, score: 999 })).toBeNull(); // total does not match the card
    expect(sanitizeRecord({ ...ok!, card: { yacht: 51 } })).toBeNull();
    expect(sanitizeRecord({ ...ok!, recordId: "../x" })).toBeNull();
  });
  it("빈 기록은 가짜 수치 없이 0/없음", () => {
    const s = computeStats([]);
    expect(s).toMatchObject({ games: 0, winRate: null, best: null, average: null });
  });
});

describe("계정 API 흐름 (가짜 Google, 실제 OAuth 아님)", () => {
  async function setup() {
    resetJwksCache();
    const idp = await fakeProvider();
    let now = Date.now();
    const users = new Map<string, AccountStore>();
    const guests = new Map<string, string>();
    const store = (id: string) => {
      if (!users.has(id)) {
        const s = new AccountStore(sqlite());
        s.init();
        users.set(id, s);
      }
      return users.get(id)!;
    };
    const user = (id: string): UserApi => ({
      ensureAndCode: async (userId, provider, cs) => (store(id).ensureUser(userId, provider, now), store(id).createLoginCode(cs, now)),
      exchange: (code, cs) => store(id).exchange(code, cs, now),
      authenticate: (sess) => store(id).authenticate(sess, now),
      me: async () => store(id).profile(),
      records: async (limit) => store(id).records(limit),
      setNickname: async (n) => store(id).setNickname(n, now),
      importRecords: async (r, src, g) => {
        const res = store(id).importRecords(r, src, now);
        if (g && !("error" in res)) store(id).linkGuest(g, now);
        return res;
      },
      logout: (sess) => store(id).logout(sess),
      logoutAll: async () => store(id).logoutAll(),
      deleteAccount: async () => {
        const g = store(id).guests();
        users.delete(id);
        return g;
      },
      publicProfile: async () => store(id).publicProfile(),
    });
    const guest = (gid: string): GuestApi => ({
      claim: async (uid) => (guests.has(gid) ? (guests.get(gid) === uid ? "ok" : "taken") : (guests.set(gid, uid), "ok")),
      release: async (uid) => void (guests.get(gid) === uid && guests.delete(gid)),
    });
    const backends: AccountBackends = { user, guest, limited: async () => false, fetcher: idp.fetcher, now: () => now };
    const cfg = authConfig({ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: "test-secret", AUTH_SECRET: "k".repeat(40), APP_URL: "https://app.example/YachtLab/" });
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    const call = async (method: string, path: string, opts: { body?: unknown; session?: string; cookie?: string } = {}) => {
      const url = new URL("https://worker.example" + path);
      const req = new Request(url, {
        method,
        headers: { ...(opts.body ? { "content-type": "application/json" } : {}), ...(opts.session ? { authorization: "Bearer " + opts.session } : {}), ...(opts.cookie ? { cookie: opts.cookie } : {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      return (await handleAccountRoute(req, url, cfg, backends, "client", reply))!;
    };
    /** Full sign-in for a Google subject; returns the session token. */
    const signIn = async (sub: string, clientState = "page-state-" + sub.padEnd(20, "x")) => {
      const start = await call("GET", "/auth/google/start?cs=" + (await sha256(clientState)));
      expect(start.status).toBe(302);
      const cookie = start.headers.get("set-cookie")!.split(";")[0];
      expect(start.headers.get("set-cookie")).toMatch(/HttpOnly; Secure; SameSite=Lax/);
      const google = new URL(start.headers.get("location")!);
      idp.setIdToken(async () => idp.sign({ iss: "https://accounts.google.com", aud: CLIENT_ID, sub, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 600, nonce: google.searchParams.get("nonce") }));
      const cb = await call("GET", `/auth/google/callback?code=abc&state=${google.searchParams.get("state")}`, { cookie });
      const loc = cb.headers.get("location")!;
      expect(loc).toMatch(/^https:\/\/app\.example\/YachtLab\/#login=u_/);
      const code = loc.split("#login=")[1];
      const ex = await call("POST", "/api/auth/exchange", { body: { code, clientState } });
      expect(ex.status).toBe(200);
      return ((await ex.json()) as { session: string }).session;
    };
    return { call, signIn, idp, users, advance: (ms: number) => (now += ms) };
  }

  it("로그인→내 정보→닉네임→로그아웃, 위조 세션·다른 브라우저 콜백·state 불일치 거부", async () => {
    const { call, signIn, idp } = await setup();
    const session = await signIn("google-sub-1");
    expect(idp.tokenRequests.at(-1)!.get("code_verifier")).toBeTruthy(); // PKCE verifier sent with the code
    const me = (await (await call("GET", "/api/me", { session })).json()) as { profile: { userId: string; nickname: string | null } };
    expect(me.profile.userId).toBe(await userIdFor("google", "google-sub-1"));
    expect(JSON.stringify(me)).not.toContain("google-sub-1"); // the provider subject is never returned
    expect((await call("POST", "/api/me/nickname", { session, body: { nickname: "관리자" } })).status).toBe(400);
    expect((await call("POST", "/api/me/nickname", { session, body: { nickname: "요트왕" } })).status).toBe(200);
    expect((await call("GET", "/api/me", { session: session.slice(0, -2) + "zz" })).status).toBe(401);
    expect((await call("GET", "/api/me")).status).toBe(401);
    // A callback without this browser's login cookie (login CSRF) or with another state is refused.
    const noCookie = await call("GET", "/auth/google/callback?code=abc&state=whatever");
    expect(noCookie.headers.get("location")).toContain("#login-error=state");
    const start = await call("GET", "/auth/google/start?cs=" + "y".repeat(43));
    const cookie = start.headers.get("set-cookie")!.split(";")[0];
    expect((await call("GET", "/auth/google/callback?code=abc&state=other", { cookie })).headers.get("location")).toContain("#login-error=state");
    expect((await call("POST", "/api/me/logout", { session })).status).toBe(200);
    expect((await call("GET", "/api/me", { session })).status).toBe(401);
  });

  it("다른 기기 같은 계정은 같은 기록, 게스트 기록 이전은 1회·중복 없음·타 계정 탈취 불가, 계정 삭제", async () => {
    const { call, signIn, users } = await setup();
    const phone = await signIn("google-sub-2", "phone-state-aaaaaaaaaaaa");
    const laptop = await signIn("google-sub-2", "laptop-state-bbbbbbbbbbb");
    const userId = await userIdFor("google", "google-sub-2");
    users.get(userId)!.recordMatch({ recordId: "m_online1", mode: "online", rules: RULES_ID, source: "server", verification: "server-verified", startedAt: 1_800_000_000_000, endedAt: 1_800_000_000_100, name: "a", score: 0, card: {}, outcome: "draw", endReason: "completed", opponent: { name: "b", kind: "guest", score: 0 } });
    const guestKey = "G".repeat(43);
    const rec = { recordId: "d_local001", mode: "ai", rules: RULES_ID, source: "device", verification: "client-reported", startedAt: 1_790_000_000_000, endedAt: 1_790_000_000_100, name: "a", score: 5, card: { fives: 5 }, outcome: "loss", endReason: "completed", opponent: { name: "AI · 보통", kind: "ai", score: 9 }, aiLevel: "보통" };
    const first = await call("POST", "/api/me/import", { session: phone, body: { guestKey, records: [rec] } });
    expect(await first.json()).toEqual({ added: 1, skipped: 0 });
    const again = await call("POST", "/api/me/import", { session: laptop, body: { guestKey, records: [rec] } });
    expect(await again.json()).toEqual({ added: 0, skipped: 1 }); // retry / second device: no duplicate
    const list = (await (await call("GET", "/api/me/records", { session: laptop })).json()) as { records: MatchRecord[] };
    expect(list.records.map((r) => r.recordId).sort()).toEqual(["d_local001", "m_online1"]);
    expect(list.records.find((r) => r.recordId === "d_local001")!.verification).toBe("client-reported");
    // Another account cannot take over this guest's records.
    const other = await signIn("google-sub-3");
    expect((await call("POST", "/api/me/import", { session: other, body: { guestKey, records: [rec] } })).status).toBe(409);
    // Deleting the account removes its data and frees the guest link.
    expect((await call("POST", "/api/me/delete", { session: phone, body: { confirm: "nope" } })).status).toBe(400);
    expect((await call("POST", "/api/me/delete", { session: phone, body: { confirm: "DELETE" } })).status).toBe(200);
    expect(users.has(userId)).toBe(false);
    expect((await call("GET", "/api/me", { session: laptop })).status).toBe(401);
    expect((await call("POST", "/api/me/import", { session: other, body: { guestKey, records: [rec] } })).status).toBe(200);
  });

  it("설정이 없으면 로그인은 꺼져 있고 성공한 척하지 않는다", async () => {
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    const backends = { user: () => ({}) as UserApi, guest: () => ({}) as GuestApi, limited: async () => false, fetcher: fetch, now: Date.now } as AccountBackends;
    for (const [m, p] of [["GET", "/api/auth/config"], ["GET", "/auth/google/start?cs=" + "a".repeat(43)], ["GET", "/api/me"], ["POST", "/api/auth/exchange"]] as const) {
      const url = new URL("https://w.example" + p);
      const res = (await handleAccountRoute(new Request(url, { method: m }), url, authConfig({}), backends, "c", reply))!;
      if (p === "/api/auth/config") expect(await res.json()).toEqual({ google: false });
      else expect(res.status).toBe(404);
    }
    expect(authConfig({ GOOGLE_CLIENT_ID: "x", GOOGLE_CLIENT_SECRET: "y", AUTH_SECRET: "short", APP_URL: "https://a" })).toBeNull();
  });
});

void (null as unknown as OidcProvider);
