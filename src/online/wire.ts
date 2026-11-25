import { isRecord, isValidId, DICE_COUNT, type MatchStatus, type OnlineAction, type OnlineError } from "./protocol";
import type { PlayerView } from "./server-engine";
import type { PublicLook } from "../economy/live/catalog";
import type { MatchKind } from "../economy/live/config";

/**
 * Socket messages between the online client and a room (Phase 2). Plain JSON text frames.
 * The command payload (`action`) is validated again by the Phase 1 `parseCommand`.
 */
export const WIRE_VERSION = 1 as const;
/** Players per friend room (host chooses at creation) and the time limits a host may pick (ms; null = none). */
export const MAX_PLAYERS = 20;
export const TURN_LIMITS: readonly (number | null)[] = [null, 30_000, 60_000, 90_000, 120_000, 180_000];
export const ROUND_LIMITS: readonly number[] = [60_000, 90_000, 120_000, 180_000];

export type ClientMessage =
  /** First frame on every socket. The token is sent in the body, never in the URL (keeps it out of logs). */
  | { t: "hello"; token: string; since?: number }
  | { t: "cmd"; id: string; v?: number; action: OnlineAction }
  /**
   * Hold selection of the player whose turn it is, in selection order (shelf order). `n` counts the
   * sender's own hold messages so its echo can be matched. Presentation state: the dice that are
   * actually kept still travel with the next `roll` command and are validated by the engine.
   */
  | { t: "hold"; keep: number[]; n?: number }
  /** Preset chat line or emote, by catalog id only (src/social/catalog.ts). Never free text. */
  | { t: "say"; id: string }
  /** After a match: ask for / take back / turn down a rematch in the same room. */
  | { t: "rematch"; op: RematchOp }
  /** Leave a finished room for good (no rematch with this seat any more). */
  | { t: "bye" }
  /** Player: allow or stop spectators for this room (needs every seated player's consent). */
  | { t: "spectate"; allow: boolean }
  /** Spectator: first frame instead of `hello`. The key comes from a player's watch link. */
  | { t: "watch"; key: string; since?: number }
  /** Lobby: any player marks ready / not ready. */
  | { t: "ready"; ready: boolean }
  /** Lobby, host only: how the match is played (turn-by-turn or simultaneous rounds) and its time limit. */
  | { t: "settings"; mode: "turns" | "simultaneous"; timeoutMs: number | null }
  /** Host only: hand the host role to another player in the room. */
  | { t: "host"; to: string }
  | { t: "ping" };
/** "start": larger rooms — the host starts the next match with everyone who asked. */
export type RematchOp = "request" | "cancel" | "decline" | "start";

export type ServerMessage =
  | { t: "welcome"; code: string; playerId: string; view: PlayerView; online: string[]; hold: HoldState | null; rematch?: RematchState; series?: SeriesSummary; spectate?: SpectateState; members?: Record<string, string>; looks?: Record<string, PublicLook>; kind?: MatchKind; ai?: AiSeat | null; lobby?: LobbyState }
  /** `hold` is present from servers that keep the shared hold order (older servers omit it). */
  | { t: "view"; view: PlayerView; hold?: HoldState | null }
  | { t: "ack"; id: string; ok: true; duplicate: boolean }
  | { t: "ack"; id: string; ok: false; error: OnlineError | { code: string; message: string } }
  | { t: "hold"; playerId: string; keep: number[]; n?: number }
  /** `away`: players whose socket is gone → ms left before their seat is forfeited / freed (D-046). */
  | { t: "presence"; online: string[]; away?: Record<string, number> }
  /** A preset chat line / emote, relayed live only (never stored, never replayed on reconnect). */
  | { t: "said"; from: string; id: string }
  /** Rematch status and this room's running score (sent when either changes). */
  | { t: "rematch"; rematch: RematchState; series: SeriesSummary }
  /** Signed-in seats: playerId → public account id (for "상대 프로필"). Guests are absent. */
  | { t: "members"; members: Record<string, string> }
  /** What each seat shows (server-validated equipped items). Sent on welcome and when a seat changes. */
  | { t: "looks"; looks: Record<string, PublicLook> }
  /** Host, ready flags and match settings (friend rooms). */
  | { t: "lobby"; lobby: LobbyState }
  /** Players only: spectating consent, the watch key (when active) and how many are watching. */
  | { t: "spectate"; spectate: SpectateState }
  /** Spectator welcome: neutral view (`you` is null, no legal moves, no command ids, no tokens). */
  | { t: "watching"; code: string; view: PlayerView; online: string[]; hold: HoldState | null; series: SeriesSummary; spectators: number; looks?: Record<string, PublicLook>; kind?: MatchKind; ai?: AiSeat | null; lobby?: LobbyState }
  | { t: "error"; code: string; message: string }
  | { t: "pong" };

/** Held dice of the current turn, in the order they were selected — identical on every screen. */
export type HoldState = { playerId: string; keep: number[]; n: number };

/**
 * Rematch negotiation for the finished match. `requests` are the players who asked (in order);
 * when every seated player has asked, a new match starts in the same room. `departed` players left
 * the room for good; `declinedBy` turned the last request down; `blocked` says why no rematch is
 * possible (daily limit, room too old, match cap) — null when it is.
 */
export type RematchState = { requests: string[]; declinedBy: string | null; departed: string[]; blocked: string | null };
/**
 * Spectating is off until every seated player turns it on. `key` (players only) is the secret part of
 * the watch link; it is replaced whenever spectating is turned off, so old links stop working.
 */
export type SpectateState = { allow: Record<string, boolean>; active: boolean; key: string | null; spectators: number; max: number; public?: boolean };
/** The server AI seat of an AI match (shown as AI, never as a person). */
export type AiSeat = { playerId: string; level: string };

/** Results of the matches already finished in this room (the running score between the same players). */
export type SeriesSummary = { matchNo: number; games: number; draws: number; wins: Record<string, number> };

/** Public info for an invite link (no tokens, no player ids). */
export type RoomSummary = { code: string; status: MatchStatus; seats: number; players: string[]; mode?: "turns" | "simultaneous" };
export type LobbyState = { hostId: string | null; ready: Record<string, boolean>; settings: { mode: "turns" | "simultaneous"; timeoutMs: number | null }; maxPlayers: number };

/** HTTP responses. */
export type JoinResponse = { code: string; playerId: string; token: string };
export type ApiError = { error: { code: string; message: string } };

export const validKeep = (keep: unknown): keep is number[] =>
  Array.isArray(keep) &&
  keep.length <= DICE_COUNT &&
  keep.every((i) => Number.isInteger(i) && i >= 0 && i < DICE_COUNT) &&
  new Set(keep).size === keep.length;

/** Shape check for untrusted frames. Game rules are checked by the engine, not here. */
export function parseClientMessage(data: string): ClientMessage | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(raw) || typeof raw.t !== "string") return null;
  switch (raw.t) {
    case "ping":
      return { t: "ping" };
    case "hello":
      if (typeof raw.token !== "string") return null;
      if (raw.since !== undefined && (!Number.isSafeInteger(raw.since) || (raw.since as number) < 0)) return null;
      return { t: "hello", token: raw.token, ...(raw.since !== undefined ? { since: raw.since as number } : {}) };
    case "hold":
      // Selection order is kept (it is the shelf order); only distinct positions 0..4 are accepted.
      if (!validKeep(raw.keep)) return null;
      if (raw.n !== undefined && (!Number.isSafeInteger(raw.n) || (raw.n as number) < 0)) return null;
      return { t: "hold", keep: [...raw.keep], ...(raw.n !== undefined ? { n: raw.n as number } : {}) };
    case "say":
      if (typeof raw.id !== "string" || raw.id.length > 40) return null;
      return { t: "say", id: raw.id };
    case "rematch":
      if (raw.op !== "request" && raw.op !== "cancel" && raw.op !== "decline" && raw.op !== "start") return null;
      return { t: "rematch", op: raw.op };
    case "bye":
      return { t: "bye" };
    case "ready":
      if (typeof raw.ready !== "boolean") return null;
      return { t: "ready", ready: raw.ready };
    case "settings":
      if (raw.mode !== "turns" && raw.mode !== "simultaneous") return null;
      if (raw.timeoutMs !== null && !Number.isSafeInteger(raw.timeoutMs)) return null;
      return { t: "settings", mode: raw.mode, timeoutMs: raw.timeoutMs as number | null };
    case "host":
      if (!isValidId(raw.to)) return null;
      return { t: "host", to: raw.to as string };
    case "spectate":
      if (typeof raw.allow !== "boolean") return null;
      return { t: "spectate", allow: raw.allow };
    case "watch":
      if (typeof raw.key !== "string" || raw.key.length < 16 || raw.key.length > 64) return null;
      if (raw.since !== undefined && (!Number.isSafeInteger(raw.since) || (raw.since as number) < 0)) return null;
      return { t: "watch", key: raw.key, ...(raw.since !== undefined ? { since: raw.since as number } : {}) };
    case "cmd":
      if (!isValidId(raw.id) || !isRecord(raw.action)) return null;
      if (raw.v !== undefined && (!Number.isSafeInteger(raw.v) || (raw.v as number) < 0)) return null;
      return { t: "cmd", id: raw.id, ...(raw.v !== undefined ? { v: raw.v as number } : {}), action: raw.action as OnlineAction };
    default:
      return null;
  }
}
