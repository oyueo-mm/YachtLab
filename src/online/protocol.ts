import { categories, type Card, type Category } from "../engine";

/**
 * YachtLab Online v0.1 — wire protocol shared by the authoritative server engine and future clients.
 *
 * Everything here is plain JSON (no classes, no functions, no RNG state) so it can be persisted
 * by any storage adapter and sent over any transport without leaking hidden engine internals.
 */

export const ONLINE_PROTOCOL_VERSION = 1 as const;
export const MIN_SEATS = 2;
export const MAX_SEATS = 8;
export const DICE_COUNT = 5;
export const MAX_ROLLS = 3;
export const RECENT_COMMAND_LIMIT = 256;

export type MatchStatus = "lobby" | "playing" | "finished";
export type PlayerStatus = "active" | "forfeited";
export type ForfeitReason = "resign" | "timeout";

export type OnlineAction =
  | { type: "join"; name: string }
  | { type: "leave" }
  | { type: "start" }
  | { type: "roll"; keep: number[] }
  | { type: "score"; category: Category }
  | { type: "resign" }
  | { type: "claimTimeout" };

/** One request from a client. `playerId` must be set by the authenticated transport, never trusted from the payload. */
export type CommandEnvelope = {
  commandId: string;
  playerId: string;
  /** Optimistic concurrency: reject when the client acted on an outdated view. */
  expectedVersion?: number;
  action: OnlineAction;
};

export type OnlinePlayer = {
  playerId: string;
  name: string;
  seat: number;
  status: PlayerStatus;
  card: Card;
};

export type Standing = {
  playerId: string;
  seat: number;
  points: number;
  rank: number;
  status: PlayerStatus;
};

type EventBase = { seq: number; at: number };
export type OnlineEvent = EventBase &
  (
    | { type: "matchCreated"; matchId: string; seats: number; turnTimeoutMs: number | null; protocol: number }
    | { type: "playerJoined"; playerId: string; name: string; seat: number }
    | { type: "playerLeft"; playerId: string }
    | { type: "matchStarted"; order: string[] }
    | { type: "turnStarted"; playerId: string; round: number; deadline: number | null }
    | { type: "diceRolled"; playerId: string; kept: number[]; dice: number[]; roll: number }
    | { type: "categoryScored"; playerId: string; category: Category; points: number; dice: number[] }
    | { type: "playerForfeited"; playerId: string; reason: ForfeitReason }
    | { type: "matchFinished"; standings: Standing[]; winners: string[] }
  );
export type OnlineEventType = OnlineEvent["type"];
/** Event payload before the engine stamps `seq`/`at`. */
export type PendingEvent = OnlineEvent extends infer E ? (E extends OnlineEvent ? Omit<E, "seq" | "at"> : never) : never;

export type TurnState = {
  playerId: string;
  round: number;
  rolls: number;
  /** Empty before the first roll of the turn. */
  dice: number[];
  deadline: number | null;
};

/** Complete authoritative state. Contains no RNG state: dice come from an injected source. */
export type OnlineMatchState = {
  protocol: typeof ONLINE_PROTOCOL_VERSION;
  matchId: string;
  seats: number;
  turnTimeoutMs: number | null;
  status: MatchStatus;
  version: number;
  players: OnlinePlayer[];
  turn: TurnState | null;
  standings: Standing[] | null;
  winners: string[];
  log: OnlineEvent[];
  /** Idempotency window of `${playerId}\u0000${commandId}` → version after it was applied. */
  recentCommands: { key: string; version: number }[];
};

export type OnlineErrorCode =
  | "INVALID_COMMAND"
  | "STALE_VERSION"
  | "NOT_IN_MATCH"
  | "ALREADY_JOINED"
  | "MATCH_FULL"
  | "WRONG_PHASE"
  | "NOT_HOST"
  | "NOT_ENOUGH_PLAYERS"
  | "NOT_YOUR_TURN"
  | "MUST_ROLL_FIRST"
  | "NO_ROLLS_LEFT"
  | "INVALID_KEEP"
  | "CATEGORY_TAKEN"
  | "TIMEOUT_NOT_REACHED"
  | "NO_DEADLINE";

export type OnlineError = { code: OnlineErrorCode; message: string };

export type CommandResult =
  | { ok: true; state: OnlineMatchState; events: OnlineEvent[]; duplicate: boolean }
  | { ok: false; error: OnlineError };

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const isControl = (ch: string) => {
  const code = ch.codePointAt(0)!;
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
};
export const isValidId = (value: unknown): value is string => typeof value === "string" && ID_PATTERN.test(value);

export function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFC").trim();
  if (!name || [...name].some(isControl) || [...name].length > 24) return null;
  return name;
}

const invalid = (message: string) => ({ ok: false as const, error: { code: "INVALID_COMMAND" as const, message } });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Validate an untrusted JSON command. The authenticated `playerId` is supplied separately
 * so a client can never act on behalf of another seat by editing its payload.
 */
export function parseCommand(
  raw: unknown,
  authenticatedPlayerId: string,
): { ok: true; command: CommandEnvelope } | { ok: false; error: OnlineError } {
  if (!isValidId(authenticatedPlayerId)) return invalid("잘못된 플레이어 식별자입니다.");
  if (!isRecord(raw)) return invalid("명령은 객체여야 합니다.");
  if (!isValidId(raw.commandId)) return invalid("잘못된 명령 식별자입니다.");
  if (raw.expectedVersion !== undefined && (!Number.isSafeInteger(raw.expectedVersion) || (raw.expectedVersion as number) < 0))
    return invalid("잘못된 상태 버전입니다.");
  const action = raw.action;
  if (!isRecord(action) || typeof action.type !== "string") return invalid("행동이 없습니다.");
  let parsed: OnlineAction;
  switch (action.type) {
    case "join": {
      const name = normalizeName(action.name);
      if (!name) return invalid("이름은 1~24자이며 제어 문자를 포함할 수 없습니다.");
      parsed = { type: "join", name };
      break;
    }
    case "roll": {
      const keep = action.keep ?? [];
      if (
        !Array.isArray(keep) ||
        keep.length > DICE_COUNT ||
        keep.some((i) => !Number.isInteger(i) || i < 0 || i >= DICE_COUNT) ||
        new Set(keep).size !== keep.length
      )
        return invalid("고정할 주사위 위치는 0~4의 서로 다른 정수여야 합니다.");
      parsed = { type: "roll", keep: [...(keep as number[])].sort((a, b) => a - b) };
      break;
    }
    case "score":
      if (typeof action.category !== "string" || !(categories as readonly string[]).includes(action.category))
        return invalid("알 수 없는 점수 칸입니다.");
      parsed = { type: "score", category: action.category as Category };
      break;
    case "leave":
    case "start":
    case "resign":
    case "claimTimeout":
      parsed = { type: action.type };
      break;
    default:
      return invalid("지원하지 않는 행동입니다.");
  }
  return {
    ok: true,
    command: {
      commandId: raw.commandId,
      playerId: authenticatedPlayerId,
      ...(raw.expectedVersion !== undefined ? { expectedVersion: raw.expectedVersion as number } : {}),
      action: parsed,
    },
  };
}
