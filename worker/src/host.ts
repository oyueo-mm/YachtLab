import { OnlineRoom, ROOM_LIMITS, type JoinResult, type RoomConnection, type RoomRecord, type SeatSpec } from "../../src/online/room";
import type { PublicLook } from "../../src/economy/live/catalog";
import type { MatchKind } from "../../src/economy/live/config";
import type { DiceSource } from "../../src/online/dice-source";
import type { HoldState, RoomSummary, ServerMessage } from "../../src/online/wire";
import type { SocialBucket } from "../../src/social/catalog";
import type { MatchRecord } from "../../src/identity/records";
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
type Attachment = { playerId: string | null; seenSeq: number; bucket: { tokens: number; at: number }; openedAt: number; hold?: { hold: HoldState; v: number } | null; social?: SocialBucket; spectator?: { key: string } };

export const HELLO_TIMEOUT_MS = 10_000;
/** Socket opens per room per minute (counted in memory; a soft guard against reconnect storms). */
export const CONNECTS_PER_MINUTE = 20;

export type HostEvents = {
  /** The room was cleaned up (idle / max age). The shell tells the directory. */
  onDeleted?: (code: string) => void | Promise<void>;
  /** A rematch wants to start: null = allowed (and counted), otherwise the reason it is not. */
  allowMatch?: (code: string) => Promise<string | null> | string | null;
  /** Deliver a server-verified result to an account; true when stored (or already there). */
  deliverRecord?: (userId: string, record: MatchRecord) => Promise<boolean>;
  /** Public spectating list: the room's entry (or null to remove it). Best effort. */
  publish?: (code: string, entry: ReturnType<OnlineRoom["publicEntry"]>) => Promise<void> | void;
  /** A quick match finished (its players may queue again). */
  matchEnded?: (code: string) => Promise<void> | void;
};
export type PublicEntry = NonNullable<ReturnType<OnlineRoom["publicEntry"]>>;
export const RECORD_RETRY_MS = 60_000;
/**
 * Server AI pacing: one action every `stepMs` (players see it roll, hold and score), and an alarm
 * `fallbackMs` later in case the object was evicted between steps (the alarm wakes it and resumes).
 */
export const AI_TIMING = { stepMs: 700, fallbackMs: 5_000 };

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
      allowMatch: () => {
        const room = this.room;
        if (!room) return "방을 찾을 수 없어요.";
        // A rematch needs time to finish before the room's retention limit removes it.
        if (this.now() > room.createdAt + this.config.maxAgeMs - 2 * 3600_000) return "이 방은 곧 정리돼요. 새 방을 만들어 주세요.";
        return this.events.allowMatch?.(room.code) ?? null;
      },
    };
  }

  /** Load after construction or wake. Throws if the stored log fails the engine audit. */
  init() {
    this.alarmAt = this.storage.getAlarm();
    const record = this.storage.load();
    if (!record) return;
    this.room = OnlineRoom.restore(record, this.deps());
    // Results that could not be delivered before the eviction are retried soon.
    if (this.room.pendingRecords().length) this.retryAt = this.now() + 5_000;
    for (const ws of this.open()) {
      this.room.adopt(this.wrap(ws));
      // The newest hold order any socket still carries (stale ones are rejected by the room).
      this.room.adoptHold((ws.deserializeAttachment() as Attachment | null)?.hold);
    }
    this.rearm();
    this.scheduleAi();
  }

  private aiTimer: ReturnType<typeof setTimeout> | null = null;
  /** If it is the server AI's turn, play its next action shortly. */
  private scheduleAi() {
    if (this.deleted || !this.room?.aiToMove || this.aiTimer) return;
    this.aiTimer = setTimeout(() => {
      this.aiTimer = null;
      void this.runAi();
    }, AI_TIMING.stepMs);
  }
  /** One AI action, then the same bookkeeping as after a player's message. */
  async runAi() {
    const room = this.room;
    if (!room || this.deleted || !room.aiToMove) return;
    try {
      await room.aiStep();
    } catch {
      /* storage failure: nothing was applied (fail-closed); the alarm retries */
    }
    await this.flushRecords();
    for (const s of this.open()) this.remember(s);
    this.rearm();
    this.scheduleAi();
  }

  get code() {
    return this.room?.code ?? null;
  }

  /** First seat of a brand-new room (called once by the Worker after the directory allocated the code). */
  async create(code: string, name: unknown, identity?: { userId: string } | null, look?: PublicLook | null): Promise<JoinResult> {
    if (this.room) return { ok: false, status: 409, error: { code: "ROOM_CLOSED", message: "이미 사용 중인 방 코드입니다." } };
    const room = OnlineRoom.create(code, this.deps(), { turnTimeoutMs: this.config.turnTimeoutMs });
    const joined = await room.join(name, identity, look);
    if (joined.ok) {
      this.room = room;
      this.rearm();
    }
    return joined;
  }

  join(name: unknown, identity?: { userId: string } | null, look?: PublicLook | null): Promise<JoinResult> | JoinResult {
    if (!this.room || this.deleted) return { ok: false, status: 404, error: { code: "ROOM_CLOSED", message: "방을 찾을 수 없어요. 초대 코드를 확인해 주세요." } };
    if (this.room.kind !== "friend") return { ok: false, status: 409, error: { code: "WRONG_PHASE", message: "초대로 들어갈 수 없는 방이에요." } };
    return this.room.join(name, identity, look);
  }

  /** Quick match / AI match: a room created with its seats already taken and the match started. */
  async createMatched(code: string, seats: SeatSpec[], options: { kind: MatchKind; public: boolean }): Promise<{ ok: true; seats: { playerId: string; token: string }[] } | { ok: false; message: string }> {
    if (this.room) return { ok: false, message: "이미 사용 중인 방 코드입니다." };
    try {
      const made = await OnlineRoom.createMatched(code, this.deps(), { turnTimeoutMs: this.config.turnTimeoutMs, kind: options.kind, public: options.public }, seats);
      this.room = made.room;
      this.rearm();
      await this.publishIfChanged();
      this.scheduleAi();
      return { ok: true, seats: made.seats };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "경기를 만들지 못했어요." };
    }
  }

  /** Watch key for a viewer coming from the public list (null when the room is not listed / full). */
  publicWatch(): string | null {
    return this.room && !this.deleted ? this.room.publicWatchKey() : null;
  }

  private published = "";
  private endedSent = false;
  /** Push the public list entry when it changed (round, scores, spectators) — at most a few times per round. */
  async publishIfChanged() {
    const room = this.room;
    if (!room) return;
    if (room.kind === "random" && room.match.status === "finished" && !this.endedSent) {
      this.endedSent = true;
      await Promise.resolve(this.events.matchEnded?.(room.code)).catch(() => undefined);
    }
    if (room.match.status === "playing") this.endedSent = false;
    if (!room.isPublic || !this.events.publish) return;
    const entry = this.deleted ? null : room.publicEntry();
    const sig = entry ? JSON.stringify([entry.round, entry.players.map((p) => p.score), entry.spectators]) : "";
    if (sig === this.published) return;
    this.published = sig;
    await Promise.resolve(this.events.publish(room.code, entry)).catch(() => undefined);
  }

  private delivering = false;
  private retryAt: number | null = null;
  /**
   * Send finished-match results to the players' accounts. Each account store ignores a record it
   * already has (matchId), so retries after a crash or a lost reply never count a match twice.
   */
  async flushRecords() {
    const room = this.room;
    if (!room || this.delivering || !this.events.deliverRecord) return;
    const pending = room.pendingRecords();
    if (!pending.length) return void (this.retryAt = null);
    this.delivering = true;
    try {
      for (const { userId, record } of pending) {
        const ok = await this.events.deliverRecord(userId, record).catch(() => false);
        if (ok) room.markDelivered(userId, record.recordId);
      }
    } finally {
      this.delivering = false;
    }
    this.retryAt = room.pendingRecords().length ? this.now() + RECORD_RETRY_MS : null;
    this.rearm();
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
      ...(a.social ? { social: { ...a.social } } : {}),
      ...(a.spectator ? { spectator: { ...a.spectator } } : {}),
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
      ws.serializeAttachment({ playerId: c.playerId, seenSeq: c.seenSeq, bucket: c.bucket, openedAt: c.openedAt, hold: this.room?.holdSnapshot() ?? null, ...(c.social ? { social: c.social } : {}), ...(c.spectator ? { spectator: c.spectator } : {}) } satisfies Attachment);
    } catch {
      /* closed */
    }
  }

  async message(ws: HostSocket, data: string | ArrayBuffer) {
    const conn = this.wrap(ws);
    if (!this.room || this.deleted) return conn.close(4004, "room closed");
    if (typeof data !== "string") return conn.close(1003, "text only");
    await this.room.message(conn, data);
    await this.flushRecords();
    await this.publishIfChanged();
    // Everyone left the lobby: the room is over, remove its data now.
    if (!this.room || this.deleted) return;
    if (this.room.isClosed) return this.remove();
    // A message may have advanced other sockets (broadcast): remember all of them.
    for (const s of this.open()) this.remember(s);
    this.rearm();
    this.scheduleAi();
  }

  /** Delete all stored data and free the code (idle / max age / empty lobby). */
  private async remove() {
    const room = this.room;
    if (!room || this.deleted) return;
    // Last attempt to hand results to accounts before the room's data is deleted.
    await this.flushRecords();
    this.deleted = true;
    if (this.aiTimer) clearTimeout(this.aiTimer);
    if (room.isPublic) await Promise.resolve(this.events.publish?.(room.code, null)).catch(() => undefined);
    if (room.kind === "random" && !this.endedSent) await Promise.resolve(this.events.matchEnded?.(room.code)).catch(() => undefined);
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
    if (conn.spectator) void this.publishIfChanged();
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
      if (c && !c.playerId && !c.spectator) next = Math.min(next ?? Infinity, c.openedAt + HELLO_TIMEOUT_MS);
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
    const aiAt = this.room?.aiToMove ? this.now() + AI_TIMING.fallbackMs : null;
    const candidates = [this.room?.match.status === "playing" ? this.turnDeadline : null, this.helloDeadline(), this.cleanupAt(), this.retryAt, aiAt].filter((x): x is number => x !== null);
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
    await this.flushRecords();
    await this.publishIfChanged();
    for (const s of this.open()) {
      const c = this.conns.get(s) ?? this.wrap(s);
      if (!c.playerId && !c.spectator && t >= (c as RoomConnection & { openedAt: number }).openedAt + HELLO_TIMEOUT_MS) c.close(4001, "hello timeout");
    }
    const cleanup = this.cleanupAt();
    if (cleanup !== null && t >= cleanup) return this.remove();
    for (const s of this.open()) this.remember(s);
    this.rearm();
    this.scheduleAi();
  }
}
