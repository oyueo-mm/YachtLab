import { OnlineRoom, ROOM_LIMITS, type JoinResult, type RoomConnection, type RoomRecord } from "../../src/online/room";
import type { DiceSource } from "../../src/online/dice-source";
import type { HoldState, RoomSummary, ServerMessage } from "../../src/online/wire";
import type { OnlineConfig } from "./config";

/**
 * The Durable Object's game logic, without any Cloudflare import, so it runs in workerd and in
 * Node tests alike. `YachtRoom` (room-object.ts) is a thin shell that hands it the SQLite storage,
 * the hibernatable sockets and the alarm.
 *
 * Hibernation: the object can be evicted from memory while sockets stay open. Everything needed to
 * continue lives in storage (the room record) or on each socket (its attachment: player id, last
 * delivered seq, rate bucket). On wake, `init()` rebuilds the room from storage — the Phase 1 audit
 * re-executes the log — and re-adopts every open socket.
 */

/** What a hibernatable WebSocket offers (a subset of the Workers `WebSocket`). */
export interface HostSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

/** Storage operations used by the host. In the Durable Object these are SQLite + the alarm API. */
export interface HostStorage {
  /** The room record, or null if this object was never initialised (or was cleaned up). */
  load(): RoomRecord | null;
  /** Replace the record (one SQLite row; atomic). */
  save(record: RoomRecord): void;
  getAlarm(): number | null;
  setAlarm(at: number): void;
  deleteAlarm(): void;
  /** Remove everything this object stores. */
  clear(): void | Promise<void>;
}

/**
 * Per-socket state that survives hibernation. `hold` is a copy of the room's shared hold order
 * (selection order of held dice) with the match version it belongs to: the room saves it to SQLite
 * only together with the next command, so without this copy an eviction between a hold toggle and
 * the next command would forget it. Attachments cost no storage writes.
 */
type Attachment = { playerId: string | null; seenSeq: number; bucket: { tokens: number; at: number }; openedAt: number; hold?: { hold: HoldState; v: number } | null };

export const HELLO_TIMEOUT_MS = 10_000;
/** Socket opens per room per minute (counted in memory; a soft guard against reconnect storms). */
export const CONNECTS_PER_MINUTE = 20;

export type HostEvents = {
  /** The room was cleaned up (idle / max age). The shell tells the directory. */
  onDeleted?: (code: string) => void | Promise<void>;
};

export class RoomHost {
  room: OnlineRoom | null = null;
  private conns = new Map<HostSocket, RoomConnection>();
  private turnDeadline: number | null = null;
  private alarmAt: number | null = null;
  private connectTimes: number[] = [];
  private deleted = false;
  /** Sockets whose close event was handled (the runtime may still list them during the handler). */
  private gone = new WeakSet<HostSocket>();

  constructor(
    private readonly storage: HostStorage,
    private readonly sockets: () => HostSocket[],
    private readonly config: OnlineConfig,
    private readonly now: () => number = Date.now,
    private readonly dice?: DiceSource,
    private readonly events: HostEvents = {},
  ) {}

  private deps() {
    return {
      now: this.now,
      dice: this.dice,
      save: (record: RoomRecord) => this.storage.save(record),
      schedule: (at: number | null) => {
        this.turnDeadline = at;
        this.rearm();
      },
    };
  }

  /** Load after construction or wake. Throws if the stored log fails the engine audit. */
  init() {
    this.alarmAt = this.storage.getAlarm();
    const record = this.storage.load();
    if (!record) return;
    this.room = OnlineRoom.restore(record, this.deps());
    for (const ws of this.open()) {
      this.room.adopt(this.wrap(ws));
      // The newest hold order any socket still carries (stale ones are rejected by the room).
      this.room.adoptHold((ws.deserializeAttachment() as Attachment | null)?.hold);
    }
    this.rearm();
  }

  get code() {
    return this.room?.code ?? null;
  }

  /** First seat of a brand-new room (called once by the Worker after the directory allocated the code). */
  async create(code: string, name: unknown): Promise<JoinResult> {
    if (this.room) return { ok: false, status: 409, error: { code: "ROOM_CLOSED", message: "이미 사용 중인 방 코드입니다." } };
    const room = OnlineRoom.create(code, this.deps(), { turnTimeoutMs: this.config.turnTimeoutMs });
    const joined = await room.join(name);
    if (joined.ok) {
      this.room = room;
      this.rearm();
    }
    return joined;
  }

  join(name: unknown): Promise<JoinResult> | JoinResult {
    if (!this.room || this.deleted) return { ok: false, status: 404, error: { code: "ROOM_CLOSED", message: "방을 찾을 수 없어요. 초대 코드를 확인해 주세요." } };
    return this.room.join(name);
  }

  summary(): RoomSummary | null {
    return this.room && !this.deleted ? this.room.summary() : null;
  }

  /** Can a new socket be accepted? (checked before `acceptWebSocket`). */
  admit(): { ok: true } | { ok: false; status: number } {
    if (!this.room || this.deleted || this.room.isClosed) return { ok: false, status: 404 };
    const t = this.now();
    this.connectTimes = this.connectTimes.filter((x) => t - x < 60_000);
    if (this.connectTimes.length >= CONNECTS_PER_MINUTE) return { ok: false, status: 429 };
    if (this.open().length >= ROOM_LIMITS.maxConnections) return { ok: false, status: 503 };
    this.connectTimes.push(t);
    return { ok: true };
  }

  /** A socket was just accepted with `acceptWebSocket`. */
  accepted(ws: HostSocket) {
    const t = this.now();
    ws.serializeAttachment({ playerId: null, seenSeq: 0, bucket: { tokens: ROOM_LIMITS.burst, at: t }, openedAt: t } satisfies Attachment);
    const conn = this.wrap(ws);
    if (this.room?.connect(conn)) this.rearm();
  }

  private wrap(ws: HostSocket): RoomConnection {
    const existing = this.conns.get(ws);
    if (existing) return existing;
    const a = (ws.deserializeAttachment() as Attachment | null) ?? { playerId: null, seenSeq: 0, bucket: { tokens: ROOM_LIMITS.burst, at: this.now() }, openedAt: this.now() };
    const conn: RoomConnection & { openedAt: number } = {
      playerId: a.playerId,
      seenSeq: a.seenSeq,
      bucket: { ...a.bucket },
      openedAt: a.openedAt,
      send: (message: ServerMessage) => {
        try {
          ws.send(JSON.stringify(message));
        } catch {
          /* socket already closing */
        }
      },
      close: (code, reason) => {
        try {
          ws.close(code, reason);
        } catch {
          /* already closed */
        }
      },
    };
    this.conns.set(ws, conn);
    return conn;
  }

  /** Persist each socket's identity / delivered seq / rate bucket so a hibernation wake can resume it. */
  private remember(ws: HostSocket) {
    const c = this.conns.get(ws) as (RoomConnection & { openedAt: number }) | undefined;
    if (!c) return;
    try {
      ws.serializeAttachment({ playerId: c.playerId, seenSeq: c.seenSeq, bucket: c.bucket, openedAt: c.openedAt, hold: this.room?.holdSnapshot() ?? null } satisfies Attachment);
    } catch {
      /* closed */
    }
  }

  async message(ws: HostSocket, data: string | ArrayBuffer) {
    const conn = this.wrap(ws);
    if (!this.room || this.deleted) return conn.close(4004, "room closed");
    if (typeof data !== "string") return conn.close(1003, "text only");
    await this.room.message(conn, data);
    // Everyone left the lobby: the room is over, remove its data now.
    if (this.room.isClosed) return this.remove();
    // A message may have advanced other sockets (broadcast): remember all of them.
    for (const s of this.open()) this.remember(s);
    this.rearm();
  }

  /** Delete all stored data and free the code (idle / max age / empty lobby). */
  private async remove() {
    const room = this.room;
    if (!room || this.deleted) return;
    this.deleted = true;
    room.closeRoom();
    this.storage.deleteAlarm();
    await this.storage.clear();
    this.room = null;
    await this.events.onDeleted?.(room.code);
  }

  async closed(ws: HostSocket) {
    const conn = this.conns.get(ws) ?? this.wrap(ws);
    this.conns.delete(ws);
    this.gone.add(ws);
    if (!this.room || this.deleted) return;
    this.room.disconnect(conn);
    // No storage write here: the idle clock (touchedAt) is updated in memory and saved with the next
    // command. After an eviction it falls back to the last saved activity — cleanup may come earlier,
    // never later, and reconnect loops cannot spend SQLite row writes.
    this.rearm();
  }

  private open() {
    return this.sockets().filter((s) => !this.gone.has(s));
  }

  /** When the room should be removed if nothing else happens. */
  private cleanupAt(): number | null {
    const room = this.room;
    if (!room) return null;
    const hardStop = room.createdAt + this.config.maxAgeMs;
    if (this.open().length) return hardStop;
    const status = room.match.status;
    const idle = status === "lobby" ? this.config.lobbyIdleMs : status === "finished" ? this.config.finishedIdleMs : this.config.playingIdleMs;
    return Math.min(hardStop, room.touchedAt + idle);
  }

  private helloDeadline(): number | null {
    let next: number | null = null;
    for (const s of this.open()) {
      const c = this.conns.get(s) as (RoomConnection & { openedAt: number }) | undefined;
      if (c && !c.playerId) next = Math.min(next ?? Infinity, c.openedAt + HELLO_TIMEOUT_MS);
    }
    return next;
  }

  /** One alarm per object: the earliest of turn deadline, hello timeout and cleanup. Only rewritten when it changes. */
  /**
   * Each `setAlarm` is one SQLite row write, so the alarm is only ever moved *earlier* (or set when none
   * is pending). An alarm that fires before anything is due simply re-evaluates and re-arms. This keeps
   * socket connect/disconnect cycles from costing row writes.
   */
  private rearm() {
    if (this.deleted) return;
    const candidates = [this.room?.match.status === "playing" ? this.turnDeadline : null, this.helloDeadline(), this.cleanupAt()].filter((x): x is number => x !== null);
    if (!candidates.length) return;
    const next = Math.min(...candidates);
    if (this.alarmAt !== null && this.alarmAt <= next) return;
    this.alarmAt = next;
    this.storage.setAlarm(next);
  }

  /** Alarm handler: turn timeout, stale unauthenticated sockets, retention cleanup. */
  async alarm(): Promise<void> {
    this.alarmAt = null;
    const room = this.room;
    if (!room || this.deleted) return;
    const t = this.now();
    await room.alarm();
    for (const s of this.open()) {
      const c = this.conns.get(s) ?? this.wrap(s);
      if (!c.playerId && t >= (c as RoomConnection & { openedAt: number }).openedAt + HELLO_TIMEOUT_MS) c.close(4001, "hello timeout");
    }
    const cleanup = this.cleanupAt();
    if (cleanup !== null && t >= cleanup) return this.remove();
    this.rearm();
  }
}
