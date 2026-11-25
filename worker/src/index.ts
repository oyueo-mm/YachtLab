import { DurableObject } from "cloudflare:workers";
import { newRoomCode, normalizeCode, ROOM_LIMITS, type RoomRecord } from "../../src/online/room";
import { readConfig, type ConfigVars, type OnlineConfig } from "./config";
import { RoomHost, type HostSocket, type HostStorage } from "./host";
import { AccountStore, type Sql } from "./account";
import { EconomyStore, type EconSql } from "./economy";
import { ECONOMY } from "../../src/economy/live/config";
import { itemById } from "../../src/economy/live/catalog";

/** Coin balance bucket for the privacy-light balance distribution. */
const bucket = (c: number) => (c < 100 ? "0-99" : c < 500 ? "100-499" : c < 2000 ? "500-1999" : c < 10000 ? "2000-9999" : c < 50000 ? "10k-49k" : "50k+");
import { validateNickname } from "../../src/identity/nickname";
import { FriendIndexStore, FriendStore, Presence, type FriendSql } from "./friends";
import { handleFriendRoute, sendInvites, type FriendDeps, type FriendUser } from "./friends-api";
import { sameText } from "./oidc";
import { authConfig, handleAccountRoute, sessionUser, type AccountBackends, type GuestApi, type UserApi } from "./accounts-api";
import type { MatchRecord } from "../../src/identity/records";
import type { SeatSpec } from "../../src/online/room";
import type { PublicLook } from "../../src/economy/live/catalog";
import type { MatchKind } from "../../src/economy/live/config";
import { HubCore, type HubSql, type QueueSeat } from "./hub";

/**
 * YachtLab Online — Cloudflare Worker + SQLite-backed Durable Objects (Phase 3).
 *
 *   Worker (stateless)          CORS / Origin check, routing, request size limits
 *   RoomDirectory (1 object)    room codes in use, room count cap, per-client rate limits, sweep
 *   YachtRoom (1 per room)      the Phase 2 OnlineRoom: engine, seats, timer, sockets (Hibernation API)
 *
 * HTTP and WebSocket paths are identical to the local Node server, so the web client is unchanged.
 */

export interface Env extends ConfigVars {
  ROOMS: DurableObjectNamespace<YachtRoom>;
  DIRECTORY: DurableObjectNamespace<RoomDirectory>;
  /** One SQLite object per account (Phase 4). */
  USERS: DurableObjectNamespace<UserStore>;
  /** One tiny object per linked guest id: which account claimed it. */
  GUESTS: DurableObjectNamespace<GuestLink>;
  /** Phase 4.5: one global object — quick-match queue, public spectating list, operations counters. */
  HUB: DurableObjectNamespace<MatchHub>;
  FRIENDS: DurableObjectNamespace<FriendIndex>;
  /** "on" enables official coins/gems/quests/achievements/shop (feature flag). */
  ECONOMY?: string;
  /** "off" disables server AI matches (kill switch, default on). */
  SERVER_AI?: string;
  /** Operations metrics endpoint (`GET /api/admin/metrics`), off unless this secret (≥ 32 chars) is set. */
  ADMIN_TOKEN?: string;
  /** Sign-in (all four must be set, as Worker secrets / vars, or sign-in stays off). */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  AUTH_SECRET?: string;
  APP_URL?: string;
  /** Local end-to-end tests only (see authConfig): ignored unless APP_URL is a loopback http address. */
  TEST_OIDC_ISSUER?: string;
  /** Local tests only: echoed by /healthz so a test talks to its own server process. */
  TEST_INSTANCE?: string;
}

const MAX_BODY = 1024;
const PING = '{"t":"ping"}';
const PONG = '{"t":"pong"}';

/* ------------------------------------------------------------------- room ------------------------------------------------------------------- */

export class YachtRoom extends DurableObject<Env> {
  private host: RoomHost;
  private config: OnlineConfig;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.config = readConfig(env);
    const sql = ctx.storage.sql;
    const storage: HostStorage = {
      load() {
        const rows = sql.exec<{ record: string }>("SELECT record FROM room WHERE id = 1").toArray();
        return rows.length ? (JSON.parse(rows[0].record) as RoomRecord) : null;
      },
      // The whole record is one row: one row write per accepted command, atomic by itself.
      save(record) {
        sql.exec("INSERT INTO room (id, record) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET record = excluded.record", JSON.stringify(record));
      },
      getAlarm: () => null,
      setAlarm: (at) => void ctx.storage.setAlarm(at),
      deleteAlarm: () => void ctx.storage.deleteAlarm(),
      clear: () => ctx.storage.deleteAll(),
    };
    this.host = new RoomHost(storage, () => ctx.getWebSockets() as unknown as HostSocket[], this.config, Date.now, undefined, {
      onDeleted: async (code) => {
        await env.DIRECTORY.get(env.DIRECTORY.idFromName("directory")).release(code);
      },
      // Rematches reuse this room but still count toward the daily cap (one directory row write).
      deliverRecord: async (userId, record) => env.USERS.get(env.USERS.idFromName(userId)).recordMatch(record),
      allowMatch: async (_code, weight) => {
        const verdict = await env.DIRECTORY.get(env.DIRECTORY.idFromName("directory")).allocateMatch(weight ?? 1);
        return verdict.ok ? null : verdict.message;
      },
      publish: async (code, entry) => {
        const hub = env.HUB.get(env.HUB.idFromName("hub"));
        await (entry ? hub.publish(entry) : hub.unpublish(code));
      },
      matchEnded: async (code) => env.HUB.get(env.HUB.idFromName("hub")).ended(code),
      // Friends see "경기 중" (memory only on each account object; no storage write).
      memberStatus: async (userIds, room) => {
        await Promise.all(userIds.map((id) => env.USERS.get(env.USERS.idFromName(id)).setPlaying(room).catch(() => undefined)));
      },
      finished: async (info) => {
        const hub = env.HUB.get(env.HUB.idFromName("hub"));
        await hub.count(`finished.${info.kind}.${info.completed ? "completed" : "forfeit"}`);
        if (info.completed) await hub.count(`duration.${info.kind}.totalSec`, Math.round(info.durationMs / 1000));
      },
    });
    // Keep-alive pings are answered by the runtime without waking the object (no duration, no request).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    ctx.blockConcurrencyWhile(async () => {
      sql.exec("CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY CHECK (id = 1), record TEXT NOT NULL)");
      const alarm = await ctx.storage.getAlarm();
      storage.getAlarm = () => alarm;
      this.host.init();
      storage.getAlarm = () => null;
    });
  }

  /* RPC from the Worker */
  /** `identity` is set only by the Worker after verifying the session (never taken from the client body). */
  async create(code: string, name: unknown, identity?: { userId: string } | null, look?: PublicLook | null, maxPlayers = 2) {
    return this.host.create(code, name, identity, look, maxPlayers);
  }
  async join(name: unknown, identity?: { userId: string } | null, look?: PublicLook | null) {
    return this.host.join(name, identity, look);
  }
  /** Quick match / AI match (seats and looks are given by trusted server code, never by a client). */
  async createMatched(code: string, seats: SeatSpec[], options: { kind: MatchKind; public: boolean }) {
    return this.host.createMatched(code, seats, options);
  }
  async publicWatch() {
    return this.host.publicWatch();
  }
  /** Friend invites: is this account seated in this friend room, and is there a free seat in the waiting room? */
  async inviteState(userId: string) {
    return this.host.inviteState(userId);
  }
  async summary() {
    return this.host.summary();
  }

  /** WebSocket upgrade (must be an HTTP request, not RPC). */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const ok = this.host.admit();
    if (!ok.ok) return new Response(null, { status: ok.status });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    // Hibernation API: the object may be evicted while this socket stays open.
    this.ctx.acceptWebSocket(server);
    this.host.accepted(server as unknown as HostSocket);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    await this.host.message(ws as unknown as HostSocket, message);
  }
  async webSocketClose(ws: WebSocket, code: number) {
    await this.host.closed(ws as unknown as HostSocket);
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, "closed");
    } catch {
      /* already closed */
    }
  }
  async webSocketError(ws: WebSocket) {
    await this.host.closed(ws as unknown as HostSocket);
  }
  async alarm() {
    await this.host.alarm();
  }
}

/* ---------------------------------------------------------------- directory ---------------------------------------------------------------- */

type Verdict = { ok: true } | { ok: false; status: number; code: string; message: string };

/**
 * One object for the whole service: which room codes exist (so codes are unique and guessing a code
 * does not create a Durable Object), the global room cap, and per-client fixed-window rate limits.
 * Client keys are SHA-256 hashes of the connecting IP, never the IP itself.
 */
export class RoomDirectory extends DurableObject<Env> {
  private config: OnlineConfig;
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.config = readConfig(env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec("CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, created_at INTEGER NOT NULL)");
      this.sql.exec("CREATE TABLE IF NOT EXISTS daily (day INTEGER PRIMARY KEY, rooms INTEGER NOT NULL)");
      if ((await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now() + 6 * 3600_000);
    });
  }

  /**
   * Fixed one-minute windows kept in memory only: rate limiting must never spend SQLite row writes
   * (the account's daily free write budget is shared with other Workers). If the object is evicted the
   * counters restart, which only makes the limit softer for a moment.
   */
  private hits = new Map<string, { window: number; count: number }>();
  private limited(key: string, max: number): boolean {
    const window = Math.floor(Date.now() / 60_000);
    const row = this.hits.get(key);
    const count = row && row.window === window ? row.count + 1 : 1;
    this.hits.set(key, { window, count });
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.window < window) this.hits.delete(k);
    return count > max;
  }

  /** Reserve a fresh code for a new room. */
  async allocate(client: string): Promise<Verdict & { code?: string }> {
    if (this.limited("create:" + client, this.config.createPerMinute)) return { ok: false, status: 429, code: "RATE_LIMITED", message: "방을 너무 자주 만들었어요. 잠시 후 다시 시도해 주세요." };
    // Daily cap (UTC day, persisted): bounds this service's share of the account's free daily usage.
    const day = Math.floor(Date.now() / 86_400_000);
    const today = this.sql.exec<{ rooms: number }>("SELECT rooms FROM daily WHERE day = ?", day).toArray()[0]?.rooms ?? 0;
    if (today >= this.config.dailyRoomLimit) return { ok: false, status: 503, code: "DAILY_LIMIT", message: "오늘은 온라인 방을 더 만들 수 없어요. 내일 다시 시도해 주세요." };
    const count = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM rooms").one().n;
    if (count >= this.config.maxRooms) return { ok: false, status: 503, code: "ROOM_LIMIT", message: "지금은 방을 더 만들 수 없어요. 잠시 후 다시 시도해 주세요." };
    for (let i = 0; i < 20; i++) {
      const code = newRoomCode();
      if (this.sql.exec("SELECT 1 FROM rooms WHERE code = ?", code).toArray().length) continue;
      this.sql.exec("INSERT INTO rooms (code, created_at) VALUES (?, ?)", code, Date.now());
      this.sql.exec("INSERT INTO daily (day, rooms) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET rooms = rooms + 1", day);
      return { ok: true, code };
    }
    return { ok: false, status: 503, code: "ROOM_LIMIT", message: "방 코드를 만들지 못했어요." };
  }

  /**
   * A room made by the server itself (quick match, AI match): same daily and concurrent caps as an
   * invite room, without the per-IP creation limit (the matchmaker paces it). `kind` "ai" also has
   * its own daily sub-budget so AI matches can never use up the whole day.
   */
  async allocateFor(kind: "random" | "ai"): Promise<Verdict & { code?: string }> {
    const day = Math.floor(Date.now() / 86_400_000);
    const today = this.sql.exec<{ rooms: number }>("SELECT rooms FROM daily WHERE day = ?", day).toArray()[0]?.rooms ?? 0;
    if (today >= this.config.dailyRoomLimit) return { ok: false, status: 503, code: "DAILY_LIMIT", message: "오늘은 온라인 경기를 더 만들 수 없어요. 내일 다시 시도해 주세요." };
    // Keep a reserve for matches already in progress to finish with rematches / reconnects.
    if (kind === "random" && today >= Math.floor(this.config.dailyRoomLimit * 0.95)) return { ok: false, status: 503, code: "DAILY_LIMIT", message: "오늘은 빠른 대전을 더 할 수 없어요. 내일 다시 시도해 주세요." };
    if (kind === "ai") {
      this.sql.exec("CREATE TABLE IF NOT EXISTS daily_ai (day INTEGER PRIMARY KEY, rooms INTEGER NOT NULL)");
      const ai = this.sql.exec<{ rooms: number }>("SELECT rooms FROM daily_ai WHERE day = ?", day).toArray()[0]?.rooms ?? 0;
      if (ai >= this.config.dailyAiLimit) return { ok: false, status: 503, code: "DAILY_LIMIT", message: "오늘은 서버 AI 대전을 더 할 수 없어요. 로컬 AI 대전을 이용해 주세요." };
    }
    const count = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM rooms").one().n;
    if (count >= this.config.maxRooms) return { ok: false, status: 503, code: "ROOM_LIMIT", message: "지금은 경기를 더 만들 수 없어요. 잠시 후 다시 시도해 주세요." };
    for (let i = 0; i < 20; i++) {
      const code = newRoomCode();
      if (this.sql.exec("SELECT 1 FROM rooms WHERE code = ?", code).toArray().length) continue;
      this.sql.exec("INSERT INTO rooms (code, created_at) VALUES (?, ?)", code, Date.now());
      this.sql.exec("INSERT INTO daily (day, rooms) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET rooms = rooms + 1", day);
      if (kind === "ai") this.sql.exec("INSERT INTO daily_ai (day, rooms) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET rooms = rooms + 1", day);
      return { ok: true, code };
    }
    return { ok: false, status: 503, code: "ROOM_LIMIT", message: "방 코드를 만들지 못했어요." };
  }

  /** Rate-limited existence check before touching a room (join / invite preview / socket). */
  async check(client: string, code: string, kind: "join" | "peek"): Promise<Verdict> {
    if (this.limited(`${kind}:${client}`, kind === "join" ? this.config.joinPerMinute : this.config.joinPerMinute * 4))
      return { ok: false, status: 429, code: "RATE_LIMITED", message: "잠시 후 다시 시도해 주세요." };
    if (!this.sql.exec("SELECT 1 FROM rooms WHERE code = ?", code).toArray().length) return { ok: false, status: 404, code: "ROOM_NOT_FOUND", message: "방을 찾을 수 없어요. 초대 코드를 확인해 주세요." };
    return { ok: true };
  }

  /**
   * One more match in an existing room (rematch). Shares the daily cap with room creation, so the
   * daily budget still bounds this service's share of the free plan; no new room code or object.
   */
  async allocateMatch(weight = 1): Promise<Verdict> {
    // A larger match costs more units (about one per two players): its storage writes grow with players.
    const w = Math.max(1, Math.min(10, Math.floor(weight)));
    const day = Math.floor(Date.now() / 86_400_000);
    const today = this.sql.exec<{ rooms: number }>("SELECT rooms FROM daily WHERE day = ?", day).toArray()[0]?.rooms ?? 0;
    if (today + w > this.config.dailyRoomLimit) return { ok: false, status: 503, code: "DAILY_LIMIT", message: "오늘은 온라인 경기를 더 할 수 없어요. 내일 다시 시도해 주세요." };
    this.sql.exec("INSERT INTO daily (day, rooms) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET rooms = rooms + ?", day, w, w);
    return { ok: true };
  }

  /** Generic in-memory rate limit for account routes (no storage writes). */
  async hit(key: string, perMinute: number): Promise<boolean> {
    return this.limited(key, perMinute);
  }

  async release(code: string) {
    this.sql.exec("DELETE FROM rooms WHERE code = ?", code);
  }

  async count() {
    return this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM rooms").one().n;
  }

  /** Rooms created today (UTC) and the cap — for operations checks. */
  async usage() {
    const day = Math.floor(Date.now() / 86_400_000);
    const today = this.sql.exec<{ rooms: number }>("SELECT rooms FROM daily WHERE day = ?", day).toArray()[0]?.rooms ?? 0;
    this.sql.exec("CREATE TABLE IF NOT EXISTS daily_ai (day INTEGER PRIMARY KEY, rooms INTEGER NOT NULL)");
    const ai = this.sql.exec<{ rooms: number }>("SELECT rooms FROM daily_ai WHERE day = ?", day).toArray()[0]?.rooms ?? 0;
    return { roomsToday: today, dailyRoomLimit: this.config.dailyRoomLimit, aiRoomsToday: ai, dailyAiLimit: this.config.dailyAiLimit, liveRooms: await this.count(), maxRooms: this.config.maxRooms };
  }

  /** Every 6 hours: forget room codes past retention (their rooms delete themselves) and old day counters. */
  async alarm() {
    const now = Date.now();
    this.sql.exec("DELETE FROM rooms WHERE created_at < ?", now - this.config.maxAgeMs - 3600_000);
    this.sql.exec("DELETE FROM daily WHERE day < ?", Math.floor(now / 86_400_000) - 2);
    this.sql.exec("CREATE TABLE IF NOT EXISTS daily_ai (day INTEGER PRIMARY KEY, rooms INTEGER NOT NULL)");
    this.sql.exec("DELETE FROM daily_ai WHERE day < ?", Math.floor(now / 86_400_000) - 2);
    await this.ctx.storage.setAlarm(now + 6 * 3600_000);
  }
}


/* ---------------------------------------------------------------- accounts ---------------------------------------------------------------- */

/** One account (Phase 4): profile, hashed sessions, match records. Addressed by `idFromName(userId)`. */
export class UserStore extends DurableObject<Env> implements UserApi {
  private store: AccountStore;
  private econ: EconomyStore;
  private friends: FriendStore;
  private presenceState = new Presence();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new AccountStore(ctx.storage.sql as unknown as Sql);
    this.econ = new EconomyStore(this.econSql());
    this.friends = new FriendStore(this.econSql() as unknown as FriendSql);
    ctx.blockConcurrencyWhile(async () => {
      this.store.init();
      this.econ.init();
      this.friends.init();
    });
  }
  /* ---------------------------------------------- friends (I/J): one generic RPC over FriendStore ---------------------------------------------- */
  private static FR_OPS = new Set(["code", "setCode", "spend", "isFriend", "isBlocking", "relation", "friendIds", "peerId", "lists", "canRequest", "recordOutgoing", "addFriend", "removeFriend", "cancelOutgoing", "declineIncoming", "incomingPeer", "block", "unblock", "receiveRequest", "outgoingDeclined", "incomingCancelled", "blockedBy", "refresh", "receiveInvite", "invites", "takeInvite", "inboxCount"]);
  async fr(op: string, ...args: unknown[]) {
    if (!UserStore.FR_OPS.has(op)) throw Error("unknown op");
    return (this.friends as unknown as Record<string, (...a: unknown[]) => unknown>)[op](...args);
  }
  async nickname() {
    return this.store.profile()?.nickname ?? null;
  }
  /** Friends' view of this account (memory only, never stored). */
  async presence() {
    return this.presenceState.status(Date.now());
  }
  async ping() {
    this.presenceState.ping(Date.now());
  }
  async setPlaying(room: string | null) {
    this.presenceState.setPlaying(room, Date.now());
  }
  /** SQLite of this account with an atomic transaction (all of an economy action, or none of it). */
  private depth = 0;
  private econSql(): EconSql {
    const sql = this.ctx.storage.sql;
    return {
      exec: (q: string, ...p: unknown[]) => sql.exec(q, ...(p as SqlStorageValue[])) as unknown as { toArray(): never[] },
      // Re-entrant: an economy action inside the match-record transaction joins it.
      transaction: <T>(fn: () => T) => {
        if (this.depth > 0) return fn();
        this.depth++;
        try {
          return this.ctx.storage.transactionSync(fn);
        } finally {
          this.depth--;
        }
      },
    } as EconSql;
  }
  private get economyOn() {
    return this.env.ECONOMY === "on";
  }
  private hub() {
    return this.env.HUB.get(this.env.HUB.idFromName("hub"));
  }
  /** Re-joining within 30 days of a deletion: no second new-member grant (only a timestamp is kept). */
  private rejoinBlockedUntil(): number | null {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS tomb (id INTEGER PRIMARY KEY CHECK (id = 1), deleted_at INTEGER NOT NULL)");
    const row = this.ctx.storage.sql.exec<{ deleted_at: number }>("SELECT deleted_at FROM tomb WHERE id = 1").toArray()[0];
    return row ? row.deleted_at + ECONOMY.rejoinWelcomeCooldownMs : null;
  }
  private welcome(now: number) {
    const p = this.store.profile();
    if (!p || !this.economyOn) return [];
    return this.econ.welcome(p.userId, now, this.rejoinBlockedUntil());
  }
  /** Economy snapshot (grants the new-member reward on first use). */
  async economy() {
    if (!this.economyOn) return { ok: false as const, code: "ECONOMY_OFF", message: "재화 기능은 아직 준비 중이에요." };
    const p = this.store.profile();
    if (!p) return { ok: false as const, code: "NO_ACCOUNT", message: "계정을 찾을 수 없어요." };
    const g = this.welcome(Date.now());
    if (g.length) await this.hub().count("econ.welcome").catch(() => undefined);
    return { ok: true as const, snapshot: this.econ.snapshot(p.userId, Date.now()) };
  }
  private async econAction(kind: string, fn: (userId: string, now: number) => { ok: true; duplicate?: boolean; snapshot: unknown } | { ok: false; code: string; message: string }, metric?: (r: { ok: true; duplicate?: boolean }) => string | null) {
    if (!this.economyOn) return { ok: false as const, code: "ECONOMY_OFF", message: "재화 기능은 아직 준비 중이에요." };
    const p = this.store.profile();
    if (!p) return { ok: false as const, code: "NO_ACCOUNT", message: "계정을 찾을 수 없어요." };
    this.welcome(Date.now());
    const r = fn(p.userId, Date.now());
    if (r.ok && !r.duplicate) {
      const m = metric?.(r);
      if (m) await this.hub().count(m).catch(() => undefined);
    }
    void kind;
    return r;
  }
  async buy(itemId: unknown, currency: unknown, requestId: string) {
    const tier = itemById(itemId)?.tier ?? "unknown";
    return this.econAction("buy", (u, n) => this.econ.buy(u, itemId, currency, requestId, n), () => `buy.${tier}.${currency === "gems" ? "gems" : "coins"}`);
  }
  async upgrade(itemId: unknown, requestId: string) {
    return this.econAction("upgrade", (u, n) => this.econ.upgrade(u, itemId, requestId, n), () => "upgrade");
  }
  async buySlot(kind: unknown, currency: unknown, requestId: string) {
    return this.econAction("slot", (u, n) => this.econ.buySlot(u, kind, currency, requestId, n), () => `slot.${kind === "chat" ? "chat" : "emote"}`);
  }
  async setLoadout(loadout: unknown) {
    return this.econAction("loadout", (u, n) => this.econ.setLoadout(u, loadout, n));
  }
  async rerollQuest(index: number) {
    return this.econAction("reroll", (u, n) => this.econ.rerollQuest(u, index, n), () => "quest.reroll");
  }
  /** Ledger ↔ balance check (administrator). */
  async verifyLedger() {
    return this.econ.verify();
  }
  /** Count a server AI match start against this account's daily limit. */
  async startAi() {
    const p = this.store.profile();
    if (!p) return { ok: false as const, code: "NO_ACCOUNT", message: "계정을 찾을 수 없어요." };
    return this.econ.startAi(p.userId, Date.now());
  }
  async ensureAndCode(userId: string, provider: string, clientStateHash: string) {
    this.store.ensureUser(userId, provider, Date.now());
    return this.store.createLoginCode(clientStateHash, Date.now());
  }
  async exchange(code: string, clientState: string) {
    return this.store.exchange(code, clientState, Date.now());
  }
  async authenticate(session: string) {
    return this.store.authenticate(session, Date.now());
  }
  async me() {
    return this.store.profile();
  }
  async records(limit: number) {
    return this.store.records(limit);
  }
  async setNickname(nickname: unknown) {
    const r = this.store.setNickname(nickname, Date.now());
    // Keep the friend search index in step (only for accounts that already have a friend code).
    const p = this.store.profile();
    if (r.ok && p && this.friends.code()) await this.env.FRIENDS.get(this.env.FRIENDS.idFromName("index")).register(p.userId, r.nickname).catch(() => undefined);
    return r;
  }
  async importRecords(records: MatchRecord[], source: "device" | "guest-import", guestId: string | null) {
    const result = this.store.importRecords(records, source, Date.now());
    if (guestId && !("error" in result)) this.store.linkGuest(guestId, Date.now());
    return result;
  }
  async logout(session: string) {
    await this.store.logout(session);
  }
  async logoutAll() {
    this.store.logoutAll();
  }
  /** Delete everything this account stores; returns linked guest ids so their claims can be released. */
  async deleteAccount() {
    const guests = this.store.exists() ? this.store.guests() : [];
    // Friends: everyone in my lists forgets me, and the search index drops me.
    const me = this.store.profile();
    if (me) {
      for (const id of this.friends.friendIds()) await (this.env.USERS.get(this.env.USERS.idFromName(id)) as unknown as FriendUser).fr("blockedBy", me.userId).catch(() => undefined);
      await this.env.FRIENDS.get(this.env.FRIENDS.idFromName("index")).remove(me.userId).catch(() => undefined);
    }
    await this.ctx.storage.deleteAll();
    this.store = new AccountStore(this.ctx.storage.sql as unknown as Sql);
    this.store.init();
    this.econ = new EconomyStore(this.econSql());
    this.econ.init();
    // Everything is gone. Only "deleted at" is kept for 30 days so a delete-and-rejoin loop cannot
    // collect the new-member grant again; an alarm removes it afterwards.
    const now = Date.now();
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS tomb (id INTEGER PRIMARY KEY CHECK (id = 1), deleted_at INTEGER NOT NULL)");
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO tomb (id, deleted_at) VALUES (1, ?)", now);
    await this.ctx.storage.setAlarm(now + ECONOMY.rejoinWelcomeCooldownMs + 60_000);
    return guests;
  }
  async publicProfile() {
    return this.store.publicProfile();
  }
  /** What other players see of this account in a match (validated equipped items; null = default look). */
  async look(): Promise<PublicLook | null> {
    return this.econ.look();
  }
  /** A signed-in seat: the account nickname (the one shown in every match) and the validated look. */
  async seat(): Promise<{ nickname: string | null; look: PublicLook | null }> {
    return { nickname: this.store.profile()?.nickname ?? null, look: this.econ.look() };
  }
  /** From a room: a server-verified result (idempotent by matchId). */
  async recordMatch(record: MatchRecord) {
    const p = this.store.profile();
    const now = Date.now();
    // The record and its rewards are stored in ONE transaction, keyed by the match id: a repeated
    // delivery finds the record and grants nothing; a crash leaves neither.
    const result = this.econSql().transaction(() => {
      if (!this.store.recordMatch(record)) return null;
      if (!p || !this.economyOn) return null;
      this.welcome(now);
      return this.econ.applyMatch(
        p.userId,
        p.createdAt,
        { matchId: record.recordId, kind: record.kind ?? "friend", outcome: record.outcome, endReason: record.endReason, score: record.score, card: record.card, opponentUserId: record.opponent.userId, stats: record.stats, endedAt: record.endedAt },
        now,
      );
    });
    if (result) {
      // Privacy-light operations counters (no ids): issuance, quests, achievements, daily actives.
      const coins = result.grants.reduce((a, g) => a + g.coins, 0);
      const gems = result.grants.reduce((a, g) => a + g.gems, 0);
      const hub = this.hub();
      const counts: [string, number][] = [
        ["econ.coins", coins],
        ["econ.gems", gems],
        [`reward.${record.kind ?? "friend"}.${result.reason}`, 1],
        ["quest.done", result.grants.filter((g) => g.kind === "quest").length],
        ["quest.allDaily", result.grants.filter((g) => g.key.startsWith("qb:daily")).length],
        ["achievement.unlock", result.grants.filter((g) => g.kind === "achievement").length],
        ["dau.members", result.firstToday ? 1 : 0],
      ];
      await Promise.all(counts.filter(([, n]) => n > 0).map(([k, n]) => hub.count(k, n))).catch(() => undefined);
      if (result.firstToday && result.wallet) await hub.count("balance." + bucket(result.wallet.coins)).catch(() => undefined);
      await hub.peak("econ.maxCoinsOneAccount", this.econ.earnedToday(now).coins).catch(() => undefined);
    }
    return true;
  }
  async alarm() {
    // Forget the deletion timestamp once the re-join cooldown is over.
    const until = this.rejoinBlockedUntil();
    if (until !== null && Date.now() >= until) {
      if (!this.store.exists()) await this.ctx.storage.deleteAll();
      else this.ctx.storage.sql.exec("DELETE FROM tomb WHERE id = 1");
    }
  }
}

/** Which account linked a guest's device records (first claim wins). Addressed by `idFromName(guestId)`. */
/** Friend code → account, exact nickname → accounts (one small SQLite object; never exposed directly). */
export class FriendIndex extends DurableObject<Env> {
  private core: FriendIndexStore;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.core = new FriendIndexStore(ctx.storage.sql as unknown as FriendSql);
    ctx.blockConcurrencyWhile(async () => this.core.init());
  }
  async register(userId: string, nickname: string) {
    return this.core.register(userId, nickname);
  }
  async lookup(code: string) {
    return this.core.lookup(code);
  }
  async search(nickname: string) {
    return this.core.search(nickname);
  }
  async remove(userId: string) {
    this.core.remove(userId);
  }
}

export class GuestLink extends DurableObject<Env> implements GuestApi {
  private sql: SqlStorage;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => void this.sql.exec("CREATE TABLE IF NOT EXISTS claim (id INTEGER PRIMARY KEY CHECK (id = 1), user_id TEXT NOT NULL, at INTEGER NOT NULL)"));
  }
  async claim(userId: string): Promise<"ok" | "taken"> {
    const row = this.sql.exec<{ user_id: string }>("SELECT user_id FROM claim WHERE id = 1").toArray()[0];
    if (row) return row.user_id === userId ? "ok" : "taken";
    this.sql.exec("INSERT INTO claim (id, user_id, at) VALUES (1, ?, ?)", userId, Date.now());
    return "ok";
  }
  async release(userId: string) {
    const row = this.sql.exec<{ user_id: string }>("SELECT user_id FROM claim WHERE id = 1").toArray()[0];
    if (row?.user_id === userId) await this.ctx.storage.deleteAll();
  }
}

/* ------------------------------------------------------------------ hub ------------------------------------------------------------------ */

/**
 * Quick-match queue, public spectating list and operations counters (Phase 4.5). One object for the
 * service (`idFromName("hub")`). Waiting players are hibernatable WebSockets whose attachments hold
 * their place in the queue; see worker/src/hub.ts.
 */
export class MatchHub extends DurableObject<Env> {
  private core: HubCore;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const config = readConfig(env);
    this.core = new HubCore({
      now: Date.now,
      sockets: () => ctx.getWebSockets() as unknown as HostSocket[],
      sql: ctx.storage.sql as unknown as HubSql,
      setAlarm: (at) => void ctx.storage.setAlarm(at),
      auth: async (session) => {
        const m = /^s1\.(u_[A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(session);
        if (!m || !authConfig(env)) return null;
        return (await env.USERS.get(env.USERS.idFromName(m[1])).authenticate(m[2])) ? m[1] : null;
      },
      createMatch: async (a: QueueSeat, b: QueueSeat, options) => {
        const directory = env.DIRECTORY.get(env.DIRECTORY.idFromName("directory"));
        const slot = await directory.allocateFor("random");
        if (!slot.ok) return { ok: false, message: slot.message };
        const seats: SeatSpec[] = [];
        for (const p of [a, b]) {
          // Members: the account nickname (validated when it was set) and the validated look.
          const info = p.userId ? await env.USERS.get(env.USERS.idFromName(p.userId)).seat().catch(() => null) : null;
          seats.push({ name: info?.nickname ?? p.name, identity: p.userId ? { userId: p.userId } : null, look: info?.look ?? null });
        }
        const made = await env.ROOMS.get(env.ROOMS.idFromName(slot.code!)).createMatched(slot.code!, seats, { kind: "random", public: options.public });
        if (!made.ok) {
          await directory.release(slot.code!);
          return { ok: false, message: made.message };
        }
        return { ok: true, code: slot.code!, seats: [made.seats[0], made.seats[1]] };
      },
    });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    ctx.blockConcurrencyWhile(async () => this.core.init());
    void config;
  }
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    if (this.core.waiting() >= 200) return new Response(null, { status: 503 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    await this.core.message(ws as unknown as HostSocket, message);
  }
  async webSocketClose(ws: WebSocket, code: number) {
    this.core.closed(ws as unknown as HostSocket);
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, "closed");
    } catch {
      /* already closed */
    }
  }
  async webSocketError(ws: WebSocket) {
    this.core.closed(ws as unknown as HostSocket);
  }
  async alarm() {
    this.core.flush();
  }
  /* RPC from rooms and the Worker */
  async publish(entry: unknown) {
    this.core.publish(entry);
  }
  async unpublish(code: string) {
    this.core.unpublish(code);
  }
  async ended(code: string) {
    this.core.ended(code);
  }
  async list() {
    return this.core.list();
  }
  async waiting() {
    return this.core.waiting();
  }
  async count(name: string, n = 1) {
    this.core.count(name, n);
  }
  async peak(name: string, value: number) {
    this.core.peak(name, value);
  }
  async report(days: number) {
    return this.core.report(days);
  }
}

/* ------------------------------------------------------------------ worker ------------------------------------------------------------------ */

const json = (status: number, body: unknown, origin: string | null, cache = "no-store") =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cache,
      ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
    },
  });
const fail = (status: number, code: string, message: string, origin: string | null) => json(status, { error: { code, message } }, origin);

/** Soft per-isolate fixed-window limiter (no storage, no Durable Object request). */
const isolateHits = new Map<string, { window: number; count: number }>();
function isolateLimited(key: string, perMinute: number): boolean {
  const window = Math.floor(Date.now() / 60_000);
  const row = isolateHits.get(key);
  const count = row && row.window === window ? row.count + 1 : 1;
  isolateHits.set(key, { window, count });
  if (isolateHits.size > 5000) for (const [k, v] of isolateHits) if (v.window < window) isolateHits.delete(k);
  return count > perMinute;
}

async function clientKey(request: Request): Promise<string> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("yachtlab:" + ip));
  return [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function readBody(request: Request): Promise<{ name?: unknown; maxPlayers?: unknown }> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY) throw new Error("too large");
  const text = await request.text();
  if (text.length > MAX_BODY) throw new Error("too large");
  const body = JSON.parse(text || "{}") as { name?: unknown; maxPlayers?: unknown };
  return body ?? {};
}
async function readName(request: Request): Promise<unknown> {
  return (await readBody(request)).name;
}
/** 2..20 players (default 2: the original 1:1 room). */
const maxPlayersOf = (v: unknown) => (Number.isInteger(v) && (v as number) >= 2 && (v as number) <= 20 ? (v as number) : 2);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const config = readConfig(env);
    const origin = request.headers.get("Origin");
    const allowed = origin && config.allowedOrigins.includes(origin) ? origin : null;
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    // Browsers always send Origin on cross-origin fetches and WebSocket upgrades: unknown origins are refused.
    if (origin && !allowed) return fail(403, "ORIGIN", "허용되지 않은 출처입니다.", null);
    if (request.method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: {
          ...(allowed ? { "access-control-allow-origin": allowed, vary: "Origin" } : {}),
          "access-control-allow-methods": "GET, POST",
          "access-control-allow-headers": "content-type, authorization",
          "access-control-max-age": "600",
        },
      });
    const directory = env.DIRECTORY.get(env.DIRECTORY.idFromName("directory"));
    // TEST_INSTANCE is set only by the local test helper (tells parallel test servers apart).
    if (url.pathname === "/healthz") return json(200, { ok: true, ...(env.TEST_INSTANCE ? { instance: env.TEST_INSTANCE } : {}) }, allowed);
    if (url.pathname === "/usage" && request.method === "GET") return json(200, await directory.usage(), allowed);
    const roomStub = (code: string) => env.ROOMS.get(env.ROOMS.idFromName(code));
    const auth = authConfig(env);
    const backends: AccountBackends = {
      user: (id) => env.USERS.get(env.USERS.idFromName(id)) as unknown as UserApi,
      guest: (id) => env.GUESTS.get(env.GUESTS.idFromName(id)) as unknown as GuestApi,
      // Per-account limits ("me:") are counted in this isolate's memory: a signed-in call no longer
      // costs an extra request to the global RoomDirectory (its duration was the largest on the
      // 2026-11-24 dashboard). Limits by IP (login, exchange, profiles) stay global in the directory.
      limited: (key, perMinute) => (key.startsWith("me:") ? Promise.resolve(isolateLimited(key, perMinute)) : directory.hit(key, perMinute)),
      fetcher: (input, init) => fetch(input, init),
      now: Date.now,
    };
    /** Signed-in identity for a seat (an invalid or expired session simply plays as a guest). */
    const seatIdentity = async () => {
      if (!auth) return null;
      const user = await sessionUser(request, backends);
      return user ? { userId: user.userId } : null;
    };
    /**
     * A signed-in seat's name and look, read from the account — never from the client: the account
     * nickname replaces whatever name the page sent (members use one nickname everywhere).
     */
    const seatInfo = async (identity: { userId: string } | null, name: unknown) => {
      if (!identity) return { name, look: null };
      const info = await env.USERS.get(env.USERS.idFromName(identity.userId)).seat().catch(() => null);
      return { name: info?.nickname ?? name, look: info?.look ?? null };
    };

    const hub = () => env.HUB.get(env.HUB.idFromName("hub"));
    try {
      // Quick match queue (Phase 4.5): one hibernatable socket per waiting player on the hub object.
      if (url.pathname === "/ws/match") {
        if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
        if (!allowed) return new Response("forbidden", { status: 403 });
        if (await directory.hit("queue:" + (await clientKey(request)), config.joinPerMinute)) return new Response(null, { status: 429 });
        return hub().fetch(request);
      }
      // What this server offers (the page hides what is not available).
      if (url.pathname === "/api/features" && request.method === "GET")
        return json(200, { quickMatch: true, publicSpectate: true, signIn: !!auth, serverAi: !!auth && env.SERVER_AI !== "off", economy: !!auth && env.ECONOMY === "on" }, allowed, "public, max-age=60");
      // Public spectating list: cheap, cached briefly; no tokens, no keys, no account ids in it.
      if (url.pathname === "/api/spectate/rooms" && request.method === "GET") {
        if (await directory.hit("list:" + (await clientKey(request)), 30)) return fail(429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.", allowed);
        return json(200, { rooms: await hub().list() }, allowed, "public, max-age=5");
      }
      if (parts[0] === "api" && parts[1] === "spectate" && parts.length === 4 && parts[3] === "watch" && request.method === "POST") {
        const code = normalizeCode(parts[2]);
        if (!code) return fail(404, "ROOM_NOT_FOUND", "경기를 찾을 수 없어요.", allowed);
        const verdict = await directory.check(await clientKey(request), code, "peek");
        if (!verdict.ok) return fail(verdict.status, verdict.code, verdict.message, allowed);
        const key = await roomStub(code).publicWatch();
        return key ? json(200, { code, key }, allowed) : fail(409, "NOT_PUBLIC", "지금은 이 경기를 관전할 수 없어요. 끝났거나 관전 인원이 가득 찼어요.", allowed);
      }
      // Operations metrics (administrator only: a Worker secret, never in the web bundle).
      if (parts[0] === "api" && parts[1] === "admin") {
        const token = env.ADMIN_TOKEN;
        const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        if (!token || token.length < 32 || given.length !== token.length || !sameText(given, token)) return fail(404, "NOT_FOUND", "없는 주소입니다.", null);
        if (url.pathname === "/api/admin/metrics" && request.method === "GET") return json(200, { usage: await directory.usage(), hub: await hub().report(Math.min(60, Number(url.searchParams.get("days") ?? 14) || 14)) }, null);
        if (parts[2] === "ledger" && parts.length === 4 && /^u_[A-Za-z0-9_-]{22}$/.test(parts[3])) return json(200, await env.USERS.get(env.USERS.idFromName(parts[3])).verifyLedger(), null);
        return fail(404, "NOT_FOUND", "없는 주소입니다.", null);
      }
      // Server-verified AI match (Phase 4.5): members only, the room plays the AI seat itself.
      if (url.pathname === "/api/ai/start" && request.method === "POST") {
        if (!allowed) return fail(403, "ORIGIN", "허용되지 않은 출처입니다.", null);
        if (env.SERVER_AI === "off") return fail(404, "AI_OFF", "서버 AI 대전은 지금 쉬고 있어요.", allowed);
        if (!auth) return fail(404, "AUTH_DISABLED", "회원 로그인은 아직 준비 중이에요.", allowed);
        const me = await sessionUser(request, backends);
        if (!me) return fail(401, "UNAUTHENTICATED", "서버 AI 대전은 로그인한 회원만 할 수 있어요.", allowed);
        if (await directory.hit("ai:" + me.userId, 6)) return fail(429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.", allowed);
        const user = env.USERS.get(env.USERS.idFromName(me.userId));
        const info = await user.seat().catch(() => null);
        const nick = validateNickname(info?.nickname ?? (await readName(request)));
        if (!nick.ok) return fail(400, "INVALID_COMMAND", nick.message, allowed);
        const started = await user.startAi();
        if (!started.ok) return fail(429, started.code, started.message, allowed);
        const slot = await directory.allocateFor("ai");
        if (!slot.ok) return fail(slot.status, slot.code, slot.message, allowed);
        const human: SeatSpec = { name: nick.name, identity: { userId: me.userId }, look: info?.look ?? null };
        const bot: SeatSpec = { name: "AI (보통)", ai: true };
        const humanFirst = (crypto.getRandomValues(new Uint8Array(1))[0] & 1) === 0;
        const made = await roomStub(slot.code!).createMatched(slot.code!, humanFirst ? [human, bot] : [bot, human], { kind: "ai", public: false });
        if (!made.ok) {
          await directory.release(slot.code!);
          return fail(500, "SERVER", made.message, allowed);
        }
        const seat = made.seats[humanFirst ? 0 : 1];
        return json(201, { code: slot.code, playerId: seat.playerId, token: seat.token }, allowed);
      }
      // WebSocket: /ws/:code — origin required, the room accepts it with the Hibernation API.
      if (parts[0] === "ws" && parts.length === 2) {
        if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
        if (!allowed) return new Response("forbidden", { status: 403 });
        const code = normalizeCode(parts[1]);
        if (!code) return new Response("not found", { status: 404 });
        const verdict = await directory.check(await clientKey(request), code, "peek");
        if (!verdict.ok) return new Response(null, { status: verdict.status });
        return roomStub(code).fetch(request);
      }
      // Friends & invites (I/J): members only; players are addressed by friend code.
      const friendPath = url.pathname.startsWith("/api/me/friends") || url.pathname === "/api/me/inbox" || url.pathname.startsWith("/api/me/invites");
      const roomInvite = parts[0] === "api" && parts[1] === "rooms" && parts.length === 4 && parts[3] === "invite" && request.method === "POST";
      if (friendPath || roomInvite) {
        if (!allowed && request.method !== "GET") return fail(403, "ORIGIN", "허용되지 않은 출처입니다.", null);
        if (!auth) return fail(404, "AUTH_DISABLED", "회원 로그인은 아직 준비 중이에요.", allowed);
        const me = await sessionUser(request, backends);
        if (!me) return fail(401, "UNAUTHENTICATED", "친구 기능은 로그인한 회원만 쓸 수 있어요.", allowed);
        if (isolateLimited("me:" + me.userId, 120)) return fail(429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.", allowed);
        const deps: FriendDeps = {
          user: (id) => env.USERS.get(env.USERS.idFromName(id)) as unknown as FriendUser,
          index: env.FRIENDS.get(env.FRIENDS.idFromName("index")) as unknown as FriendDeps["index"],
          limited: (key, perMinute) => Promise.resolve(isolateLimited(key, perMinute)),
          now: Date.now,
        };
        const readJson = async () => {
          const text = await request.text();
          if (text.length > 4096) throw new Error("too large");
          const v = JSON.parse(text || "{}");
          if (typeof v !== "object" || v === null || Array.isArray(v)) throw new SyntaxError("object expected");
          return v as Record<string, unknown>;
        };
        if (roomInvite) {
          const code = normalizeCode(parts[2]);
          if (!code) return fail(404, "ROOM_NOT_FOUND", "방을 찾을 수 없어요.", allowed);
          if (isolateLimited("invite:" + me.userId, 20)) return fail(429, "RATE_LIMITED", "초대를 너무 많이 보냈어요. 잠시 후 다시 해 주세요.", allowed);
          const state = await roomStub(code).inviteState(me.userId);
          if (!state.ok) return fail(409, "INVITE_" + state.reason.toUpperCase().replace("-", "_"), state.reason === "full" ? "방이 가득 찼어요." : state.reason === "started" ? "이미 경기가 시작된 방이에요." : "이 방에서 친구를 초대할 수 없어요.", allowed);
          const input = await readJson();
          const codes = Array.isArray(input.friends) ? input.friends.filter((c): c is string => typeof c === "string") : [];
          const results = await sendInvites(me, codes.slice(0, Math.max(0, state.seats - state.players) + 5), code, deps, () => crypto.randomUUID());
          return json(200, { results }, allowed);
        }
        if (url.pathname === "/api/me/invites/accept" && request.method === "POST") {
          const input = await readJson();
          const inv = await deps.user(me.userId).fr<{ room: string } | null>("takeInvite", String(input.id ?? ""), Date.now());
          if (!inv) return fail(404, "INVITE_EXPIRED", "초대가 만료되었거나 이미 처리됐어요.", allowed);
          const verdict = await directory.check(await clientKey(request), inv.room, "join");
          if (!verdict.ok) return fail(verdict.status, verdict.code, verdict.message, allowed);
          const identity = { userId: me.userId };
          const seat = await seatInfo(identity, null);
          const joined = await roomStub(inv.room).join(seat.name, identity, seat.look);
          if (!joined.ok) {
            const message = joined.error.code === "MATCH_FULL" ? "방이 가득 찼어요." : joined.error.code === "WRONG_PHASE" ? "이미 경기가 시작된 방이에요." : joined.error.code === "ROOM_CLOSED" ? "방이 닫혔어요." : joined.error.message;
            return fail(joined.status, joined.error.code, message, allowed);
          }
          return json(201, { code: inv.room, playerId: joined.playerId, token: joined.token }, allowed);
        }
        const res = await handleFriendRoute(request, url, me, deps, (status, body) => json(status, body, allowed), readJson);
        if (res) return res;
      }
      // Account routes (Phase 4). Browser API calls need an allowed Origin; the Google redirect pages do not.
      if (url.pathname.startsWith("/auth/") || (parts[0] === "api" && parts[1] !== "rooms")) {
        if (url.pathname.startsWith("/api/") && !allowed && request.method !== "GET") return fail(403, "ORIGIN", "허용되지 않은 출처입니다.", null);
        const res = await handleAccountRoute(request, url, auth, backends, await clientKey(request), (status, body) => json(status, body, allowed));
        if (res) return res;
      }
      if (parts[0] !== "api" || parts[1] !== "rooms") return fail(404, "NOT_FOUND", "없는 주소입니다.", allowed);

      if (request.method === "POST" && parts.length === 2) {
        const body = await readBody(request);
        const slot = await directory.allocate(await clientKey(request));
        if (!slot.ok) return fail(slot.status, slot.code, slot.message, allowed);
        const identity = await seatIdentity();
        const seat = await seatInfo(identity, body.name);
        const joined = await roomStub(slot.code!).create(slot.code!, seat.name, identity, seat.look, maxPlayersOf(body.maxPlayers));
        if (!joined.ok) {
          await directory.release(slot.code!);
          return fail(joined.status, joined.error.code, joined.error.message, allowed);
        }
        return json(201, { code: slot.code, playerId: joined.playerId, token: joined.token }, allowed);
      }

      const code = normalizeCode(parts[2]);
      if (!code) return fail(404, "ROOM_NOT_FOUND", "방을 찾을 수 없어요. 초대 코드를 확인해 주세요.", allowed);
      const isJoin = request.method === "POST" && parts.length === 4 && parts[3] === "join";
      const isPeek = request.method === "GET" && parts.length === 3;
      if (!isJoin && !isPeek) return fail(404, "NOT_FOUND", "없는 주소입니다.", allowed);
      const name = isJoin ? await readName(request) : undefined;
      const verdict = await directory.check(await clientKey(request), code, isJoin ? "join" : "peek");
      if (!verdict.ok) return fail(verdict.status, verdict.code, verdict.message, allowed);
      const room = roomStub(code);
      if (isPeek) {
        const summary = await room.summary();
        return summary ? json(200, summary, allowed) : fail(404, "ROOM_NOT_FOUND", "방을 찾을 수 없어요. 초대 코드를 확인해 주세요.", allowed);
      }
      const identity = await seatIdentity();
      const seat = await seatInfo(identity, name);
      const joined = await room.join(seat.name, identity, seat.look);
      if (!joined.ok) {
        const message = joined.error.code === "MATCH_FULL" ? "방이 가득 찼어요." : joined.error.code === "WRONG_PHASE" ? "이미 경기가 시작된 방이에요." : joined.error.message;
        return fail(joined.status, joined.error.code, message, allowed);
      }
      return json(201, { code, playerId: joined.playerId, token: joined.token }, allowed);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg === "too large" || error instanceof SyntaxError || error instanceof TypeError) return fail(400, "INVALID_COMMAND", "요청 형식이 올바르지 않습니다.", allowed);
      console.error("online worker error", msg);
      return fail(500, "SERVER", "서버 오류가 발생했어요.", allowed);
    }
  },
} satisfies ExportedHandler<Env>;

export { ROOM_LIMITS };
