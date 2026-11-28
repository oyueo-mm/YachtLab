import { authHeader } from "../identity/account-client";

/**
 * ADMIN-1 browser client. Holds NO secret of its own: the admin session is obtained from the server
 * with the member's own sign-in, kept in sessionStorage (gone when the tab closes), and every call is
 * checked again on the server (role, permission, expiry). Hiding this screen is not access control.
 */
const KEY = "yachtlab.admin.v1";
export type AdminSession = { token: string; role: string; permissions: string[]; writes: boolean; selfApprove: boolean; approval?: string; reauth?: string; reauthAt?: number | null; rewardPolicy?: string | null; freshMs: number; at: number };
const REAUTH_STATE = "yachtlab.admin.reauth.state";
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha256 = async (t: string) => b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t))));

/**
 * Real re-authentication (D-107b): leave for Google with prompt=login / max_age=0. The Worker checks
 * auth_time and returns `#admin-reauth=<one-time ticket>`; only this tab knows the client state.
 */
export async function startAdminReauth(server: string) {
  const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
  sessionStorage.setItem(REAUTH_STATE, state);
  location.assign(`${server}/auth/google/start?cs=${await sha256(state)}&purpose=admin`);
}
/** On return from Google: the ticket (or error) from the address bar, removed at once. */
export function takeReauthResult(): { ticket?: string; error?: string } | null {
  const h = location.hash;
  if (!h.startsWith("#admin-reauth=") && !h.startsWith("#admin-reauth-error=")) return null;
  history.replaceState(history.state, "", location.pathname + location.search + "#admin");
  return h.startsWith("#admin-reauth=") ? { ticket: decodeURIComponent(h.slice("#admin-reauth=".length)) } : { error: h.slice("#admin-reauth-error=".length) };
}

export function adminSession(): AdminSession | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as AdminSession | null;
    return v && /^a1\.[A-Za-z0-9_-]{43}$/.test(v.token) ? v : null;
  } catch {
    return null;
  }
}
function save(v: AdminSession | null) {
  try {
    if (v) sessionStorage.setItem(KEY, JSON.stringify(v));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}
export class AdminError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
  }
}

export async function adminSignIn(server: string, ticket?: string): Promise<AdminSession> {
  let clientState: string | null = null;
  if (ticket) {
    try {
      clientState = sessionStorage.getItem(REAUTH_STATE);
      sessionStorage.removeItem(REAUTH_STATE);
    } catch {
      /* ignore */
    }
  }
  const payload = ticket && clientState ? JSON.stringify({ reauth: ticket, clientState }) : "{}";
  const res = await fetch(server + "/api/admin/session", { method: "POST", headers: { "content-type": "application/json", ...authHeader() }, body: payload });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.token) throw new AdminError(res.status === 404 ? "NOT_ADMIN" : body?.error?.code ?? "SERVER", res.status === 404 ? "관리자 권한이 있는 계정으로 로그인해 주세요." : body?.error?.message ?? "관리자 로그인에 실패했어요.", res.status);
  const s: AdminSession = { token: body.token, role: body.role, permissions: body.permissions, writes: body.writes, selfApprove: body.selfApprove, approval: body.approval, reauth: body.reauth, reauthAt: body.reauthAt, rewardPolicy: body.rewardPolicy, freshMs: body.freshMs, at: body.reauthAt ?? Date.now() };
  save(s);
  return s;
}
export async function adminSignOut(server: string) {
  const s = adminSession();
  save(null);
  if (s) await fetch(server + "/api/admin/logout", { method: "POST", headers: { authorization: "Bearer " + s.token, "content-type": "application/json" }, body: "{}" }).catch(() => undefined);
}

export async function adminApi<T = any>(server: string, path: string, body?: unknown): Promise<T> {
  const s = adminSession();
  if (!s) throw new AdminError("NO_SESSION", "관리자 로그인이 필요해요.", 401);
  let res: Response;
  try {
    res = await fetch(server + path, { method: body === undefined ? "GET" : "POST", headers: { authorization: "Bearer " + s.token, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new AdminError("NETWORK", "서버에 연결할 수 없어요.", 0);
  }
  const data = await res.json().catch(() => null);
  // an expired or revoked admin session is answered exactly like a missing route
  if (res.status === 404 && data?.error?.message === "없는 주소입니다.") save(null);
  if (!res.ok) throw new AdminError(data?.error?.code ?? "SERVER", data?.error?.message ?? "요청을 처리하지 못했어요.", res.status);
  return data as T;
}
