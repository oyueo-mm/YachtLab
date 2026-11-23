import { isRecord, isValidId, DICE_COUNT, type MatchStatus, type OnlineAction, type OnlineError } from "./protocol";
import type { PlayerView } from "./server-engine";

/**
 * Socket messages between the online client and a room (Phase 2). Plain JSON text frames.
 * The command payload (`action`) is validated again by the Phase 1 `parseCommand`.
 */
export const WIRE_VERSION = 1 as const;

export type ClientMessage =
  /** First frame on every socket. The token is sent in the body, never in the URL (keeps it out of logs). */
  | { t: "hello"; token: string; since?: number }
  | { t: "cmd"; id: string; v?: number; action: OnlineAction }
  /** Live hold preview for the opponent (not authoritative). */
  | { t: "hold"; keep: number[] }
  | { t: "ping" };

export type ServerMessage =
  | { t: "welcome"; code: string; playerId: string; view: PlayerView; online: string[]; hold: { playerId: string; keep: number[] } | null }
  | { t: "view"; view: PlayerView }
  | { t: "ack"; id: string; ok: true; duplicate: boolean }
  | { t: "ack"; id: string; ok: false; error: OnlineError | { code: string; message: string } }
  | { t: "hold"; playerId: string; keep: number[] }
  | { t: "presence"; online: string[] }
  | { t: "error"; code: string; message: string }
  | { t: "pong" };

/** Public info for an invite link (no tokens, no player ids). */
export type RoomSummary = { code: string; status: MatchStatus; seats: number; players: string[] };

/** HTTP responses. */
export type JoinResponse = { code: string; playerId: string; token: string };
export type ApiError = { error: { code: string; message: string } };

const validKeep = (keep: unknown): keep is number[] =>
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
      return validKeep(raw.keep) ? { t: "hold", keep: [...raw.keep].sort((a, b) => a - b) } : null;
    case "cmd":
      if (!isValidId(raw.id) || !isRecord(raw.action)) return null;
      if (raw.v !== undefined && (!Number.isSafeInteger(raw.v) || (raw.v as number) < 0)) return null;
      return { t: "cmd", id: raw.id, ...(raw.v !== undefined ? { v: raw.v as number } : {}), action: raw.action as OnlineAction };
    default:
      return null;
  }
}
