import { FRIEND_LIMITS, normalizeCode, type FriendLists, type Invite, type Peer } from "./friends";
import { validateNickname } from "../../src/identity/nickname";

/**
 * Friend routes (I/J, 2026-11-25). Members only (a valid session). Players are addressed by friend
 * code; internal ids, e-mail and OAuth data are never in a response. Every cross-account step is
 * idempotent, so a retry after a lost reply never doubles anything.
 *
 *   GET  /api/me/friends                   lists + friends' status (online / playing / offline)
 *   POST /api/me/friends/search  {query}   exact friend code or exact nickname, ≤ 10 results
 *   POST /api/me/friends/request {code}    send (crossing requests become friends at once)
 *   POST /api/me/friends/accept|decline|cancel|remove|block|unblock {code}
 *   GET  /api/me/friends/profile?code=…    a friend's (or search result's) public profile
 *   GET  /api/me/inbox                     request count + invites (also "I am here" for friends)
 *   POST /api/me/invites/decline {id}
 * Room invites (send / accept) need the room and live in index.ts.
 */
export interface FriendUser {
  /** Dispatch to this account's FriendStore (see UserStore.fr). */
  fr<T = unknown>(op: string, ...args: unknown[]): Promise<T>;
  nickname(): Promise<string | null>;
  /** `viewer`: shown only to a player this account also lists as a friend (else "offline"). */
  presence(viewer?: string): Promise<"playing" | "online" | "offline">;
  ping(): Promise<void>;
  publicProfile(): Promise<unknown>;
}
export interface FriendIndexApi {
  /** `avoid`: retired codes of the account's deleted generations, never handed back. */
  register(userId: string, nickname: string, avoid?: string[]): Promise<string>;
  lookup(code: string): Promise<Peer | null>;
  search(nickname: string): Promise<Peer[]>;
  live?(pairs: { userId: string; code: string }[]): Promise<boolean[]>;
}
/**
 * Residue of accounts deleted BEFORE the C4.2 cleanup (rows in other players' lists): "off" (default, no
 * check), "dry-run" (count only, nothing changes), "on" (forget them). Operator decision — see
 * docs/audits/c4-2026-11-28/C4-2-ACCOUNT-SECURITY.md.
 */
export type ResidueMode = "off" | "dry-run" | "on";
export type FriendDeps = {
  user(userId: string): FriendUser;
  index: FriendIndexApi;
  limited(key: string, perMinute: number): Promise<boolean>;
  now(): number;
  residue?: ResidueMode;
  /** Privacy-light operations counter (no ids). */
  metric?(key: string, n: number): Promise<void>;
};
type Reply = (status: number, body: unknown) => Response;

/** The caller as a peer (registering a friend code the first time). */
export async function selfPeer(userId: string, d: FriendDeps): Promise<Peer> {
  const u = d.user(userId);
  const nickname = (await u.nickname()) ?? "이름 없음";
  let code = await u.fr<string | null>("code");
  if (!code) {
    const retired = await u.fr<string[]>("retiredCodes");
    code = await d.index.register(userId, nickname, retired);
    code = (await u.fr<string | null>("setCode", code)) ?? code;
  }
  return { userId, code, nickname };
}

/**
 * Both sides agreed (`aCode` / `bPeer` from the side that acts last): after writing my side, confirm the
 * other side still holds the friendship of this generation; otherwise (it was deleted meanwhile) undo
 * mine. Closes the race "account deleted while its request is being accepted".
 */
async function confirmFriend(me: FriendUser, other: FriendUser, meId: string, meCode: string, peer: Peer, now: number): Promise<boolean> {
  await me.fr("addFriend", peer, now);
  if (await other.fr<boolean>("isFriend", meId, meCode)) return true;
  await me.fr("removeFriend", peer.userId);
  return false;
}

export async function handleFriendRoute(request: Request, url: URL, me: { userId: string }, d: FriendDeps, reply: Reply, readBody: () => Promise<Record<string, unknown>>): Promise<Response | null> {
  const path = url.pathname;
  const method = request.method;
  const fail = (status: number, code: string, message: string) => reply(status, { error: { code, message } });
  if (!path.startsWith("/api/me/friends") && path !== "/api/me/inbox" && !path.startsWith("/api/me/invites")) return null;
  const user = d.user(me.userId);

  if (path === "/api/me/inbox" && method === "GET") {
    await user.ping();
    const box = await user.fr<{ requests: number; invites: number }>("inboxCount", d.now());
    const invites = await user.fr<Invite[]>("invites", d.now());
    return reply(200, { requests: box.requests, invites });
  }
  if (path === "/api/me/friends" && method === "GET") {
    const self = await selfPeer(me.userId, d);
    await residueCheck(me.userId, d);
    const lists = await user.fr<FriendLists>("lists");
    // Status of friends only (fan-out to at most 200 small objects, only while the page is open); each
    // answers only if it lists me as a friend too.
    const ids = await Promise.all(lists.friends.map((f) => user.fr<string | null>("peerId", f.code)));
    const status = await Promise.all(ids.map((id) => (id ? d.user(id).presence(me.userId).catch(() => "offline" as const) : "offline")));
    return reply(200, { me: { code: self.code, nickname: self.nickname }, friends: lists.friends.map((f, i) => ({ ...f, status: status[i] })), incoming: lists.incoming, outgoing: lists.outgoing, blocked: lists.blocked });
  }
  if (path === "/api/me/friends/profile" && method === "GET") {
    const code = normalizeCode(url.searchParams.get("code"));
    const peer = code ? await d.index.lookup(code) : null;
    if (!peer || (await d.user(peer.userId).fr<boolean>("isBlocking", me.userId))) return fail(404, "NOT_FOUND", "프로필을 찾을 수 없어요.");
    const profile = (await d.user(peer.userId).publicProfile()) as Record<string, unknown> | null;
    if (!profile) return fail(404, "NOT_FOUND", "프로필을 찾을 수 없어요.");
    const { userId: _hidden, ...open } = profile;
    return reply(200, { ...open, code: peer.code });
  }
  if (method !== "POST") return fail(404, "NOT_FOUND", "없는 주소입니다.");
  const input = await readBody();

  if (path === "/api/me/invites/decline") {
    await user.fr("takeInvite", String(input.id ?? ""), d.now());
    return reply(200, { ok: true });
  }
  if (path === "/api/me/friends/search") {
    if (await d.limited("fsearch:" + me.userId, 20)) return fail(429, "RATE_LIMITED", "잠시 후 다시 검색해 주세요.");
    if (!(await user.fr<boolean>("spend", "searches", FRIEND_LIMITS.searchesPerDay, d.now()))) return fail(429, "DAILY_LIMIT", "오늘은 검색을 더 할 수 없어요.");
    const raw = typeof input.query === "string" ? input.query.trim() : "";
    const code = normalizeCode(raw);
    let found: Peer[] = code ? [await d.index.lookup(code)].filter((p): p is Peer => !!p) : [];
    if (!found.length) {
      const nick = validateNickname(raw);
      if (!nick.ok) return fail(400, "QUERY", "닉네임 전체 또는 친구 코드를 입력해 주세요.");
      found = await d.index.search(nick.name);
    }
    const results = [];
    for (const p of found) {
      if (p.userId === me.userId) {
        results.push({ code: p.code, nickname: p.nickname, relation: "self" });
        continue;
      }
      // Players who block me are not shown (and I learn nothing about the block).
      if (await d.user(p.userId).fr<boolean>("isBlocking", me.userId)) continue;
      results.push({ code: p.code, nickname: p.nickname, relation: await user.fr<string>("relation", p.userId) });
    }
    return reply(200, { results });
  }

  const code = normalizeCode(input.code);
  if (!code) return fail(400, "CODE", "친구 코드가 올바르지 않아요.");
  // request / block address anyone by their current code (global index); the rest act on my own lists.
  const found = path === "/api/me/friends/request" || path === "/api/me/friends/block" ? await d.index.lookup(code) : null;
  const peerId = found ? found.userId : path === "/api/me/friends/request" || path === "/api/me/friends/block" ? null : await user.fr<string | null>("peerId", code);
  if (!peerId || peerId === me.userId) return fail(404, "NOT_FOUND", "사용자를 찾을 수 없어요.");
  const self = await selfPeer(me.userId, d);
  const other = d.user(peerId);
  const now = d.now();

  if (path === "/api/me/friends/request") {
    if (await d.limited("freq:" + me.userId, 10)) return fail(429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.");
    // The target as the index knows it now (its current generation), without writing to its account.
    const target: Peer = { userId: peerId, code, nickname: found!.nickname || ((await other.nickname()) ?? "이름 없음") };
    const ok = await user.fr<{ ok: boolean; code?: string; message?: string }>("canRequest", target, now);
    if (!ok.ok) return fail(409, ok.code!, ok.message!);
    if (!(await user.fr<boolean>("spend", "requests", FRIEND_LIMITS.requestsPerDay, now))) return fail(429, "DAILY_LIMIT", "오늘은 친구 요청을 더 보낼 수 없어요.");
    // My side first: if the target is deleted after receiving the request, its deletion finds the request
    // in its lists and makes me forget it; if it is deleted before, it answers "gone" and I drop it here.
    await user.fr("recordOutgoing", target, now);
    const got = await other.fr<"stored" | "friends" | "already" | "silent" | "gone">("receiveRequest", self, now);
    if (got === "gone") {
      await user.fr("cancelOutgoing", peerId);
      return fail(404, "NOT_FOUND", "사용자를 찾을 수 없어요.");
    }
    if (got === "friends" || got === "already") {
      if (await confirmFriend(user, other, me.userId, self.code, target, now)) return reply(200, { status: "friends" });
      return fail(404, "NOT_FOUND", "사용자를 찾을 수 없어요.");
    }
    // "silent" (blocked / full inbox) looks exactly like "stored" to the sender.
    return reply(200, { status: "sent" });
  }
  if (path === "/api/me/friends/accept") {
    const peer = await user.fr<Peer | null>("incomingPeer", code);
    if (!peer) return fail(404, "NOT_FOUND", "받은 친구 요청이 없어요.");
    if ((await user.fr<string[]>("friendIds")).length >= FRIEND_LIMITS.maxFriends) return fail(409, "FULL", `친구는 ${FRIEND_LIMITS.maxFriends}명까지예요.`);
    // The requester's account must still hold this request (same generation): a deleted account, or the
    // same Google account re-joined since, never becomes a friend without asking (SEC-03 R2).
    const gone = () => fail(404, "REQUEST_GONE", "더 이상 유효하지 않은 친구 요청이에요.");
    if (!(await d.user(peer.userId).fr<boolean>("acceptedBy", self, peer.code, now))) {
      await user.fr("dropIncoming", peer.userId, peer.code);
      return gone();
    }
    if (!(await confirmFriend(user, d.user(peer.userId), me.userId, self.code, peer, now))) return gone();
    return reply(200, { status: "friends" });
  }
  if (path === "/api/me/friends/decline") {
    if (await user.fr<boolean>("declineIncoming", peerId)) await other.fr("outgoingDeclined", me.userId, now);
    return reply(200, { ok: true });
  }
  if (path === "/api/me/friends/cancel") {
    await user.fr("cancelOutgoing", peerId);
    await other.fr("incomingCancelled", me.userId);
    return reply(200, { ok: true });
  }
  if (path === "/api/me/friends/remove") {
    await user.fr("removeFriend", peerId);
    await other.fr("removeFriend", me.userId);
    return reply(200, { ok: true });
  }
  if (path === "/api/me/friends/block") {
    const target: Peer = { userId: peerId, code, nickname: found!.nickname || ((await other.nickname()) ?? "이름 없음") };
    await user.fr("block", target, now);
    await other.fr("blockedBy", me.userId, self.code, now);
    return reply(200, { ok: true });
  }
  if (path === "/api/me/friends/unblock") {
    await user.fr("unblock", peerId);
    await other.fr("unblockedBy", me.userId);
    return reply(200, { ok: true });
  }
  return fail(404, "NOT_FOUND", "없는 주소입니다.");
}

/**
 * Residue of accounts deleted before the C4.2 cleanup (see ResidueMode): when the owner opens the friend
 * list, at most once a day, one call to the global index checks which (id, code) rows still name a live
 * account. Off by default; "dry-run" only counts. Never throws (the list is shown either way).
 */
async function residueCheck(userId: string, d: FriendDeps) {
  const mode = d.residue ?? "off";
  if (mode === "off" || !d.index.live) return;
  try {
    const user = d.user(userId);
    const pairs = await user.fr<{ userId: string; code: string }[]>("residuePairs", d.now());
    if (!pairs.length) return;
    const live = await d.index.live(pairs);
    const stale = pairs.filter((_, i) => live[i] === false);
    if (!stale.length) return;
    await d.metric?.(`friends.residue.${mode === "on" ? "cleaned" : "found"}`, stale.length);
    if (mode === "on") await user.fr("forgetMany", stale);
  } catch {
    /* best effort */
  }
}

/** Room invite to friends (J): returns, per code, "sent" / "not-friend" / "recent". Blocks stay invisible ("sent"). */
export async function sendInvites(me: { userId: string }, codes: string[], room: string, d: FriendDeps, newId: () => string): Promise<Record<string, string>> {
  const user = d.user(me.userId);
  const self = await selfPeer(me.userId, d);
  const out: Record<string, string> = {};
  for (const raw of codes.slice(0, 19)) {
    const code = normalizeCode(raw);
    if (!code) continue;
    const id = await user.fr<string | null>("peerId", code);
    if (!id || !(await user.fr<boolean>("isFriend", id))) {
      out[code] = "not-friend";
      continue;
    }
    const got = await d.user(id).fr<string>("receiveInvite", self, room, newId(), d.now());
    out[code] = got === "recent" ? "recent" : "sent";
  }
  return out;
}
