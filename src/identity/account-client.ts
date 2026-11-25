import type { ReviewMatch } from "../review/model";
import type { MatchReceipt } from "../economy/live/receipt";
import type { MatchRecord } from "./records";

/**
 * Browser side of accounts (Phase 4). Sign-in is optional and off until the server says it is
 * configured (`/api/auth/config`). Nothing here pretends a sign-in happened.
 *
 * Session: a bearer token kept in localStorage (the API is another site, so third-party cookies would
 * not work on phones). Login flow: this page → Worker /auth/google/start (sealed state cookie there)
 * → Google → Worker callback → back here with a one-time code in the URL fragment (never sent to a
 * server by the browser), which is exchanged together with a random value only this tab knows.
 */
const SESSION_KEY = "yachtlab.session.v1";
const LOGIN_STATE_KEY = "yachtlab.login.state";

export type Profile = { userId: string; provider: string; nickname: string | null; createdAt: number };
export type PublicProfile = { userId: string; nickname: string; joinedAt: number; online: { games: number; wins: number; losses: number; draws: number; best: number | null; average: number | null } };

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function sha256(text: string) {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

export function session(): string | null {
  try {
    const s = localStorage.getItem(SESSION_KEY);
    return s && /^s1\.u_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/.test(s) ? s : null;
  } catch {
    return null;
  }
}
function setSession(value: string | null) {
  try {
    if (value) localStorage.setItem(SESSION_KEY, value);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event("yachtlab-session"));
}
/** Header for API calls (online room join/create also send it, so a signed-in seat is recorded). */
export const authHeader = (): Record<string, string> => {
  const s = session();
  return s ? { authorization: "Bearer " + s } : {};
};

export class AccountError extends Error {
  constructor(readonly code: string, message: string, readonly status = 0) {
    super(message);
  }
}
export async function api<T>(server: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(server + path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...authHeader() },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new AccountError("NETWORK", "서버에 연결할 수 없어요.");
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: { code: string; message: string } }) | null;
  if (!res.ok || !data) {
    if (res.status === 401 && session()) setSession(null); // expired / revoked session
    throw new AccountError(data?.error?.code ?? "SERVER", data?.error?.message ?? "요청을 처리하지 못했어요.", res.status);
  }
  return data;
}

let configCache: Promise<boolean> | null = null;
/** Is Google sign-in configured on the server? (false on errors — sign-in simply stays hidden). */
export function signInAvailable(server: string | null): Promise<boolean> {
  if (!server) return Promise.resolve(false);
  configCache ??= api<{ google: boolean }>(server, "/api/auth/config")
    .then((c) => c.google === true)
    .catch(() => false);
  return configCache;
}

export async function startSignIn(server: string) {
  const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
  try {
    sessionStorage.setItem(LOGIN_STATE_KEY, state);
  } catch {
    throw new AccountError("STORAGE", "이 브라우저에서는 로그인을 시작할 수 없어요(저장소 차단).");
  }
  location.assign(`${server}/auth/google/start?cs=${await sha256(state)}`);
}

/**
 * Finish a sign-in when the page was opened by the Worker's redirect (`#login=` / `#login-error=`).
 * Returns a message to show, or null when the URL had nothing to do with sign-in.
 */
export async function completeSignIn(server: string | null): Promise<{ ok: boolean; message: string } | null> {
  const hash = location.hash;
  if (!hash.startsWith("#login=") && !hash.startsWith("#login-error=")) return null;
  const clean = () => history.replaceState(history.state, "", location.pathname + location.search + "#profile");
  if (hash.startsWith("#login-error=")) {
    clean();
    const reason = hash.slice("#login-error=".length);
    return { ok: false, message: reason === "cancelled" ? "로그인을 취소했어요." : "로그인을 완료하지 못했어요. 다시 시도해 주세요." };
  }
  const code = decodeURIComponent(hash.slice("#login=".length));
  clean(); // the one-time code leaves the address bar immediately
  let state: string | null = null;
  try {
    state = sessionStorage.getItem(LOGIN_STATE_KEY);
    sessionStorage.removeItem(LOGIN_STATE_KEY);
  } catch {
    /* ignore */
  }
  if (!server || !state) return { ok: false, message: "이 브라우저에서 시작한 로그인이 아니에요. 다시 로그인해 주세요." };
  try {
    const r = await api<{ session: string }>(server, "/api/auth/exchange", { body: { code, clientState: state } });
    setSession(r.session);
    return { ok: true, message: "로그인했어요." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "로그인을 완료하지 못했어요." };
  }
}

export const me = (server: string) => api<{ profile: Profile }>(server, "/api/me").then((r) => r.profile);
export const serverRecords = (server: string) => api<{ records: MatchRecord[] }>(server, "/api/me/records?limit=500").then((r) => r.records);
export const setNickname = (server: string, nickname: string) => api<{ nickname: string }>(server, "/api/me/nickname", { body: { nickname } });
export const publicProfile = (server: string, userId: string) => api<PublicProfile>(server, "/api/profiles/" + encodeURIComponent(userId));
export async function importRecords(server: string, records: MatchRecord[], guestKey?: string) {
  let added = 0,
    skipped = 0;
  for (let i = 0; i < records.length; i += 150) {
    const r = await api<{ added: number; skipped: number }>(server, "/api/me/import", { body: { records: records.slice(i, i + 150), ...(guestKey ? { guestKey } : {}) } });
    added += r.added;
    skipped += r.skipped;
  }
  return { added, skipped };
}
export async function signOut(server: string, everywhere = false) {
  try {
    await api(server, everywhere ? "/api/me/logout-all" : "/api/me/logout", { body: {} });
  } finally {
    setSession(null);
  }
}
export async function deleteAccount(server: string) {
  await api(server, "/api/me/delete", { body: { confirm: "DELETE" } });
  setSession(null);
}

export const matchReview = (server: string, matchId: string) => api<{ review: ReviewMatch | null }>(server, `/api/me/records/${encodeURIComponent(matchId)}/review`).then((r) => r.review);
export const matchReward = (server: string, matchId: string) => api<{ receipt: MatchReceipt | null }>(server, `/api/me/records/${encodeURIComponent(matchId)}/reward`).then((r) => r.receipt);
