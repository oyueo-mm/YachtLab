import type { SoloRecord } from "../../src/solo/records";
import type { DrawPool } from "../../src/economy/live/draw";
import type { MatchEconomyResult } from "./economy";
import { DurableObject } from "cloudflare:workers";
import { newRoomCode, normalizeCode, normalizeSpectateId, parseRoomSettings, ROOM_LIMITS, type RoomRecord, type RoomSettings } from "../../src/online/room";
import { readConfig, type ConfigVars, type OnlineConfig } from "./config";
import { RoomHost, type HostSocket, type HostStorage } from "./host";
import { AccountStore, type Sql } from "./account";
import { EconomyStore, type EconSql, type Quote } from "./economy";
import { RewardGrants, type GrantRecord } from "./grants";
import { RetentionStore, type DailyContentActivity } from "./retention";
import type { RewardInput } from "../../src/economy/live/rewards";
import { ECONOMY } from "../../src/economy/live/config";
import { itemById } from "../../src/economy/live/catalog";

/** Coin balance bucket for the privacy-light balance distribution. */
const bucket = (c: number) => (c < 100 ? "0-99" : c < 500 ? "100-499" : c < 2000 ? "500-1999" : c < 10000 ? "2000-9999" : c < 50000 ? "10k-49k" : "50k+");
import { validateNickname } from "../../src/identity/nickname";
import { ABSENT_ACCOUNT, FriendIndexStore, FriendStore, Presence, type FriendSql } from "./friends";
import { handleFriendRoute, sendInvites, type FriendDeps, type FriendUser, type ResidueMode } from "./friends-api";
import { CLEANUP_PARKED_CHECK_MS, CleanupQueue, INDEX_TARGET, runCleanup, type CleanupJob } from "./account-cleanup";
/** ADMIN-1 / FEEDBACK-1 cleanup targets (account ids start with "u_", so these never collide). */
const ADMIN_TARGET = "@admin";
const BOARD_TARGET = "@board";
import { sameText } from "./oidc";
import { authConfig, handleAccountRoute, sessionUser, type AccountBackends, type GuestApi, type UserApi } from "./accounts-api";
import type { MatchRecord } from "../../src/identity/records";
import type { SeatSpec } from "../../src/online/room";
import type { PublicLook } from "../../src/economy/live/catalog";
import type { MatchKind } from "../../src/economy/live/config";
import { HubCore, type HubSql, type QueueSeat } from "./hub";
import { clearStaleReservations, migrateReservations, reserve, type ReservationSql } from "./reservations";
import { adminSettings, legacyTokenRoutes } from "./admin/roles";
import { AdminCore, utcDay, type ActivityReport, type AdminSql, type InboxItem } from "./admin/store";
import { MemberOps, type MemberSql } from "./admin/member";
import { handleAdminRoute, handleEngagementRoute, type AdminBackends, type AdminUserApi } from "./admin/api";
import { BoardCore, type BoardSql } from "./feedback/board";

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
  DICE_DRAW?: string;
  /**
   * C5-CORE retention rewards (attendance, activity streak, weekly best streak) and the reward inbox:
   * "on" pays them (needs ECONOMY="on"); anything else — the default — keeps them off. Operational
   * activation is a separate owner approval (docs/economy/C5-RETENTION-RESEARCH.md §11).
   */
  RETENTION?: string;
  /**
   * Purchase-like requests (buy / upgrade / slot / draw): "required" refuses requests without the quote
   * fields (CLIENT_UPDATE_REQUIRED); anything else — the default — accepts them (older pages).
   */
  ECONOMY_QUOTE?: string;
  /** "off" disables server AI matches (kill switch, default on). */
  SERVER_AI?: string;
  /**
   * C4.2: friend-list residue of accounts deleted before the deletion cleanup existed — "off" (default),
   * "dry-run" (count only) or "on". Operator decision (docs/audits/c4-2026-11-28/C4-2-ACCOUNT-SECURITY.md).
   */
  FRIEND_RESIDUE_CLEANUP?: string;
  /**
   * C4.2: deploy a NEW value (e.g. a date) to have every parked deletion cleanup (16 failed attempts)
   * retried; each parked account checks weekly. No admin endpoint involved.
   */
  ACCOUNT_CLEANUP_RETRY_EPOCH?: string;
  /** Operations metrics endpoint (`GET /api/admin/metrics`), off unless this secret (≥ 32 chars) is set. */
  ADMIN_TOKEN?: string;
  /** ADMIN-1: one global object — admin sessions, audit log, member index, campaigns, codes, notices, reports, sanctions. */
  ADMIN: DurableObjectNamespace<AdminHub>;
  /** FEEDBACK-1: one global object — the service suggestion board. */
  FEEDBACK: DurableObjectNamespace<SuggestionBoard>;
  /** ADMIN-1 Worker SECRET: `u_…:role,…` (viewer | support | operator | owner). Unset = no admin console. */
  ADMIN_ACCOUNTS?: string;
  /** "on" allows admin writes (drafts, approvals, execution). Default off. */
  ADMIN_WRITES?: string;
  /** "self" lets an owner approve their own drafts; default needs a second administrator. */
  ADMIN_APPROVAL?: string;
  /** ADMIN-1: "google" (default) re-authentication for admin sessions; "off" honoured only for a loopback APP_URL (tests). */
  ADMIN_REAUTH?: string;
  /** ADMIN-1: approved reward-amount policy version. Unset = reward/code/adoption-reward drafts refused. */
  ADMIN_REWARD_POLICY?: string;
  /** D-ADM-9: legacy ADMIN_TOKEN routes — "metrics,ledger" (default), "metrics", "off". */
  ADMIN_TOKEN_ROUTES?: string;
  /** "on" opens the suggestion board, reports and appeals to members. Default off. */
  FEEDBACK_BOARD?: string;
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
      // Each rematch reuses this room and reserves the daily budget once.
      deliverRecord: async (userId, record) => env.USERS.get(env.USERS.idFromName(userId)).recordMatch(record),
      releaseMatch: async (code, matchNo) => env.DIRECTORY.get(env.DIRECTORY.idFromName("directory")).releaseMatch(code, matchNo),
      registerSpectate: async (code, sid) => env.DIRECTORY.get(env.DIRECTORY.idFromName("directory")).registerSpectate(code, sid),
      allowMatch: async (code, weight, matchNo, users) => {
        const verdict = await env.DIRECTORY.get(env.DIRECTORY.idFromName("directory")).allocateMatch(code, matchNo, weight, users);
        return verdict.ok ? null : verdict.message;
      },
      publish: async (code, entry) => {
        const hub = env.HUB.get(env.HUB.idFromName("hub"));
        await (entry ? hub.publish(entry, code) : hub.unpublish(code));
      },
      yachts: async (id, events) => env.HUB.get(env.HUB.idFromName("hub")).yachts(id, events),
      activity: async (code, info) => env.HUB.get(env.HUB.idFromName("hub")).observeRoom(code, info),
      matchEnded: async (code) => env.HUB.get(env.HUB.idFromName("hub")).ended(code),
      // Friends see "경기 중" (memory only on each account object; no storage write).
      memberStatus: async (userIds, room) => {
        await Promise.all(userIds.map((id) => env.USERS.get(env.USERS.idFromName(id)).setPlaying(room).catch(() => undefined)));
      },
      finished: async (info) => {
        const hub = env.HUB.get(env.HUB.idFromName("hub"));
        await hub.count(`finished.${info.kind}.${info.completed ? "completed" : "forfeit"}`);
        if (info.players) await hub.count(`players.${Math.min(20, info.players)}`);
        if (info.completed) {
          await hub.completed(info.matchId, info.at);
          await hub.count(`duration.${info.kind}.totalSec`, Math.round(info.durationMs / 1000));
        }
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
  async create(code: string, name: unknown, identity?: { userId: string } | null, look?: PublicLook | null, maxPlayers = 2, settings?: RoomSettings) {
    return this.host.create(code, name, identity, look, maxPlayers, settings);
  }
  async join(name: unknown, identity?: { userId: string } | null, look?: PublicLook | null) {
    return this.host.join(name, identity, look);
  }
  /** Quick match / AI match (seats and looks are given by trusted server code, never by a client). */
  async createMatched(code: string, seats: SeatSpec[], options: { kind: MatchKind; public: boolean }) {
    return this.host.createMatched(code, seats, options);
  }
  /** Public-list watch key, only when `sid` is this room's spectate id (the caller never knows the room code). */
  async publicWatch(sid: string) {
    return this.host.publicWatch(sid);
  }
  /** Friend invites: is this account seated in this friend room, and is there a free seat in the waiting room? */
  async inviteState(userId: string) {
    return this.host.inviteState(userId);
  }
  async summary() {
    return this.host.summary();
  }
  async holdsAccount(userId: string, matchNo: number) {
    return this.host.holdsAccount(userId, matchNo);
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
  private storage: DurableObjectStorage;
  private config: OnlineConfig;
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.config = readConfig(env);
    this.storage = ctx.storage;
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec("CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, created_at INTEGER NOT NULL)");
      this.sql.exec("CREATE TABLE IF NOT EXISTS daily (day INTEGER PRIMARY KEY, rooms INTEGER NOT NULL)");
      this.sql.exec("CREATE TABLE IF NOT EXISTS match_allocations (id TEXT PRIMARY KEY, code TEXT NOT NULL)");
      this.sql.exec("CREATE INDEX IF NOT EXISTS match_allocations_code ON match_allocations (code)");
      migrateReservations(this.sql as unknown as ReservationSql);
      // PR118-01: spectate id → room code. Watch links and the public list carry only the id.
      this.sql.exec("CREATE TABLE IF NOT EXISTS spectate_ids (sid TEXT PRIMARY KEY, code TEXT NOT NULL)");
      this.sql.exec("CREATE INDEX IF NOT EXISTS spectate_ids_code ON spectate_ids (code)");
      this.sql.exec("CREATE TABLE IF NOT EXISTS match_budget (code TEXT NOT NULL, match_no INTEGER NOT NULL, units INTEGER NOT NULL, PRIMARY KEY(code, match_no))");
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
  async allocateFor(kind: "random" | "ai", users: string[] = [], assignmentId?: string): Promise<Verdict & { code?: string }> {
    const first = this.allocateForOnce(kind, users, assignmentId);
    if (first.ok || first.code !== "IN_MATCH" || !(await this.clearStaleReservations(users))) return first;
    return this.allocateForOnce(kind, users, assignmentId);
  }

  private allocateForOnce(kind: "random" | "ai", users: string[], assignmentId?: string): Verdict & { code?: string } {
    return this.storage.transactionSync(() => {
      if (assignmentId) {
        const allocation = this.sql.exec<{ code: string }>("SELECT code FROM match_allocations WHERE id = ?", assignmentId).toArray()[0];
        if (allocation) return { ok: true, code: allocation.code };
      }
      const conflict = this.playingConflict(users);
      if (conflict) return conflict;
      const slot = this.allocateMatchRoom(kind, users);
      if (slot.ok && assignmentId) this.sql.exec("INSERT INTO match_allocations (id, code) VALUES (?, ?)", assignmentId, slot.code!);
      return slot;
    });
  }

  private allocateMatchRoom(kind: "random" | "ai", users: string[]): Verdict & { code?: string } {
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
      this.reservePlayers(users, code, 1);
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

  private playingConflict(users: string[], code?: string): Extract<Verdict, { ok: false }> | null {
    if (new Set(users).size !== users.length) return { ok: false, status: 409, code: "DUPLICATE", message: "같은 계정은 한 좌석에서만 경기할 수 있어요." };
    for (const id of users) {
      const active = this.sql.exec<{ code: string }>("SELECT code FROM playing_users WHERE user_id = ?", id).toArray()[0];
      if (active && active.code !== code) return { ok: false, status: 409, code: "IN_MATCH", message: "이미 다른 온라인 경기에 참가 중인 계정이 있어요." };
    }
    return null;
  }

  private reservePlayers(users: string[], code: string, matchNo: number) {
    reserve(this.sql as unknown as ReservationSql, users, code, matchNo, Date.now());
  }

  /** PR118-03: before refusing with IN_MATCH, drop reservations their room no longer holds. */
  private clearStaleReservations(users: string[], except?: string): Promise<boolean> {
    return clearStaleReservations(this.sql as unknown as ReservationSql, users, (code, userId, matchNo) => this.env.ROOMS.get(this.env.ROOMS.idFromName(code)).holdsAccount(userId, matchNo), Date.now(), except);
  }

  async releaseMatch(code: string, matchNo: number) {
    this.sql.exec("DELETE FROM playing_users WHERE code = ? AND match_no = ?", code, matchNo);
  }

  /**
   * One more match in an existing room (rematch). Shares the daily cap with room creation, so the
   * daily budget still bounds this service's share of the free plan; no new room code or object.
   */
  async allocateMatch(code: string, matchNo: number, weight: number, users: string[] = []): Promise<Verdict> {
    const first = this.allocateMatchOnce(code, matchNo, weight, users);
    if (first.ok || first.code !== "IN_MATCH" || !(await this.clearStaleReservations(users, code))) return first;
    return this.allocateMatchOnce(code, matchNo, weight, users);
  }

  private allocateMatchOnce(code: string, matchNo: number, weight: number, users: string[]): Verdict {
    const units = Math.max(0, Math.min(10, Math.floor(weight)));
    return this.storage.transactionSync(() => {
      if (!this.sql.exec("SELECT 1 FROM rooms WHERE code = ?", code).toArray().length)
        return { ok: false, status: 404, code: "ROOM_NOT_FOUND", message: "방을 찾을 수 없어요." };
      const conflict = this.playingConflict(users, code);
      if (conflict) return conflict;
      const reserved = this.sql.exec<{ units: number }>("SELECT units FROM match_budget WHERE code = ? AND match_no = ?", code, matchNo).toArray()[0]?.units ?? 0;
      // If a retry includes more seats, reserve only the additional units. A smaller roster
      // can still start using the units previously reserved for this logical match.
      const extra = units - reserved;
      if (extra <= 0) {
        this.reservePlayers(users, code, matchNo);
        return { ok: true };
      }
      const day = Math.floor(Date.now() / 86_400_000);
      const today = this.sql.exec<{ rooms: number }>("SELECT rooms FROM daily WHERE day = ?", day).toArray()[0]?.rooms ?? 0;
      if (today + extra > this.config.dailyRoomLimit)
        return { ok: false, status: 503, code: "DAILY_LIMIT", message: "오늘은 온라인 경기를 더 할 수 없어요. 내일 다시 시도해 주세요." };
      this.sql.exec("INSERT INTO daily (day, rooms) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET rooms = rooms + ?", day, extra, extra);
      this.sql.exec("INSERT INTO match_budget (code, match_no, units) VALUES (?, ?, ?) ON CONFLICT(code, match_no) DO UPDATE SET units = excluded.units", code, matchNo, units);
      this.reservePlayers(users, code, matchNo);
      return { ok: true };
    });
  }

  /** Generic in-memory rate limit for account routes (no storage writes). */
  async hit(key: string, perMinute: number): Promise<boolean> {
    return this.limited(key, perMinute);
  }

  /** A room's spectate id (one row per room that ever allowed spectators; removed with the room). */
  async registerSpectate(code: string, sid: string) {
    if (!this.sql.exec("SELECT 1 FROM rooms WHERE code = ?", code).toArray().length) throw Error("room not found");
    this.sql.exec("INSERT INTO spectate_ids (sid, code) VALUES (?, ?) ON CONFLICT(sid) DO NOTHING", sid, code);
    const row = this.sql.exec<{ code: string }>("SELECT code FROM spectate_ids WHERE sid = ?", sid).toArray()[0];
    if (row?.code !== code) throw Error("spectate id taken");
  }

  /** Rate-limited lookup of a spectate id (watch links, the public list). Never reveals the code to the caller's client. */
  async resolveSpectate(client: string, sid: string): Promise<(Verdict & { code?: string })> {
    if (this.limited(`peek:${client}`, this.config.joinPerMinute * 4)) return { ok: false, status: 429, code: "RATE_LIMITED", message: "잠시 후 다시 시도해 주세요." };
    const row = this.sql.exec<{ code: string }>("SELECT s.code AS code FROM spectate_ids s JOIN rooms r ON r.code = s.code WHERE s.sid = ?", sid).toArray()[0];
    return row ? { ok: true, code: row.code } : { ok: false, status: 404, code: "ROOM_NOT_FOUND", message: "경기를 찾을 수 없어요." };
  }

  async release(code: string) {
    this.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM spectate_ids WHERE code = ?", code);
      this.sql.exec("DELETE FROM match_budget WHERE code = ?", code);
      this.sql.exec("DELETE FROM match_allocations WHERE code = ?", code);
      this.sql.exec("DELETE FROM playing_users WHERE code = ?", code);
      this.sql.exec("DELETE FROM rooms WHERE code = ?", code);
    });
  }

  async liveCodes() {
    return this.sql.exec<{ code: string }>("SELECT code FROM rooms").toArray().map((row) => row.code);
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
    this.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM rooms WHERE created_at < ?", now - this.config.maxAgeMs - 3600_000);
      this.sql.exec("DELETE FROM match_budget WHERE code NOT IN (SELECT code FROM rooms)");
      this.sql.exec("DELETE FROM playing_users WHERE code NOT IN (SELECT code FROM rooms)");
      this.sql.exec("DELETE FROM match_allocations WHERE code NOT IN (SELECT code FROM rooms)");
      this.sql.exec("DELETE FROM spectate_ids WHERE code NOT IN (SELECT code FROM rooms)");
    });
    this.sql.exec("DELETE FROM daily WHERE day < ?", Math.floor(now / 86_400_000) - 2);
    this.sql.exec("CREATE TABLE IF NOT EXISTS daily_ai (day INTEGER PRIMARY KEY, rooms INTEGER NOT NULL)");
    this.sql.exec("DELETE FROM daily_ai WHERE day < ?", Math.floor(now / 86_400_000) - 2);
    await this.ctx.storage.setAlarm(now + 6 * 3600_000);
  }
}


/* ---------------------------------------------------------------- accounts ---------------------------------------------------------------- */

/** What the page sees of a grant (no user id, no fingerprint). */
const publicGrant = (g: GrantRecord) => ({ txId: g.txId, source: g.source, coins: g.coins, gems: g.gems, items: g.items, label: g.label, status: g.status, createdAt: g.createdAt, expiresAt: g.expiresAt });
/** Operations counters of C5 grants (no ids): count and coins / gems per source. */
function grantCounts(grants: readonly GrantRecord[]): [string, number][] {
  const out = new Map<string, number>();
  const add = (k: string, n: number) => n > 0 && out.set(k, (out.get(k) ?? 0) + n);
  for (const g of grants) {
    add(`grant.${g.source}`, 1);
    add(`grant.${g.source}.coins`, g.coins);
    add(`grant.${g.source}.gems`, g.gems);
    add("econ.coins", g.coins);
    add("econ.gems", g.gems);
  }
  return [...out];
}

/** One account (Phase 4): profile, hashed sessions, match records. Addressed by `idFromName(userId)`. */
export class UserStore extends DurableObject<Env> implements UserApi {
  private store: AccountStore;
  private econ: EconomyStore;
  private grants: RewardGrants;
  private retention: RetentionStore;
  private friends: FriendStore;
  private cleanup: CleanupQueue;
  private member: MemberOps;
  private presenceState = new Presence();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new AccountStore(ctx.storage.sql as unknown as Sql);
    this.member = new MemberOps(ctx.storage.sql as unknown as MemberSql);
    this.econ = new EconomyStore(this.econSql());
    // C5: only the approved C5-CORE sources can pay (operator, suggestion, daily content, redeem codes: off)
    this.grants = new RewardGrants(this.econSql(), this.econ);
    this.retention = new RetentionStore(this.econSql(), this.grants);
    this.friends = new FriendStore(this.econSql() as unknown as FriendSql);
    this.cleanup = new CleanupQueue(ctx.storage.sql as unknown as Sql);
    ctx.blockConcurrencyWhile(async () => {
      this.store.init();
      this.econ.init();
      this.grants.init();
      this.retention.init();
      this.friends.init();
      this.cleanup.init();
      this.member.init();
    });
  }
  /* ---------------------------------------------- friends (I/J): one generic RPC over FriendStore ---------------------------------------------- */
  private static FR_OPS = new Set(["code", "setCode", "spend", "isFriend", "isBlocking", "relation", "friendIds", "peerId", "lists", "canRequest", "recordOutgoing", "addFriend", "removeFriend", "cancelOutgoing", "declineIncoming", "dropIncoming", "incomingPeer", "block", "unblock", "receiveRequest", "outgoingDeclined", "incomingCancelled", "blockedBy", "unblockedBy", "acceptedBy", "forget", "forgetMany", "retiredCodes", "residuePairs", "refresh", "receiveInvite", "invites", "takeInvite", "inboxCount"]);
  async fr(op: string, ...args: unknown[]) {
    if (!UserStore.FR_OPS.has(op)) throw Error("unknown op");
    // an account that does not exist (never created, or deleted) answers neutrally and stores nothing
    if (!this.store.exists()) return ABSENT_ACCOUNT[op];
    return (this.friends as unknown as Record<string, (...a: unknown[]) => unknown>)[op](...args);
  }
  async nickname() {
    return this.store.profile()?.nickname ?? null;
  }
  /** Friends' view of this account (memory only, never stored) — only for a viewer this account lists as a friend. */
  async presence(viewer?: string) {
    if (viewer !== undefined && (!this.store.exists() || !this.friends.isFriend(viewer))) return "offline" as const;
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
  private get retentionOn() {
    return this.economyOn && this.env.RETENTION === "on";
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
  private async econAction<T extends { ok: true; duplicate?: boolean; snapshot: unknown } | { ok: false; code: string; message: string }>(kind: string, fn: (userId: string, now: number) => T, metric?: (r: T & { ok: true; duplicate?: boolean }) => string | (string | [string, number])[] | null) {
    if (!this.economyOn) return { ok: false as const, code: "ECONOMY_OFF", message: "재화 기능은 아직 준비 중이에요." };
    const p = this.store.profile();
    if (!p) return { ok: false as const, code: "NO_ACCOUNT", message: "계정을 찾을 수 없어요." };
    this.welcome(Date.now());
    const before = this.econ.wallet();
    const r = fn(p.userId, Date.now());
    if (r.ok && !r.duplicate) {
      const m = metric?.(r as T & { ok: true });
      // ADMIN-1: spending is counted as the balance drop of the action (no ids, privacy-light)
      const after = this.econ.wallet();
      const counts: [string, number][] = [...(m === null || m === undefined ? [] : Array.isArray(m) ? m : [m]).map((x): [string, number] => (typeof x === "string" ? [x, 1] : x)),
        ["spend.coins", Math.max(0, before.coins - after.coins)], ["spend.gems", Math.max(0, before.gems - after.gems)]];
      const hub = this.hub();
      await Promise.all(counts.filter(([, n]) => n > 0).map(([k, n]) => hub.count(k, n))).catch(() => undefined);
    }
    void kind;
    return r;
  }
  async buy(itemId: unknown, currency: unknown, requestId: string, quote: Quote = {}) {
    const tier = itemById(itemId)?.tier ?? "unknown";
    return this.econAction("buy", (u, n) => this.econ.buy(u, itemId, currency, requestId, n, quote), () => [`buy.${tier}.${currency === "gems" ? "gems" : "coins"}`, ...(itemById(itemId) ? [`item.${itemById(itemId)!.id}`] : [])]);
  }
  async upgrade(itemId: unknown, requestId: string, quote: Quote = {}) {
    return this.econAction("upgrade", (u, n) => this.econ.upgrade(u, itemId, requestId, n, quote), () => {
      const level = itemById(itemId) ? this.econ.owned().get(itemById(itemId)!.id) : undefined;
      return ["upgrade", ...(level ? [`upgrade.level.${level}`] : [])];
    });
  }
  async buySlot(kind: unknown, currency: unknown, requestId: string, quote: Quote = {}) {
    return this.econAction("slot", (u, n) => this.econ.buySlot(u, kind, currency, requestId, n, quote), () => `slot.${kind === "chat" ? "chat" : "emote"}`);
  }
  async setLoadout(loadout: unknown) {
    return this.econAction("loadout", (u, n) => this.econ.setLoadout(u, loadout, n));
  }
  async rerollQuest(index: number | "all", period: "daily" | "weekly" = "daily", expected?: number) {
    return this.econAction("reroll", (u, n) => this.econ.rerollQuest(u, index, n, period, expected), () => "quest.reroll");
  }
  async drawStatus() {
    if (this.env.DICE_DRAW !== "on") return { ok: false as const, code: "ECONOMY_OFF", message: "뽑기는 아직 준비 중이에요." };
    return this.econAction("drawStatus", (userId, now) => ({
      ok: true as const, snapshot: this.econ.snapshot(userId, now), draw: this.econ.drawStatus(now),
    }));
  }
  async draw(pool: DrawPool, requestId: string, quote: Quote = {}) {
    if (this.env.DICE_DRAW !== "on") return { ok: false as const, code: "ECONOMY_OFF", message: "뽑기는 아직 준비 중이에요." };
    return this.econAction("draw", (u, n) => this.econ.draw(u, pool, requestId, n, quote), (r) => {
      const receipt = (r as { receipt?: { hand: string; duplicateCoins: number } }).receipt;
      return ["shop.draw", ...(receipt ? [`draw.hand.${receipt.hand}`, ...(receipt.duplicateCoins ? ["draw.duplicate"] : [])] : [])];
    });
  }
  /** Ledger ↔ balance check (administrator), including the grant records (C5). */
  async verifyLedger() {
    const ledger = this.econ.verify();
    const grants = this.grants.verify();
    return { ...ledger, ok: ledger.ok && grants.ok, grants: grants.grants, problems: [...ledger.problems, ...grants.problems] };
  }

  /* --------------------------------------------- C5 rewards: attendance, streaks, inbox, codes --------------------------------------------- */

  /** `snapshot` on changes only, so the page's wallet updates through the usual economy event. */
  private rewardsView(userId: string, now: number, changed = false) {
    return {
      status: this.retention.status(now),
      inbox: this.grants.inbox(now).map(publicGrant),
      history: this.grants.history(20).map(publicGrant),
      redeem: false,
      wallet: this.econ.balance(),
      ...(changed ? { snapshot: this.econ.snapshot(userId, now) } : {}),
    };
  }
  private retentionGate(): { ok: false; code: string; message: string } | null {
    if (!this.retentionOn) return { ok: false, code: "RETENTION_OFF", message: "출석·연속 활동 보상은 아직 준비 중이에요." };
    return this.store.profile() ? null : { ok: false, code: "NO_ACCOUNT", message: "계정을 찾을 수 없어요." };
  }
  /** GET /api/me/rewards — status of attendance, activity and weekly streak, the inbox and recent grants. */
  async rewards() {
    const gate = this.retentionGate();
    if (gate) return gate;
    const p = this.store.profile()!;
    const now = Date.now();
    this.welcome(now);
    this.grants.expire(now);
    return { ok: true as const, ...this.rewardsView(p.userId, now) };
  }
  /** POST /api/me/rewards/attendance — once per KST day. */
  async claimAttendance() {
    const gate = this.retentionGate();
    if (gate) return gate;
    const p = this.store.profile()!;
    const now = Date.now();
    this.welcome(now);
    const r = this.retention.claimAttendance(p.userId, now);
    if (!r.ok) return r;
    await Promise.all(grantCounts(r.granted).map(([k, n]) => this.hub().count(k, n))).catch(() => undefined);
    return { ok: true as const, granted: r.granted.map(publicGrant), ...this.rewardsView(p.userId, now, true) };
  }
  /** POST /api/me/rewards/claim — one inbox entry or "all". */
  async claimReward(txId: string | "all") {
    const gate = this.retentionGate();
    if (gate) return gate;
    const p = this.store.profile()!;
    const now = Date.now();
    let claimed: GrantRecord[];
    if (txId === "all") claimed = this.grants.claimAll(now).claimed;
    else {
      const r = this.grants.claim(txId, now);
      if (!r.ok) return r;
      claimed = r.duplicate ? [] : [r.record];
    }
    await Promise.all(grantCounts(claimed).map(([k, n]) => this.hub().count(k, n))).catch(() => undefined);
    return { ok: true as const, granted: claimed.map(publicGrant), ...this.rewardsView(p.userId, now, true) };
  }
  /**
   * POST /api/me/rewards/redeem — redeem codes need the global code directory of ADMIN-1 (#141) and an
   * approved amount; until both exist the route answers REDEEM_OFF and never pays.
   */
  async redeemCode(_code: string) {
    const gate = this.retentionGate();
    if (gate) return gate;
    return { ok: false as const, code: "REDEEM_OFF", message: "교환 코드는 아직 준비 중이에요." };
  }
  /** LIVE-1 (#142) hook: an approved daily content completion counts as an active day (no daily-content coins). */
  async dailyContentDone(activity: DailyContentActivity) {
    if (!this.retentionOn) return [];
    const p = this.store.profile();
    if (!p) return [];
    const now = Date.now();
    this.welcome(now);
    return this.retention.onDailyContent(p.userId, activity, now).map(publicGrant);
  }
  /** Count a server AI match start against this account's daily limit. */
  async startAi() {
    const p = this.store.profile();
    if (!p) return { ok: false as const, code: "NO_ACCOUNT", message: "계정을 찾을 수 없어요." };
    return this.econ.startAi(p.userId, Date.now());
  }
  async ensureAndCode(userId: string, provider: string, clientStateHash: string) {
    const isNew = !this.store.exists();
    this.store.ensureUser(userId, provider, Date.now());
    if (isNew) {
      const carried = await this.admin().op("signup", userId, Date.now()).catch(() => []) as { id: string; kind: "restrict" | "suspend"; reason: string; until: number | null }[];
      for (const c of carried) this.member.applySanction(c, Date.now());
    }
    return this.store.createLoginCode(clientStateHash, Date.now());
  }
  async exchange(code: string, clientState: string) {
    const session = await this.store.exchange(code, clientState, Date.now());
    // the alarm removes the session once expired, even if the account never comes back (SEC-04)
    if (session) await this.scheduleAlarm();
    return session;
  }
  async authenticate(session: string) {
    const ok = await this.store.authenticate(session, Date.now());
    if (ok) this.reportActivity();
    return ok;
  }
  /** ADMIN-1: authentication and sanction standing in one call (enforced by the Worker routes). */
  async authenticateStanding(session: string) {
    const ok = await this.authenticate(session);
    const s = this.member.standing(Date.now());
    return { ok, suspended: s.suspended, restricted: s.restricted, until: s.suspendedUntil ?? s.restrictedUntil };
  }
  private admin(): { op(name: string, ...args: unknown[]): Promise<unknown> } {
    return this.env.ADMIN.get(this.env.ADMIN.idFromName("admin")) as unknown as { op(name: string, ...args: unknown[]): Promise<unknown> };
  }
  /**
   * First authenticated request of a KST day queues an activity report; the whole unacknowledged queue
   * (oldest first, one call, one at a time) goes to the admin index and is removed only on success, so a
   * failure is retried at a later request (at most once a minute). The index counts each day once.
   */
  private activitySending = false;
  private activityTriedAt = 0;
  private reportActivity() {
    const p = this.store.profile();
    if (!p || !this.env.ADMIN) return;
    const fresh = this.member.activity(p, Date.now());
    if (this.activitySending || (!fresh && Date.now() - this.activityTriedAt < 60_000)) return;
    const queue = this.member.outbox();
    if (!queue.length) return;
    this.activitySending = true;
    this.activityTriedAt = Date.now();
    this.ctx.waitUntil(this.admin().op("activityBatch", queue satisfies ActivityReport[])
      .then(() => this.member.ack(queue.map((r) => r.day)))
      .catch(() => undefined)
      .finally(() => (this.activitySending = false)));
  }
  /* ------------------------------------------------------------- ADMIN-1 (admin console RPC) ------------------------------------------------------------- */
  async adminView() {
    const account = this.store.adminSummary();
    if (!account) return null;
    const now = Date.now();
    const snap = this.econ.snapshot(account.userId, now, 20);
    return {
      account,
      lastActiveDay: this.member.lastActiveDay() === null ? null : new Date(this.member.lastActiveDay()! * 86_400_000).toISOString().slice(0, 10),
      economy: { enabled: this.economyOn, wallet: snap.wallet, items: snap.inventory.length, topItems: [...snap.inventory].sort((a, b) => b.level - a.level).slice(0, 10), achievements: Object.keys(snap.state.achievements ?? {}).length, slots: snap.slots, loadout: snap.loadout, recentLedger: snap.ledger },
      ledger: this.econ.verify(),
      standing: this.member.standing(now),
      sanctions: this.member.sanctions(),
      inbox: this.member.inbox(now, 20),
    };
  }
  async adminRecord(matchId: string) {
    return this.store.exists() ? this.store.adminRecord(matchId) : null;
  }
  async deliver(item: InboxItem) {
    if (!this.store.exists()) return "absent" as const;
    this.member.deliver(item, Date.now());
    return "ok" as const;
  }
  async revokeItem(id: string) {
    return this.store.exists() && this.member.revoke(id);
  }
  async applySanction(s: { id: string; kind: "warning" | "nickname_reset" | "restrict" | "suspend"; reason: string; until: number | null }) {
    const p = this.store.profile();
    if (!p) return "absent" as const;
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      if (this.member.applySanction(s, now) && s.kind === "nickname_reset") this.store.resetNickname(now);
    });
    if (s.kind === "nickname_reset") await this.admin().op("nicknameChanged", p.userId, null).catch(() => undefined);
    return "ok" as const;
  }
  async liftSanction(id: string) {
    return this.store.exists() && this.member.liftSanction(id, Date.now());
  }
  async inbox() {
    const now = Date.now();
    return this.store.exists() ? { items: this.member.inbox(now), unclaimed: this.member.unclaimed(now) } : { items: [], unclaimed: 0 };
  }
  async mySanctions() {
    return this.store.exists() ? this.member.sanctions() : [];
  }
  /** Claim a mailbox reward: ONE transaction — mailbox row + the economy ledger row `admin:<id>`. */
  async claim(id: string) {
    const p = this.store.profile();
    if (!p) return { ok: false as const, code: "NO_ACCOUNT", message: "계정을 찾을 수 없어요." };
    if (!this.economyOn) return { ok: false as const, code: "ECONOMY_OFF", message: "재화 기능은 아직 준비 중이에요." };
    const now = Date.now();
    this.welcome(now);
    const r = this.econSql().transaction(() => this.member.claim(id, now, (eventId, coins, gems, label) => void this.econ.adminGrant(p.userId, eventId, coins, gems, label, now)));
    return r.ok ? { ...r, snapshot: this.econ.snapshot(p.userId, now) } : r;
  }
  /** Redeem code: deliver and claim together (idempotent by the redemption id). */
  async redeemGrant(item: InboxItem) {
    const p = this.store.profile();
    if (!p) return { ok: false as const, code: "NO_ACCOUNT", message: "계정을 찾을 수 없어요." };
    if (!this.economyOn) return { ok: false as const, code: "ECONOMY_OFF", message: "재화 기능은 아직 준비 중이에요." };
    const now = Date.now();
    this.welcome(now);
    return this.econSql().transaction(() => {
      this.member.deliver(item, now);
      const r = this.member.claim(item.id, now, (eventId, coins, gems, label) => void this.econ.adminGrant(p.userId, eventId, coins, gems, label, now));
      // already claimed by an earlier, interrupted attempt: the grant exists, report it as done
      return r.ok ? r : r.code === "CLAIMED" ? { ok: true as const, coins: item.coins, gems: item.gems } : r;
    });
  }
  async me() {
    return this.store.profile();
  }
  async matchReview(matchId: string) {
    return this.store.matchReview(matchId);
  }
  async matchReward(matchId: string) {
    return this.store.matchReward(matchId);
  }
  async records(limit: number) {
    return this.store.records(limit);
  }
  async setNickname(nickname: unknown) {
    const r = this.store.setNickname(nickname, Date.now());
    if (r.ok && this.store.profile()) await this.admin().op("nicknameChanged", this.store.profile()!.userId, r.nickname).catch(() => undefined);
    // Keep the friend search index in step (only for accounts that already have a friend code).
    const p = this.store.profile();
    // `keep`: if the index lost this account's entry, it is restored with the SAME code (never a new one).
    const code = this.friends.code();
    if (r.ok && p && code) await this.env.FRIENDS.get(this.env.FRIENDS.idFromName("index")).register(p.userId, r.nickname, [], code).catch(() => undefined);
    return r;
  }
  async soloRecords(limit: number) {
    return this.store.soloRecords(limit);
  }
  async importSolo(records: SoloRecord[]) {
    return this.store.importSolo(records, Date.now());
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
  /**
   * Delete everything this account stores; returns linked guest ids so their claims can be released.
   *
   * C4.2 (SEC-03): in ONE transaction (nothing else can run on this object in between) the account's
   * tables are dropped and a cleanup queue is written: every account holding a row about this one
   * (friends, requests both ways, blocks either way) is told to forget this generation, and the global
   * friend-code index drops its code. The queue is worked through at once and retried from the alarm.
   * Kept afterwards: the deletion time (30-day re-join grant cooldown), the retired friend code (so a
   * re-join is never handed it again) and the pending queue — no nickname, record, session or relation.
   */
  async deleteAccount() {
    const guests = this.store.exists() ? this.store.guests() : [];
    const owner = this.store.profile()?.userId ?? null;
    const plan = owner ? this.friends.deletionPlan() : { code: null, peers: [] };
    const now = Date.now();
    const sql = this.ctx.storage.sql;
    const keep = new Set(["tomb", "acct_cleanup", "fr_retired"]);
    this.ctx.storage.transactionSync(() => {
      const tables = sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").toArray().map((r) => r.name);
      for (const t of tables) if (!keep.has(t) && !t.startsWith("_cf_") && !t.startsWith("sqlite_")) sql.exec(`DROP TABLE IF EXISTS "${t.replace(/"/g, '""')}"`);
      sql.exec("CREATE TABLE IF NOT EXISTS tomb (id INTEGER PRIMARY KEY CHECK (id = 1), deleted_at INTEGER NOT NULL)");
      sql.exec("INSERT OR REPLACE INTO tomb (id, deleted_at) VALUES (1, ?)", now);
      sql.exec("CREATE TABLE IF NOT EXISTS fr_retired (code TEXT PRIMARY KEY, at INTEGER NOT NULL)");
      if (plan.code) sql.exec("INSERT OR IGNORE INTO fr_retired (code, at) VALUES (?, ?)", plan.code, now);
      this.cleanup.init();
      // ADMIN-1/FEEDBACK-1 (D-ADM-8): the admin index and the board are cleanup targets too — same durable,
      // retried, generation-safe queue as the friend relations (they act only on data from before `now`).
      if (owner) this.cleanup.enqueue(owner, [...(plan.code || plan.peers.length ? [INDEX_TARGET, ...plan.peers] : []), ADMIN_TARGET, BOARD_TARGET], plan.code, now);
    });
    // Fresh, empty objects over the (re-created) empty tables; presence is forgotten too.
    this.store = new AccountStore(sql as unknown as Sql);
    this.store.init();
    this.econ = new EconomyStore(this.econSql());
    this.econ.init();
    this.friends = new FriendStore(this.econSql() as unknown as FriendSql);
    this.friends.init();
    this.presenceState = new Presence();
    this.member = new MemberOps(sql as unknown as MemberSql);
    this.member.init();
    await this.runCleanup();
    await this.scheduleAlarm();
    return guests;
  }
  private async runCleanup() {
    const send = async (job: CleanupJob, userId: string) => {
      if (job.target === INDEX_TARGET) await this.env.FRIENDS.get(this.env.FRIENDS.idFromName("index")).removeCode(userId, job.code);
      else if (job.target === ADMIN_TARGET || job.target === BOARD_TARGET) {
        // generation bound: the deletion time of THIS deletion record (a later re-join is never touched)
        const deletedAt = this.ctx.storage.sql.exec<{ deleted_at: number }>("SELECT deleted_at FROM tomb WHERE id = 1").toArray()[0]?.deleted_at;
        if (deletedAt === undefined) return; // record already ended: nothing left to bound the cleanup → done
        if (job.target === ADMIN_TARGET) await this.admin().op("deleted", userId, deletedAt);
        else await (this.env.FEEDBACK.get(this.env.FEEDBACK.idFromName("board")) as unknown as { op(n: string, ...a: unknown[]): Promise<unknown> }).op("forget", userId, deletedAt);
      }
      else await (this.env.USERS.get(this.env.USERS.idFromName(job.target)) as unknown as FriendUser).fr("forget", userId, job.code);
    };
    const run = await runCleanup(this.cleanup, send, Date.now);
    if (run.failed || run.gaveUp) await this.cleanupReport({ retry: run.failed, gaveUp: run.gaveUp, remaining: run.remaining });
    return run;
  }
  /**
   * Cleanup counters (no ids): Hub metrics for `/api/admin/metrics`, and the same numbers as an
   * application log line, readable in Workers Logs / `wrangler tail` even without ADMIN_TOKEN.
   */
  private async cleanupReport(c: Record<string, number>) {
    console.warn("ACCOUNT_CLEANUP", JSON.stringify(c));
    const hub = this.hub();
    await Promise.all(Object.entries(c).filter(([k, n]) => n > 0 && k !== "remaining").map(([k, n]) => hub.count("account.cleanup." + k, n))).catch(() => undefined);
  }
  /** One alarm per object: next session expiry, next cleanup retry, end of the re-join cooldown. */
  private async scheduleAlarm() {
    const until = this.rejoinBlockedUntil();
    const expiry = this.store.exists() ? this.store.nextSessionExpiry() : null;
    // parked cleanup: look for an operator retry request weekly, until the deletion record ends
    const parkedCheck = this.cleanup.parked() ? Date.now() + CLEANUP_PARKED_CHECK_MS : null;
    // a deletion record already past its end waits for the active retries (handled in the same alarm run
    // as the last one), so it never schedules on its own — otherwise the alarm would fire every second
    const end = until === null ? null : until + 60_000 > Date.now() || this.cleanup.nextAt() === null ? until + 60_000 : null;
    const times = [expiry === null ? null : expiry + 60_000, this.cleanup.nextAt(), parkedCheck, end].filter((t): t is number => t !== null);
    if (!times.length) return;
    const want = Math.max(Math.min(...times), Date.now() + 1000);
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > want) await this.ctx.storage.setAlarm(want);
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
    const settlement: { current: MatchEconomyResult | null; retention?: GrantRecord[] } = { current: null };
    this.econSql().transaction(() => this.store.recordMatch(record, () => {
      if (!p || !this.economyOn) return undefined;
      this.welcome(now);
      const input: RewardInput = { matchId: record.recordId, kind: record.kind ?? "friend", outcome: record.outcome, endReason: record.endReason, score: record.score, card: record.card, opponentUserId: record.opponent.userId, stats: record.stats, endedAt: record.endedAt };
      settlement.current = this.econ.applyMatch(p.userId, p.createdAt, input, now);
      const receipt = settlement.current.receipt;
      // C5-CORE: activity streak + weekly best streak, same transaction (server-verified records only)
      if (this.retentionOn) {
        const countable = settlement.current.reason !== "own-forfeit" && settlement.current.reason !== "too-short";
        const paid = this.retention.onMatch(p.userId, record, input, { countable, reason: settlement.current.reason }, now);
        if (paid.length) {
          receipt.grants.push(...paid.map((g) => ({ kind: g.source, label: g.label, coins: g.coins, gems: g.gems })));
          receipt.after = this.econ.balance();
          settlement.retention = paid;
        }
      }
      return receipt.quests.length || receipt.grants.length ? receipt : undefined;
    }));
    const result = settlement.current;
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
        ...grantCounts(settlement.retention ?? []),
        ...result.grants.filter((g) => g.kind === "quest").map((g): [string, number] => [`quest.id.${g.key.split(":")[3] ?? "unknown"}`, 1]),
        ...result.grants.filter((g) => g.kind === "achievement").map((g): [string, number] => [`achievement.id.${g.key.slice(2)}`, 1]),
      ];
      await Promise.all(counts.filter(([, n]) => n > 0).map(([k, n]) => hub.count(k, n))).catch(() => undefined);
      if (result.firstToday && result.wallet) await hub.count("balance." + bucket(result.wallet.coins)).catch(() => undefined);
      await hub.peak("econ.maxCoinsOneAccount", this.econ.earnedToday(now).coins).catch(() => undefined);
    }
    return true;
  }
  async alarm() {
    const now = Date.now();
    // Expired sessions / login codes go even if the account never signs in again (SEC-04).
    if (this.store.exists()) this.store.pruneSessions(now);
    // Deletion cleanup retries (SEC-03); parked jobs restart when the operator deploys a new retry epoch.
    const requeued = this.cleanup.requeue(this.env.ACCOUNT_CLEANUP_RETRY_EPOCH ?? "", now);
    if (requeued) await this.cleanupReport({ requeued });
    if (this.cleanup.pending()) await this.runCleanup();
    // Forget the deletion timestamp once the re-join cooldown is over (and the cleanup has finished;
    // jobs still parked then are dropped — the peer-side residue check is the remaining path).
    const until = this.rejoinBlockedUntil();
    if (until !== null && now >= until && this.cleanup.parked() === this.cleanup.pending()) {
      const expired = this.cleanup.expireParked();
      if (expired) await this.cleanupReport({ expired });
      if (!this.store.exists()) {
        await this.ctx.storage.deleteAll();
        return;
      }
      this.ctx.storage.sql.exec("DELETE FROM tomb WHERE id = 1");
      this.ctx.storage.sql.exec("DELETE FROM fr_retired");
    }
    await this.scheduleAlarm();
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
  async register(userId: string, nickname: string, avoid?: string[], keep?: string | null) {
    return this.core.register(userId, nickname, avoid ?? [], keep ?? null);
  }
  async removeCode(userId: string, code: string | null) {
    this.core.removeCode(userId, code);
  }
  async live(pairs: { userId: string; code: string }[]) {
    return this.core.live(pairs);
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

/* ------------------------------------------------------------- admin (ADMIN-1) ------------------------------------------------------------- */

/** Allowlisted AdminCore methods callable over RPC (one generic method keeps the shell thin). */
const ADMIN_OPS = new Set(["createSession", "checkSession", "endSession", "endSessionsOf", "audit", "auditLog", "activity", "activityBatch", "signup", "deleted", "purgeRetention", "createReauth", "consumeReauth", "useSelfApproval", "nicknameChanged", "activityReport", "searchMembers", "draft", "action", "actions", "decide", "finishAction", "checkReward", "previewReward", "scheduleCampaign", "campaigns", "cancelCampaign", "retryFailed", "createCode", "code", "codes", "setCodeStatus", "redemptions", "redeem", "confirmRedeem", "saveNotice", "endNotice", "notices", "createReport", "reports", "report", "updateReport", "checkSanction", "recordSanction", "sanctions", "liftSanction", "createAppeal", "appeals", "answerAppeal"]);

/**
 * ADMIN-1: one object for the service (`idFromName("admin")`). Only the Worker and account objects
 * call it; it is never reachable from a browser except through the checked routes in admin/api.ts.
 * Its alarm sends due reward deliveries in small batches and expires time-limited sanctions.
 */
export class AdminHub extends DurableObject<Env> {
  private core: AdminCore;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    this.core = new AdminCore({
      exec: (q: string, ...p: unknown[]) => sql.exec(q, ...(p as SqlStorageValue[])) as unknown as { toArray(): never[] },
      transaction: <T>(fn: () => T) => ctx.storage.transactionSync(fn),
    } as AdminSql);
    ctx.blockConcurrencyWhile(async () => this.core.init());
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- structured-clone values; typed at the call sites (admin/api.ts)
  async op(name: string, ...args: unknown[]): Promise<any> {
    if (!ADMIN_OPS.has(name)) throw Error("unknown op");
    return (this.core as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args);
  }
  async schedule() {
    const next = this.core.nextWorkAt();
    const want = Math.max(Date.now() + 1000, next ?? Date.now() + 6 * 3600_000);
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > want) await this.ctx.storage.setAlarm(want);
  }
  async alarm() {
    const now = Date.now();
    await this.core.process(now, async (userId, item) => this.env.USERS.get(this.env.USERS.idFromName(userId)).deliver(item));
    this.core.expireSanctions(now);
    this.core.pruneSessions(now, adminSettings(this.env).absoluteMs);
    this.core.purgeRetention(now);
    const next = this.core.nextWorkAt();
    // idle: wake every 6 hours for sanction expiry / session pruning; busy: as soon as work is due
    await this.ctx.storage.setAlarm(Math.max(now + 1000, Math.min(next ?? Infinity, now + 6 * 3600_000)));
  }
}

const BOARD_OPS = new Set(["create", "list", "get", "vote", "report", "setCredit", "contributors", "moderate", "rewardTarget", "markReward", "history", "forget", "stats"]);
/** FEEDBACK-1: the suggestion board (`idFromName("board")`). */
export class SuggestionBoard extends DurableObject<Env> {
  private core: BoardCore;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    this.core = new BoardCore({
      exec: (q: string, ...p: unknown[]) => sql.exec(q, ...(p as SqlStorageValue[])) as unknown as { toArray(): never[] },
      transaction: <T>(fn: () => T) => ctx.storage.transactionSync(fn),
    } as BoardSql);
    ctx.blockConcurrencyWhile(async () => this.core.init());
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see AdminHub.op
  async op(name: string, ...args: unknown[]): Promise<any> {
    if (!BOARD_OPS.has(name)) throw Error("unknown op");
    return (this.core as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args);
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
      transaction: (run) => ctx.storage.transactionSync(run),
      auth: async (session) => {
        const m = /^s1\.(u_[A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(session);
        if (!m || !authConfig(env)) return null;
        // ADMIN-1: a restricted / suspended account cannot queue as a member
        const r = await env.USERS.get(env.USERS.idFromName(m[1])).authenticateStanding(m[2]);
        return r.ok && !r.restricted ? m[1] : null;
      },
      createMatch: async (a: QueueSeat, b: QueueSeat, options) => {
        const directory = env.DIRECTORY.get(env.DIRECTORY.idFromName("directory"));
        const slot = await directory.allocateFor("random", [a, b].flatMap((seat) => seat.userId ?? []), options.assignmentId);
        if (!slot.ok) return { ok: false, message: slot.message };
        const seats: SeatSpec[] = [];
        for (const [i, p] of [a, b].entries()) {
          // Members: the account nickname (validated when it was set) and the validated look.
          const info = p.userId ? await env.USERS.get(env.USERS.idFromName(p.userId)).seat().catch(() => null) : null;
          seats.push({ name: info?.nickname ?? p.name, identity: p.userId ? { userId: p.userId } : null, look: info?.look ?? null, token: options.secrets[i] });
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
  async publish(entry: unknown, room?: string) {
    this.core.publish(entry, room);
  }
  async unpublish(code: string) {
    this.core.unpublish(code);
  }
  async ended(code: string) {
    this.core.ended(code);
  }
  async observeRoom(code: string, info: Parameters<HubCore["observeRoom"]>[1]) {
    this.core.observeRoom(code, info);
  }
  async yachts(id: string, events: { seq: number; at: number }[]) {
    this.core.yachts(id, events);
  }
  async completed(id: string, at: number) {
    this.core.completed(id, at);
  }
  /**
   * PR118-02: one aggregate shared by every caller for `activityCacheMs`. The directory is asked for
   * the live room codes at most once per window (was: once per request, plus this call).
   */
  private activityCache: { at: number; value: ReturnType<HubCore["activity"]> } | null = null;
  private activityLoad: Promise<ReturnType<HubCore["activity"]>> | null = null;
  async activity(liveCodes?: string[]) {
    if (liveCodes) return this.core.activity(liveCodes);
    const ttl = readConfig(this.env).activityCacheMs;
    const cached = this.activityCache;
    if (cached && Date.now() - cached.at < ttl) return cached.value;
    this.activityLoad ??= (async () => {
      try {
        const codes = await this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName("directory")).liveCodes();
        const value = this.core.activity(codes);
        this.activityCache = { at: Date.now(), value };
        return value;
      } finally {
        this.activityLoad = null;
      }
    })();
    return this.activityLoad;
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
/** PR118-02: last `/api/activity` answer in this isolate (memory only, no storage, no Cache API). */
let isolateActivity: { at: number; value: unknown } | null = null;
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

async function readBody(request: Request): Promise<{ name?: unknown; maxPlayers?: unknown; settings?: unknown }> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY) throw new Error("too large");
  const text = await request.text();
  if (text.length > MAX_BODY) throw new Error("too large");
  const body = JSON.parse(text || "{}") as { name?: unknown; maxPlayers?: unknown; settings?: unknown };
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
      // ADMIN-1: Google re-authentication → one-time admin ticket, only for accounts in ADMIN_ACCOUNTS
      adminReauth: env.ADMIN ? async (userId, cs, authTime) => (adminSettings(env).accounts.has(userId) ? ((await (env.ADMIN.get(env.ADMIN.idFromName("admin")) as unknown as { op(n: string, ...a: unknown[]): Promise<unknown> }).op("createReauth", userId, cs, authTime, Date.now())) as string) : null) : undefined,
      now: Date.now,
      quoteRequired: env.ECONOMY_QUOTE === "required",
    };
    /** Signed-in identity for a seat (an invalid or expired session simply plays as a guest). */
    const seatIdentity = async () => {
      if (!auth) return null;
      const user = await sessionUser(request, backends);
      // ADMIN-1: a restricted / suspended member cannot take an account seat (enforced in the catch below)
      if (user?.restricted) throw new Error("SANCTIONED");
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
        return json(200, { quickMatch: true, publicSpectate: true, signIn: !!auth, createSettings: true, defaultTurnTimeoutMs: config.turnTimeoutMs, backgroundMatch: true, activity: true, friendPublicSpectate: true, serverAi: !!auth && env.SERVER_AI !== "off", economy: !!auth && env.ECONOMY === "on" }, allowed, "public, max-age=60");
      if (url.pathname === "/api/activity" && request.method === "GET") {
        if (isolateLimited("activity:" + (await clientKey(request)), 15)) return fail(429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.", allowed);
        // PR118-02: one hub call (the hub caches the directory lookup), and this isolate reuses the
        // answer for half the hub window. Data is at most about 1.5 × ACTIVITY_CACHE_MS old.
        const ttl = config.activityCacheMs / 2;
        if (!isolateActivity || Date.now() - isolateActivity.at >= ttl) isolateActivity = { at: Date.now(), value: await hub().activity() };
        return json(200, isolateActivity.value, allowed, `public, max-age=${Math.max(1, Math.round(config.activityCacheMs / 1000))}`);
      }
      // Public spectating list: cheap, cached briefly; no tokens, no keys, no account ids in it.
      if (url.pathname === "/api/spectate/rooms" && request.method === "GET") {
        if (await directory.hit("list:" + (await clientKey(request)), 30)) return fail(429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.", allowed);
        return json(200, { rooms: await hub().list() }, allowed, "public, max-age=5");
      }
      // Public list → watch key. Addressed by the spectate id only; the room code is never returned (PR118-01).
      if (parts[0] === "api" && parts[1] === "spectate" && parts.length === 4 && parts[3] === "watch" && request.method === "POST") {
        const sid = normalizeSpectateId(parts[2]);
        if (!sid) return fail(404, "ROOM_NOT_FOUND", "경기를 찾을 수 없어요.", allowed);
        const verdict = await directory.resolveSpectate(await clientKey(request), sid);
        if (!verdict.ok) return fail(verdict.status, verdict.code, verdict.message, allowed);
        const key = await roomStub(verdict.code!).publicWatch(sid);
        return key ? json(200, { id: sid, code: sid, key }, allowed) : fail(409, "NOT_PUBLIC", "지금은 이 경기를 관전할 수 없어요. 끝났거나 관전 인원이 가득 찼어요.", allowed);
      }
      // ADMIN-1 / FEEDBACK-1 backends (Durable Object stubs; admin/api.ts holds every check).
      const engagement = (): AdminBackends => ({
        settings: adminSettings(env),
        admin: { op: (name, ...args) => (env.ADMIN.get(env.ADMIN.idFromName("admin")) as unknown as { op(n: string, ...a: unknown[]): Promise<never> }).op(name, ...args), schedule: () => env.ADMIN.get(env.ADMIN.idFromName("admin")).schedule() },
        board: { op: (name, ...args) => (env.FEEDBACK.get(env.FEEDBACK.idFromName("board")) as unknown as { op(n: string, ...a: unknown[]): Promise<never> }).op(name, ...args) },
        user: (id) => env.USERS.get(env.USERS.idFromName(id)) as unknown as AdminUserApi,
        sessionUser: (r) => (auth ? sessionUser(r, backends) : Promise.resolve(null)),
        hubReport: (d) => hub().report(d) as never,
        usage: () => directory.usage(),
        liveActivity: () => hub().activity(),
        flags: { signIn: !!auth, economy: env.ECONOMY === "on", diceDraw: env.DICE_DRAW === "on", serverAi: env.SERVER_AI !== "off", adminWrites: env.ADMIN_WRITES === "on", approval: env.ADMIN_APPROVAL === "self" ? "self" : "two-person", feedback: env.FEEDBACK_BOARD === "on", attachments: false, friendResidueCleanup: env.FRIEND_RESIDUE_CLEANUP ?? "off" },
        limited: (key, perMinute) => directory.hit(key, perMinute),
        count: (name, n) => hub().count(name, n),
        client: "",
        now: Date.now,
        feedback: !!auth && env.FEEDBACK_BOARD === "on",
        economy: !!auth && env.ECONOMY === "on",
      });
      if (parts[0] === "api" && (parts[1] === "notices" || parts[1] === "suggestions" || parts[1] === "reports" || (parts[1] === "me" && ["mailbox", "redeem", "sanctions", "appeals"].includes(parts[2] ?? "")))) {
        if (request.method !== "GET" && !allowed) return fail(403, "ORIGIN", "허용되지 않은 출처입니다.", null);
        const reply = (status: number, body: unknown) => json(status, body, allowed, parts[1] === "notices" && status === 200 ? "public, max-age=60" : "no-store");
        if (parts[1] === "notices" && !env.ADMIN) return reply(200, { notices: [] });
        const routed = await handleEngagementRoute(request, url, { ...engagement(), client: await clientKey(request) }, reply);
        if (routed) return routed;
      }
      // Operations metrics (administrator only: a Worker secret, never in the web bundle).
      if (parts[0] === "api" && parts[1] === "admin") {
        const token = env.ADMIN_TOKEN;
        const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        const legacy = !!token && token.length >= 32 && given.length === token.length && sameText(given, token);
        // ADMIN-1 console: member session → admin session, role from the ADMIN_ACCOUNTS secret (admin/api.ts).
        if (!legacy) {
          if (!env.ADMIN || !auth) return fail(404, "NOT_FOUND", "없는 주소입니다.", null);
          return handleAdminRoute(request, url, { ...engagement(), client: await clientKey(request) }, (status, body) => json(status, body, allowed));
        }
        // Legacy shared token (D-ADM-9): read-only allowlist, rate-limited, every use in the admin audit log.
        // No write and no new route may be served here — modules register console routes instead.
        const routes = legacyTokenRoutes(env.ADMIN_TOKEN_ROUTES);
        const route = url.pathname === "/api/admin/metrics" ? "metrics" : parts[2] === "ledger" && parts.length === 4 && /^u_[A-Za-z0-9_-]{22}$/.test(parts[3]) ? "ledger" : null;
        if (request.method !== "GET" || !route || !routes.has(route)) return fail(404, "NOT_FOUND", "없는 주소입니다.", null);
        if (await directory.hit("admin-legacy:" + (await clientKey(request)), 30)) return fail(429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.", null);
        await (env.ADMIN?.get(env.ADMIN.idFromName("admin")) as unknown as { op(n: string, ...a: unknown[]): Promise<unknown> } | undefined)?.op("audit", { at: Date.now(), actor: "token:ADMIN_TOKEN", role: "legacy-token", action: "legacy." + route, target: route === "ledger" ? parts[3] : "", result: "ok", client: await clientKey(request) }).catch(() => console.warn("ADMIN_LEGACY_AUDIT_FAILED"));
        if (route === "metrics") return json(200, { usage: await directory.usage(), hub: await hub().report(Math.min(60, Number(url.searchParams.get("days") ?? 14) || 14)) }, null);
        return json(200, await env.USERS.get(env.USERS.idFromName(parts[3])).verifyLedger(), null);
      }
      // Server-verified AI match (Phase 4.5): members only, the room plays the AI seat itself.
      if (url.pathname === "/api/ai/start" && request.method === "POST") {
        if (!allowed) return fail(403, "ORIGIN", "허용되지 않은 출처입니다.", null);
        if (env.SERVER_AI === "off") return fail(404, "AI_OFF", "서버 AI 대전은 지금 쉬고 있어요.", allowed);
        if (!auth) return fail(404, "AUTH_DISABLED", "회원 로그인은 아직 준비 중이에요.", allowed);
        const me = await sessionUser(request, backends);
        if (!me) return fail(401, "UNAUTHENTICATED", "서버 AI 대전은 로그인한 회원만 할 수 있어요.", allowed);
        if (me.restricted) return fail(403, "SANCTIONED", "이용 제한 중에는 온라인 대전을 할 수 없어요.", allowed);
        if (await directory.hit("ai:" + me.userId, 6)) return fail(429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.", allowed);
        const user = env.USERS.get(env.USERS.idFromName(me.userId));
        const info = await user.seat().catch(() => null);
        const nick = validateNickname(info?.nickname ?? (await readName(request)));
        if (!nick.ok) return fail(400, "INVALID_COMMAND", nick.message, allowed);
        const started = await user.startAi();
        if (!started.ok) return fail(429, started.code, started.message, allowed);
        const slot = await directory.allocateFor("ai", [me.userId]);
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
        // /ws/:code (players; legacy watch links) or /ws/:sid (watch links and the public list).
        const code = normalizeCode(parts[1]);
        const sid = code ? null : normalizeSpectateId(parts[1]);
        if (!code && !sid) return new Response("not found", { status: 404 });
        const verdict = code ? await directory.check(await clientKey(request), code, "peek") : await directory.resolveSpectate(await clientKey(request), sid!);
        if (!verdict.ok) return new Response(null, { status: verdict.status });
        return roomStub(code ?? (verdict as unknown as { code: string }).code).fetch(request);
      }
      // Friends & invites (I/J): members only; players are addressed by friend code.
      const friendPath = url.pathname.startsWith("/api/me/friends") || url.pathname === "/api/me/inbox" || url.pathname.startsWith("/api/me/invites");
      const roomInvite = parts[0] === "api" && parts[1] === "rooms" && parts.length === 4 && parts[3] === "invite" && request.method === "POST";
      if (friendPath || roomInvite) {
        if (!allowed && request.method !== "GET") return fail(403, "ORIGIN", "허용되지 않은 출처입니다.", null);
        if (!auth) return fail(404, "AUTH_DISABLED", "회원 로그인은 아직 준비 중이에요.", allowed);
        const me = await sessionUser(request, backends);
        if (!me) return fail(401, "UNAUTHENTICATED", "친구 기능은 로그인한 회원만 쓸 수 있어요.", allowed);
        if (me.suspended || (me.restricted && request.method !== "GET")) return fail(403, "SANCTIONED", "이용 제한 중에는 친구 기능을 쓸 수 없어요.", allowed);
        if (isolateLimited("me:" + me.userId, 120)) return fail(429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.", allowed);
        const deps: FriendDeps = {
          user: (id) => env.USERS.get(env.USERS.idFromName(id)) as unknown as FriendUser,
          index: env.FRIENDS.get(env.FRIENDS.idFromName("index")) as unknown as FriendDeps["index"],
          limited: (key, perMinute) => Promise.resolve(isolateLimited(key, perMinute)),
          now: Date.now,
          residue: (["dry-run", "on"].includes(env.FRIEND_RESIDUE_CLEANUP ?? "") ? env.FRIEND_RESIDUE_CLEANUP : "off") as ResidueMode,
          metric: (key, n) => {
            console.log("FRIEND_RESIDUE", JSON.stringify({ [key]: n })); // counts only, no ids
            return hub().count(key, n).catch(() => undefined);
          },
        };
        const readJson = async () => {
          // SEC-15 (C4 B-31): refuse an oversized declared body before reading it, as the other routes do.
          if (Number(request.headers.get("content-length") ?? "0") > 4096) throw new Error("too large");
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
        const settings = body.settings === undefined ? undefined : parseRoomSettings(body.settings);
        if (settings === null) return fail(400, "BAD_REQUEST", "경기 방식과 제한 시간을 확인해 주세요.", allowed);
        const slot = await directory.allocate(await clientKey(request));
        if (!slot.ok) return fail(slot.status, slot.code, slot.message, allowed);
        const identity = await seatIdentity();
        const seat = await seatInfo(identity, body.name);
        const joined = await roomStub(slot.code!).create(slot.code!, seat.name, identity, seat.look, maxPlayersOf(body.maxPlayers), settings);
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
      if (msg === "SANCTIONED") return fail(403, "SANCTIONED", "이용 제한 중에는 온라인 대전을 할 수 없어요.", allowed);
      console.error("ONLINE_WORKER_UNEXPECTED");
      // ADMIN-1 system status: an error counter only (no request data)
      await env.HUB.get(env.HUB.idFromName("hub")).count("worker.error").catch(() => undefined);
      return fail(500, "SERVER", "서버 오류가 발생했어요.", allowed);
    }
  },
} satisfies ExportedHandler<Env>;

export { ROOM_LIMITS };
