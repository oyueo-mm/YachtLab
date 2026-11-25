import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { OnlineRoom, ROOM_LIMITS, newRoomCode, normalizeCode, parseRoomSettings, type RoomConnection, type RoomRecord } from "../../src/online/room";
import type { DiceSource } from "../../src/online/dice-source";
import type { ServerMessage } from "../../src/online/wire";

/**
 * YachtLab Online — local development / self-host server (Phase 2).
 *
 * One process, rooms in memory, each room persisted as an atomically replaced JSON file (event log +
 * token hashes). Every room is an `OnlineRoom` that processes one message at a time, which is the same
 * contract a Cloudflare Durable Object gives (one instance per room). Nothing here is deployed.
 *
 * HTTP
 *   POST /api/rooms               {name}        → 201 {code, playerId, token}   create a 2-seat room and sit down
 *   GET  /api/rooms/:code                       → {code, status, seats, players} invite preview
 *   POST /api/rooms/:code/join    {name}        → 201 {code, playerId, token}
 *   GET  /healthz
 * WebSocket
 *   /ws/:code   first frame {t:"hello", token, since}
 */

export type OnlineServerOptions = {
  port?: number;
  host?: string;
  /** Directory for room files; null keeps rooms in memory only. */
  dataDir?: string | null;
  allowedOrigins?: string[];
  /** Turn time limit. null/0 = no limit. */
  turnTimeoutMs?: number | null;
  maxRooms?: number;
  /** Rooms with no sockets are removed after this idle time (lobby / finished / playing). */
  idle?: { lobbyMs: number; finishedMs: number; playingMs: number };
  sweepEveryMs?: number;
  /** Per-IP limits on room creation and joins (fixed one-minute window). */
  perMinute?: { create: number; join: number };
  now?: () => number;
  dice?: DiceSource;
  log?: (line: string) => void;
};

export type RunningOnlineServer = {
  url: string;
  port: number;
  server: Server;
  rooms: Map<string, OnlineRoom>;
  close(): Promise<void>;
  /** Run the idle-room sweeper now (tests). */
  sweep(): Promise<void>;
};

const DEFAULT_ORIGINS = ["http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:4173", "http://localhost:4173"];
const MAX_BODY = 1024;

export async function startOnlineServer(options: OnlineServerOptions = {}): Promise<RunningOnlineServer> {
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => {});
  const allowed = new Set(options.allowedOrigins ?? DEFAULT_ORIGINS);
  const maxRooms = options.maxRooms ?? 200;
  const turnTimeoutMs = options.turnTimeoutMs || null;
  const idle = options.idle ?? { lobbyMs: 30 * 60_000, finishedMs: 30 * 60_000, playingMs: 24 * 3600_000 };
  const perMinute = options.perMinute ?? { create: 10, join: 30 };
  const dataDir = options.dataDir === undefined ? null : options.dataDir;
  const rooms = new Map<string, OnlineRoom>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const writes = new Map<string, Promise<void>>();

  if (dataDir) await mkdir(dataDir, { recursive: true });
  const fileOf = (code: string) => join(dataDir!, `${code}.json`);

  /** Atomic replace (write temp + rename), serialized per room. */
  const save = (record: RoomRecord) => {
    if (!dataDir) return;
    const prev = writes.get(record.code) ?? Promise.resolve();
    const next = prev.then(async () => {
      const tmp = fileOf(record.code) + ".tmp";
      await writeFile(tmp, JSON.stringify(record));
      await rename(tmp, fileOf(record.code));
    });
    writes.set(record.code, next.catch(() => undefined));
    return next;
  };

  const depsFor = (code: string) => ({
    now,
    dice: options.dice,
    save,
    schedule(at: number | null) {
      clearTimeout(timers.get(code));
      timers.delete(code);
      if (at === null) return;
      const t = setTimeout(() => void rooms.get(code)?.alarm().catch((e) => log(`alarm ${code}: ${e}`)), Math.max(0, at - now()) + 5);
      timers.set(code, t);
    },
  });

  const dropRoom = async (code: string) => {
    rooms.get(code)?.closeRoom();
    rooms.delete(code);
    clearTimeout(timers.get(code));
    timers.delete(code);
    if (dataDir) {
      await writes.get(code);
      await rm(fileOf(code), { force: true });
    }
  };

  // Restart recovery: every stored room is audited by re-executing its log (Phase 1 engine).
  if (dataDir) {
    for (const file of await readdir(dataDir)) {
      if (!file.endsWith(".json")) continue;
      const code = file.slice(0, -5);
      try {
        const record = JSON.parse(await readFile(join(dataDir, file), "utf8")) as RoomRecord;
        rooms.set(code, OnlineRoom.restore(record, depsFor(code)));
      } catch (error) {
        log(`skip room ${code}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  /* ---------------------------------------------------------------- rate limits ---------------------------------------------------------------- */
  const windows = new Map<string, { start: number; count: number }>();
  const limited = (key: string, max: number) => {
    const t = now();
    const w = windows.get(key);
    if (!w || t - w.start >= 60_000) {
      windows.set(key, { start: t, count: 1 });
      return false;
    }
    w.count++;
    return w.count > max;
  };
  const ipOf = (req: IncomingMessage) => req.socket.remoteAddress ?? "unknown";

  /* ------------------------------------------------------------------- HTTP ------------------------------------------------------------------- */
  const send = (res: ServerResponse, status: number, body: unknown, origin?: string) => {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
    });
    res.end(JSON.stringify(body));
  };
  const fail = (res: ServerResponse, status: number, code: string, message: string, origin?: string) => send(res, status, { error: { code, message } }, origin);

  const readJson = (req: IncomingMessage) =>
    new Promise<unknown>((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new Error("too large"));
          req.destroy();
        } else chunks.push(c);
      });
      req.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
        } catch {
          reject(new Error("bad json"));
        }
      });
      req.on("error", reject);
    });

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    const okOrigin = origin && allowed.has(origin) ? origin : undefined;
    // Browsers always send Origin on cross-origin fetches: unknown origins are refused (fail closed).
    if (origin && !okOrigin) return fail(res, 403, "ORIGIN", "허용되지 않은 출처입니다.");
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        ...(okOrigin ? { "access-control-allow-origin": okOrigin, vary: "Origin" } : {}),
        "access-control-allow-methods": "GET, POST",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "600",
      });
      return res.end();
    }
    const url = new URL(req.url ?? "/", "http://local");
    const parts = url.pathname.split("/").filter(Boolean);
    try {
      if (req.method === "GET" && url.pathname === "/api/features")
        return send(res, 200, { quickMatch: false, publicSpectate: false, signIn: false, createSettings: true, defaultTurnTimeoutMs: turnTimeoutMs }, okOrigin);
      if (req.method === "GET" && url.pathname === "/healthz") return send(res, 200, { ok: true, rooms: rooms.size }, okOrigin);
      if (parts[0] !== "api" || parts[1] !== "rooms") return fail(res, 404, "NOT_FOUND", "없는 주소입니다.", okOrigin);

      if (req.method === "POST" && parts.length === 2) {
        if (limited("create:" + ipOf(req), perMinute.create)) return fail(res, 429, "RATE_LIMITED", "방을 너무 자주 만들었어요. 잠시 후 다시 시도해 주세요.", okOrigin);
        if (rooms.size >= maxRooms) return fail(res, 503, "ROOM_LIMIT", "지금은 방을 더 만들 수 없어요. 잠시 후 다시 시도해 주세요.", okOrigin);
        const body = await readJson(req);
        let code = newRoomCode();
        for (let i = 0; rooms.has(code) && i < 20; i++) code = newRoomCode();
        if (rooms.has(code)) return fail(res, 503, "ROOM_LIMIT", "방 코드를 만들지 못했어요.", okOrigin);
        const { maxPlayers, settings: rawSettings } = (body ?? {}) as { maxPlayers?: unknown; settings?: unknown };
        const settings = rawSettings === undefined ? undefined : parseRoomSettings(rawSettings);
        if (settings === null) return fail(res, 400, "BAD_REQUEST", "경기 방식과 제한 시간을 확인해 주세요.", okOrigin);
        const seats = Number.isInteger(maxPlayers) && (maxPlayers as number) >= 2 && (maxPlayers as number) <= 20 ? (maxPlayers as number) : 2;
        const room = OnlineRoom.create(code, depsFor(code), { turnTimeoutMs, seats, settings });
        const joined = await room.join((body as { name?: unknown })?.name);
        if (!joined.ok) return fail(res, joined.status, joined.error.code, joined.error.message, okOrigin);
        rooms.set(code, room);
        log(`room ${code} created`);
        return send(res, 201, { code, playerId: joined.playerId, token: joined.token }, okOrigin);
      }

      const code = normalizeCode(parts[2]);
      const room = code ? rooms.get(code) : undefined;
      if (parts.length >= 3 && !room) {
        if (req.method === "POST" && limited("join:" + ipOf(req), perMinute.join)) return fail(res, 429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.", okOrigin);
        return fail(res, 404, "ROOM_NOT_FOUND", "방을 찾을 수 없어요. 초대 코드를 확인해 주세요.", okOrigin);
      }
      if (req.method === "GET" && parts.length === 3) return send(res, 200, room!.summary(), okOrigin);
      if (req.method === "POST" && parts.length === 4 && parts[3] === "join") {
        if (limited("join:" + ipOf(req), perMinute.join)) return fail(res, 429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.", okOrigin);
        const body = await readJson(req);
        const joined = await room!.join((body as { name?: unknown })?.name);
        if (!joined.ok) {
          const message = joined.error.code === "MATCH_FULL" ? "이미 두 명이 모두 들어온 방이에요." : joined.error.code === "WRONG_PHASE" ? "이미 경기가 시작된 방이에요." : joined.error.message;
          return fail(res, joined.status, joined.error.code, message, okOrigin);
        }
        return send(res, 201, { code: room!.code, playerId: joined.playerId, token: joined.token }, okOrigin);
      }
      return fail(res, 404, "NOT_FOUND", "없는 주소입니다.", okOrigin);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg === "too large" || msg === "bad json") return fail(res, 400, "INVALID_COMMAND", "요청 형식이 올바르지 않습니다.", okOrigin);
      log(`http error: ${msg}`);
      return fail(res, 500, "SERVER", "서버 오류가 발생했어요.", okOrigin);
    }
  });

  /* ------------------------------------------------------------------ sockets ------------------------------------------------------------------ */
  const wss = new WebSocketServer({ noServer: true, maxPayload: ROOM_LIMITS.maxMessageBytes * 2 });
  server.on("upgrade", (req, socket, head) => {
    // A reconnect that arrives while the server shuts down must not become a new, untracked client.
    if (closing) return void socket.destroy();
    const origin = req.headers.origin;
    const parts = new URL(req.url ?? "/", "http://local").pathname.split("/").filter(Boolean);
    const code = parts[0] === "ws" && parts.length === 2 ? normalizeCode(parts[1]) : null;
    const room = code ? rooms.get(code) : undefined;
    const reject = (status: number, text: string) => {
      socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    // Browsers always send Origin on WebSocket upgrades; a cross-site page cannot reuse a player's seat.
    if (!origin || !allowed.has(origin)) return reject(403, "Forbidden");
    if (!room) return reject(404, "Not Found");
    wss.handleUpgrade(req, socket, head, (ws) => attach(room, ws));
  });

  const attach = (room: OnlineRoom, ws: WebSocket) => {
    const conn: RoomConnection = {
      playerId: null,
      seenSeq: 0,
      bucket: { tokens: ROOM_LIMITS.burst, at: now() },
      send: (message: ServerMessage) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
      },
      close: (code, reason) => ws.close(code, reason),
    };
    if (!room.connect(conn)) return;
    // Unauthenticated sockets are dropped quickly.
    const helloTimer = setTimeout(() => {
      if (!conn.playerId && !conn.spectator) ws.close(4001, "hello timeout");
    }, 10_000);
    ws.on("message", (data, isBinary) => {
      if (isBinary) return ws.close(1003, "text only");
      void room.message(conn, data.toString()).catch((e) => log(`message ${room.code}: ${e}`));
    });
    ws.on("close", () => {
      clearTimeout(helloTimer);
      room.disconnect(conn);
    });
    ws.on("error", () => ws.close());
  };

  /* ------------------------------------------------------------------ cleanup ------------------------------------------------------------------ */
  const sweep = async () => {
    const t = now();
    for (const [code, room] of rooms) {
      if (room.isClosed) {
        await dropRoom(code);
        continue;
      }
      if (room.connectionCount) continue;
      const status = room.match.status;
      const limit = status === "lobby" ? idle.lobbyMs : status === "finished" ? idle.finishedMs : idle.playingMs;
      if (t - room.touchedAt >= limit) {
        log(`room ${code} removed (idle ${status})`);
        await dropRoom(code);
      }
    }
    for (const [key, w] of windows) if (t - w.start >= 60_000) windows.delete(key);
  };
  const sweeper = setInterval(() => void sweep(), options.sweepEveryMs ?? 60_000);
  /**
   * Every TCP connection, whatever state it is in. `server.close()` only drops connections that sit
   * idle between HTTP requests; a socket a browser opened in advance and never used (Chromium
   * preconnects to origins a page used before) is not one of them, so shutdown waits for the browser
   * to drop it — forever while the page stays open. Shutdown destroys these explicitly.
   */
  const sockets = new Set<import("node:net").Socket>();
  let closing = false;
  server.on("connection", (socket) => {
    if (closing) return void socket.destroy();
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 8787, options.host ?? "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port ?? 8787;
  return {
    url: `http://${options.host ?? "127.0.0.1"}:${port}`,
    port,
    server,
    rooms,
    sweep,
    async close() {
      // Order matters: stop accepting first (no new connection or upgrade can slip in while we wait
      // for pending writes), then end every WebSocket and every remaining socket.
      closing = true;
      clearInterval(sweeper);
      timers.forEach((t) => clearTimeout(t));
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      for (const client of wss.clients) client.terminate();
      await Promise.all([...writes.values()]);
      server.closeAllConnections();
      for (const socket of sockets) socket.destroy();
      await closed;
    },
  };
}
