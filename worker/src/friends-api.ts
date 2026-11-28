import { FRIEND_LIMITS, normalizeCode, type FriendLists, type Invite, type Peer } from "./friends";
import { validateNickname } from "../../src/identity/nickname";
import { DEVICE_ID, SOCIAL_LIMITS, type FriendStatus, type SentInvite, type SocialSettings } from "./social";

const USER_ID = /^u_[A-Za-z0-9_-]{22}$/;
/** Invite ids are server-made UUIDs; anything else is refused before any storage read (SEC-1). */
export const INVITE_ID = /^[A-Za-z0-9-]{8,64}$/;

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
 * SOC-1 (2026-11-28, docs/online/SOC-1-SOCIAL.md):
 *   GET  /api/me/inbox?device=…            + `sent` (my invites and their state), heartbeat of this tab
 *   POST /api/me/presence {device, state}  "online" | "offline" (tab closed: that tab only)
 *   GET  /api/me/friends/relation?userId=…[&room=…]   relation to a recent opponent / room member
 *   POST /api/me/friends/request {userId[, room]}      the same, by account id (never by nickname)
 *   GET|POST /api/me/friends/settings      presence visibility, pins visibility
 *   GET|PUT  /api/me/profile/pins {ids}    showcase achievements (earned ones only, ≤ 3, no duplicates)
 *   POST /api/me/invites/cancel {id}       take back an invite I sent
 * Room invites (send / accept) and direct challenges need the room and live in index.ts.
 */
export interface FriendUser {
  /** Dispatch to this account's FriendStore (see UserStore.fr). */
  fr<T = unknown>(op: string, ...args: unknown[]): Promise<T>;
  nickname(): Promise<string | null>;
  /** `viewer`: shown only to a player this account also lists as a friend (else "offline"). */
  presence(viewer?: string): Promise<"playing" | "online" | "offline">;
  ping(): Promise<void>;
  /** INT-1: ping + inboxCount + invites + sent in one call (absent on test fakes → the separate calls). */
  inboxBeat?(now: number): Promise<{ box: { requests: number; invites: number }; invites: unknown[]; sent: unknown[] }>;
  publicProfile(): Promise<unknown>;
  /** SOC-1: SocialStore operations of this account (settings, pins, sent invites). */
  social?<T = unknown>(op: string, ...args: unknown[]): Promise<T>;
  /** SOC-1: pins this viewer may see (visibility, blocks and earned state applied by the account itself). */
  showcase?(viewer: string | null): Promise<string[]>;
  /** SOC-1: achievements this account has earned (server economy state). */
  earned?(): Promise<string[]>;
  /** SOC-1: my server-verified results against that account. */
  versus?(userId: string): Promise<{ games: number; wins: number; losses: number; draws: number }>;
  /** SOC-1: did I play that account (a server-verified record names it as my opponent)? */
  playedWith?(userId: string): Promise<boolean>;
}
/** SOC-1: presence in the global FriendIndex object (one call for a whole friend list). */
export interface PresenceApi {
  statuses(userIds: string[]): Promise<FriendStatus[]>;
  beat(userId: string, device: string, state?: "online" | "offline"): Promise<void>;
  setHidden(userId: string, hidden: boolean): Promise<void>;
}
export interface FriendIndexApi {
  /** `avoid`: retired codes of the account's deleted generations, never handed back. */
  register(userId: string, nickname: string, avoid?: string[], keep?: string | null): Promise<string>;
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
  /** SOC-1: central presence (absent: the older per-account fan-out). */
  presence?: PresenceApi;
  /** SOC-1: are both accounts seated in this room right now (in-match profile → friend request)? */
  sharesRoom?(room: string, a: string, b: string): Promise<boolean>;
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
 * SOC-1: any existing account as a peer, registering its friend code if it never had one (accounts made
 * before friend codes were issued at sign-in). Null for an account that does not exist (never made, or
 * deleted) — nothing is written to the index for it.
 */
export async function peerOf(userId: string, d: FriendDeps): Promise<Peer | null> {
  // Existence is the profile, not the nickname (an account may never have set one).
  if (!(await d.user(userId).publicProfile().catch(() => null))) return null;
  return selfPeer(userId, d);
}

/**
 * Friends' statuses. With the central presence: ONE call for the whole list, then only friends who
 * look online / playing are confirmed with their own account (they must still list me — a half-removed
 * friendship shows nothing). Without it (older deployments, tests): the per-account fan-out.
 */
export async function friendStatuses(me: string, peers: { userId: string; code: string }[], d: FriendDeps): Promise<FriendStatus[]> {
  if (!d.presence) return Promise.all(peers.map((p) => d.user(p.userId).presence(me).catch(() => "offline" as const)));
  let raw: FriendStatus[];
  try {
    raw = await d.presence.statuses(peers.map((p) => p.userId));
  } catch {
    return peers.map(() => "unknown");
  }
  return Promise.all(
    peers.map(async (p, i) => {
      const s = raw[i] ?? "unknown";
      if (s === "offline" || s === "unknown") return s;
      const mutual = await d.user(p.userId).fr<boolean>("isFriend", me).catch(() => null);
      return mutual === null ? "unknown" : mutual ? s : "offline";
    }),
  );
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
  if (!path.startsWith("/api/me/friends") && path !== "/api/me/inbox" && !path.startsWith("/api/me/invites") && path !== "/api/me/presence" && path !== "/api/me/profile/pins") return null;
  const user = d.user(me.userId);

  if (path === "/api/me/inbox" && method === "GET") {
    const device = url.searchParams.get("device") ?? "";
    if (user.inboxBeat) {
      // INT-1: one account call + one presence call per heartbeat (Workers Free request budget)
      const [beat] = await Promise.all([
        user.inboxBeat(d.now()),
        d.presence?.beat(me.userId, DEVICE_ID.test(device) ? device : "legacy").catch(() => undefined),
      ]);
      return reply(200, { requests: beat.box.requests, invites: beat.invites as Invite[], sent: beat.sent as SentInvite[] });
    }
    await user.ping();
    // The heartbeat of this tab / device; a failure only makes friends see "unknown" for a while.
    await d.presence?.beat(me.userId, DEVICE_ID.test(device) ? device : "legacy").catch(() => undefined);
    const box = await user.fr<{ requests: number; invites: number }>("inboxCount", d.now());
    const invites = await user.fr<Invite[]>("invites", d.now());
    const sent = user.social ? await user.social<SentInvite[]>("sent", d.now()) : undefined;
    return reply(200, { requests: box.requests, invites, ...(sent ? { sent } : {}) });
  }
  if (path === "/api/me/presence" && method === "POST") {
    const input = await readBody();
    const device = typeof input.device === "string" && DEVICE_ID.test(input.device) ? input.device : null;
    if (!device || (input.state !== "online" && input.state !== "offline")) return fail(400, "PRESENCE", "기기 정보를 확인해 주세요.");
    if (await d.limited("presence:" + me.userId, 30)) return fail(429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.");
    if (input.state === "online") await user.ping();
    await d.presence?.beat(me.userId, device, input.state).catch(() => undefined);
    return reply(200, { ok: true });
  }
  if (path === "/api/me/friends/settings") {
    if (!user.social) return fail(404, "NOT_FOUND", "없는 주소입니다.");
    if (method === "GET") return reply(200, { settings: await user.social<SocialSettings>("settings") });
    if (method !== "POST") return fail(404, "NOT_FOUND", "없는 주소입니다.");
    if (await d.limited("fsettings:" + me.userId, 10)) return fail(429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.");
    const r = await user.social<{ ok: true; settings: SocialSettings; presenceChanged: boolean } | { ok: false; code: string; message: string }>("setSettings", await readBody(), d.now());
    if (!r.ok) return fail(400, r.code, r.message);
    if (r.presenceChanged) await d.presence?.setHidden(me.userId, r.settings.presence === "hidden").catch(() => undefined);
    return reply(200, { settings: r.settings });
  }
  if (path === "/api/me/profile/pins") {
    if (!user.social || !user.earned) return fail(404, "NOT_FOUND", "없는 주소입니다.");
    if (method === "GET") {
      const earned = await user.earned();
      const settings = await user.social<SocialSettings>("settings");
      return reply(200, { pins: await user.social<string[]>("pins", earned), visibility: settings.pinsVisibility, max: SOCIAL_LIMITS.maxPins });
    }
    if (method !== "PUT" && method !== "POST") return fail(404, "NOT_FOUND", "없는 주소입니다.");
    if (await d.limited("pins:" + me.userId, 20)) return fail(429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.");
    const input = await readBody();
    const r = await user.social<{ ok: true; pins: string[] } | { ok: false; code: string; message: string }>("setPins", input.ids, await user.earned(), d.now());
    if (!r.ok) return fail(400, r.code, r.message);
    return reply(200, { pins: r.pins });
  }
  if (path === "/api/me/friends" && method === "GET") {
    const self = await selfPeer(me.userId, d);
    await residueCheck(me.userId, d);
    const lists = await user.fr<FriendLists>("lists");
    // Status of friends only: one call for the ids (my own object), one call to the central presence,
    // then a mutual-friendship check for the friends who look online only (SOC-1).
    const peers = await user.fr<{ userId: string; code: string }[]>("friendPeers");
    const byCode = new Map(peers.map((p) => [p.code, p]));
    const ordered = lists.friends.map((f) => byCode.get(f.code) ?? null);
    const known = ordered.filter((p): p is { userId: string; code: string } => !!p);
    const st = await friendStatuses(me.userId, known, d);
    const statusOf = new Map(known.map((p, i) => [p.code, st[i]]));
    const settings = user.social ? await user.social<SocialSettings>("settings").catch(() => null) : null;
    return reply(200, { me: { code: self.code, nickname: self.nickname, ...(settings ? { settings } : {}) }, friends: lists.friends.map((f) => ({ ...f, status: statusOf.get(f.code) ?? "offline" })), incoming: lists.incoming, outgoing: lists.outgoing, blocked: lists.blocked, ...(d.presence ? { presence: "v2" } : {}) });
  }
  if (path === "/api/me/friends/relation" && method === "GET") {
    const target = url.searchParams.get("userId") ?? "";
    const room = url.searchParams.get("room");
    const r = await resolveKnown(me.userId, target, room, d);
    if (!r.ok) return fail(r.status, r.code, r.message);
    if (r.peer.userId === me.userId) return reply(200, { relation: "self", code: r.peer.code, nickname: r.peer.nickname });
    // A player who blocks me reads exactly like "none" (the block is never revealed).
    const relation = await user.fr<string>("relation", r.peer.userId);
    return reply(200, { relation, code: r.peer.code, nickname: r.peer.nickname });
  }
  if (path === "/api/me/friends/profile" && method === "GET") {
    const code = normalizeCode(url.searchParams.get("code"));
    const peer = code ? await d.index.lookup(code) : null;
    if (!peer || (await d.user(peer.userId).fr<boolean>("isBlocking", me.userId))) return fail(404, "NOT_FOUND", "프로필을 찾을 수 없어요.");
    const profile = (await d.user(peer.userId).publicProfile()) as Record<string, unknown> | null;
    if (!profile) return fail(404, "NOT_FOUND", "프로필을 찾을 수 없어요.");
    const { userId: _hidden, ...open } = profile;
    const versus = me.userId !== peer.userId && user.versus ? await user.versus(peer.userId).catch(() => null) : null;
    const pins = d.user(peer.userId).showcase ? await d.user(peer.userId).showcase!(me.userId).catch(() => []) : undefined;
    const relation = me.userId === peer.userId ? "self" : await user.fr<string>("relation", peer.userId);
    return reply(200, { ...open, code: peer.code, relation, ...(versus ? { versus } : {}), ...(pins ? { pins } : {}) });
  }
  if (method !== "POST") return fail(404, "NOT_FOUND", "없는 주소입니다.");
  const input = await readBody();

  if (path === "/api/me/invites/decline" || path === "/api/me/invites/cancel") {
    if (typeof input.id !== "string" || !INVITE_ID.test(input.id)) return fail(400, "INVITE_ID", "초대 정보가 올바르지 않아요.");
    if (await d.limited("finv:" + me.userId, 30)) return fail(429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.");
  }
  if (path === "/api/me/invites/decline") {
    const taken = await user.fr<{ invite: Invite; fromId: string } | null>("takeInviteFrom", String(input.id ?? ""), d.now());
    // The sender's screen shows "거절됨" (no reason, no time of reading).
    if (taken) await d.user(taken.fromId).social?.("answerSent", taken.invite.id, "declined").catch(() => undefined);
    return reply(200, { ok: true });
  }
  if (path === "/api/me/invites/cancel") {
    if (!user.social) return fail(404, "NOT_FOUND", "없는 주소입니다.");
    const id = String(input.id ?? "");
    const r = await user.social<{ toId: string } | null>("cancelSent", id);
    if (r?.toId) await d.user(r.toId).fr("dropInvite", id, me.userId).catch(() => undefined);
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

  // SOC-1: a request to a recent opponent / room member by account id. The server resolves the friend
  // code itself (registering it if the account never had one); a nickname is never used to find anyone.
  if (path === "/api/me/friends/request" && input.code === undefined && input.userId !== undefined) {
    if (typeof input.userId !== "string" || (input.room !== undefined && typeof input.room !== "string")) return fail(400, "USER_ID", "계정 정보가 올바르지 않아요.");
    const r = await resolveKnown(me.userId, String(input.userId), typeof input.room === "string" ? input.room : null, d);
    if (!r.ok) return fail(r.status, r.code, r.message);
    input.code = r.peer.code;
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
 * An account id the caller is allowed to address: one of my server-verified opponents, or a player
 * seated with me in a room right now (checked by the room). Anything else is "not found" — account ids
 * can not be used to probe who exists. Returns the peer with its (possibly just registered) code.
 */
async function resolveKnown(meId: string, target: string, room: string | null, d: FriendDeps): Promise<{ ok: true; peer: Peer } | { ok: false; status: number; code: string; message: string }> {
  const nf = { ok: false as const, status: 404, code: "NOT_FOUND", message: "사용자를 찾을 수 없어요." };
  if (!USER_ID.test(target)) return { ok: false, status: 400, code: "USER_ID", message: "계정 정보가 올바르지 않아요." };
  if (await d.limited("frel:" + meId, 30)) return { ok: false, status: 429, code: "RATE_LIMITED", message: "잠시 후 다시 시도해 주세요." };
  if (target !== meId) {
    const played = (await d.user(meId).playedWith?.(target).catch(() => false)) ?? false;
    const seated = !played && room && d.sharesRoom ? await d.sharesRoom(room, meId, target).catch(() => false) : false;
    if (!played && !seated) return nf;
  }
  const peer = await peerOf(target, d);
  return peer ? { ok: true, peer } : nf;
}

/**
 * Direct challenge from the friend list (SOC-1): make a 1:1 friend room with me seated, invite the friend,
 * and remember the invite as mine. A pending challenge to the same friend is returned instead of a new
 * room (double taps, a second tab). A friend who is visibly playing gets no invite ("BUSY").
 */
export type ChallengeRooms = {
  /** Make a friend room seating me (the Worker's normal room creation and limits). */
  create(): Promise<{ ok: true; code: string; playerId: string; token: string } | { ok: false; status: number; code: string; message: string }>;
  /** Is the room still waiting with a free seat for this invite? */
  open(room: string): Promise<boolean>;
};
export async function challenge(me: { userId: string }, rawCode: unknown, d: FriendDeps, rooms: ChallengeRooms, newId: () => string): Promise<{ status: number; body: unknown }> {
  const fail = (status: number, code: string, message: string) => ({ status, body: { error: { code, message } } });
  const user = d.user(me.userId);
  if (!user.social) return fail(404, "NOT_FOUND", "없는 주소입니다.");
  const code = normalizeCode(rawCode);
  if (!code) return fail(400, "CODE", "친구 코드가 올바르지 않아요.");
  const id = await user.fr<string | null>("peerId", code);
  if (!id || !(await user.fr<boolean>("isFriend", id))) return fail(404, "NOT_FRIEND", "친구에게만 대전을 신청할 수 있어요.");
  const now = d.now();
  const pending = await user.social<SentInvite | null>("pendingChallenge", code, now);
  if (pending && (await rooms.open(pending.room).catch(() => false))) return { status: 200, body: { status: "pending", invite: pending } };
  if (await d.limited("challenge:" + me.userId, SOCIAL_LIMITS.challengesPerMinute)) return fail(429, "RATE_LIMITED", "대전 신청을 너무 많이 보냈어요. 잠시 후 다시 해 주세요.");
  const [status] = await friendStatuses(me.userId, [{ userId: id, code }], d);
  if (status === "playing") return fail(409, "BUSY", "친구가 지금 경기 중이에요. 경기가 끝난 뒤에 다시 신청해 주세요.");
  const room = await rooms.create();
  if (!room.ok) return fail(room.status, room.code, room.message);
  const result = await sendInvites(me, [code], room.code, d, newId, "challenge");
  if (result[code] !== "sent") return fail(409, "INVITE_FAILED", "대전 신청을 보내지 못했어요.");
  const invite = await user.social<SentInvite | null>("pendingChallenge", code, now);
  return { status: 201, body: { status: "sent", code: room.code, playerId: room.playerId, token: room.token, invite } };
}

/** At most this many candidates are confirmed (one call each) per check. */
export const RESIDUE_CONFIRM_MAX = 50;
/**
 * Residue of accounts deleted before the C4.2 cleanup (see ResidueMode): when the owner opens the friend
 * list, at most once a day. Two steps, so that a lost or damaged global index can never delete a live
 * account's rows:
 *  1. pre-filter: one call to the global index — which (id, code) rows no longer name a live code;
 *  2. confirm: each candidate's OWN account object (the authority on its generation) is asked for its
 *     current code; only a missing account or a different code (deleted / re-joined) is residue.
 *     A candidate whose account still holds that code is an index fault: counted, never touched.
 * Off by default; "dry-run" only counts. Never throws (the list is shown either way).
 */
async function residueCheck(userId: string, d: FriendDeps) {
  const mode = d.residue ?? "off";
  if (mode === "off" || !d.index.live) return;
  try {
    const user = d.user(userId);
    const pairs = await user.fr<{ userId: string; code: string }[]>("residuePairs", d.now());
    if (!pairs.length) return;
    const live = await d.index.live(pairs);
    const candidates = pairs.filter((_, i) => live[i] === false).slice(0, RESIDUE_CONFIRM_MAX);
    if (!candidates.length) return;
    const current = await Promise.all(candidates.map((p) => d.user(p.userId).fr<string | null>("code").then((c) => c, () => undefined)));
    const stale = candidates.filter((p, i) => current[i] !== undefined && current[i] !== p.code);
    const indexFault = candidates.filter((p, i) => current[i] === p.code).length;
    if (indexFault) await d.metric?.("friends.residue.indexMismatch", indexFault);
    if (!stale.length) return;
    await d.metric?.(`friends.residue.${mode === "on" ? "cleaned" : "found"}`, stale.length);
    if (mode === "on") await user.fr("forgetMany", stale);
  } catch {
    /* best effort */
  }
}

/** Room invite to friends (J): returns, per code, "sent" / "not-friend" / "recent". Blocks stay invisible ("sent"). */
export async function sendInvites(me: { userId: string }, codes: string[], room: string, d: FriendDeps, newId: () => string, kind: "room" | "challenge" = "room"): Promise<Record<string, string>> {
  const user = d.user(me.userId);
  const self = await selfPeer(me.userId, d);
  const out: Record<string, string> = {};
  let names: Map<string, string> | undefined;
  for (const raw of codes.slice(0, 19)) {
    const code = normalizeCode(raw);
    if (!code) continue;
    const id = await user.fr<string | null>("peerId", code);
    if (!id || !(await user.fr<boolean>("isFriend", id))) {
      out[code] = "not-friend";
      continue;
    }
    const inviteId = newId();
    const now = d.now();
    const got = await d.user(id).fr<string>("receiveInvite", self, room, inviteId, now);
    out[code] = got === "recent" ? "recent" : "sent";
    // The sender's own view (SOC-1). A silent drop (they block me) looks pending, then expires — as before.
    if (got !== "recent" && user.social) {
      names ??= new Map((await user.fr<{ friends: { code: string; nickname: string }[] }>("lists")).friends.map((f) => [f.code, f.nickname]));
      await user.social("recordSent", { id: inviteId, to: { code, nickname: names.get(code) ?? "" }, room, at: now, expires: now + FRIEND_LIMITS.inviteTtlMs, kind }, id);
    }
  }
  return out;
}
