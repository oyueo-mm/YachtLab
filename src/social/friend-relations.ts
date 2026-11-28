import { api, session } from "../identity/account-client";

/**
 * Friend requests from anywhere in the game (A4): one behaviour for an opponent's profile in a match,
 * the recent-opponents list and (A3) the match result screen.
 *
 * SAFETY RULE (review of #127): a friend request is sent ONLY to a person whose account id is bound to
 * a friend code by the SERVER. The existing Worker friend API cannot do that: it addresses people by
 * friend code only, a code is not derivable from an account id, a member without a code is absent from
 * the search index, searches are capped, nicknames are not unique and can change, and public numbers
 * are not an identity proof. Nickname search / public-stat matching is therefore NEVER used to decide
 * whom to ask. Without a verified mapping the result is "unresolved": nothing is looked up, nothing is
 * sent, and the UI points to manual friend-code entry on the friends page.
 *
 * The verified mapping is an optional adapter capability (`relationByUserId`). The live adapter has none
 * until the server offers it (contract candidates A/B in docs/context/A4-CONTRACT-CANDIDATES-2026-11-27.md,
 * to be built with C4.2); the state machine below is complete and tested against a fake verified adapter.
 *
 * Account isolation: cached relations, in-flight lookups and in-flight sends belong to the signed-in
 * account that started them. Switching or signing out clears the cache and invalidates everything in
 * flight; a late answer for the previous account is dropped, never shown, cached or acted on.
 */
export type Relation = "self" | "friend" | "incoming" | "outgoing" | "blocked" | "none" | "unresolved";
export type Resolved = { relation: Relation; code?: string; nickname: string };
export type VerifiedRelation = { relation: Exclude<Relation, "unresolved">; code: string; nickname: string };
export type FriendApi = {
  /** Server-verified binding of an account id to a friend code and the relation. ABSENT on today's Worker. */
  relationByUserId?(userId: string): Promise<VerifiedRelation>;
  /** Existing endpoint: request by friend code (only ever called with a code from `relationByUserId`). */
  request(code: string): Promise<{ status?: string }>;
};
/**
 * The live Worker (SOC-1): `GET /api/me/friends/relation?userId=…[&room=…]` binds the account id to its
 * friend code on the SERVER (only for my server-verified opponents or a member seated with me in `room`).
 * An older Worker answers 404 for that path → the lookup fails → "unresolved" (manual code entry), so an
 * old Worker can never be made to send to a guessed person. Malformed answers are refused the same way.
 */
const RELATIONS = new Set(["self", "friend", "incoming", "outgoing", "blocked", "none"]);
export const liveApi = (server: string, room?: string | null): FriendApi => ({
  relationByUserId: async (userId) => {
    const v = await api<VerifiedRelation>(server, `/api/me/friends/relation?userId=${encodeURIComponent(userId)}${room ? `&room=${encodeURIComponent(room)}` : ""}`);
    if (!v || !RELATIONS.has(v.relation) || typeof v.code !== "string" || !/^YL[0-9A-Z]{8}$/.test(v.code) || typeof v.nickname !== "string") throw new Error(MANUAL_ADD_MESSAGE);
    return { relation: v.relation, code: v.code, nickname: v.nickname };
  },
  request: (code) => api<{ status?: string }>(server, "/api/me/friends/request", { body: { code } }),
});

/* ------------------------------------------------------------ account scope ------------------------------------------------------------ */
const accountOfSession = () => {
  const s = session();
  return s ? s.split(".")[1] ?? null : null;
};
let scopeProvider: () => string | null = accountOfSession;
let currentScope: string | null | undefined;
let epoch = 0;
const cache = new Map<string, { at: number; value: Resolved }>();
const inflight = new Map<string, Promise<unknown>>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
export const subscribeRelations = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

/** Detects an account change (sign-out, switch) and drops everything that belonged to the old account. */
function syncScope(): number {
  const now = scopeProvider();
  if (currentScope !== now) {
    const first = currentScope === undefined;
    currentScope = now;
    if (!first) {
      epoch++;
      cache.clear();
      inflight.clear();
      notify();
    }
  }
  return epoch;
}
/** Tests: replace how the signed-in account is read. */
export function setScopeProvider(fn: () => string | null) {
  scopeProvider = fn;
  syncScope();
}
if (typeof window !== "undefined") {
  window.addEventListener("yachtlab-session", () => syncScope());
  window.addEventListener("storage", () => syncScope());
}
const key = (server: string, userId: string) => `${currentScope ?? "-"}|${server}|${userId}`;
export function peekRelation(server: string, userId: string): Resolved | null {
  syncScope();
  return cache.get(key(server, userId))?.value ?? null;
}
export function resetRelations() {
  cache.clear();
  inflight.clear();
  epoch++;
  currentScope = undefined;
  syncScope();
}

const TTL = 8_000;
const UNRESOLVED = (nickname = ""): Resolved => ({ relation: "unresolved", nickname });

/** Cached lookup of a person's relation. Never guesses: without the verified capability it is "unresolved" with no network call. */
export async function loadRelation(server: string, userId: string, api: FriendApi = liveApi(server), force = false): Promise<Resolved> {
  const start = syncScope();
  if (!api.relationByUserId) return UNRESOLVED();
  const k = key(server, userId);
  const hit = cache.get(k);
  if (!force && hit && Date.now() - hit.at < TTL) return hit.value;
  const running = inflight.get(k);
  if (running) return running as Promise<Resolved>;
  const p = api
    .relationByUserId(userId)
    .then((v): Resolved => {
      if (syncScope() !== start) return UNRESOLVED(); // the account changed while this was in flight: drop it
      const value: Resolved = { relation: v.relation, code: v.code, nickname: v.nickname };
      cache.set(k, { at: Date.now(), value });
      notify();
      return value;
    })
    // No verified answer (older Worker, network, not my opponent): never guess, never cache.
    .catch((): Resolved => UNRESOLVED())
    .finally(() => {
      if (inflight.get(k) === p) inflight.delete(k);
    });
  inflight.set(k, p);
  return p;
}

export type SendOutcome = { ok: true; relation: "friend" | "outgoing" | "incoming" | "blocked" | "self" | "none"; sent: boolean } | { ok: false; message: string };
export const MANUAL_ADD_MESSAGE = "친구 요청은 상대의 친구 코드로 보낼 수 있어요. 친구 화면에서 코드를 입력해 주세요.";
/**
 * Send ONE friend request, only to a server-verified person who is currently "none". Never sends when
 * the person is already a friend, already asked (either way), blocked, yourself or unresolved; a second
 * tap while the first is running does nothing; nothing is sent (or recorded) for a different account.
 */
export async function sendFriendRequest(server: string, userId: string, api: FriendApi = liveApi(server)): Promise<SendOutcome> {
  const start = syncScope();
  const k = key(server, userId) + "|send";
  const running = inflight.get(k);
  if (running) return running as Promise<SendOutcome>;
  const slot: { p?: Promise<SendOutcome> } = {};
  const p = (slot.p = (async (): Promise<SendOutcome> => {
    try {
      const now = await loadRelation(server, userId, api, true); // fresh: someone may have asked meanwhile
      if (syncScope() !== start) return { ok: false, message: "계정이 바뀌어 요청을 보내지 않았어요." };
      if (now.relation === "unresolved" || !now.code) return { ok: false, message: MANUAL_ADD_MESSAGE };
      if (now.relation !== "none") return { ok: true, relation: now.relation, sent: false };
      const r = await api.request(now.code);
      if (syncScope() !== start) return { ok: false, message: "계정이 바뀌어 결과를 반영하지 않았어요." }; // late answer of the old account
      const relation = r.status === "friends" ? "friend" : "outgoing";
      cache.set(key(server, userId), { at: Date.now(), value: { ...now, relation } });
      notify();
      return { ok: true, relation, sent: true };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "친구 요청을 보내지 못했어요." };
    } finally {
      if (inflight.get(k) === slot.p) inflight.delete(k);
    }
  })());
  inflight.set(k, p);
  return p;
}

/** The signed-in account id ("" when signed out), reactive: components re-run their loads when it changes. */
export const accountKey = () => {
  syncScope();
  return currentScope ?? "";
};
