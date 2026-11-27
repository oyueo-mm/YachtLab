import { publicProfile as fetchPublicProfile, type PublicProfile } from "../identity/account-client";
import { friendAction, friendProfile, friends as loadFriends, searchFriends, type FriendProfile, type SearchResult } from "../identity/friends-client";

/**
 * Friend requests from anywhere in the game (A4): an opponent's profile in a match, the recent-opponents
 * list, and (reusable by the match result screen) a button — one shared behaviour.
 *
 * Contract note: the Worker friend API addresses people by FRIEND CODE only (random, not derivable from
 * the account id) and the game knows opponents by account id (`members`, server records). Until a
 * request-by-profile endpoint exists (proposed in docs/context/A4-CONTRACT-CANDIDATES-2026-11-27.md; the
 * friend API is C4.2's and is NOT changed here) the code is resolved through the EXISTING endpoints:
 * the opponent's public profile → exact-nickname search → if several people share the nickname, compare
 * the public profile numbers (join date and server-verified totals) with `friends/profile`. A person who
 * cannot be told apart safely is reported as "unresolved" and nothing is sent.
 */
export type Relation = "self" | "friend" | "incoming" | "outgoing" | "blocked" | "none" | "unresolved";
export type Resolved = { relation: Relation; code?: string; nickname: string };
export type FriendApi = {
  profile(userId: string): Promise<PublicProfile>;
  search(query: string): Promise<SearchResult[]>;
  friendProfile(code: string): Promise<FriendProfile>;
  action(action: "request", code: string): Promise<{ status?: string }>;
};
export const liveApi = (server: string): FriendApi => ({
  profile: (userId) => fetchPublicProfile(server, userId),
  search: (query) => searchFriends(server, query),
  friendProfile: (code) => friendProfile(server, code),
  action: (action, code) => friendAction(server, action, code),
});

const sameNumbers = (a: PublicProfile, b: FriendProfile) =>
  a.joinedAt === b.joinedAt && a.online.games === b.online.games && a.online.wins === b.online.wins && a.online.losses === b.online.losses && a.online.draws === b.online.draws && a.online.best === b.online.best;

/** Who is this account id in friend terms (relation + code), or "unresolved" when it cannot be told safely. */
export async function resolveRelation(api: FriendApi, userId: string): Promise<Resolved> {
  const profile = await api.profile(userId);
  const found = (await api.search(profile.nickname)).filter((r) => r.nickname === profile.nickname);
  if (found.length === 0) return { relation: "unresolved", nickname: profile.nickname };
  if (found.length === 1) return { relation: found[0].relation, code: found[0].code, nickname: profile.nickname };
  // Same nickname, several people: only the one whose public numbers match is accepted.
  const matches: SearchResult[] = [];
  for (const r of found) {
    if (r.relation === "self") continue;
    try {
      if (sameNumbers(profile, await api.friendProfile(r.code))) matches.push(r);
    } catch {
      /* a profile that cannot be read cannot be matched */
    }
  }
  return matches.length === 1 ? { relation: matches[0].relation, code: matches[0].code, nickname: profile.nickname } : { relation: "unresolved", nickname: profile.nickname };
}

/* ------------------------------------------------------------ shared state (cache, in-flight, events) ------------------------------------------------------------ */
const TTL = 8_000; // short: reopening a profile after the other person answered shows the new state
const cache = new Map<string, { at: number; value: Resolved }>();
const inflight = new Map<string, Promise<unknown>>();
const listeners = new Set<() => void>();
const key = (server: string, userId: string) => server + "|" + userId;
const notify = () => listeners.forEach((l) => l());
export const subscribeRelations = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
export const peekRelation = (server: string, userId: string) => cache.get(key(server, userId))?.value ?? null;
/** Tests / account switch. */
export function resetRelations() {
  cache.clear();
  inflight.clear();
}

/** Cached lookup; concurrent callers share one network round (no double search). */
export function loadRelation(server: string, userId: string, api: FriendApi = liveApi(server), force = false): Promise<Resolved> {
  const k = key(server, userId);
  const hit = cache.get(k);
  if (!force && hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.value);
  const running = inflight.get(k);
  if (running) return running as Promise<Resolved>;
  const p = resolveRelation(api, userId)
    .then((value) => {
      cache.set(k, { at: Date.now(), value });
      notify();
      return value;
    })
    .finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

export type SendOutcome = { ok: true; relation: "friend" | "outgoing" | "incoming" | "blocked" | "self" | "none"; sent: boolean } | { ok: false; message: string };
/**
 * Send ONE friend request. Never sends when the person is already a friend, already asked (either
 * way), blocked, unresolved or yourself; a second tap while the first is running does nothing.
 */
export async function sendFriendRequest(server: string, userId: string, api: FriendApi = liveApi(server)): Promise<SendOutcome> {
  const k = key(server, userId) + "|send";
  const running = inflight.get(k);
  if (running) return running as Promise<SendOutcome>;
  const p = (async (): Promise<SendOutcome> => {
    try {
      const now = await loadRelation(server, userId, api, true); // fresh: someone may have asked meanwhile
      if (now.relation === "unresolved" || !now.code) return { ok: false, message: "이 사람을 안전하게 찾지 못했어요. 친구 코드로 추가해 주세요." };
      if (now.relation !== "none") return { ok: true, relation: now.relation, sent: false };
      const r = await api.action("request", now.code);
      const relation = r.status === "friends" ? "friend" : "outgoing";
      cache.set(key(server, userId), { at: Date.now(), value: { ...now, relation } });
      notify();
      return { ok: true, relation, sent: true };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "친구 요청을 보내지 못했어요." };
    } finally {
      inflight.delete(k);
    }
  })();
  inflight.set(k, p);
  return p;
}

/**
 * A member becomes findable (friend code registered) only when their own account first uses the friends
 * API. The inbox poll does not do that, so once per page load a signed-in client reads its own friend
 * list: the cheapest existing call that registers it. Without this most opponents could not be found.
 * (Proposed server-side fix: register at sign-in — see the A4 contract candidates; the Worker is C4.2's.)
 */
const registered = new Set<string>();
export function ensureSelfRegistered(server: string | null) {
  if (!server || registered.has(server)) return;
  registered.add(server);
  void loadFriends(server).catch(() => registered.delete(server));
}
