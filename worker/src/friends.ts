/**
 * Friends (I/J, 2026-11-25): runtime-free logic for one account's side of the friend graph, stored in
 * that account's `UserStore` SQLite (like the economy). Cross-account steps are RPCs between account
 * objects (the Worker routes call them in order; every step is idempotent, so a retry never doubles).
 *
 * Privacy / abuse rules (docs/online/FRIENDS.md):
 *  - Players are addressed by a public friend code ("YL" + 8 Crockford base32 chars, random, unique).
 *    Google e-mail, OAuth subject and internal ids are never returned to another player.
 *  - Search: members only, exact friend code or exact nickname (no prefix / partial search), at most
 *    10 results, 20 searches a minute and 200 a day per account → no cheap user enumeration.
 *  - Requests: 30 a day, 100 pending sent; a declined request can be sent again after 24 h; a blocked
 *    sender gets the same answer as success (the block is not revealed) and nothing is stored.
 *  - Presence is in memory only, given to friends only, and refreshed by the page's own inbox check
 *    (once a minute while the site is visible) — no global presence tracking, no storage writes.
 *  - Invites: friends only, not from blocked players, the same friend + room at most once a minute,
 *    20 a minute per inviter, expire after 10 minutes, accepted only while the room has a free seat.
 *
 * Account deletion (C4.2, SEC-03): a friend code is the *generation* of an account. Codes never change
 * while an account lives; deleting it retires the code (a re-join with the same Google account keeps the
 * same internal id but gets a new code). Every row about another player stores the code it was made
 * with, and cross-account steps compare it, so a request, friendship or invite of a deleted generation
 * can never be accepted by — or turn into a relation with — the re-joined account. `forget(id, code)` is
 * what a deleted account sends to everyone in its lists (retried from a durable queue until it lands);
 * blocks of a deleted player are kept only as "탈퇴한 사용자" + internal id, so a re-join cannot evade them.
 */
export type FriendSql = { exec<T = Record<string, unknown>>(query: string, ...params: unknown[]): { toArray(): T[] }; transaction<T>(fn: () => T): T };
export type Peer = { userId: string; code: string; nickname: string };
export type PublicPeer = { code: string; nickname: string };
export type FriendView = PublicPeer & { since: number };
export type Invite = { id: string; from: PublicPeer; room: string; at: number; expires: number };
export type FriendLists = { code: string; friends: FriendView[]; incoming: (PublicPeer & { at: number })[]; outgoing: (PublicPeer & { at: number })[]; blocked: PublicPeer[] };

export const FRIEND_LIMITS = {
  /** Shown in a blocker's list for a block whose target deleted the account (no nickname / code kept). */
  deletedName: "탈퇴한 사용자",
  maxFriends: 200,
  requestsPerDay: 30,
  pendingOut: 100,
  pendingIn: 200,
  retryAfterDeclineMs: 24 * 3600_000,
  searchesPerDay: 200,
  inviteTtlMs: 10 * 60_000,
  reinviteGapMs: 60_000,
  invitesPerMinute: 20,
  maxInvites: 50,
  onlineMs: 150_000,
} as const;

/** Friend code: "YL" + 8 chars of Crockford base32 (no I, L, O, U). */
export const FRIEND_CODE = /^YL[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/;
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function newFriendCode(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return "YL" + [...random(8)].map((b) => ALPHABET[b & 31]).join("");
}
/** Normalised friend code typed by a person (spaces, dashes, lower case, O/I/L look-alikes). */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.toUpperCase().replace(/[\s-]/g, "");
  // look-alikes are fixed in the 8 code characters only (the "YL" prefix itself contains an L)
  const body = (c.startsWith("YL") && c.length === 10 ? c.slice(2) : c).replace(/O/g, "0").replace(/[IL]/g, "1");
  const code = "YL" + body;
  return FRIEND_CODE.test(code) ? code : null;
}
/** The key nicknames are searched by (exact match, case and width folded). */
export const nameKey = (nickname: string) => nickname.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();

const day = (t: number) => Math.floor(t / 86_400_000);

/**
 * What each FriendStore operation answers for an account that does not exist (never created, or deleted):
 * a neutral value, and NOTHING is written — another player's request, invite or accept can never leave
 * data in a deleted account's object (C4.2, SEC-03). Operations not listed answer undefined (no-op).
 */
export const ABSENT_ACCOUNT: Readonly<Record<string, unknown>> = {
  code: null, setCode: null, spend: false, isFriend: false, isBlocking: false, relation: "none", friendIds: [], peerId: null,
  lists: { code: "", friends: [], incoming: [], outgoing: [], blocked: [] },
  canRequest: { ok: false, code: "NO_ACCOUNT", message: "계정을 찾을 수 없어요." },
  declineIncoming: false, incomingPeer: null, receiveRequest: "gone", receiveInvite: "silent", acceptedBy: false,
  retiredCodes: [], residuePairs: [], invites: [], takeInvite: null, takeInviteFrom: null, friendPeers: [], inboxCount: { requests: 0, invites: 0 },
};

export class FriendStore {
  constructor(private readonly sql: FriendSql) {}

  init() {
    const s = this.sql;
    s.exec("CREATE TABLE IF NOT EXISTS fr_meta (id INTEGER PRIMARY KEY CHECK (id = 1), code TEXT, day INTEGER NOT NULL DEFAULT 0, requests INTEGER NOT NULL DEFAULT 0, searches INTEGER NOT NULL DEFAULT 0)");
    s.exec("CREATE TABLE IF NOT EXISTS fr_friends (user_id TEXT PRIMARY KEY, code TEXT NOT NULL, nickname TEXT NOT NULL, since INTEGER NOT NULL)");
    s.exec("CREATE TABLE IF NOT EXISTS fr_in (user_id TEXT PRIMARY KEY, code TEXT NOT NULL, nickname TEXT NOT NULL, at INTEGER NOT NULL)");
    s.exec("CREATE TABLE IF NOT EXISTS fr_out (user_id TEXT PRIMARY KEY, code TEXT NOT NULL, nickname TEXT NOT NULL, at INTEGER NOT NULL, declined_at INTEGER)");
    s.exec("CREATE TABLE IF NOT EXISTS fr_blocks (user_id TEXT PRIMARY KEY, code TEXT NOT NULL, nickname TEXT NOT NULL, at INTEGER NOT NULL)");
    s.exec("CREATE TABLE IF NOT EXISTS fr_invites (id TEXT PRIMARY KEY, from_id TEXT NOT NULL, from_code TEXT NOT NULL, from_name TEXT NOT NULL, room TEXT NOT NULL, at INTEGER NOT NULL, expires INTEGER NOT NULL)");
    // Server-only reverse index "who blocks me" (id + their code), so deleting either account can clean
    // the other side. Never returned to a client; the block itself stays invisible to the blocked player.
    s.exec("CREATE TABLE IF NOT EXISTS fr_blocked_by (user_id TEXT PRIMARY KEY, code TEXT NOT NULL, at INTEGER NOT NULL)");
    // Codes of this account's deleted generations (kept with the deletion timestamp only): a re-join must
    // never be handed one of them again by the global index.
    s.exec("CREATE TABLE IF NOT EXISTS fr_retired (code TEXT PRIMARY KEY, at INTEGER NOT NULL)");
  }

  private meta() {
    this.sql.exec("INSERT OR IGNORE INTO fr_meta (id, code) VALUES (1, NULL)");
    return this.sql.exec<{ code: string | null; day: number; requests: number; searches: number }>("SELECT code, day, requests, searches FROM fr_meta WHERE id = 1").toArray()[0];
  }
  code(): string | null {
    return this.meta().code;
  }
  setCode(code: string) {
    this.meta();
    this.sql.exec("UPDATE fr_meta SET code = ? WHERE id = 1 AND code IS NULL", code);
    return this.code()!;
  }
  /** Count one use of a daily allowance; false when today's allowance is used up. */
  spend(kind: "requests" | "searches", limit: number, now: number): boolean {
    const m = this.meta();
    const today = day(now);
    const used = m.day === today ? m[kind] : 0;
    if (used >= limit) return false;
    if (m.day !== today) this.sql.exec("UPDATE fr_meta SET day = ?, requests = 0, searches = 0 WHERE id = 1", today);
    this.sql.exec(`UPDATE fr_meta SET ${kind} = ${kind} + 1 WHERE id = 1`);
    return true;
  }

  /** With `code`: a friend of that generation only (a stale row of a deleted generation does not count). */
  isFriend(userId: string, code?: string) {
    if (code !== undefined) return this.sql.exec("SELECT 1 FROM fr_friends WHERE user_id = ? AND code = ?", userId, code).toArray().length > 0;
    return this.sql.exec("SELECT 1 FROM fr_friends WHERE user_id = ?", userId).toArray().length > 0;
  }
  isBlocking(userId: string) {
    return this.sql.exec("SELECT 1 FROM fr_blocks WHERE user_id = ?", userId).toArray().length > 0;
  }
  relation(userId: string): "self" | "friend" | "incoming" | "outgoing" | "blocked" | "none" {
    if (this.isFriend(userId)) return "friend";
    if (this.isBlocking(userId)) return "blocked";
    if (this.sql.exec("SELECT 1 FROM fr_in WHERE user_id = ?", userId).toArray().length) return "incoming";
    if (this.sql.exec("SELECT 1 FROM fr_out WHERE user_id = ? AND declined_at IS NULL", userId).toArray().length) return "outgoing";
    return "none";
  }
  /** (id, code) of every friend in ONE call (presence lookup; server-only, never returned to clients). */
  friendPeers(): { userId: string; code: string }[] {
    return this.sql.exec<{ user_id: string; code: string }>("SELECT user_id, code FROM fr_friends ORDER BY nickname").toArray().map((r) => ({ userId: r.user_id, code: r.code }));
  }
  friendIds(): string[] {
    return this.sql.exec<{ user_id: string }>("SELECT user_id FROM fr_friends").toArray().map((r) => r.user_id);
  }
  /** Internal ids of everyone in the lists (for presence fan-out and display refresh — never returned to clients). */
  peerId(code: string): string | null {
    for (const t of ["fr_friends", "fr_in", "fr_out", "fr_blocks"])
      for (const r of this.sql.exec<{ user_id: string }>(`SELECT user_id FROM ${t} WHERE code = ?`, code).toArray()) return r.user_id;
    return null;
  }

  lists(): FriendLists {
    const pick = <T>(q: string, ...p: unknown[]) => this.sql.exec<T>(q, ...p).toArray();
    return {
      code: this.code() ?? "",
      friends: pick<{ code: string; nickname: string; since: number }>("SELECT code, nickname, since FROM fr_friends ORDER BY nickname").map((r) => ({ code: r.code, nickname: r.nickname, since: r.since })),
      incoming: pick<{ code: string; nickname: string; at: number }>("SELECT code, nickname, at FROM fr_in ORDER BY at DESC").map((r) => ({ code: r.code, nickname: r.nickname, at: r.at })),
      outgoing: pick<{ code: string; nickname: string; at: number }>("SELECT code, nickname, at FROM fr_out WHERE declined_at IS NULL ORDER BY at DESC").map((r) => ({ code: r.code, nickname: r.nickname, at: r.at })),
      blocked: pick<{ code: string; nickname: string }>("SELECT code, nickname FROM fr_blocks ORDER BY at DESC").map((r) => ({ code: r.code, nickname: r.nickname })),
    };
  }

  /* ------------------------------------------------- my side of an action (sender / actor) ------------------------------------------------- */

  /** Before sending: may I send a request to `peer`? (Does not store anything.) */
  canRequest(peer: Peer, now: number): { ok: true } | { ok: false; code: string; message: string } {
    this.purgeStale(peer.userId, peer.code);
    this.sql.exec("DELETE FROM fr_out WHERE declined_at IS NOT NULL AND declined_at <= ?", now - FRIEND_LIMITS.retryAfterDeclineMs);
    if (this.isFriend(peer.userId)) return { ok: false, code: "ALREADY", message: "이미 친구예요." };
    if (this.isBlocking(peer.userId)) return { ok: false, code: "BLOCKED", message: "차단한 사용자예요. 차단을 풀면 요청할 수 있어요." };
    const out = this.sql.exec<{ at: number; declined_at: number | null }>("SELECT at, declined_at FROM fr_out WHERE user_id = ?", peer.userId).toArray()[0];
    if (out && out.declined_at === null) return { ok: false, code: "PENDING", message: "이미 친구 요청을 보냈어요." };
    if (out && out.declined_at !== null && now - out.declined_at < FRIEND_LIMITS.retryAfterDeclineMs) return { ok: false, code: "COOLDOWN", message: "거절된 요청은 하루 뒤에 다시 보낼 수 있어요." };
    if (this.friendIds().length >= FRIEND_LIMITS.maxFriends) return { ok: false, code: "FULL", message: `친구는 ${FRIEND_LIMITS.maxFriends}명까지예요.` };
    const pending = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM fr_out WHERE declined_at IS NULL").toArray()[0].n;
    if (pending >= FRIEND_LIMITS.pendingOut) return { ok: false, code: "LIMIT", message: "보낸 요청이 너무 많아요. 일부를 취소해 주세요." };
    return { ok: true };
  }
  recordOutgoing(peer: Peer, now: number) {
    this.sql.exec("INSERT OR REPLACE INTO fr_out (user_id, code, nickname, at, declined_at) VALUES (?, ?, ?, ?, NULL)", peer.userId, peer.code, peer.nickname, now);
  }
  /** Both sides agreed (accept, or crossing requests): friends. */
  addFriend(peer: Peer, now: number) {
    this.sql.transaction(() => {
      this.sql.exec("DELETE FROM fr_in WHERE user_id = ?", peer.userId);
      this.sql.exec("DELETE FROM fr_out WHERE user_id = ?", peer.userId);
      this.sql.exec("INSERT OR IGNORE INTO fr_friends (user_id, code, nickname, since) VALUES (?, ?, ?, ?)", peer.userId, peer.code, peer.nickname, now);
    });
  }
  /** No longer friends: their pending room invites go too (invites are for friends only). */
  removeFriend(userId: string) {
    this.sql.exec("DELETE FROM fr_friends WHERE user_id = ?", userId);
    this.sql.exec("DELETE FROM fr_invites WHERE from_id = ?", userId);
  }
  cancelOutgoing(userId: string) {
    this.sql.exec("DELETE FROM fr_out WHERE user_id = ?", userId);
  }
  /** I declined their request: forget it (they see it disappear; they may try again after 24 h). */
  declineIncoming(userId: string) {
    const had = this.sql.exec("SELECT 1 FROM fr_in WHERE user_id = ?", userId).toArray().length > 0;
    this.sql.exec("DELETE FROM fr_in WHERE user_id = ?", userId);
    return had;
  }
  /** An incoming request that can no longer be accepted (its sender's generation is gone): drop that row only. */
  dropIncoming(userId: string, code: string) {
    this.sql.exec("DELETE FROM fr_in WHERE user_id = ? AND code = ?", userId, code);
  }
  incomingPeer(code: string): Peer | null {
    const r = this.sql.exec<{ user_id: string; code: string; nickname: string }>("SELECT user_id, code, nickname FROM fr_in WHERE code = ?", code).toArray()[0];
    return r ? { userId: r.user_id, code: r.code, nickname: r.nickname } : null;
  }
  block(peer: Peer, now: number) {
    this.sql.transaction(() => {
      for (const t of ["fr_friends", "fr_in", "fr_out"]) this.sql.exec(`DELETE FROM ${t} WHERE user_id = ?`, peer.userId);
      this.sql.exec("DELETE FROM fr_invites WHERE from_id = ?", peer.userId);
      this.sql.exec("INSERT OR REPLACE INTO fr_blocks (user_id, code, nickname, at) VALUES (?, ?, ?, ?)", peer.userId, peer.code, peer.nickname, now);
    });
  }
  unblock(userId: string) {
    this.sql.exec("DELETE FROM fr_blocks WHERE user_id = ?", userId);
  }

  /* --------------------------------------------------- the other side (recipient) --------------------------------------------------- */

  /**
   * A request arrives. "friends": they had already asked me (crossing requests) → friends at once.
   * "silent": I block them, or my inbox is full — the sender is told nothing different.
   */
  receiveRequest(from: Peer, now: number): "stored" | "friends" | "already" | "silent" | "gone" {
    // Rows of an earlier (deleted) generation of this sender never count as consent: a friendship or a
    // request I made to the old account does not carry over to a re-joined one.
    this.purgeStale(from.userId, from.code);
    if (this.isFriend(from.userId, from.code)) return "already";
    if (this.isBlocking(from.userId)) return "silent";
    const mineOut = this.sql.exec("SELECT 1 FROM fr_out WHERE user_id = ? AND code = ? AND declined_at IS NULL", from.userId, from.code).toArray().length > 0;
    if (mineOut) {
      this.addFriend(from, now);
      return "friends";
    }
    const pending = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM fr_in").toArray()[0].n;
    if (pending >= FRIEND_LIMITS.pendingIn) return "silent";
    this.sql.exec("INSERT OR REPLACE INTO fr_in (user_id, code, nickname, at) VALUES (?, ?, ?, ?)", from.userId, from.code, from.nickname, now);
    return "stored";
  }
  /**
   * The recipient declined: keep only the time (no nickname / code) so the same request waits 24 h;
   * the row is pruned once the wait is over.
   */
  outgoingDeclined(userId: string, now: number) {
    this.sql.exec("UPDATE fr_out SET declined_at = ?, code = '', nickname = '' WHERE user_id = ?", now, userId);
  }
  /**
   * On the REQUESTER's account, when the recipient accepts (`me` = the recipient as a peer): agree only if
   * this generation of my account still has a pending request to them (`myCode` = the code they saw on
   * the request). A re-joined account (new code, empty lists) or a deleted one never agrees, so an old
   * request can never make a friend of an account that did not ask. Idempotent (a retried accept: true).
   */
  acceptedBy(me: Peer, myCode: string, now: number): boolean {
    if (this.code() !== myCode) return false;
    if (this.isFriend(me.userId, me.code)) return true;
    const out = this.sql.exec("SELECT 1 FROM fr_out WHERE user_id = ? AND code = ? AND declined_at IS NULL", me.userId, me.code).toArray().length > 0;
    if (!out || this.isBlocking(me.userId)) return false;
    this.addFriend(me, now);
    return true;
  }
  incomingCancelled(userId: string) {
    this.sql.exec("DELETE FROM fr_in WHERE user_id = ?", userId);
  }
  /**
   * Someone blocked me: everything between us goes (I am not told). `code` (the blocker's) is kept in a
   * server-only reverse index so that deleting either account can clean the other side.
   */
  blockedBy(userId: string, code?: string, now = 0) {
    this.sql.transaction(() => {
      for (const t of ["fr_friends", "fr_in", "fr_out"]) this.sql.exec(`DELETE FROM ${t} WHERE user_id = ?`, userId);
      this.sql.exec("DELETE FROM fr_invites WHERE from_id = ?", userId);
      if (code) this.sql.exec("INSERT OR REPLACE INTO fr_blocked_by (user_id, code, at) VALUES (?, ?, ?)", userId, code, now);
    });
  }
  unblockedBy(userId: string) {
    this.sql.exec("DELETE FROM fr_blocked_by WHERE user_id = ?", userId);
  }

  /* --------------------------------------------- account deletion (C4.2) / stale generations --------------------------------------------- */

  /**
   * A deleted account (`userId` with friend code `code`) asks me to forget it: its friendship, requests
   * both ways, invites and the reverse block entry go; my block of it stays, anonymised (internal id and
   * time only — a re-join with the same Google account stays blocked, but nothing shown or stored about
   * the person remains). Only rows of THAT generation are touched, so a late retry never removes a newer
   * relation with the re-joined account. Idempotent. `code` null (an account that never had a friend
   * code) matches every generation.
   */
  forget(userId: string, code: string | null, random?: (n: number) => Uint8Array) {
    const gen = code === null ? "" : " AND code = ?";
    const p = code === null ? [userId] : [userId, code];
    this.sql.transaction(() => {
      this.sql.exec(`DELETE FROM fr_friends WHERE user_id = ?${gen}`, ...p);
      this.sql.exec(`DELETE FROM fr_in WHERE user_id = ?${gen}`, ...p);
      this.sql.exec(`DELETE FROM fr_out WHERE user_id = ? AND (declined_at IS NOT NULL${code === null ? " OR 1" : " OR code = ?"})`, ...p);
      this.sql.exec(`DELETE FROM fr_invites WHERE from_id = ?${code === null ? "" : " AND from_code = ?"}`, ...p);
      this.sql.exec(`DELETE FROM fr_blocked_by WHERE user_id = ?${gen}`, ...p);
      const blocked = this.sql.exec(`SELECT 1 FROM fr_blocks WHERE user_id = ?${gen}`, ...p).toArray().length > 0;
      // a fresh placeholder code (never registered in the index) only lets me unblock it from my list
      if (blocked) this.sql.exec("UPDATE fr_blocks SET code = ?, nickname = ? WHERE user_id = ?", newFriendCode(random), FRIEND_LIMITS.deletedName, userId);
    });
  }
  forgetMany(pairs: { userId: string; code: string }[]) {
    for (const p of pairs.slice(0, 1000)) this.forget(p.userId, p.code);
  }
  /**
   * Rows about `userId` from a generation other than `code` (that generation was deleted: codes change
   * only then) are dropped when the same person shows up again. Blocks are kept (by design, see forget).
   */
  private purgeStale(userId: string, code: string) {
    for (const t of ["fr_friends", "fr_in"]) this.sql.exec(`DELETE FROM ${t} WHERE user_id = ? AND code <> ?`, userId, code);
    this.sql.exec("DELETE FROM fr_out WHERE user_id = ? AND code <> ? AND declined_at IS NULL", userId, code);
    this.sql.exec("DELETE FROM fr_invites WHERE from_id = ? AND from_code <> ?", userId, code);
  }
  /** Before deleting this account: my code and every account that holds a row about me. */
  deletionPlan(): { code: string | null; peers: string[] } {
    const code = this.sql.exec<{ code: string | null }>("SELECT code FROM fr_meta WHERE id = 1").toArray()[0]?.code ?? null;
    const ids = new Set<string>();
    for (const t of ["fr_friends", "fr_in", "fr_out", "fr_blocks", "fr_blocked_by"]) for (const r of this.sql.exec<{ user_id: string }>(`SELECT user_id FROM ${t}`).toArray()) ids.add(r.user_id);
    return { code, peers: [...ids] };
  }
  /** Codes of this account's deleted generations (never to be handed out to it again). */
  retiredCodes(): string[] {
    return this.sql.exec<{ code: string }>("SELECT code FROM fr_retired").toArray().map((r) => r.code);
  }
  /**
   * Residue check of rows made BEFORE this cleanup existed (C4.2 design, off unless the operator turns it
   * on): (id, code) of everyone in my lists, at most once a day per loaded object.
   */
  private residueDay = -1;
  residuePairs(now: number): { userId: string; code: string }[] {
    if (this.residueDay === day(now)) return [];
    this.residueDay = day(now);
    const out: { userId: string; code: string }[] = [];
    const q = [
      "SELECT user_id, code FROM fr_friends",
      "SELECT user_id, code FROM fr_in",
      "SELECT user_id, code FROM fr_out WHERE declined_at IS NULL",
      "SELECT user_id, code FROM fr_blocks WHERE nickname <> ?", // already anonymised blocks are not residue
    ];
    for (const sql of q) for (const r of this.sql.exec<{ user_id: string; code: string }>(sql, ...(sql.includes("?") ? [FRIEND_LIMITS.deletedName] : [])).toArray()) out.push({ userId: r.user_id, code: r.code });
    return out;
  }
  /** Keep a friend's shown nickname fresh (nickname changes). */
  refresh(userId: string, nickname: string) {
    for (const t of ["fr_friends", "fr_in", "fr_out", "fr_blocks"]) this.sql.exec(`UPDATE ${t} SET nickname = ? WHERE user_id = ?`, nickname, userId);
  }

  /* ------------------------------------------------------------------- invites ------------------------------------------------------------------- */

  /** A friend invited me to a room. Friends only; not from blocked players; one per friend + room per minute. */
  receiveInvite(from: Peer, room: string, id: string, now: number): "stored" | "silent" | "recent" {
    this.sql.exec("DELETE FROM fr_invites WHERE expires <= ?", now);
    if (!this.isFriend(from.userId, from.code) || this.isBlocking(from.userId)) return "silent";
    const last = this.sql.exec<{ at: number }>("SELECT at FROM fr_invites WHERE from_id = ? AND room = ?", from.userId, room).toArray()[0];
    if (last && now - last.at < FRIEND_LIMITS.reinviteGapMs) return "recent";
    this.sql.exec("DELETE FROM fr_invites WHERE from_id = ? AND room = ?", from.userId, room);
    const count = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM fr_invites").toArray()[0].n;
    if (count >= FRIEND_LIMITS.maxInvites) this.sql.exec("DELETE FROM fr_invites WHERE id IN (SELECT id FROM fr_invites ORDER BY at LIMIT 1)");
    this.sql.exec("INSERT INTO fr_invites (id, from_id, from_code, from_name, room, at, expires) VALUES (?, ?, ?, ?, ?, ?, ?)", id, from.userId, from.code, from.nickname, room, now, now + FRIEND_LIMITS.inviteTtlMs);
    return "stored";
  }
  invites(now: number): Invite[] {
    return this.sql
      // only from players who are still my friends (same generation): an ex-friend's or a deleted
      // account's invite is never shown or accepted, even if its row is still here
      .exec<{ id: string; from_code: string; from_name: string; room: string; at: number; expires: number }>(
        "SELECT i.id, i.from_code, i.from_name, i.room, i.at, i.expires FROM fr_invites i JOIN fr_friends f ON f.user_id = i.from_id AND f.code = i.from_code WHERE i.expires > ? ORDER BY i.at DESC",
        now,
      )
      .toArray()
      .map((r) => ({ id: r.id, from: { code: r.from_code, nickname: r.from_name }, room: r.room, at: r.at, expires: r.expires }));
  }
  /** Take an invite (accept / decline): returns it once, then it is gone. */
  takeInvite(id: string, now: number): Invite | null {
    const inv = this.invites(now).find((i) => i.id === id) ?? null;
    this.sql.exec("DELETE FROM fr_invites WHERE id = ?", id);
    return inv;
  }
  /** Take an invite and learn who sent it (server-only: to tell the sender it was accepted / declined). */
  takeInviteFrom(id: string, now: number): { invite: Invite; fromId: string } | null {
    const r = this.sql.exec<{ from_id: string }>("SELECT from_id FROM fr_invites WHERE id = ?", id).toArray()[0];
    const invite = this.takeInvite(id, now);
    return invite && r ? { invite, fromId: r.from_id } : null;
  }
  /** The sender took the invite back (only that sender's row with that id). */
  dropInvite(id: string, fromId: string) {
    this.sql.exec("DELETE FROM fr_invites WHERE id = ? AND from_id = ?", id, fromId);
  }
  inboxCount(now: number) {
    return { requests: this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM fr_in").toArray()[0].n, invites: this.invites(now).length };
  }
}

/* -------------------------------------------------------------- presence (memory) -------------------------------------------------------------- */

/** In-memory presence of one account (lost on eviction = shown offline; never stored). */
export class Presence {
  private seen = 0;
  private playing: { room: string; until: number } | null = null;
  ping(now: number) {
    this.seen = now;
  }
  setPlaying(room: string | null, now: number) {
    this.playing = room ? { room, until: now + 3 * 3600_000 } : null;
    if (room) this.seen = now;
  }
  status(now: number): "playing" | "online" | "offline" {
    if (this.playing && this.playing.until > now) return "playing";
    return now - this.seen < FRIEND_LIMITS.onlineMs ? "online" : "offline";
  }
}

/* ---------------------------------------------------------- global index (one object) ---------------------------------------------------------- */

/**
 * Friend code → account and exact-nickname → accounts. One small SQLite object ("FriendIndex"): only
 * members who used friends (or set a nickname since) are listed. It stores the internal id because it
 * is server-side only; routes never return it.
 */
export class FriendIndexStore {
  constructor(private readonly sql: Omit<FriendSql, "transaction">) {}
  init() {
    this.sql.exec("CREATE TABLE IF NOT EXISTS codes (code TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS names (user_id TEXT PRIMARY KEY, name_key TEXT NOT NULL, nickname TEXT NOT NULL)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS names_key ON names (name_key)");
  }
  /** The account's code (a new random one the first time) and its current nickname. */
  /**
   * `avoid`: retired codes of the account's deleted generations (never handed back). `keep`: the code the
   * account itself already holds — if the index lost the entry it is restored, not replaced, so an index
   * loss never silently changes a live account's generation.
   */
  register(userId: string, nickname: string, avoid: string[] = [], keep: string | null = null, make: () => string = () => newFriendCode()): string {
    let code: string | undefined = this.sql.exec<{ code: string }>("SELECT code FROM codes WHERE user_id = ?", userId).toArray()[0]?.code;
    if (!code && keep && FRIEND_CODE.test(keep) && !avoid.includes(keep) && !this.sql.exec("SELECT 1 FROM codes WHERE code = ?", keep).toArray().length) {
      this.sql.exec("INSERT INTO codes (code, user_id) VALUES (?, ?)", keep, userId);
      code = keep;
    }
    // A re-joined account must never get back the code of its deleted generation (e.g. when the
    // deletion's index cleanup has not landed yet): replace it.
    if (code && avoid.includes(code)) {
      this.sql.exec("DELETE FROM codes WHERE user_id = ?", userId);
      code = undefined;
    }
    for (let i = 0; !code && i < 8; i++) {
      const c = make();
      if (!this.sql.exec("SELECT 1 FROM codes WHERE code = ?", c).toArray().length) {
        this.sql.exec("INSERT INTO codes (code, user_id) VALUES (?, ?)", c, userId);
        code = c;
      }
    }
    if (!code) throw Error("no free friend code");
    this.sql.exec("INSERT OR REPLACE INTO names (user_id, name_key, nickname) VALUES (?, ?, ?)", userId, nameKey(nickname), nickname);
    return code;
  }
  lookup(code: string): Peer | null {
    const r = this.sql.exec<{ user_id: string; nickname: string | null }>("SELECT c.user_id, n.nickname FROM codes c LEFT JOIN names n ON n.user_id = c.user_id WHERE c.code = ?", code).toArray()[0];
    return r ? { userId: r.user_id, code, nickname: r.nickname ?? "" } : null;
  }
  /** Exact nickname match only (no partial search), at most 10. */
  search(nickname: string): Peer[] {
    return this.sql
      .exec<{ user_id: string; code: string; nickname: string }>("SELECT n.user_id, c.code, n.nickname FROM names n JOIN codes c ON c.user_id = n.user_id WHERE n.name_key = ? LIMIT 10", nameKey(nickname))
      .toArray()
      .map((r) => ({ userId: r.user_id, code: r.code, nickname: r.nickname }));
  }
  remove(userId: string) {
    this.sql.exec("DELETE FROM codes WHERE user_id = ?", userId);
    this.sql.exec("DELETE FROM names WHERE user_id = ?", userId);
  }
  /** Deletion cleanup of one generation: a late retry never removes the re-joined account's new code. */
  removeCode(userId: string, code: string | null) {
    if (code === null) return this.remove(userId);
    if (!this.sql.exec("SELECT 1 FROM codes WHERE user_id = ? AND code = ?", userId, code).toArray().length) return;
    this.remove(userId);
  }
  /** Is each (id, code) still a live account generation? (Residue check; at most 1000 pairs.) */
  live(pairs: { userId: string; code: string }[]): boolean[] {
    return pairs.slice(0, 1000).map((p) => this.sql.exec("SELECT 1 FROM codes WHERE code = ? AND user_id = ?", p.code, p.userId).toArray().length > 0);
  }
}
