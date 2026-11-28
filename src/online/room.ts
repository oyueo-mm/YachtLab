import { fromOnline } from "../review/online-source";
import type { ReviewMatch } from "../review/model";
import { cryptoDiceSource, type DiceSource } from "./dice-source";
import { total } from "../engine";
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
  type SpectateState,
  type SpectateMode,
  type LobbyState,
} from "./wire";
import { allowSocial, canSend, newSocialBucket, socialRetryMs, type SocialBucket } from "../social/catalog";
import { NICKNAME_MAX_GRAPHEMES, graphemes, validateNickname } from "../identity/nickname";
import { RULES_ID, type MatchRecord } from "../identity/records";
import { GUEST_LOOK, sanitizeLook, sendableIds, type PublicLook } from "../economy/live/catalog";
import { matchStats } from "../economy/live/rewards";
import { SERVER_AI_LEVEL, serverAiMove } from "./server-ai";
import type { MatchKind } from "../economy/live/config";

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
  maxEvents: 4000,
  /** Simultaneous sockets per room: up to 20 players (plus a spare tab or reconnect each) and spectators. */
  maxConnections: 48,
  /** Spectators per room. Conservative: each one receives every view broadcast (docs/online/SOCIAL-AND-ACCOUNTS.md). */
  maxSpectators: 5,
  /** Largest accepted client message, bytes. */
  maxMessageBytes: 2048,
  /** Token bucket per connection: burst and refill per second. */
  burst: 30,
  refillPerSecond: 8,
  /** Matches one room may host (first match + rematches). Each still counts toward the daily cap. */
  maxMatches: 20,
  /** Rematch request/cancel/decline: at most one stored change per player per second. */
  rematchCooldownMs: 1000,
  /** Lobby ready / settings / host changes: stored changes per room between two matches (write-loop cap). */
  lobbyOps: 200,
} as const;

import { MAX_PLAYERS, ROUND_LIMITS, TURN_LIMITS } from "./wire";
export { MAX_PLAYERS, ROUND_LIMITS, TURN_LIMITS };
export type RoomSettings = { mode: "turns" | "simultaneous"; timeoutMs: number | null };

export function parseRoomSettings(value: unknown): RoomSettings | null {
  if (!isRecord(value)) return null;
  const { mode, timeoutMs } = value;
  if (mode === "simultaneous" && typeof timeoutMs === "number" && ROUND_LIMITS.includes(timeoutMs)) return { mode, timeoutMs };
  if (mode === "turns" && (timeoutMs === null || typeof timeoutMs === "number") && TURN_LIMITS.includes(timeoutMs)) return { mode, timeoutMs };
  return null;
}

/** What everyone in the lobby sees: who is host, who is ready, the match settings. */
export type { LobbyState } from "./wire";

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
  /** Spectating consent per player and the current watch key (null = off / revoked). */
  spectate?: {
    allow: Record<string, boolean>;
    key: string | null;
    /** C3 draft field (per-player public consent). Never deployed; ignored except by legacy readers. */
    publicAllow?: Record<string, boolean>;
    /**
     * Friend rooms (D-095): the range the host chose. Absent = a record written before host control,
     * read with the legacy rule (every player allowed → link only, never public).
     */
    mode?: SpectateMode;
    /** Key handed out from the public list (friend rooms, mode "public" only). Separate from the link key. */
    publicKey?: string | null;
    /** Spectate id used in watch links and the public list instead of the room (= invite) code. */
    sid?: string;
  };
  /** Seats taken by signed-in players: playerId → account id (verified by the host at join time). */
  identities?: Record<string, { userId: string }>;
  /** Server-verified results not yet delivered to the players' accounts (retried; idempotent). */
  outbox?: { userId: string; record: MatchRecord }[];
  /** How the room was made: invite code ("friend", the default), quick match ("random"), server AI ("ai"). */
  kind?: MatchKind;
  /** Quick match whose players both agreed to the public spectating list. */
  public?: boolean;
  /** What each seat shows to others (server-validated equipped items; guests: the default look). */
  looks?: Record<string, PublicLook>;
  /** Server AI seat of an AI match: it has no token (nobody can connect as it); the room plays it. */
  ai?: { playerId: string; level: string };
  /** Friend rooms: settings chosen by the host in the lobby (applied when the match starts). */
  settings?: RoomSettings;
  /** Friend rooms: lobby ready flags (reset when a match starts). */
  ready?: Record<string, boolean>;
  /** Host chosen by transfer; when absent or gone, the earliest remaining player is host. */
  hostId?: string;
};
/** A seat given by the matchmaker (or the AI starter): name, verified account and its validated look. */
export type SeatSpec = { name: string; identity?: { userId: string } | null; look?: PublicLook | null; ai?: boolean; token?: string };

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
  releaseMatch?: (matchNo: number) => void | Promise<void>;
  allowMatch?: (weight: number, matchNo: number, users: string[]) => Promise<string | null> | string | null;
  /** Make a spectate id resolvable to this room (Worker: directory row). Must succeed before links are shown. */
  registerSpectate?: (sid: string) => void | Promise<void>;
};

/** A live socket, as seen by the room. `playerId` is set only after a successful `hello`. */
export interface RoomConnection {
  playerId: string | null;
  /** Set for read-only spectator sockets (playerId stays null). The key they were admitted with. */
  spectator?: { key: string };
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

/** `name`, or `name 2`, `name 3`… when it is taken in this room (kept within the 12-character limit). */
export function uniqueName(name: string, taken: string[]): string {
  const used = new Set(taken.map((n) => n.toLocaleLowerCase()));
  if (!used.has(name.toLocaleLowerCase())) return name;
  for (let i = 2; i < 100; i++) {
    const suffix = " " + i;
    const base = graphemes(name).slice(0, NICKNAME_MAX_GRAPHEMES - suffix.length).join("").trimEnd();
    const next = base + suffix;
    if (!used.has(next.toLocaleLowerCase())) return next;
  }
  return name;
}

/** Invite codes: 6 characters without look-alikes (0/O, 1/I/L): 31 symbols, 31^6 ≈ 8.9e8 codes. */
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

/** Spectate id: 10 characters from the room-code alphabet, so it can never be mistaken for a 6-character room code. */
const SID_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{10}$`);
export function newSpectateId(random: (b: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const out: string[] = [];
  while (out.length < 10) {
    for (const b of random(new Uint8Array(16))) if (b < 248 && out.length < 10) out.push(CODE_ALPHABET[b % CODE_ALPHABET.length]);
  }
  return out.join("");
}
export const normalizeSpectateId = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const id = value.trim().toUpperCase();
  return SID_PATTERN.test(id) ? id : null;
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

  static create(code: string, deps: RoomDeps, options: { turnTimeoutMs?: number | null; seats?: number; settings?: RoomSettings } = {}): OnlineRoom {
    if (!CODE_PATTERN.test(code)) throw Error("잘못된 방 코드입니다.");
    const now = deps.now();
    const seats = Math.max(2, Math.min(MAX_PLAYERS, Math.floor(options.seats ?? 2)));
    // Every match has its own random id (records, rematches); the room code is only the address.
    const state = createOnlineMatch({ matchId: newMatchId(deps.random), seats, turnTimeoutMs: options.turnTimeoutMs ?? null }, now);
    const record: RoomRecord = { wire: WIRE_VERSION, code, createdAt: now, touchedAt: now, credentials: {}, log: state.log, matchNo: 1, ...(options.settings ? { settings: options.settings } : {}) };
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
      mode: this.settings().mode,
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
  join(rawName: unknown, identity?: { userId: string } | null, look?: PublicLook | null): Promise<JoinResult> {
    return this.serial(async () => {
      if (this.closed) return { ok: false, status: 410, error: { code: "ROOM_CLOSED", message: "닫힌 방입니다." } } as const;
      // Display names follow the shared nickname policy (src/identity/nickname.ts); the engine keeps its
      // looser 1–24 check so logs written before this policy still replay.
      const checked = validateNickname(rawName);
      let name = checked.ok ? normalizeName(checked.name) : null;
      if (!checked.ok || !name) return { ok: false, status: 400, error: { code: "INVALID_COMMAND", message: checked.ok ? "닉네임을 확인해 주세요." : checked.message } } as const;
      if (identity && Object.values(this.record.identities ?? {}).some((i) => i.userId === identity.userId))
        return { ok: false, status: 409, error: { code: "NAME_TAKEN", message: "이 계정은 이미 이 방에 있어요." } } as const;
      // Nicknames are set on the profile page, so a duplicate in this room gets a number ("하늘 2")
      // instead of a refusal the player could only fix by leaving the invite screen.
      if (this.state.status === "lobby") name = uniqueName(name, this.state.players.map((p) => p.name));
      const playerId = "p_" + base64url(this.random(new Uint8Array(12)));
      const token = base64url(this.random(new Uint8Array(32)));
      const result = this.apply(playerId, { commandId: "join", action: { type: "join", name } });
      if (!result.ok) return { ok: false, status: result.error.code === "MATCH_FULL" || result.error.code === "WRONG_PHASE" ? 409 : 400, error: result.error } as const;
      const tokenHash = await hashToken(token);
      await this.commit(result.state, result.events, {
        ...this.record,
        credentials: { ...this.record.credentials, [playerId]: { tokenHash } },
        ...(identity ? { identities: { ...(this.record.identities ?? {}), [playerId]: { userId: identity.userId } } } : {}),
        looks: { ...(this.record.looks ?? {}), [playerId]: identity && look ? sanitizeLook(look) : GUEST_LOOK },
      });
      return { ok: true, playerId, token } as const;
    });
  }

  /**
   * Quick match: a room whose two seats are given by the matchmaker and whose match starts at once
   * (seat order = move order, chosen at random by the matchmaker). One storage write for all of it.
   * When both players agreed, spectating is on and the room is listed publicly.
   */
  static async createMatched(code: string, deps: RoomDeps, options: { turnTimeoutMs?: number | null; kind: MatchKind; public: boolean }, seats: SeatSpec[]): Promise<{ room: OnlineRoom; seats: { playerId: string; token: string }[] }> {
    const room = OnlineRoom.create(code, deps, options);
    const out: { playerId: string; token: string }[] = [];
    let state = room.state;
    const credentials: RoomRecord["credentials"] = {};
    const identities: NonNullable<RoomRecord["identities"]> = {};
    const looks: NonNullable<RoomRecord["looks"]> = {};
    const events: OnlineEvent[] = [];
    const ctx = { now: deps.now(), dice: room.dice };
    let ai: RoomRecord["ai"];
    for (const [i, seat] of seats.entries()) {
      // The AI seat's label is chosen by the server (always says it is an AI), not a player nickname.
      const checked = seat.ai ? { ok: true as const, name: seat.name } : validateNickname(seat.name);
      const name = checked.ok ? normalizeName(checked.name) : null;
      if (!name) throw Error("닉네임을 확인해 주세요.");
      const playerId = "p_" + base64url(room.random(new Uint8Array(12)));
      const token = seat.token ?? base64url(room.random(new Uint8Array(32)));
      const joined = applyCommand(state, { commandId: `match-join-${i}`, playerId, action: { type: "join", name } }, ctx);
      if (!joined.ok) throw Error(joined.error.message);
      state = joined.state;
      events.push(...joined.events);
      if (seat.ai) ai = { playerId, level: SERVER_AI_LEVEL };
      else credentials[playerId] = { tokenHash: await hashToken(token) };
      if (seat.identity && !seat.ai) identities[playerId] = { userId: seat.identity.userId };
      looks[playerId] = seat.identity && seat.look ? sanitizeLook(seat.look) : GUEST_LOOK;
      out.push({ playerId, token: seat.ai ? "" : token });
    }
    const started = applyCommand(state, { commandId: "match-start", playerId: out[0].playerId, action: { type: "start" } }, ctx);
    if (!started.ok) throw Error(started.error.message);
    events.push(...started.events);
    let spectate: RoomRecord["spectate"];
    if (options.public && !ai) {
      const sid = newSpectateId(room.random);
      await deps.registerSpectate?.(sid);
      spectate = { allow: Object.fromEntries(out.map((s) => [s.playerId, true])), key: base64url(room.random(new Uint8Array(18))), sid };
    }
    await room.commit(started.state, events, { ...room.record, credentials, identities, looks, kind: options.kind, ...(ai ? { ai } : {}), ...(options.public && !ai ? { public: true, spectate } : {}) });
    return { room, seats: out };
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
      this.record = { ...this.record, series: [...(this.record.series ?? []), entry].slice(-ROOM_LIMITS.maxMatches), rematch: null, outbox: [...(this.record.outbox ?? []), ...this.accountRecords(next)] };
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
    // A finished match changes the room's running score (and opens rematch): tell every screen.
    if (finished) this.broadcastRematch();
    // Someone new took a seat (who has not agreed to spectators): stop watching now.
    if (events.some((e) => e.type === "playerJoined" || e.type === "playerLeft")) {
      this.enforceSpectate();
      const members = this.members();
      const looks = this.looks();
      for (const c of this.connections) if (c.playerId) c.send({ t: "members", members });
      for (const c of this.connections) if (c.playerId || c.spectator) c.send({ t: "looks", looks });
      this.broadcastLobby();
    }
  }

  private async run(playerId: string, raw: unknown): Promise<CommandResult> {
    const result = this.apply(playerId, raw);
    if (result.ok && !result.duplicate) await this.commit(result.state, result.events);
    return result;
  }

  private armTimer() {
    const deadline = this.state.status !== "playing" ? null : this.state.mode === "simultaneous" ? (this.state.roundDeadline ?? null) : (this.state.turn?.deadline ?? null);
    this.deps.schedule(deadline);
  }

  /** Server-side turn timer: when the deadline passes, the waiting opponent's seat claims it. */
  alarm(): Promise<void> {
    return this.serial(async () => {
      const turn = this.state.turn;
      if (!this.closed && this.state.status === "playing" && turn && turn.playerId === this.record.ai?.playerId) return this.aiAct();
      if (!this.closed && this.state.status === "playing" && this.state.mode === "simultaneous") {
        const deadline = this.state.roundDeadline;
        if (deadline == null) return;
        if (this.deps.now() < deadline) return this.armTimer();
        const claimer = this.state.players.find((p) => p.status === "active");
        if (!claimer) return;
        await this.run(claimer.playerId, { commandId: `timeout-${this.state.version}`, action: { type: "claimTimeout" } });
        return;
      }
      if (this.closed || this.state.status !== "playing" || !turn || turn.deadline === null) return;
      if (this.deps.now() < turn.deadline) return this.armTimer();
      const claimer = this.state.players.find((p) => p.status === "active" && p.playerId !== turn.playerId);
      if (!claimer) return;
      // Deterministic id: a repeated alarm for the same turn is an idempotent duplicate.
      await this.run(claimer.playerId, { commandId: `timeout-${this.state.version}`, action: { type: "claimTimeout" } });
    });
  }

  /* ------------------------------------------------------------- server AI ------------------------------------------------------------- */

  /** The AI seat, if this is a server AI match. */
  aiSeat(): { playerId: string; level: string } | null {
    return this.record.ai ?? null;
  }
  /** True while it is the AI's turn (the host schedules `aiStep`). */
  get aiToMove(): boolean {
    return !this.closed && this.state.status === "playing" && !!this.record.ai && this.state.turn?.playerId === this.record.ai.playerId;
  }
  /** One AI action (roll or score), applied and stored exactly like a player's command. */
  aiStep(): Promise<void> {
    return this.serial(() => this.aiAct());
  }
  private async aiAct() {
    const ai = this.record.ai;
    const turn = this.state.turn;
    if (!ai || this.closed || this.state.status !== "playing" || !turn || turn.playerId !== ai.playerId) return;
    const me = this.state.players.find((p) => p.playerId === ai.playerId);
    if (!me) return;
    // It sees exactly what a player sees: its dice, roll count and card — never the dice source.
    const move = turn.rolls === 0 ? ({ type: "roll", keep: [] } as const) : serverAiMove(turn.dice, turn.rolls, me.card);
    const action = move.type === "roll" ? { type: "roll" as const, keep: move.keep } : { type: "score" as const, category: move.category };
    // Deterministic id per state version: a repeated step (alarm + timer) is an idempotent duplicate.
    this.rollOrder = move.type === "roll" ? [...move.keep] : null;
    try {
      await this.run(ai.playerId, { commandId: `ai-${this.state.version}`, expectedVersion: this.state.version, action });
    } finally {
      this.rollOrder = null;
    }
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
    if (this.closed) return;
    // A spectator whose link was revoked while the object slept is not re-admitted.
    if (conn.spectator && !this.spectateKeyValid(conn.spectator.key)) return conn.close(4003, "spectating off");
    this.connections.add(conn);
  }

  /** Record activity without a game event (e.g. a socket closed) so idle cleanup counts from now. */
  touch() {
    this.record = { ...this.record, touchedAt: this.deps.now() };
    return this.deps.save(this.record);
  }

  disconnect(conn: RoomConnection) {
    if (!this.connections.delete(conn)) return;
    this.record = { ...this.record, touchedAt: this.deps.now() };
    if (conn.spectator) this.broadcastSpectate();
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
    if (msg.t === "watch") return this.watch(conn, msg.key, msg.since ?? 0);
    if (conn.spectator) return conn.send({ t: "error", code: "SPECTATOR", message: "관전 중에는 게임을 조작할 수 없어요." });
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
      conn.send({ t: "welcome", code: this.code, playerId, view, online: this.onlinePlayers(), hold: this.currentHold(), rematch: this.rematchState(), series: this.seriesSummary(), spectate: this.spectateState(), members: this.members(), looks: this.looks(), kind: this.kind, ai: this.aiSeat(), lobby: this.lobbyState() });
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
    if (msg.t === "spectate") return this.setSpectate(conn, playerId, msg.allow, msg.visibility);
    if (msg.t === "ready" || msg.t === "settings" || msg.t === "host") return this.lobbyChange(conn, playerId, msg);
    if (msg.t === "cmd" && msg.action.type === "start" && this.kind === "friend") return this.startFromLobby(conn, playerId, msg.id);
    if (msg.t === "hold") {
      // Shared presentation state: the dice actually kept still travel with the next `roll` command
      // and are validated by the engine. Kept in memory and saved with the next command (no row write).
      const turn = this.state.turn;
      if (this.state.status !== "playing" || turn?.playerId !== playerId || turn.rolls === 0 || turn.rolls >= 3) return;
      const n = msg.n ?? (this.record.hold?.playerId === playerId ? this.record.hold.n : 0);
      const hold: HoldState = { playerId, keep: msg.keep, n };
      this.record = { ...this.record, hold };
      // Everyone, the sender included, gets the same order (the sender matches its echo by `n`).
      for (const c of this.connections) if (c.playerId || c.spectator) c.send({ t: "hold", ...hold });
      return;
    }
    // command
    // A disconnect forfeit is decided by the server's reconnect grace, never asked for by a client.
    if ((msg.action as { type?: unknown }).type === "abandon") return conn.send({ t: "ack", id: msg.id, ok: false, error: { code: "INVALID_COMMAND", message: "지원하지 않는 행동입니다." } });
    let result: CommandResult;
    try {
      // The engine stores kept positions sorted; the selection order is kept here for the shelf.
      const keep = msg.action.type === "roll" ? (msg.action as { keep?: unknown }).keep : undefined;
      this.rollOrder = validKeep(keep) ? [...keep] : null;
      // Simultaneous rounds: other players' moves change the version all the time; each player's own
      // turn state (roll count, round) is what the engine checks, so the version guard is not used.
      const v = this.state.mode === "simultaneous" ? undefined : msg.v;
      result = await this.run(playerId, { commandId: msg.id, expectedVersion: v, action: msg.action });
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
    if (msg.action.type === "leave") await this.afterLeave(playerId);
  }

  /** Leaving the lobby ends this seat's token (asked by the player, or the reconnect grace ran out). */
  private async afterLeave(playerId: string) {
    const { [playerId]: _gone, ...rest } = this.record.credentials;
    const { [playerId]: _r, ...ready } = this.record.ready ?? {};
    this.record = { ...this.record, credentials: rest, ready, ...(this.record.hostId === playerId ? { hostId: undefined } : {}) };
    await this.deps.save(this.record);
    for (const c of [...this.connections]) if (c.playerId === playerId) c.close(4002, "left");
    if (!this.state.players.length) this.closeRoom();
    else this.broadcastLobby();
  }

  /* ------------------------------------------------------------- lobby (multiplayer) ------------------------------------------------------------- */

  settings(): RoomSettings {
    return this.record.settings ?? { mode: "turns", timeoutMs: this.state.turnTimeoutMs };
  }
  /** The host: the transferred host if still in the room, else the earliest remaining player. */
  hostId(): string | null {
    const departed = new Set(this.record.departed ?? []);
    const present = this.state.players.filter((p) => !departed.has(p.playerId));
    const chosen = this.record.hostId;
    if (chosen && present.some((p) => p.playerId === chosen)) return chosen;
    return present[0]?.playerId ?? null;
  }
  lobbyState(): LobbyState {
    const ready = Object.fromEntries(this.state.players.map((p) => [p.playerId, this.record.ready?.[p.playerId] === true]));
    return { hostId: this.hostId(), ready, settings: this.settings(), maxPlayers: this.state.seats };
  }
  private broadcastLobby() {
    const lobby = this.lobbyState();
    for (const c of this.connections) if (c.playerId || c.spectator) c.send({ t: "lobby", lobby });
  }
  private lobbyOps = 0;
  private lobbyAt = new Map<string, number>();

  /** Ready toggle (any player), match settings and host transfer (host only), in the lobby or after a match. */
  private async lobbyChange(conn: RoomConnection, playerId: string, msg: Extract<ClientMessage, { t: "ready" | "settings" | "host" }>) {
    const fail = (message: string) => conn.send({ t: "error", code: "LOBBY", message });
    if (this.kind !== "friend") return fail("이 방에서는 바꿀 수 없어요.");
    if (this.state.status === "playing") return fail("경기 중에는 바꿀 수 없어요.");
    const host = this.hostId();
    if (msg.t !== "ready" && host !== playerId) return fail("방장만 바꿀 수 있어요.");
    const now = this.deps.now();
    if (now - (this.lobbyAt.get(playerId) ?? -Infinity) < 300) return fail("잠시 후 다시 눌러 주세요.");
    if (this.lobbyOps >= ROOM_LIMITS.lobbyOps) return fail("변경을 너무 많이 했어요. 잠시 후 다시 시도해 주세요.");
    let next: RoomRecord;
    if (msg.t === "ready") {
      if ((this.record.ready?.[playerId] === true) === msg.ready) return conn.send({ t: "lobby", lobby: this.lobbyState() });
      next = { ...this.record, ready: { ...(this.record.ready ?? {}), [playerId]: msg.ready } };
    } else if (msg.t === "settings") {
      const settings = parseRoomSettings(msg);
      if (!settings) return fail(msg.mode === "simultaneous" ? "동시 진행은 라운드 제한 시간이 필요해요." : "지원하지 않는 제한 시간이에요.");
      next = { ...this.record, settings };
    } else {
      if (!this.state.players.some((p) => p.playerId === msg.to) || (this.record.departed ?? []).includes(msg.to)) return fail("방에 있는 사람에게만 넘길 수 있어요.");
      next = { ...this.record, hostId: msg.to };
    }
    this.lobbyAt.set(playerId, now);
    this.lobbyOps++;
    await this.saveRecord(next);
    this.broadcastLobby();
    // The host can change the spectating range: pages show the new host's controls.
    if (msg.t === "host") this.broadcastSpectate();
  }

  /**
   * The host starts the match from the lobby: everyone else must be ready (a 1:1 room starts at once,
   * as before). The match is rebuilt with the chosen settings (mode, time limit) and the host moves
   * first; seat tokens and player ids stay the same.
   */
  private async startFromLobby(conn: RoomConnection, playerId: string, commandId: string) {
    const nack = (code: string, message: string) => conn.send({ t: "ack", id: commandId, ok: false, error: { code, message } });
    if (this.state.processedCommands.length && this.state.status === "playing") return conn.send({ t: "ack", id: commandId, ok: true, duplicate: true });
    if (this.state.status !== "lobby") return nack("WRONG_PHASE", "이미 경기가 시작되었어요.");
    if (this.hostId() !== playerId) return nack("NOT_HOST", "방장만 경기를 시작할 수 있어요.");
    const players = this.state.players;
    if (players.length < 2) return nack("NOT_ENOUGH_PLAYERS", "최소 2명이 필요해요.");
    const notReady = players.filter((p) => p.playerId !== playerId && this.record.ready?.[p.playerId] !== true);
    if (this.state.seats > 2 && notReady.length) return nack("NOT_READY", `아직 준비하지 않은 사람이 있어요: ${notReady.map((p) => p.name).join(", ")}`);
    // Larger matches cost more of the shared daily budget (about one unit per two players; the room
    // creation already used one).
    const extra = Math.ceil(players.length / 2) - 1;
    const users = Object.values(this.members());
    if (extra > 0 || users.length) {
      const block = (await this.deps.allowMatch?.(extra, this.matchNumber, users)) ?? null;
      if (block) return nack("MATCH_UNAVAILABLE", block);
    }
    const ordered = [players.find((p) => p.playerId === playerId)!, ...players.filter((p) => p.playerId !== playerId).sort((a, b) => a.seat - b.seat)];
    const started = this.buildMatch(ordered, `start-${commandId}`);
    const before = { state: this.state, record: this.record };
    this.state = started;
    try {
      await this.saveRecord({ ...this.record, log: started.log, ready: {}, hold: null, hostId: playerId });
    } catch {
      this.state = before.state;
      this.record = before.record;
      await this.deps.releaseMatch?.(this.matchNumber);
      return nack("INVALID_COMMAND", "서버에서 명령을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
    this.lobbyOps = 0;
    this.armTimer();
    // Same order as every other command: the new state first, then the acknowledgement.
    for (const c of this.connections) if (c.playerId || c.spectator) this.sendView(c, 0);
    this.broadcastLobby();
    conn.send({ t: "ack", id: commandId, ok: true, duplicate: false });
  }

  /** A fresh match with these players (the first moves first), the room's settings, started. */
  private buildMatch(order: { playerId: string; name: string }[], prefix: string): OnlineMatchState {
    const now = this.deps.now();
    const { mode, timeoutMs } = this.settings();
    let next = createOnlineMatch({ matchId: newMatchId(this.random), seats: this.state.seats, turnTimeoutMs: timeoutMs, ...(mode === "simultaneous" ? { mode } : {}) }, now);
    const ctx = { now, dice: this.dice };
    for (const [i, p] of order.entries()) {
      const joined = applyCommand(next, { commandId: `${prefix}-join-${i}`, playerId: p.playerId, action: { type: "join", name: p.name } }, ctx);
      if (!joined.ok) throw Error(joined.error.message);
      next = joined.state;
    }
    const started = applyCommand(next, { commandId: `${prefix}-go`.slice(0, 64), playerId: order[0].playerId, action: { type: "start" } }, ctx);
    if (!started.ok) throw Error(started.error.message);
    return started.state;
  }

  /* ------------------------------------------------------------- spectating (Phase 3) ------------------------------------------------------------- */

  private spectators() {
    return [...this.connections].filter((c) => c.spectator);
  }

  /**
   * The spectating range in force. Quick matches are public by rule (D-045). Friend rooms use the
   * host's choice (D-095); a record from before host control keeps the legacy rule: every seated
   * player allowed → link only. Nothing becomes public without an explicit choice.
   */
  spectateMode(): SpectateMode {
    const sp = this.record.spectate;
    if (!sp?.key || !this.state.players.length || this.closed || this.record.ai) return "private";
    if (this.isPublic) return "public";
    if (sp.mode) return sp.mode;
    return this.state.players.every((p) => sp.allow[p.playerId] === true) ? "invite" : "private";
  }

  private spectateActive(): boolean {
    return this.spectateMode() !== "private";
  }

  publicSpectating(): boolean {
    const mode = this.spectateMode();
    if (mode !== "public") return false;
    return this.isPublic || (this.kind === "friend" && !!this.record.spectate?.publicKey);
  }

  /** Is this key (link key, or public-list key while public) still a valid read-only credential? */
  private spectateKeyValid(key: string): boolean {
    const sp = this.record.spectate;
    if (!sp?.key || !this.spectateActive()) return false;
    if (sameHash(key, sp.key)) return true;
    return this.publicSpectating() && !this.isPublic && !!sp.publicKey && sameHash(key, sp.publicKey);
  }

  spectateState(): SpectateState {
    const mode = this.spectateMode();
    const active = mode !== "private";
    const sp = this.record.spectate;
    // `allow` mirrors the range for every seat, so older pages (a per-player switch) show the real state.
    const allow = Object.fromEntries(this.state.players.map((p) => [p.playerId, active]));
    return {
      allow, active, key: active ? sp!.key : null, spectators: this.spectators().length, max: ROOM_LIMITS.maxSpectators,
      public: this.isPublic && active, visibility: mode,
      ...(this.kind === "friend" && !this.record.ai ? { hostControl: true, host: this.hostId(), ...(active && sp?.sid ? { sid: sp.sid } : {}) } : {}),
      ...(this.isPublic && sp?.sid ? { sid: sp.sid } : {}),
    };
  }

  private broadcastSpectate() {
    const spectate = this.spectateState();
    for (const c of this.connections) if (c.playerId) c.send({ t: "spectate", spectate });
  }

  /** Close spectator sockets that are no longer allowed (range narrowed, key replaced). */
  private enforceSpectate() {
    let kicked = false;
    for (const c of this.spectators())
      if (!this.spectateKeyValid(c.spectator!.key)) {
        this.connections.delete(c);
        c.close(4003, "spectating off");
        kicked = true;
      }
    if (kicked) this.broadcastSpectate();
  }

  private spectateAt = -Infinity;
  /**
   * The host sets the friend room's spectating range (D-095). Every player can read it; only the host
   * can change it, checked here. Older pages send `{allow}` only: the host's `allow:true` means "link",
   * `false` means "private". Narrowing is honoured at once and revokes what it no longer covers
   * (private: both keys; public → link: the public-list key); widening is paced and issues new keys.
   */
  private async setSpectate(conn: RoomConnection, playerId: string, allow: boolean, visibility?: SpectateMode) {
    if (this.record.ai) return conn.send({ t: "error", code: "SPECTATE", message: "AI 대전은 관전할 수 없어요." });
    // Quick matches are public by rule (D-045): nobody can switch spectating off during the match.
    if (this.isPublic) {
      if (!allow || (visibility && visibility !== "public")) conn.send({ t: "error", code: "SPECTATE", message: "빠른 대전은 관전방에 공개되는 경기예요. 공개를 끌 수 없어요." });
      return conn.send({ t: "spectate", spectate: this.spectateState() });
    }
    if (this.hostId() !== playerId) {
      conn.send({ t: "error", code: "NOT_HOST", message: "관전 범위는 방장만 바꿀 수 있어요." });
      return conn.send({ t: "spectate", spectate: this.spectateState() });
    }
    const target: SpectateMode = visibility ?? (allow ? "invite" : "private");
    const current = this.spectateMode();
    const sp = this.record.spectate ?? { allow: {}, key: null };
    if (target === current && (this.record.spectate?.mode || target === "private")) return conn.send({ t: "spectate", spectate: this.spectateState() });
    const rank = { private: 0, invite: 1, public: 2 } as const;
    const now = this.deps.now();
    if (rank[target] > rank[current]) {
      if (now - this.spectateAt < ROOM_LIMITS.rematchCooldownMs) return conn.send({ t: "error", code: "SPECTATE", message: "잠시 후 다시 눌러 주세요." });
      this.spectateAt = now;
    }
    let sid = sp.sid;
    if (target !== "private" && !sid) {
      sid = newSpectateId(this.random);
      try {
        await this.deps.registerSpectate?.(sid);
      } catch {
        return conn.send({ t: "error", code: "SPECTATE", message: "관전 링크를 만들지 못했어요. 잠시 후 다시 시도해 주세요." });
      }
    }
    const fresh = () => base64url(this.random(new Uint8Array(18)));
    const key = target === "private" ? null : current !== "private" && sp.key ? sp.key : fresh();
    const publicKey = target === "public" ? (current === "public" && sp.publicKey ? sp.publicKey : fresh()) : null;
    await this.saveRecord({ ...this.record, spectate: { allow: {}, key, publicKey, mode: target, ...(sid ? { sid } : {}) } });
    this.enforceSpectate();
    this.broadcastSpectate();
  }

  /** A spectator socket: read-only, admitted with a valid watch key (link or public list). */
  private watch(conn: RoomConnection, key: string, since: number) {
    if (conn.playerId || conn.spectator) return conn.send({ t: "error", code: "SPECTATOR", message: "이미 연결된 화면이에요." });
    if (!this.spectateKeyValid(key)) {
      conn.send({ t: "error", code: "SPECTATE_OFF", message: "지금은 이 경기를 관전할 수 없어요." });
      return conn.close(4003, "spectating off");
    }
    if (this.spectators().length >= ROOM_LIMITS.maxSpectators) {
      conn.send({ t: "error", code: "SPECTATORS_FULL", message: "관전 인원이 가득 찼어요." });
      return conn.close(4005, "spectators full");
    }
    conn.spectator = { key };
    const from = Math.max(0, Math.min(since, this.state.log.length));
    conn.seenSeq = this.state.log.length;
    // A spectator learns the spectate id, never the room (= invite) code (PR118-01). Old records without
    // an id were watched through the room code, which the viewer already had.
    const sid = this.record.spectate?.sid ?? this.code;
    conn.send({ t: "watching", code: sid, view: viewFor(this.state, null, this.deps.now(), from), online: this.onlinePlayers(), hold: this.currentHold(), series: this.seriesSummary(), spectators: this.spectators().length, looks: this.looks(), kind: this.kind, ai: this.aiSeat(), lobby: this.lobbyState() });
    this.broadcastSpectate();
  }

  /* ------------------------------------------------------------- social (Phase 3) ------------------------------------------------------------- */

  /** Preset chat / emote: catalog ids only, rate-limited per connection, relayed live, never stored. */
  private say(conn: RoomConnection, playerId: string, id: string) {
    if (!canSend(id, sendableIds(this.lookOf(playerId)))) return conn.send({ t: "error", code: "INVALID_SOCIAL", message: "장착하지 않은 메시지는 보낼 수 없어요.", id });
    const now = this.deps.now();
    conn.social ??= newSocialBucket(now);
    if (!allowSocial(conn.social, id, now)) return conn.send({ t: "error", code: "SOCIAL_RATE_LIMITED", message: "잠시 후 다시 보내 주세요.", id, retryMs: Math.max(300, socialRetryMs(conn.social, id, now)) });
    for (const c of this.connections) if (c.playerId || c.spectator) c.send({ t: "said", from: playerId, id });
  }

  /** Account ids of signed-in seats (public profile ids; shown to the other players for "상대 프로필"). */
  members(): Record<string, string> {
    const ids = this.record.identities ?? {};
    return Object.fromEntries(this.state.players.filter((p) => ids[p.playerId]).map((p) => [p.playerId, ids[p.playerId].userId]));
  }

  /** A seat's public look (default for guests and for records written before looks existed). */
  lookOf(playerId: string): PublicLook {
    return this.record.looks?.[playerId] ?? GUEST_LOOK;
  }
  looks(): Record<string, PublicLook> {
    return Object.fromEntries(this.state.players.map((p) => [p.playerId, this.lookOf(p.playerId)]));
  }
  get matchNumber() {
    return this.record.matchNo ?? 1;
  }
  get kind(): MatchKind {
    return this.record.kind ?? "friend";
  }
  get isPublic(): boolean {
    return this.record.public === true;
  }

  /**
   * Public list entry while a public match is being played, else null. It carries the spectate id
   * (`id`; `code` repeats it for older pages), never the room code (PR118-01).
   */
  publicEntry(): { id: string; code: string; kind: "random" | "friend"; status: "playing"; participants: number; rounds: number; players: { name: string; score: number; look: PublicLook }[]; round: number; spectators: number; max: number } | null {
    const sid = this.record.spectate?.sid;
    if (!sid || this.kind === "ai" || this.closed || this.state.status !== "playing" || !this.publicSpectating()) return null;
    const players = [...this.state.players].sort((a, b) => a.seat - b.seat);
    return { id: sid, code: sid, kind: this.kind, status: "playing", participants: players.length, rounds: 12, players: players.map((p) => ({ name: p.name, score: total(p.card), look: this.lookOf(p.playerId) })), round: this.state.round ?? this.state.turn?.round ?? 12, spectators: this.spectators().length, max: ROOM_LIMITS.maxSpectators };
  }
  /** The watch key for someone who picked this room from the public list (only while it is listed). */
  publicWatchKey(): string | null {
    if (!this.publicEntry() || this.spectators().length >= ROOM_LIMITS.maxSpectators) return null;
    const sp = this.record.spectate!;
    return (this.isPublic ? sp.key : sp.publicKey) ?? null;
  }
  /**
   * PR118-03: does this account still hold a live seat in match `matchNo` here? Used only to clear a
   * reservation whose release was lost; a match in progress always answers true.
   */
  holdsAccount(userId: string, matchNo: number): boolean {
    if (this.closed || this.state.status !== "playing" || this.matchNumber !== matchNo) return false;
    const playerId = Object.entries(this.record.identities ?? {}).find(([, v]) => v.userId === userId)?.[0];
    return !!playerId && this.state.players.some((p) => p.playerId === playerId && p.status === "active");
  }
  get spectateId(): string | null {
    return this.record.spectate?.sid ?? null;
  }

  /** The official result of a finished match for each signed-in seat, from the engine's own state. */
  private accountRecords(state: OnlineMatchState): { userId: string; record: MatchRecord }[] {
    const ids = this.record.identities ?? {};
    const started = state.log.find((e) => e.type === "matchStarted")?.at ?? state.log[0]?.at ?? this.deps.now();
    const finished = [...state.log].reverse().find((e) => e.type === "matchFinished");
    const forfeit = [...state.log].reverse().find((e) => e.type === "playerForfeited");
    const totals = Object.fromEntries((state.standings ?? []).map((s) => [s.playerId, s.points]));
    const out: { userId: string; record: MatchRecord }[] = [];
    const standings = state.standings ?? [];
    let review: ReviewMatch | undefined;
    if (state.players.length === 2 && state.status === "finished") {
      const member = state.players.find((player) => ids[player.playerId]);
      if (member) {
        const view = viewFor(state, member.playerId, undefined, 0);
        const trace = fromOnline(view, view.events, this.looks());
        if (typeof trace !== "string" && trace.steps.length <= 72) review = trace;
      }
    }
    for (const p of state.players) {
      const id = ids[p.playerId];
      if (!id) continue;
      const others = state.players.filter((q) => q.playerId !== p.playerId);
      if (!others.length) continue;
      // The opponent summary is the best other player (the only one in a 1:1 match).
      const other = [...others].sort((a, b) => (totals[b.playerId] ?? 0) - (totals[a.playerId] ?? 0))[0];
      const rank = standings.find((st) => st.playerId === p.playerId)?.rank ?? state.players.length;
      const sharedFirst = state.winners.length > 1 && state.winners.includes(p.playerId);
      const outcome = state.winners.length === 1 && state.winners[0] === p.playerId ? "win" : sharedFirst || (state.winners.length !== 1 && state.players.length === 2) ? "draw" : "loss";
      // A forfeit by someone else does not change this player's end reason in a larger match.
      const myForfeit = [...state.log].reverse().find((e) => e.type === "playerForfeited" && e.playerId === p.playerId);
      // Larger matches: "completed" only with a full card; a match cut short because the others left is
      // reported like an opponent forfeit (the reward rules then need ≥ 6 filled categories).
      const fullCard = Object.keys(p.card).length >= 12;
      const endReason =
        state.players.length === 2
          ? forfeit && forfeit.type === "playerForfeited" ? forfeit.reason : "completed"
          : myForfeit && myForfeit.type === "playerForfeited" ? myForfeit.reason : fullCard ? "completed" : "resign";
      out.push({
        userId: id.userId,
        record: {
          recordId: state.matchId,
          mode: "online",
          rules: RULES_ID,
          source: "server",
          verification: "server-verified",
          startedAt: started,
          endedAt: finished?.at ?? this.deps.now(),
          name: p.name,
          score: totals[p.playerId] ?? 0,
          card: { ...p.card },
          outcome,
          endReason,
          opponent:
            this.record.ai?.playerId === other.playerId
              ? { name: other.name, kind: "ai", score: totals[other.playerId] ?? 0, aiLevel: this.record.ai.level }
              : { name: others.length > 1 ? `${other.name} 외 ${others.length - 1}명` : other.name, kind: ids[other.playerId] ? "member" : "guest", score: totals[other.playerId] ?? 0, ...(ids[other.playerId] && others.length === 1 ? { userId: ids[other.playerId].userId } : {}) },
          ...(this.record.ai ? { aiLevel: this.record.ai.level } : {}),
          kind: this.kind,
          stats: matchStats(state.log, p.playerId, others.length === 1 ? other.playerId : null, state.winners),
          ...(review ? { review } : {}),
          ...(state.players.length > 2 ? { field: { players: state.players.length, rank, mode: state.mode === "simultaneous" ? "simultaneous" : "turns" } } : {}),
        },
      });
    }
    return out;
  }

  /** Results waiting to be delivered to accounts. */
  pendingRecords(): { userId: string; record: MatchRecord }[] {
    return [...(this.record.outbox ?? [])];
  }
  /** Delivered (the account store ignores duplicates, so a lost acknowledgement is harmless). Saved with the next write. */
  markDelivered(userId: string, recordId: string) {
    const outbox = (this.record.outbox ?? []).filter((e) => !(e.userId === userId && e.record.recordId === recordId));
    this.record = { ...this.record, outbox };
  }

  rematchState(): RematchState {
    const departed = this.record.departed ?? [];
    const pending = this.record.rematch ?? { requests: [], declinedBy: null };
    const finished = this.state.status === "finished";
    const blocked = !finished
      ? null
      : this.state.players.length - departed.length < 2
        ? "상대가 방을 나갔어요."
        : this.record.ai
          ? "AI 대전은 새로 시작해 주세요."
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
    for (const c of this.connections) if (c.playerId || c.spectator) c.send({ t: "rematch", rematch, series });
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
    if (this.record.ai) return fail("AI 대전은 재대결 대신 새로 시작해 주세요.");
    const blocked = this.rematchState().blocked;
    if (blocked && (op === "request" || op === "start") && (this.state.players.length - (this.record.departed?.length ?? 0) < 2 || (this.record.matchNo ?? 1) >= ROOM_LIMITS.maxMatches)) return fail(blocked);
    const pending = this.record.rematch ?? { requests: [], declinedBy: null };
    let next = pending;
    if (op === "request") {
      if (pending.requests.includes(playerId)) return this.broadcastRematchTo(conn); // double tap: nothing to store
      next = { requests: [...pending.requests, playerId], declinedBy: null };
    } else if (op === "cancel") {
      if (!pending.requests.includes(playerId)) return this.broadcastRematchTo(conn);
      next = { requests: pending.requests.filter((id) => id !== playerId), declinedBy: null };
    } else if (op === "start") {
      // Larger rooms: the host starts the next match with everyone who asked (at least two).
      if (this.hostId() !== playerId) return fail("방장만 바로 시작할 수 있어요.");
      const requests = pending.requests.includes(playerId) ? pending.requests : [...pending.requests, playerId];
      if (requests.length < 2) return fail("함께할 사람이 한 명 이상 재대결을 눌러야 해요.");
      return this.startRematch(requests);
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
    const departed = new Set(this.record.departed ?? []);
    const everyone = this.state.players.filter((p) => !departed.has(p.playerId)).every((p) => next.requests.includes(p.playerId));
    if (everyone && next.requests.length >= 2) return this.startRematch(next.requests);
    await this.saveRecord({ ...this.record, rematch: next });
    this.broadcastRematch();
  }

  private broadcastRematchTo(conn: RoomConnection) {
    conn.send({ t: "rematch", rematch: this.rematchState(), series: this.seriesSummary() });
  }

  private async startRematch(requests: string[]) {
    const joining = this.state.players.filter((p) => requests.includes(p.playerId));
    const matchNo = (this.record.matchNo ?? 1) + 1;
    const users = joining.flatMap(({ playerId }) => this.record.identities?.[playerId]?.userId ?? []);
    const block = (await this.deps.allowMatch?.(Math.max(1, Math.ceil(joining.length / 2)), matchNo, users)) ?? null;
    if (block) {
      this.rematchBlocked = block;
      await this.saveRecord({ ...this.record, rematch: null });
      return this.broadcastRematch();
    }
    // Alternate who starts: seats rotate by one (two players: swap).
    const bySeat = [...joining].sort((a, b) => a.seat - b.seat);
    const order = [...bySeat.slice(1), bySeat[0]];
    const started = { state: this.buildMatch(order, `rematch-${matchNo}`) };
    // Players who did not ask (larger rooms) leave the room for good: their seat tokens stop working.
    const dropped = this.state.players.filter((p) => !requests.includes(p.playerId)).map((p) => p.playerId);
    const credentials = Object.fromEntries(Object.entries(this.record.credentials).filter(([id]) => !dropped.includes(id)));
    const before = { state: this.state, record: this.record };
    this.state = started.state;
    try {
      await this.saveRecord({ ...this.record, log: started.state.log, matchNo, rematch: null, hold: null, credentials, departed: [], ready: {} });
    } catch (error) {
      this.state = before.state;
      this.record = before.record;
      await this.deps.releaseMatch?.(matchNo);
      throw error;
    }
    this.rematchOps = 0;
    this.armTimer();
    for (const c of [...this.connections]) if (c.playerId && dropped.includes(c.playerId)) c.close(4002, "left");
    // A new match: every screen gets the whole (short) log of the new match.
    for (const c of this.connections) if (c.playerId || c.spectator) this.sendView(c, 0);
    this.broadcastRematch();
    this.broadcastLobby();
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
    this.broadcastLobby();
  }

  private sendView(conn: RoomConnection, since: number) {
    if (!conn.playerId && !conn.spectator) return;
    // Spectators get the neutral projection (viewer null): no legal moves, no command ids.
    conn.send({ t: "view", view: viewFor(this.state, conn.playerId, this.deps.now(), since), hold: this.currentHold() });
    conn.seenSeq = this.state.log.length;
  }

  private broadcast() {
    for (const conn of this.connections) if (conn.playerId || conn.spectator) this.sendView(conn, conn.seenSeq);
  }

  /**
   * Room lifecycle (D-046), called by the host's alarm: a seat whose reconnect grace ran out. During a
   * match it is forfeited with reason "left" (not a resignation); in the waiting room it leaves its seat.
   * Deterministic command ids: a repeated alarm is an idempotent duplicate.
   */
  absentFor(playerId: string): Promise<void> {
    return this.serial(async () => {
      if (this.closed) return;
      const p = this.state.players.find((x) => x.playerId === playerId);
      if (!p) return;
      if (this.state.status === "playing" && p.status === "active") await this.run(playerId, { commandId: `away-${this.state.version}-${playerId}`, action: { type: "abandon" } });
      else if (this.state.status === "lobby") {
        const r = await this.run(playerId, { commandId: `away-${this.state.version}-${playerId}`, action: { type: "leave" } });
        if (r.ok && !r.duplicate) await this.afterLeave(playerId);
      }
    });
  }
  /** Seats (players still in the match / lobby) other than the server AI. */
  humanSeats(): string[] {
    const ai = this.record.ai?.playerId;
    return this.state.players.filter((p) => p.playerId !== ai && (this.state.status !== "playing" || p.status === "active")).map((p) => p.playerId);
  }
  /** Players with a live socket (the server AI counts as present). */
  presentPlayers(): string[] {
    return this.onlinePlayers();
  }
  /** Reconnect deadlines shown to every screen ("다시 들어오면 이어서 진행돼요 · 1:30"). */
  private away: Record<string, number> = {};
  setAway(away: Record<string, number>) {
    const same = JSON.stringify(away) === JSON.stringify(this.away);
    this.away = away;
    if (!same) this.broadcastPresence();
  }

  private onlinePlayers() {
    const ids = [...this.connections].map((c) => c.playerId).filter((id): id is string => !!id);
    // The server AI is always "connected".
    if (this.record.ai) ids.push(this.record.ai.playerId);
    return [...new Set(ids)];
  }
  private broadcastPresence() {
    const online = this.onlinePlayers();
    const now = this.deps.now();
    const away = Object.fromEntries(Object.entries(this.away).map(([id, at]) => [id, Math.max(0, at - now)]));
    for (const conn of this.connections) if (conn.playerId || conn.spectator) conn.send({ t: "presence", online, ...(Object.keys(away).length ? { away } : {}) });
  }

  /** Close every socket; the host then drops the room and its stored record. */
  closeIf(condition: () => boolean): Promise<boolean> {
    return this.serial(() => {
      if (!condition()) return false;
      this.closeRoom();
      return true;
    });
  }

  closeRoom() {
    this.closed = true;
    this.deps.schedule(null);
    for (const conn of [...this.connections]) conn.close(4004, "room closed");
    this.connections.clear();
  }
}

