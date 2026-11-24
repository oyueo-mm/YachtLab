/**
 * Google sign-in (OpenID Connect, authorization code flow + PKCE) for the YachtLab Worker.
 * Runtime-free (Web Crypto + an injected `fetch`), so it is unit-tested in Node with a fake provider.
 *
 * Security (docs/online/SOCIAL-AND-ACCOUNTS.md §인증):
 *  - Confidential client: the client secret lives only in Worker secrets, never in the web bundle.
 *  - state (CSRF) + nonce (token replay) + PKCE S256 (code interception), all random per login,
 *    kept in an AES-GCM encrypted, HttpOnly, Secure, SameSite=Lax cookie on the Worker's own origin
 *    for the ten minutes of the redirect (a first-party cookie: no third-party cookie needed).
 *  - The ID token is verified here even though it comes straight from Google's token endpoint:
 *    RS256 signature against Google's JWKS, issuer, audience, expiry/issued-at, nonce. `alg` other than
 *    RS256 is refused (no "none", no HS256 confusion).
 *  - Scope is `openid` only: no e-mail, no name, no profile picture is requested or stored.
 */
export type OidcProvider = {
  name: "google";
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  issuers: string[];
};
export const GOOGLE: OidcProvider = {
  name: "google",
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
  issuers: ["https://accounts.google.com", "accounts.google.com"],
};

const enc = new TextEncoder();
export const b64url = (bytes: Uint8Array) => {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const fromB64url = (text: string) => {
  const b = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
export const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));
export async function sha256(text: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text))));
}
export function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* ------------------------------------------------------------- sealed cookie ------------------------------------------------------------- */

async function cookieKey(secret: string) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode("yachtlab-oidc-cookie:" + secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function seal(value: unknown, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cookieKey(secret), enc.encode(JSON.stringify(value))));
  return b64url(iv) + "." + b64url(data);
}
export async function unseal<T>(sealed: string | null | undefined, secret: string): Promise<T | null> {
  if (!sealed || sealed.length > 4096) return null;
  const [iv, data] = sealed.split(".");
  if (!iv || !data) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv) }, await cookieKey(secret), fromB64url(data));
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- login start ------------------------------------------------------------- */

export type LoginState = { state: string; nonce: string; verifier: string; cs: string; exp: number };
export const LOGIN_TTL_MS = 10 * 60_000;

/** Build the authorization redirect and the state to remember (in the sealed cookie). */
export async function beginLogin(opts: { provider: OidcProvider; clientId: string; redirectUri: string; clientStateHash: string; now: number }) {
  const login: LoginState = { state: randomToken(), nonce: randomToken(), verifier: randomToken(48), cs: opts.clientStateHash, exp: opts.now + LOGIN_TTL_MS };
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(login.verifier))));
  const url = new URL(opts.provider.authorizationEndpoint);
  url.search = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: "openid",
    state: login.state,
    nonce: login.nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return { url: url.toString(), login };
}

/* ------------------------------------------------------------- ID token ------------------------------------------------------------- */

type Jwk = JsonWebKey & { kid?: string; alg?: string; kty?: string };
let jwksCache: { uri: string; keys: Jwk[]; at: number } | null = null;
export function resetJwksCache() {
  jwksCache = null;
}

async function jwks(provider: OidcProvider, fetcher: typeof fetch, now: number, refresh = false): Promise<Jwk[]> {
  if (!refresh && jwksCache && jwksCache.uri === provider.jwksUri && now - jwksCache.at < 3600_000) return jwksCache.keys;
  const res = await fetcher(provider.jwksUri);
  if (!res.ok) throw new OidcError("JWKS", "공개 키를 가져오지 못했어요.");
  const body = (await res.json()) as { keys?: Jwk[] };
  if (!Array.isArray(body.keys)) throw new OidcError("JWKS", "공개 키 형식이 올바르지 않아요.");
  jwksCache = { uri: provider.jwksUri, keys: body.keys, at: now };
  return body.keys;
}

export class OidcError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export type IdClaims = { iss: string; aud: string | string[]; sub: string; exp: number; iat: number; nonce?: string; azp?: string };

/** Verify a compact JWS ID token: RS256 signature (kid from JWKS), iss, aud, exp, iat, nonce. */
export async function verifyIdToken(token: string, opts: { provider: OidcProvider; clientId: string; nonce: string; now: number; fetcher: typeof fetch }): Promise<IdClaims> {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 3 || token.length > 8192) throw new OidcError("TOKEN", "로그인 정보 형식이 올바르지 않아요.");
  let header: { alg?: string; kid?: string; typ?: string };
  let claims: IdClaims;
  try {
    header = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(fromB64url(parts[1])));
  } catch {
    throw new OidcError("TOKEN", "로그인 정보 형식이 올바르지 않아요.");
  }
  if (header.alg !== "RS256") throw new OidcError("ALG", "지원하지 않는 서명 방식이에요.");
  let keys = await jwks(opts.provider, opts.fetcher, opts.now);
  let jwk = keys.find((k) => k.kid === header.kid && k.kty === "RSA");
  if (!jwk) {
    // Keys rotate: refresh once before refusing.
    keys = await jwks(opts.provider, opts.fetcher, opts.now, true);
    jwk = keys.find((k) => k.kid === header.kid && k.kty === "RSA");
  }
  if (!jwk) throw new OidcError("KID", "서명 키를 찾을 수 없어요.");
  const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromB64url(parts[2]), enc.encode(parts[0] + "." + parts[1]));
  if (!ok) throw new OidcError("SIGNATURE", "로그인 정보의 서명이 올바르지 않아요.");
  const sec = Math.floor(opts.now / 1000);
  if (!opts.provider.issuers.includes(claims.iss)) throw new OidcError("ISS", "발급자가 올바르지 않아요.");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(opts.clientId) || (aud.length > 1 && claims.azp !== opts.clientId)) throw new OidcError("AUD", "이 서비스용 로그인 정보가 아니에요.");
  if (!Number.isFinite(claims.exp) || claims.exp < sec - 60) throw new OidcError("EXP", "로그인 정보가 만료되었어요.");
  if (!Number.isFinite(claims.iat) || claims.iat > sec + 300) throw new OidcError("IAT", "로그인 정보의 시각이 올바르지 않아요.");
  if (typeof claims.nonce !== "string" || !sameText(claims.nonce, opts.nonce)) throw new OidcError("NONCE", "로그인 요청이 일치하지 않아요.");
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 255) throw new OidcError("SUB", "계정 식별자가 올바르지 않아요.");
  return claims;
}

/** Exchange the authorization code (with the PKCE verifier and client secret) and verify the ID token. */
export async function finishLogin(opts: {
  provider: OidcProvider;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  login: LoginState;
  now: number;
  fetcher: typeof fetch;
}): Promise<IdClaims> {
  const res = await opts.fetcher(opts.provider.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      code_verifier: opts.login.verifier,
    }).toString(),
  });
  if (!res.ok) throw new OidcError("EXCHANGE", "로그인을 완료하지 못했어요.");
  const body = (await res.json()) as { id_token?: string };
  if (typeof body.id_token !== "string") throw new OidcError("EXCHANGE", "로그인을 완료하지 못했어요.");
  return verifyIdToken(body.id_token, { provider: opts.provider, clientId: opts.clientId, nonce: opts.login.nonce, now: opts.now, fetcher: opts.fetcher });
}

/** Internal account id for a provider subject: not reversible, stable, different per provider. */
export async function userIdFor(provider: string, sub: string): Promise<string> {
  return "u_" + (await sha256(`yachtlab-user:${provider}:${sub}`)).slice(0, 22);
}
export const USER_ID = /^u_[A-Za-z0-9_-]{22}$/;
