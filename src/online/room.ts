import { cryptoDiceSource, type DiceSource } from "./dice-source";
import {
  isRecord,
  normalizeName,
  type CommandResult,
  type OnlineError,
  type OnlineEvent,
  type OnlineMatchState,
} from "./protocol";
import { applyCommand, createOnlineMatch, rebuildFromEvents, viewFor } from "./server-engine";
import { parseCommand } from "./protocol";
import {
  WIRE_VERSION,
  parseClientMessage,
  validKeep,
  type HoldState,
  type ClientMessage,
  type RematchOp,
  type RematchState,
  type RoomSummary,
  type SeriesSummary,
  type ServerMessage,
} from "./wire";
import { allowSocial, canSend, newSocialBucket, type SocialBucket } from "../social/catalog";

/**
 * YachtLab Online v0.1 Phase 2 — one game room (invite code + seats + authoritative match).
 *
 * Runtime-agnostic on purpose: no Node, no Workers API. A host adapter supplies the clock, dice,
 * persistence and timer, and wraps each socket as a `RoomConnection`. The local Node server
 * (server/online/) uses it today; a Durable Object (one instance per room, single-threaded) can wrap
 * the same class later without changing game logic.
 *
 * Security model (see docs/online/ONLINE-V01-PHASE2.md):
 * - The room code only lets someone *join an open seat in the lobby*. Every seat is bound to a
 *   high-entropy secret token issued once; only its SHA-256 hash is stored. Reconnecting needs the token,
 *   so knowing the code never lets anyone take over a seat.
 * - The player id used for every command comes from the authenticated connection, never from the payload.
 * - All dice, turns and scores are decided by the Phase 1 engine; the client only renders confirmed events.
 */

export const ROOM_LIMITS = {
  /** Event log cap per match. A 2-player game needs ~130 events; the cap only stops abuse (fail-closed). */
  maxEvents: 800,
  /** Simultaneous sockets per room (two players with a couple of duplicate tabs each). */
  maxConnections: 8,
  /** Largest accepted client message, bytes. */
  maxMessageBytes: 2048,
  /** Token bucket per connection: burst and refill per second. */
  burst: 30,
  refillPerSecond: 8,
  /** Matches one room may host (first match + rematches). Each still counts toward the daily cap. */
  maxMatches: 20,
  /** Rematch request/cancel/decline: at most one stored change per player per second. */
  rematchCooldownMs: 1000,
} as const;

/** One finished match of this room (kept for the running score; the event log itself is replaced). */
export type SeriesEntry = { matchId: string; finishedAt: number; winners: string[]; points: Record<string, number> };

export type RoomRecord = {
  wire: typeof WIRE_VERSION;
  code: string;
  createdAt: number;
  /** Last time anything happened (command, connect, disconnect) — used for cleanup. */
  touchedAt: number;
  /** playerId → SHA-256(token) (hex) and the seat name. Only hashes are stored. */
  credentials: Record<string, { tokenHash: string }>;
  log: OnlineEvent[];
  /**
   * Hold selection (selection order) of the current turn — presentation state shared by both
   * screens, outside the engine log. Saved together with the next accepted command (no extra write).
   */
  hold?: HoldState | null;
  /** Number of matches started in this room (1 = the first). Missing on records from before rematches. */
  matchNo?: number;
  /** Finished matches of this room, oldest first (at most ROOM_LIMITS.maxMatches). */
  series?: SeriesEntry[];
  /** Pending rematch requests for the finished match. */
  rematch?: { requests: string[]; declinedBy: string | null } | null;
  /** Players who left the finished room for good. */
  departed?: string[];
};

export type RoomDeps = {
  now: () => number;
  dice?: DiceSource;
  /** Persist the full record atomically (called after every accepted change). */
  save: (record: RoomRecord) => void | Promise<void>;
  /** Ask the host to call `alarm()` at this time (null = cancel). One pending alarm per room. */
  schedule: (at: number | null) => void;
  /** Random bytes (Web Crypto). */
  random?: (bytes: Uint8Array) => Uint8Array;
  /**
   * May one more match start in this room? Returns null when it may, otherwise a message for the
   * players. The Durable Object host counts it toward the daily cap (rooms + rematches).
   */
  allowMatch?: () => Promise<string | null> | string | null;
};

/** A live socket, as seen by the room. `playerId` is set only after a successful `hello`. */
export interface RoomConnection {
  playerId: string | null;
  /** Highest event seq already delivered to this socket. */
  seenSeq: number;
  bucket: { tokens: number; at: number };
  /** Preset chat / emote rate limit (created on first use). */
  social?: SocialBucket;
  send(message: ServerMessage): void;
  close(code: number, reason: string): void;
}

export type JoinResult = { ok: true; playerId: string; token: string } | { ok: false; status: number; error: OnlineError | RoomError };
export type RoomError = { code: RoomErrorCode; message: string };
export type RoomErrorCode = "NAME_TAKEN" | "ROOM_LIMIT" | "BAD_TOKEN" | "RATE_LIMITED" | "TOO_LARGE" | "ROOM_CLOSED";

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
const base64url = (bytes: Uint8Array) => {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export async function hashToken(token: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}
/** Constant-time compare of two equal-length hex strings. */
function sameHash(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Invite codes: 6 characters without look-alikes (0/O, 1/I/L). 32^6 ≈ 1.07e9 codes. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
export function newRoomCode(random: (b: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const out: string[] = [];
  const buf = new Uint8Array(16);
  while (out.length < 6) {
    random(buf);
    // 248 = 31 × 8 keeps the choice uniform.
    for (const b of buf) if (b < 248 && out.length < 6) out.push(CODE_ALPHABET[b % CODE_ALPHABET.length]);
  }
  return out.join("");
}
export const normalizeCode = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
};

/** Random match id, `m_` + 16 url-safe characters (96 bits). */
export function newMatchId(random: (b: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  return "m_" + base64url(random(new Uint8Array(12)));
}

export class OnlineRoom {
  private state: OnlineMatchState;
  private readonly connections = new Set<RoomConnection>();
  private readonly dice: DiceSource;
  private readonly random: (b: Uint8Array) => Uint8Array;
  /** Serializes async work (token hashing) so commands are applied strictly one at a time. */
  private queue: Promise<unknown> = Promise.resolve();
  /** Ordered `keep` of the roll command being applied (the engine itself stores kept positions sorted). */
  private rollOrder: number[] | null = null;
  private closed = false;
  /** Why the last rematch could not start (daily cap…), until the next request. Memory only. */
  private rematchBlocked: string | null = null;
  /** Last stored rematch change per player (cooldown against request/cancel write loops). Memory only. */
  private rematchAt = new Map<string, number>();
  /** Stored rematch changes since the last match started (cap against write loops). Memory only. */
  private rematchOps = 0;

  private constructor(
    private record: RoomRecord,
    private readonly deps: RoomDeps,
    state?: OnlineMatchState,
  ) {
    this.dice = deps.dice ?? cryptoDiceSource();
    this.random = deps.random ?? ((b) => crypto.getRandomValues(b));
    // A stored record is audited by re-execution (Phase 1). A tampered or corrupt log refuses to load.
    this.state = state ?? rebuildFromEvents(record.log);
  }

  static create(code: string, deps: RoomDeps, options: { turnTimeoutMs?: number | null } = {}): OnlineRoom {
    if (!CODE_PATTERN.test(code)) throw Error("잘못된 방 코드입니다.");
    const now = deps.now();
    // Every match has its own random id (records, rematches); the room code is only the address.
    const state = createOnlineMatch({ matchId: newMatchId(deps.random), seats: 2, turnTimeoutMs: options.turnTimeoutMs ?? null }, now);
    const record: RoomRecord = { wire: WIRE_VERSION, code, createdAt: now, touchedAt: now, credentials: {}, log: state.log, matchNo: 1 };
    return new OnlineRoom(record, deps, state);
  }

  /** Restore after a restart. Throws if the stored log fails the engine audit. */
  static restore(record: RoomRecord, deps: RoomDeps): OnlineRoom {
    if (!isRecord(record) || record.wire !== WIRE_VERSION || !CODE_PATTERN.test(record.code)) throw Error("저장된 방 형식이 올바르지 않습니다.");
    const room = new OnlineRoom(record, deps);
    room.armTimer();
    return room;
  }

  get code() {
    return this.record.code;
  }
  get match(): OnlineMatchState {
    return this.state;
  }
  get touchedAt() {
    return this.record.touchedAt;
  }
  /** Copy of the persisted record (code, timestamps, token hashes, log). */
  get snapshot(): RoomRecord {
    return this.record;
  }
  get createdAt() {
    return this.record.createdAt;
  }
  get connectionCount() {
    return this.connections.size;
  }
  get isClosed() {
    return this.closed;
  }

  summary(): RoomSummary {
    return {
      code: this.code,
      status: this.state.status,
      seats: this.state.seats,
      players: this.state.players.map((p) => p.name),
    };
  }

  private serial<T>(work: () => Promise<T> | T): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private persist() {
    this.record = { ...this.record, touchedAt: this.deps.now(), log: this.state.log };
    return this.deps.save(this.record);
  }

  /** Take an open seat in the lobby. Returns the secret token exactly once. */
  join(rawName: unknown): Promise<JoinResult> {
    return this.serial(async () => {
      if (this.closed) return { ok: false, status: 410, error: { code: "ROOM_CLOSED", message: "닫힌 방입니다." } } as const;
      const name = normalizeName(rawName);
      if (!name) return { ok: false, status: 400, error: { code: "INVALID_COMMAND", message: "닉네임은 1~24자로 입력해 주세요." } } as const;
      if (this.state.status === "lobby" && this.state.players.some((p) => p.name.toLocaleLowerCase() === name.toLocaleLowerCase()))
        return { ok: false, status: 409, error: { code: "NAME_TAKEN", message: "이미 방에 같은 닉네임이 있어요. 다른 닉네임을 써 주세요." } } as const;
      const playerId = "p_" + base64url(this.random(new Uint8Array(12)));
      const token = base64url(this.random(new Uint8Array(32)));
      const result = this.apply(playerId, { commandId: "join", action: { type: "join", name } });
      if (!result.ok) return { ok: false, status: result.error.code === "MATCH_FULL" || result.error.code === "WRONG_PHASE" ? 409 : 400, error: result.error } as const;
      const tokenHash = await hashToken(token);
      await this.commit(result.state, result.events, { ...this.record, credentials: { ...this.record.credentials, [playerId]: { tokenHash } } });
      return { ok: true, playerId, token } as const;
    });
  }

  /** Validate a token; returns the seat's player id if it is still in the match. */
  async authenticate(token: unknown): Promise<string | null> {
    if (typeof token !== "string" || token.length < 20 || token.length > 128) return null;
    const hash = await hashToken(token);
    for (const [playerId, cred] of Object.entries(this.record.credentials))
      if (sameHash(cred.tokenHash, hash)) return this.state.players.some((p) => p.playerId === playerId) ? playerId : null;
    return null;
  }

  private apply(playerId: string, raw: unknown): CommandResult {
    if (this.state.log.length >= ROOM_LIMITS.maxEvents)
      return { ok: false, error: { code: "INVALID_COMMAND", message: "이 방의 기록 한도에 도달했습니다." } };
    const parsed = parseCommand(raw, playerId);
    if (!parsed.ok) return parsed;
    return applyCommand(this.state, parsed.command, { now: this.deps.now(), dice: this.dice });
  }

  /**
   * Hold selection with the match version it was made at, for hosts that keep it outside the room
   * record (Durable Object socket attachments survive hibernation without a storage write).
   */
  holdSnapshot(): { hold: HoldState; v: number } | null {
    const hold = this.currentHold();
    return hold ? { hold, v: this.state.version } : null;
  }

  /**
   * Re-adopt a hold selection kept by the host while the object was evicted. Accepted only for the
   * turn in progress, made at the current version (no command since), and newer than what is known.
   */
  adoptHold(snapshot: { hold: HoldState; v: number } | null | undefined): boolean {
    if (!snapshot || snapshot.v !== this.state.version) return false;
    const { hold } = snapshot;
    const turn = this.state.turn;
    if (this.state.status !== "playing" || !turn || turn.playerId !== hold.playerId || turn.rolls === 0 || !validKeep(hold.keep)) return false;
    // The engine knows which dice the last roll kept; a selection is anything after that, so only
    // the shape is checked here (like a live `hold` message).
    const known = this.record.hold;
    if (known && known.playerId === hold.playerId && known.n >= hold.n) return false;
    this.record = { ...this.record, hold: { playerId: hold.playerId, keep: [...hold.keep], n: hold.n } };
    return true;
  }

  /** The hold selection, if it belongs to the turn in progress (after at least one roll). */
  private currentHold(): HoldState | null {
    const hold = this.record.hold;
    const turn = this.state.turn;
    if (!hold || this.state.status !== "playing" || !turn || turn.playerId !== hold.playerId || turn.rolls === 0) return null;
    return hold;
  }

  /** Hold state after these events: kept dice in selection order after a roll, cleared on a new turn. */
  private holdAfter(events: OnlineEvent[]): HoldState | null | undefined {
    let hold: HoldState | null | undefined = undefined;
    for (const e of events) {
      if (e.type === "turnStarted" || e.type === "matchFinished") hold = null;
      if (e.type === "diceRolled") {
        const prior = this.record.hold?.playerId === e.playerId ? this.record.hold : null;
        const wanted = this.rollOrder ?? prior?.keep ?? [];
        const keep = wanted.filter((i) => e.kept.includes(i));
        for (const i of e.kept) if (!keep.includes(i)) keep.push(i);
        hold = { playerId: e.playerId, keep, n: prior?.n ?? 0 };
      }
    }
    return hold;
  }

  /** Persist the new state (and record changes) together, then notify sockets and re-arm the timer. */
  private async commit(next: OnlineMatchState, events: OnlineEvent[], record: RoomRecord = this.record) {
    if (!events.length) return;
    const before = { state: this.state, record: this.record };
    const hold = this.holdAfter(events);
    this.state = next;
    this.record = hold === undefined ? record : { ...record, hold };
    const finished = events.find((e) => e.type === "matchFinished");
    if (finished && finished.type === "matchFinished") {
      // The running score of this room, stored with the same write as the final event.
      const entry: SeriesEntry = { matchId: next.matchId, finishedAt: finished.at, winners: [...finished.winners], points: Object.fromEntries(finished.standings.map((s) => [s.playerId, s.points])) };
      this.record = { ...this.record, series: [...(this.record.series ?? []), entry].slice(-ROOM_LIMITS.maxMatches), rematch: null };
    }
    try {
      await this.persist();
    } catch (error) {
      // Fail closed: nothing is applied unless it was stored.
      this.state = before.state;
      this.record = before.record;
      throw error;
    }
    this.armTimer();
    this.broadcast();
  }

  private async run(playerId: string, raw: unknown): Promise<CommandResult> {
    const result = this.apply(playerId, raw);
    if (result.ok && !result.duplicate) await this.commit(result.state, result.events);
    return result;
  }

  private armTimer() {
    const deadline = this.state.status === "playing" ? this.state.turn?.deadline ?? null : null;
    this.deps.schedule(deadline);
  }

  /** Server-side turn timer: when the deadline passes, the waiting opponent's seat claims it. */
  alarm(): Promise<void> {
    return this.serial(async () => {
      const turn = this.state.turn;
      if (this.closed || this.state.status !== "playing" || !turn || turn.deadline === null) return;
      if (this.deps.now() < turn.deadline) return this.armTimer();
      const claimer = this.state.players.find((p) => p.status === "active" && p.playerId !== turn.playerId);
      if (!claimer) return;
      // Deterministic id: a repeated alarm for the same turn is an idempotent duplicate.
      await this.run(claimer.playerId, { commandId: `timeout-${this.state.version}`, action: { type: "claimTimeout" } });
    });
  }

  /* --------------------------------------------------------------- sockets --------------------------------------------------------------- */

  /** A new socket. It must send `hello` with a valid token before anything else. */
  connect(conn: RoomConnection): boolean {
    if (this.closed || this.connections.size >= ROOM_LIMITS.maxConnections) {
      conn.close(1013, "room busy");
      return false;
    }
    this.connections.add(conn);
    this.record = { ...this.record, touchedAt: this.deps.now() };
    return true;
  }

  /**
   * Re-register a socket that survived while the host was evicted (Durable Object WebSocket
   * Hibernation). Its identity, delivered seq and rate bucket come from the socket's attachment.
   */
  adopt(conn: RoomConnection) {
    if (!this.closed) this.connections.add(conn);
  }

  /** Record activity without a game event (e.g. a socket closed) so idle cleanup counts from now. */
  touch() {
    this.record = { ...this.record, touchedAt: this.deps.now() };
    return this.deps.save(this.record);
  }

  disconnect(conn: RoomConnection) {
    if (!this.connections.delete(conn)) return;
    this.record = { ...this.record, touchedAt: this.deps.now() };
    if (conn.playerId) this.broadcastPresence();
  }

  private allow(conn: RoomConnection): boolean {
    const now = this.deps.now();
    const b = conn.bucket;
    b.tokens = Math.min(ROOM_LIMITS.burst, b.tokens + ((now - b.at) / 1000) * ROOM_LIMITS.refillPerSecond);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  /** Handle one raw text frame from a socket. */
  message(conn: RoomConnection, data: string): Promise<void> {
    return this.serial(async () => {
      if (!this.connections.has(conn)) return;
      if (data.length > ROOM_LIMITS.maxMessageBytes) return conn.close(1009, "message too large");
      if (!this.allow(conn)) return conn.close(1008, "rate limited");
      const parsed = parseClientMessage(data);
      if (!parsed) return conn.send({ t: "error", code: "INVALID_COMMAND", message: "알 수 없는 메시지입니다." });
      await this.dispatch(conn, parsed);
    });
  }

  private async dispatch(conn: RoomConnection, msg: ClientMessage) {
    if (msg.t === "ping") return conn.send({ t: "pong" });
    if (msg.t === "hello") {
      const playerId = await this.authenticate(msg.token);
      if (!playerId) {
        conn.send({ t: "error", code: "BAD_TOKEN", message: "이 방의 참가 정보가 올바르지 않거나 만료되었습니다." });
        return conn.close(4001, "bad token");
      }
      conn.playerId = playerId;
      const since = Math.max(0, Math.min(msg.since ?? 0, this.state.log.length));
      const view = viewFor(this.state, playerId, this.deps.now(), since);
      conn.seenSeq = this.state.log.length;
      conn.send({ t: "welcome", code: this.code, playerId, view, online: this.onlinePlayers(), hold: this.currentHold(), rematch: this.rematchState(), series: this.seriesSummary() });
      this.broadcastPresence();
      return;
    }
    const playerId = conn.playerId;
    if (!playerId) {
      conn.send({ t: "error", code: "BAD_TOKEN", message: "먼저 인증해야 합니다." });
      return conn.close(4001, "not authenticated");
    }
    if (msg.t === "say") return this.say(conn, playerId, msg.id);
    if (msg.t === "rematch") return this.rematch(conn, playerId, msg.op);
    if (msg.t === "bye") return this.bye(playerId);
    if (msg.t === "hold") {
      // Shared presentation state: the dice actually kept still travel with the next `roll` command
      // and are validated by the engine. Kept in memory and saved with the next command (no row write).
      const turn = this.state.turn;
      if (this.state.status !== "playing" || turn?.playerId !== playerId || turn.rolls === 0 || turn.rolls >= 3) return;
      const n = msg.n ?? (this.record.hold?.playerId === playerId ? this.record.hold.n : 0);
      const hold: HoldState = { playerId, keep: msg.keep, n };
      this.record = { ...this.record, hold };
      // Everyone, the sender included, gets the same order (the sender matches its echo by `n`).
      for (const c of this.connections) if (c.playerId) c.send({ t: "hold", ...hold });
      return;
    }
    // command
    let result: CommandResult;
    try {
      // The engine stores kept positions sorted; the selection order is kept here for the shelf.
      const keep = msg.action.type === "roll" ? (msg.action as { keep?: unknown }).keep : undefined;
      this.rollOrder = validKeep(keep) ? [...keep] : null;
      result = await this.run(playerId, { commandId: msg.id, expectedVersion: msg.v, action: msg.action });
    } catch {
      return conn.send({ t: "ack", id: msg.id, ok: false, error: { code: "INVALID_COMMAND", message: "서버에서 명령을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." } });
    }
    this.rollOrder = null;
    if (!result.ok) {
      conn.send({ t: "ack", id: msg.id, ok: false, error: result.error });
      // A rejected command usually means the client view is behind: resend the full picture.
      this.sendView(conn, 0);
      return;
    }
    conn.send({ t: "ack", id: msg.id, ok: true, duplicate: result.duplicate });
    if (result.duplicate) this.sendView(conn, conn.seenSeq);
    if (msg.action.type === "leave") {
      // Leaving the lobby ends this seat's token.
      const { [playerId]: _gone, ...rest } = this.record.credentials;
      this.record = { ...this.record, credentials: rest };
      await this.deps.save(this.record);
      for (const c of [...this.connections]) if (c.playerId === playerId) c.close(4002, "left");
      if (!this.state.players.length) this.closeRoom();
    }
  }

  /* ------------------------------------------------------------- social (Phase 3) ------------------------------------------------------------- */

  /** Preset chat / emote: catalog ids only, rate-limited per connection, relayed live, never stored. */
  private say(conn: RoomConnection, playerId: string, id: string) {
    if (!canSend(id)) return conn.send({ t: "error", code: "INVALID_SOCIAL", message: "보낼 수 없는 메시지예요." });
    const now = this.deps.now();
    conn.social ??= newSocialBucket(now);
    if (!allowSocial(conn.social, id, now)) return conn.send({ t: "error", code: "SOCIAL_RATE_LIMITED", message: "잠시 후 다시 보내 주세요." });
    for (const c of this.connections) if (c.playerId) c.send({ t: "said", from: playerId, id });
  }

  rematchState(): RematchState {
    const departed = this.record.departed ?? [];
    const pending = this.record.rematch ?? { requests: [], declinedBy: null };
    const finished = this.state.status === "finished";
    const blocked = !finished
      ? null
      : departed.length
        ? "상대가 방을 나갔어요."
        : (this.record.matchNo ?? 1) >= ROOM_LIMITS.maxMatches
          ? "이 방에서는 더 이상 경기를 할 수 없어요. 새 방을 만들어 주세요."
          : this.rematchBlocked;
    return { requests: finished ? [...pending.requests] : [], declinedBy: finished ? pending.declinedBy : null, departed: [...departed], blocked };
  }

  seriesSummary(): SeriesSummary {
    const series = this.record.series ?? [];
    const wins: Record<string, number> = {};
    let draws = 0;
    for (const m of series) {
      if (m.winners.length === 1) wins[m.winners[0]] = (wins[m.winners[0]] ?? 0) + 1;
      else draws++;
    }
    return { matchNo: this.record.matchNo ?? 1, games: series.length, draws, wins };
  }

  private broadcastRematch() {
    const rematch = this.rematchState();
    const series = this.seriesSummary();
    for (const c of this.connections) if (c.playerId) c.send({ t: "rematch", rematch, series });
  }

  private async saveRecord(record: RoomRecord) {
    const before = this.record;
    this.record = { ...record, touchedAt: this.deps.now() };
    try {
      await this.deps.save(this.record);
    } catch (error) {
      this.record = before;
      throw error;
    }
  }

  /**
   * Rematch in the same room (no new room, no new code, the same seat tokens): when every seated
   * player has asked, a new match with a new id starts and the other player moves first.
   */
  private async rematch(conn: RoomConnection, playerId: string, op: RematchOp) {
    const fail = (message: string) => conn.send({ t: "error", code: "REMATCH", message });
    if (this.state.status !== "finished") return fail("경기가 끝난 뒤에 재대결할 수 있어요.");
    const blocked = this.rematchState().blocked;
    if (blocked && op === "request" && (this.record.departed?.length || (this.record.matchNo ?? 1) >= ROOM_LIMITS.maxMatches)) return fail(blocked);
    const pending = this.record.rematch ?? { requests: [], declinedBy: null };
    let next = pending;
    if (op === "request") {
      if (pending.requests.includes(playerId)) return this.broadcastRematchTo(conn); // double tap: nothing to store
      next = { requests: [...pending.requests, playerId], declinedBy: null };
    } else if (op === "cancel") {
      if (!pending.requests.includes(playerId)) return this.broadcastRematchTo(conn);
      next = { requests: pending.requests.filter((id) => id !== playerId), declinedBy: null };
    } else {
      if (!pending.requests.some((id) => id !== playerId)) return this.broadcastRematchTo(conn);
      next = { requests: [], declinedBy: playerId };
    }
    const now = this.deps.now();
    if (now - (this.rematchAt.get(playerId) ?? -Infinity) < ROOM_LIMITS.rematchCooldownMs) return fail("잠시 후 다시 눌러 주세요.");
    if (this.rematchOps >= 40) return fail("재대결 요청을 너무 많이 보냈어요. 새 방을 만들어 주세요.");
    this.rematchAt.set(playerId, now);
    this.rematchOps++;
    this.rematchBlocked = null;
    const everyone = this.state.players.every((p) => next.requests.includes(p.playerId));
    if (everyone) return this.startRematch();
    await this.saveRecord({ ...this.record, rematch: next });
    this.broadcastRematch();
  }

  private broadcastRematchTo(conn: RoomConnection) {
    conn.send({ t: "rematch", rematch: this.rematchState(), series: this.seriesSummary() });
  }

  private async startRematch() {
    const block = (await this.deps.allowMatch?.()) ?? null;
    if (block) {
      this.rematchBlocked = block;
      await this.saveRecord({ ...this.record, rematch: null });
      return this.broadcastRematch();
    }
    const now = this.deps.now();
    const matchNo = (this.record.matchNo ?? 1) + 1;
    // Alternate who starts: seats rotate by one (two players: swap).
    const bySeat = [...this.state.players].sort((a, b) => a.seat - b.seat);
    const order = [...bySeat.slice(1), bySeat[0]];
    let next = createOnlineMatch({ matchId: newMatchId(this.random), seats: this.state.seats, turnTimeoutMs: this.state.turnTimeoutMs }, now);
    const ctx = { now, dice: this.dice };
    for (const [i, p] of order.entries()) {
      const joined = applyCommand(next, { commandId: `rematch-${matchNo}-join-${i}`, playerId: p.playerId, action: { type: "join", name: p.name } }, ctx);
      if (!joined.ok) throw Error(joined.error.message);
      next = joined.state;
    }
    const started = applyCommand(next, { commandId: `rematch-${matchNo}-start`, playerId: order[0].playerId, action: { type: "start" } }, ctx);
    if (!started.ok) throw Error(started.error.message);
    const before = { state: this.state, record: this.record };
    this.state = started.state;
    try {
      await this.saveRecord({ ...this.record, log: started.state.log, matchNo, rematch: null, hold: null });
    } catch (error) {
      this.state = before.state;
      this.record = before.record;
      throw error;
    }
    this.rematchOps = 0;
    this.armTimer();
    // A new match: every screen gets the whole (short) log of the new match.
    for (const c of this.connections) if (c.playerId) this.sendView(c, 0);
    this.broadcastRematch();
  }

  /** Leave a finished room for good: the seat token stops working, the other player is told. */
  private async bye(playerId: string) {
    if (this.state.status !== "finished") return;
    const departed = [...new Set([...(this.record.departed ?? []), playerId])];
    const { [playerId]: _gone, ...credentials } = this.record.credentials;
    await this.saveRecord({ ...this.record, departed, credentials, rematch: null });
    for (const c of [...this.connections]) if (c.playerId === playerId) c.close(4002, "left");
    if (this.state.players.every((p) => departed.includes(p.playerId))) return this.closeRoom();
    this.broadcastRematch();
  }

  private sendView(conn: RoomConnection, since: number) {
    if (!conn.playerId) return;
    conn.send({ t: "view", view: viewFor(this.state, conn.playerId, this.deps.now(), since), hold: this.currentHold() });
    conn.seenSeq = this.state.log.length;
  }

  private broadcast() {
    for (const conn of this.connections) if (conn.playerId) this.sendView(conn, conn.seenSeq);
  }

  private onlinePlayers() {
    return [...new Set([...this.connections].map((c) => c.playerId).filter((id): id is string => !!id))];
  }
  private broadcastPresence() {
    const online = this.onlinePlayers();
    for (const conn of this.connections) if (conn.playerId) conn.send({ t: "presence", online });
  }

  /** Close every socket; the host then drops the room and its stored record. */
  closeRoom() {
    this.closed = true;
    this.deps.schedule(null);
    for (const conn of [...this.connections]) conn.close(4004, "room closed");
    this.connections.clear();
  }
}

