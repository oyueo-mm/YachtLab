import { drawPool, type DrawPool, type DrawReceipt, type DrawStatus } from "../../src/economy/live/draw";
import type { ReviewMatch } from "../../src/review/model";
import type { MatchReceipt } from "../../src/economy/live/receipt";
import { sanitizeRecord, type MatchRecord } from "../../src/identity/records";
import { sanitizeSoloRecord, type SoloRecord } from "../../src/solo/records";
import { GOOGLE, OidcError, USER_ID, beginLogin, finishLogin, seal, sha256, unseal, userIdFor, type LoginState, type OidcProvider } from "./oidc";
import type { PrivateProfile, PublicProfile } from "./account";
import { STALE_CODES, type Quote } from "./economy";

/**
 * Account HTTP API (Phase 4). Runtime-free: the Worker passes Durable Object stubs as `AccountBackends`,
 * tests pass in-memory fakes. Every route is off unless sign-in is configured (`authConfig`), and
 * nothing here ever reports a sign-in that did not really happen.
 *
 *   GET  /api/auth/config              → { google: boolean }
 *   GET  /auth/google/start?cs=HASH    → 302 to Google (sealed state cookie)            [top-level navigation]
 *   GET  /auth/google/callback         → 303 to the app  #login=<one-time code> | #login-error=<reason>
 *   POST /api/auth/exchange            { code, clientState } → { session, profile }
 *   GET  /api/me                       → private profile          (Authorization: Bearer <session>)
 *   GET  /api/me/records               → match records (latest first)
 *   POST /api/me/nickname              { nickname }
 *   POST /api/me/import                { records, guestKey? }  → device / guest records (client-reported)
 *   GET  /api/me/solo                  → 1인 플레이 records (client-reported, latest first)
 *   POST /api/me/solo                  { records }  → add this device's 1인 플레이 records (idempotent)
 *   POST /api/me/logout | /api/me/logout-all
 *   POST /api/me/delete                { confirm: "DELETE" }   → account and all its data removed
 *   GET  /api/profiles/:userId         → public profile (nickname, join month, server-verified totals)
 *
 * Sessions are bearer tokens (`s1.<userId>.<secret>`, only a hash stored) kept by the web page,
 * because the page (github.io) and the API (workers.dev) are different sites and phone browsers block
 * third-party cookies. The only cookie is the short-lived, first-party login-state cookie on the
 * Worker's own origin during the Google redirect.
 */
export type AuthConfig = { clientId: string; clientSecret: string; secret: string; appUrl: string; provider: OidcProvider } | null;
export function authConfig(env: { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string; AUTH_SECRET?: string; APP_URL?: string; TEST_OIDC_ISSUER?: string }): AuthConfig {
  const { GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: secret, AUTH_SECRET: key, APP_URL: app } = env;
  if (!id || !secret || !key || key.length < 32 || !app) return null;
  // Local end-to-end tests only: a fake identity provider on this machine. It is honoured only when
  // the app itself is a loopback http address, which a deployed Worker can never have (Google needs https).
  const test = env.TEST_OIDC_ISSUER;
  if (test && /^http:\/\/127\.0\.0\.1:\d+$/.test(test) && /^http:\/\/127\.0\.0\.1:\d+\//.test(app))
    return { clientId: id, clientSecret: secret, secret: key, appUrl: app, provider: { name: "google", authorizationEndpoint: test + "/auth", tokenEndpoint: test + "/token", jwksUri: test + "/jwks", issuers: [test] } };
  if (!/^https:\/\//.test(app)) return null;
  return { clientId: id, clientSecret: secret, secret: key, appUrl: app, provider: GOOGLE };
}

export interface UserApi {
  ensureAndCode(userId: string, provider: string, clientStateHash: string): Promise<string>;
  exchange(code: string, clientState: string): Promise<string | null>;
  authenticate(session: string): Promise<boolean>;
  me(): Promise<PrivateProfile | null>;
  records(limit: number): Promise<MatchRecord[]>;
  matchReview?(matchId: string): Promise<{ review: ReviewMatch | null } | null>;
  matchReward?(matchId: string): Promise<{ receipt: MatchReceipt | null } | null>;
  setNickname(nickname: unknown): Promise<{ ok: true; nickname: string } | { ok: false; message: string }>;
  importRecords(records: MatchRecord[], source: "device" | "guest-import", guestId: string | null): Promise<{ added: number; skipped: number } | { error: string }>;
  soloRecords?(limit: number): Promise<SoloRecord[]>;
  importSolo?(records: SoloRecord[]): Promise<{ added: number; skipped: number } | { error: string }>;
  logout(session: string): Promise<void>;
  logoutAll(): Promise<void>;
  deleteAccount(): Promise<string[]>;
  publicProfile(): Promise<PublicProfile | null>;
  /* Phase 5/6 economy (optional: tests of the account API may omit them) */
  economy?(): Promise<EconResult>;
  buy?(itemId: unknown, currency: unknown, requestId: string, quote?: Quote): Promise<EconResult>;
  upgrade?(itemId: unknown, requestId: string, quote?: Quote): Promise<EconResult>;
  buySlot?(kind: unknown, currency: unknown, requestId: string, quote?: Quote): Promise<EconResult>;
  setLoadout?(loadout: unknown): Promise<EconResult>;
  rerollQuest?(index: number | "all", period?: "daily" | "weekly", expected?: number): Promise<EconResult>;
  drawStatus?(): Promise<EconResult>;
  draw?(pool: DrawPool, requestId: string, quote?: Quote): Promise<EconResult>;
}

/**
 * The optional "what I saw" fields of a purchase-like request (SEC-08, SEC-10, stale requests). Absent
 * fields are not checked (older pages); a present field with the wrong type is a 400.
 */
export function parseQuote(input: Record<string, unknown>): Quote | null {
  const q: Quote = {};
  const int = (v: unknown, max: number) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
  const text = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 40 && /^[A-Za-z0-9@._:-]+$/.test(v);
  if (input.expectedPrice !== undefined) { if (!int(input.expectedPrice, 10_000_000)) return null; q.expectedPrice = input.expectedPrice as number; }
  if (input.expectedLevel !== undefined) { if (!int(input.expectedLevel, 10) || (input.expectedLevel as number) < 1) return null; q.expectedLevel = input.expectedLevel as number; }
  if (input.configVersion !== undefined) { if (!text(input.configVersion)) return null; q.configVersion = input.configVersion as string; }
  if (input.oddsVersion !== undefined) { if (!text(input.oddsVersion)) return null; q.oddsVersion = input.oddsVersion as string; }
  return q;
}
export type EconResult = { ok: true; snapshot: unknown; duplicate?: boolean; receipt?: DrawReceipt; draw?: DrawStatus } | { ok: false; code: string; message: string };
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
export interface GuestApi {
  /** First claim wins; the same account may claim again (retries). */
  claim(userId: string): Promise<"ok" | "taken">;
  release(userId: string): Promise<void>;
}
export type AccountBackends = {
  user(userId: string): UserApi;
  guest(guestId: string): GuestApi;
  /** In-memory rate limit (no storage writes). True = over the limit. */
  limited(key: string, perMinute: number): Promise<boolean>;
  fetcher: typeof fetch;
  now(): number;
};

const COOKIE = "__Host-yl_oidc";
const SESSION = /^s1\.(u_[A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;
const LOGIN_CODE = /^(u_[A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;
const CS_HASH = /^[A-Za-z0-9_-]{43}$/;
export const MAX_IMPORT_BODY = 160_000;

type Reply = (status: number, body: unknown) => Response;

function cookieValue(request: Request, name: string) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

async function body(request: Request, max: number): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") ?? "0") > max) throw new Error("too large");
  const text = await request.text();
  if (text.length > max) throw new Error("too large");
  const parsed = JSON.parse(text || "{}");
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new SyntaxError("object expected");
  return parsed as Record<string, unknown>;
}

/** The signed-in user of this request, or null (no / invalid / expired session). */
export async function sessionUser(request: Request, b: AccountBackends): Promise<{ userId: string; secret: string } | null> {
  const m = SESSION.exec((request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  if (!m) return null;
  const ok = await b.user(m[1]).authenticate(m[2]).catch(() => false);
  return ok ? { userId: m[1], secret: m[2] } : null;
}

/**
 * Handle an account route, or return null when the path is not one. `client` is the hashed client
 * key (rate limits); `reply` adds CORS for allowed origins.
 */
export async function handleAccountRoute(request: Request, url: URL, cfg: AuthConfig, b: AccountBackends, client: string, reply: Reply): Promise<Response | null> {
  const path = url.pathname;
  const method = request.method;
  const fail = (status: number, code: string, message: string) => reply(status, { error: { code, message } });

  if (path === "/api/auth/config" && method === "GET") return reply(200, { google: !!cfg });

  /* ---------------- Google redirect flow (top-level navigations, no Origin/CORS involved) ---------------- */
  if (path === "/auth/google/start" && method === "GET") {
    if (!cfg) return new Response("sign-in is not configured", { status: 404 });
    if (await b.limited("login:" + client, 10)) return new Response("too many sign-in attempts", { status: 429 });
    const cs = url.searchParams.get("cs") ?? "";
    if (!CS_HASH.test(cs)) return new Response("bad request", { status: 400 });
    const redirectUri = url.origin + "/auth/google/callback";
    const { url: to, login } = await beginLogin({ provider: cfg.provider, clientId: cfg.clientId, redirectUri, clientStateHash: cs, now: b.now() });
    return new Response(null, {
      status: 302,
      headers: {
        location: to,
        "cache-control": "no-store",
        "set-cookie": `${COOKIE}=${await seal(login, cfg.secret)}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
        "referrer-policy": "no-referrer",
      },
    });
  }
  if (path === "/auth/google/callback" && method === "GET") {
    if (!cfg) return new Response("sign-in is not configured", { status: 404 });
    const back = (hash: string) =>
      new Response(null, {
        status: 303,
        headers: { location: cfg.appUrl + "#" + hash, "cache-control": "no-store", "set-cookie": `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`, "referrer-policy": "no-referrer" },
      });
    const login = await unseal<LoginState>(cookieValue(request, COOKIE), cfg.secret);
    const state = url.searchParams.get("state") ?? "";
    // Without our own cookie with the same state this callback was not started by this browser (login CSRF).
    if (!login || login.exp < b.now() || login.state !== state) return back("login-error=state");
    if (url.searchParams.get("error")) return back("login-error=cancelled");
    const code = url.searchParams.get("code");
    if (!code || code.length > 2048) return back("login-error=code");
    try {
      const claims = await finishLogin({ provider: cfg.provider, clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri: url.origin + "/auth/google/callback", code, login, now: b.now(), fetcher: b.fetcher });
      const userId = await userIdFor(cfg.provider.name, claims.sub);
      const oneTime = await b.user(userId).ensureAndCode(userId, cfg.provider.name, login.cs);
      return back(`login=${userId}.${oneTime}`);
    } catch (error) {
      // Never log tokens or claims; only the error kind.
      console.warn("sign-in failed", error instanceof OidcError ? error.code : "unexpected");
      return back("login-error=verify");
    }
  }

  if (!path.startsWith("/api/auth/") && !path.startsWith("/api/me") && !path.startsWith("/api/profiles/")) return null;
  if (!cfg) return fail(404, "AUTH_DISABLED", "회원 로그인은 아직 준비 중이에요.");

  if (path === "/api/auth/exchange" && method === "POST") {
    if (await b.limited("exchange:" + client, 20)) return fail(429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.");
    const input = await body(request, 1024);
    const m = LOGIN_CODE.exec(String(input.code ?? ""));
    const cs = typeof input.clientState === "string" && input.clientState.length >= 20 && input.clientState.length <= 128 ? input.clientState : null;
    if (!m || !cs) return fail(400, "INVALID", "로그인 정보가 올바르지 않아요.");
    const user = b.user(m[1]);
    const secret = await user.exchange(m[2], cs);
    if (!secret) return fail(401, "LOGIN_EXPIRED", "로그인이 만료되었어요. 다시 로그인해 주세요.");
    return reply(200, { session: `s1.${m[1]}.${secret}`, profile: await user.me() });
  }

  if (path.startsWith("/api/profiles/") && method === "GET") {
    if (await b.limited("profile:" + client, 60)) return fail(429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.");
    const id = decodeURIComponent(path.slice("/api/profiles/".length));
    if (!USER_ID.test(id)) return fail(404, "NOT_FOUND", "프로필을 찾을 수 없어요.");
    const profile = await b.user(id).publicProfile();
    return profile ? reply(200, profile) : fail(404, "NOT_FOUND", "프로필을 찾을 수 없어요.");
  }

  /* ---------------- signed-in routes ---------------- */
  const me = await sessionUser(request, b);
  if (!me) return fail(401, "UNAUTHENTICATED", "로그인이 필요해요.");
  if (await b.limited("me:" + me.userId, 120)) return fail(429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.");
  const user = b.user(me.userId);
  if (path === "/api/me" && method === "GET") return reply(200, { profile: await user.me() });
  if (path === "/api/me/records" && method === "GET") return reply(200, { records: await user.records(Number(url.searchParams.get("limit") ?? 300) || 300) });
  if (path === "/api/me/solo" && method === "GET" && user.soloRecords) return reply(200, { records: await user.soloRecords(1000) });
  if (path === "/api/me/solo" && method === "POST" && user.importSolo) {
    const input = await body(request, MAX_IMPORT_BODY);
    if (!Array.isArray(input.records)) return fail(400, "INVALID", "기록 형식이 올바르지 않아요.");
    const records = input.records.map((r) => sanitizeSoloRecord(r, b.now()));
    if (records.some((r) => !r)) return fail(400, "INVALID", "올바르지 않은 기록이 있어요.");
    const result = await user.importSolo(records as SoloRecord[]);
    return "error" in result ? fail(400, "IMPORT", result.error) : reply(200, result);
  }
  const reward = /^\/api\/me\/records\/([A-Za-z0-9_-]{4,64})\/reward$/.exec(path);
  if (reward && method === "GET" && user.matchReward) {
    const result = await user.matchReward(reward[1]);
    return result ? reply(200, result) : fail(404, "NOT_FOUND", "경기 기록을 아직 찾을 수 없어요.");
  }
  const review = /^\/api\/me\/records\/([A-Za-z0-9_-]{4,64})\/review$/.exec(path);
  if (review && method === "GET" && user.matchReview) {
    const result = await user.matchReview(review[1]);
    return result ? reply(200, result) : fail(404, "NOT_FOUND", "본인 계정에서 이 경기 기록을 찾을 수 없어요.");
  }
  /* ---------------- economy (server-side only; the client never sends amounts) ---------------- */
  const econ = (r: EconResult) => (r.ok ? reply(200, { snapshot: r.snapshot, duplicate: r.duplicate ?? false, receipt: r.receipt, draw: r.draw }) : fail(r.code === "ECONOMY_OFF" ? 404 : r.code === "INSUFFICIENT" ? 402 : STALE_CODES.has(r.code) ? 409 : 400, r.code, r.message));
  if (path === "/api/me/economy" && method === "GET" && user.economy) return econ(await user.economy());
  if (path === "/api/me/shop/draw" && method === "GET" && user.drawStatus) return econ(await user.drawStatus());
  if (method !== "POST") return fail(404, "NOT_FOUND", "없는 주소입니다.");
  if (path.startsWith("/api/me/shop/") || path === "/api/me/loadout" || path === "/api/me/quests/reroll") {
    if (!user.buy) return fail(404, "ECONOMY_OFF", "재화 기능은 아직 준비 중이에요.");
    const input = await body(request, 4096);
    const rid = typeof input.requestId === "string" && REQUEST_ID.test(input.requestId) ? input.requestId : null;
    if (path === "/api/me/loadout") return econ(await user.setLoadout!(input.loadout));
    if (path === "/api/me/quests/reroll") {
      if (!user.rerollQuest) return fail(404, "ECONOMY_OFF", "퀘스트 기능은 아직 준비 중이에요.");
      if (input.index === "all") {
        const period = input.period;
        if ((period !== "daily" && period !== "weekly") || typeof input.expected !== "number" || !Number.isSafeInteger(input.expected)) return fail(400, "INVALID", "교체할 퀘스트 기간을 확인해 주세요.");
        return econ(await user.rerollQuest("all", period, input.expected));
      }
      return econ(await user.rerollQuest(Number.isInteger(input.index) ? input.index as number : -1, "daily",
        typeof input.expected === "number" ? input.expected : undefined));
    }
    if (!rid) return fail(400, "INVALID", "요청 정보가 올바르지 않아요.");
    const quote = parseQuote(input);
    if (!quote) return fail(400, "INVALID", "요청 정보가 올바르지 않아요.");
    if (path === "/api/me/shop/draw" && user.draw) {
      const pool = drawPool(input.pool);
      if (!pool) return fail(400, "INVALID", "뽑기 종류를 확인해 주세요.");
      return econ(await user.draw(pool, rid, quote));
    }
    if (path === "/api/me/shop/buy") return econ(await user.buy(input.itemId, input.currency, rid, quote));
    if (path === "/api/me/shop/upgrade") return econ(await user.upgrade!(input.itemId, rid, quote));
    if (path === "/api/me/shop/slot") return econ(await user.buySlot!(input.kind, input.currency, rid, quote));
  }
  if (path === "/api/me/nickname") {
    const result = await user.setNickname((await body(request, 1024)).nickname);
    return result.ok ? reply(200, result) : fail(400, "NICKNAME", result.message);
  }
  if (path === "/api/me/import") {
    const input = await body(request, MAX_IMPORT_BODY);
    if (!Array.isArray(input.records)) return fail(400, "INVALID", "기록 형식이 올바르지 않아요.");
    const records = input.records.map((r) => sanitizeRecord(r, b.now()));
    if (records.some((r) => !r)) return fail(400, "INVALID", "올바르지 않은 기록이 있어요.");
    let guestId: string | null = null;
    if (input.guestKey !== undefined) {
      if (typeof input.guestKey !== "string" || input.guestKey.length < 40 || input.guestKey.length > 64) return fail(400, "INVALID", "게스트 정보가 올바르지 않아요.");
      // The guest id is derived from the key: only the device that holds the key can link its records.
      guestId = "g_" + (await sha256("yachtlab-guest:" + input.guestKey)).slice(0, 22);
      if ((await b.guest(guestId).claim(me.userId)) === "taken") return fail(409, "GUEST_TAKEN", "이 기기의 게스트 기록은 이미 다른 계정에 연결되어 있어요.");
    }
    const result = await user.importRecords(records as MatchRecord[], guestId ? "guest-import" : "device", guestId);
    return "error" in result ? fail(400, "IMPORT", result.error) : reply(200, result);
  }
  if (path === "/api/me/logout") {
    await user.logout(me.secret);
    return reply(200, { ok: true });
  }
  if (path === "/api/me/logout-all") {
    await user.logoutAll();
    return reply(200, { ok: true });
  }
  if (path === "/api/me/delete") {
    if ((await body(request, 256)).confirm !== "DELETE") return fail(400, "CONFIRM", "삭제 확인이 필요해요.");
    const guests = await user.deleteAccount();
    await Promise.all(guests.map((g) => b.guest(g).release(me.userId).catch(() => undefined)));
    return reply(200, { ok: true });
  }
  return fail(404, "NOT_FOUND", "없는 주소입니다.");
}
