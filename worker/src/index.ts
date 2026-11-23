import { DurableObject } from "cloudflare:workers";
import { newRoomCode, normalizeCode, ROOM_LIMITS, type RoomRecord } from "../../src/online/room";
import { readConfig, type ConfigVars, type OnlineConfig } from "./config";
import { RoomHost, type HostSocket, type HostStorage } from "./host";

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
  async create(code: string, name: unknown) {
    return this.host.create(code, name);
  }
  async join(name: unknown) {
    return this.host.join(name);
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
      this.sql.exec("CREATE TABLE IF NOT EXISTS hits (key TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL)");
      if ((await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now() + 3600_000);
    });
  }

  private limited(key: string, max: number): boolean {
    const window = Math.floor(Date.now() / 60_000);
    const row = this.sql.exec<{ window: number; count: number }>("SELECT window, count FROM hits WHERE key = ?", key).toArray()[0];
    const count = row && row.window === window ? row.count + 1 : 1;
    if (count > max + 1) return true; // already over: no further writes
    this.sql.exec("INSERT INTO hits (key, window, count) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET window = excluded.window, count = excluded.count", key, window, count);
    return count > max;
  }

  /** Reserve a fresh code for a new room. */
  async allocate(client: string): Promise<Verdict & { code?: string }> {
    if (this.limited("create:" + client, this.config.createPerMinute)) return { ok: false, status: 429, code: "RATE_LIMITED", message: "방을 너무 자주 만들었어요. 잠시 후 다시 시도해 주세요." };
    const count = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM rooms").one().n;
    if (count >= this.config.maxRooms) return { ok: false, status: 503, code: "ROOM_LIMIT", message: "지금은 방을 더 만들 수 없어요. 잠시 후 다시 시도해 주세요." };
    for (let i = 0; i < 20; i++) {
      const code = newRoomCode();
      if (this.sql.exec("SELECT 1 FROM rooms WHERE code = ?", code).toArray().length) continue;
      this.sql.exec("INSERT INTO rooms (code, created_at) VALUES (?, ?)", code, Date.now());
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

  async release(code: string) {
    this.sql.exec("DELETE FROM rooms WHERE code = ?", code);
  }

  async count() {
    return this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM rooms").one().n;
  }

  /** Hourly: forget rate windows, and room codes older than the retention limit (their rooms delete themselves). */
  async alarm() {
    const now = Date.now();
    this.sql.exec("DELETE FROM hits WHERE window < ?", Math.floor(now / 60_000) - 1);
    this.sql.exec("DELETE FROM rooms WHERE created_at < ?", now - this.config.maxAgeMs - 3600_000);
    await this.ctx.storage.setAlarm(now + 3600_000);
  }
}

/* ------------------------------------------------------------------ worker ------------------------------------------------------------------ */

const json = (status: number, body: unknown, origin: string | null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
    },
  });
const fail = (status: number, code: string, message: string, origin: string | null) => json(status, { error: { code, message } }, origin);

async function clientKey(request: Request): Promise<string> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("yachtlab:" + ip));
  return [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function readName(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY) throw new Error("too large");
  const text = await request.text();
  if (text.length > MAX_BODY) throw new Error("too large");
  const body = JSON.parse(text || "{}") as { name?: unknown };
  return body?.name;
}

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
          "access-control-allow-headers": "content-type",
          "access-control-max-age": "600",
        },
      });
    if (url.pathname === "/healthz") return json(200, { ok: true }, allowed);
    const directory = env.DIRECTORY.get(env.DIRECTORY.idFromName("directory"));
    const roomStub = (code: string) => env.ROOMS.get(env.ROOMS.idFromName(code));

    try {
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
      if (parts[0] !== "api" || parts[1] !== "rooms") return fail(404, "NOT_FOUND", "없는 주소입니다.", allowed);

      if (request.method === "POST" && parts.length === 2) {
        const name = await readName(request);
        const slot = await directory.allocate(await clientKey(request));
        if (!slot.ok) return fail(slot.status, slot.code, slot.message, allowed);
        const joined = await roomStub(slot.code!).create(slot.code!, name);
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
      const joined = await room.join(name);
      if (!joined.ok) {
        const message = joined.error.code === "MATCH_FULL" ? "이미 두 명이 모두 들어온 방이에요." : joined.error.code === "WRONG_PHASE" ? "이미 경기가 시작된 방이에요." : joined.error.message;
        return fail(joined.status, joined.error.code, message, allowed);
      }
      return json(201, { code, playerId: joined.playerId, token: joined.token }, allowed);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg === "too large" || error instanceof SyntaxError) return fail(400, "INVALID_COMMAND", "요청 형식이 올바르지 않습니다.", allowed);
      console.error("online worker error", msg);
      return fail(500, "SERVER", "서버 오류가 발생했어요.", allowed);
    }
  },
} satisfies ExportedHandler<Env>;

export { ROOM_LIMITS };
