import { available, bonus, categories, score, total, upper, type Category } from "../engine";
import type { DiceSource } from "./dice-source";
import {
  DICE_COUNT,
  MAX_ROLLS,
  MAX_SEATS,
  MIN_SEATS,
  ONLINE_PROTOCOL_VERSION,
  RECENT_COMMAND_LIMIT,
  isValidId,
  type CommandEnvelope,
  type CommandResult,
  type OnlineError,
  type OnlineErrorCode,
  type OnlineEvent,
  type OnlineMatchState,
  type OnlinePlayer,
  type PendingEvent,
  type Standing,
} from "./protocol";

/**
 * YachtLab Online v0.1 — authoritative match engine.
 *
 * - Pure and runtime-agnostic: no I/O, no timers, no global clock. The host passes `now` and a DiceSource.
 * - Event-sourced: commands are validated into events, and `applyEvent` is the only state mutation path,
 *   so `rebuildFromEvents(state.log)` reproduces the state exactly (used for persistence/reconnect/audit).
 * - Scoring reuses `score/total/upper/bonus` from ../engine so local play, AI research and online
 *   play share one rule implementation (12-category Nintendo-style Yacht Dice).
 */

export type CommandContext = { now: number; dice: DiceSource };
export type MatchOptions = { matchId: string; seats?: number; turnTimeoutMs?: number | null };

class Rejection extends Error {
  constructor(readonly code: OnlineErrorCode, message: string) {
    super(message);
  }
}
const reject = (code: OnlineErrorCode, message: string): never => {
  throw new Rejection(code, message);
};

export function createOnlineMatch(options: MatchOptions, now: number): OnlineMatchState {
  const seats = options.seats ?? 2;
  const turnTimeoutMs = options.turnTimeoutMs ?? null;
  if (!isValidId(options.matchId)) throw Error("잘못된 경기 식별자입니다.");
  if (!Number.isInteger(seats) || seats < MIN_SEATS || seats > MAX_SEATS)
    throw Error(`참가 인원은 ${MIN_SEATS}~${MAX_SEATS}명이어야 합니다.`);
  if (turnTimeoutMs !== null && (!Number.isSafeInteger(turnTimeoutMs) || turnTimeoutMs < 1000))
    throw Error("턴 제한 시간은 1000ms 이상의 정수여야 합니다.");
  if (!Number.isFinite(now)) throw Error("잘못된 시각입니다.");
  return applyEvent(emptyState(), {
    seq: 0,
    at: now,
    type: "matchCreated",
    matchId: options.matchId,
    seats,
    turnTimeoutMs,
    protocol: ONLINE_PROTOCOL_VERSION,
  });
}

function emptyState(): OnlineMatchState {
  return {
    protocol: ONLINE_PROTOCOL_VERSION,
    matchId: "",
    seats: 0,
    turnTimeoutMs: null,
    status: "lobby",
    version: 0,
    players: [],
    turn: null,
    standings: null,
    winners: [],
    log: [],
    recentCommands: [],
  };
}

/** The single reducer. Trusts its input: validation happens in `applyCommand`/`rebuildFromEvents`. */
export function applyEvent(state: OnlineMatchState, event: OnlineEvent): OnlineMatchState {
  const next: OnlineMatchState = { ...state, log: [...state.log, event] };
  next.version = next.log.length;
  switch (event.type) {
    case "matchCreated":
      next.matchId = event.matchId;
      next.seats = event.seats;
      next.turnTimeoutMs = event.turnTimeoutMs;
      break;
    case "playerJoined":
      // Join order is kept: players[0] is the host (earliest joiner still present). Turn order uses seats.
      next.players = [...state.players, { playerId: event.playerId, name: event.name, seat: event.seat, status: "active", card: {} }];
      break;
    case "playerLeft":
      next.players = state.players.filter((p) => p.playerId !== event.playerId);
      break;
    case "matchStarted":
      next.status = "playing";
      break;
    case "turnStarted":
      next.turn = { playerId: event.playerId, round: event.round, rolls: 0, dice: [], deadline: event.deadline };
      break;
    case "diceRolled":
      next.turn = { ...state.turn!, rolls: event.roll, dice: [...event.dice] };
      break;
    case "categoryScored":
      next.players = state.players.map((p) =>
        p.playerId === event.playerId ? { ...p, card: { ...p.card, [event.category]: event.points } } : p,
      );
      break;
    case "playerForfeited":
      next.players = state.players.map((p) => (p.playerId === event.playerId ? { ...p, status: "forfeited" } : p));
      break;
    case "matchFinished":
      next.status = "finished";
      next.turn = null;
      next.standings = event.standings.map((s) => ({ ...s }));
      next.winners = [...event.winners];
      break;
  }
  return next;
}

const commandKey = (c: CommandEnvelope) => `${c.playerId}\u0000${c.commandId}`;

/** Validate and apply one command. Never throws for client mistakes; returns a typed rejection instead. */
export function applyCommand(state: OnlineMatchState, command: CommandEnvelope, context: CommandContext): CommandResult {
  const key = commandKey(command);
  if (state.recentCommands.some((r) => r.key === key)) return { ok: true, state, events: [], duplicate: true };
  if (command.expectedVersion !== undefined && command.expectedVersion !== state.version)
    return failure("STALE_VERSION", `상태가 갱신되었습니다. (현재 ${state.version}, 요청 ${command.expectedVersion})`);
  if (!isValidId(command.playerId) || !isValidId(command.commandId)) return failure("INVALID_COMMAND", "잘못된 식별자입니다.");
  if (!Number.isFinite(context.now)) return failure("INVALID_COMMAND", "잘못된 시각입니다.");
  let draft = state;
  const emitted: OnlineEvent[] = [];
  const emit = (pending: PendingEvent) => {
    const event = { ...pending, seq: draft.log.length, at: context.now } as OnlineEvent;
    draft = applyEvent(draft, event);
    emitted.push(event);
    return draft;
  };
  try {
    decide(state, command, context, emit);
  } catch (error) {
    if (error instanceof Rejection) return failure(error.code, error.message);
    throw error;
  }
  if (!emitted.length) throw Error("명령이 이벤트를 만들지 않았습니다.");
  draft = {
    ...draft,
    recentCommands: [...state.recentCommands, { key, version: draft.version }].slice(-RECENT_COMMAND_LIMIT),
  };
  return { ok: true, state: draft, events: emitted, duplicate: false };
}

const failure = (code: OnlineErrorCode, message: string): { ok: false; error: OnlineError } => ({
  ok: false,
  error: { code, message },
});

function decide(
  state: OnlineMatchState,
  { playerId, action }: CommandEnvelope,
  { now, dice }: CommandContext,
  emit: (event: PendingEvent) => OnlineMatchState,
) {
  const me = state.players.find((p) => p.playerId === playerId);
  const requirePhase = (status: OnlineMatchState["status"]) => {
    if (state.status !== status) reject("WRONG_PHASE", phaseMessage(state.status));
  };
  const requireMember = () => me ?? reject("NOT_IN_MATCH", "이 경기의 참가자가 아닙니다.");
  const requireTurn = () => {
    requirePhase("playing");
    requireMember();
    if (state.turn?.playerId !== playerId) reject("NOT_YOUR_TURN", "현재 차례가 아닙니다.");
    return state.turn!;
  };
  switch (action.type) {
    case "join": {
      requirePhase("lobby");
      if (me) reject("ALREADY_JOINED", "이미 참가했습니다.");
      if (state.players.length >= state.seats) reject("MATCH_FULL", "빈 자리가 없습니다.");
      const used = new Set(state.players.map((p) => p.seat));
      const seat = Array.from({ length: state.seats }, (_, i) => i).find((i) => !used.has(i))!;
      emit({ type: "playerJoined", playerId, name: action.name, seat });
      return;
    }
    case "leave":
      requirePhase("lobby");
      requireMember();
      emit({ type: "playerLeft", playerId });
      return;
    case "start": {
      requirePhase("lobby");
      requireMember();
      if (state.players[0].playerId !== playerId) reject("NOT_HOST", "방장만 경기를 시작할 수 있습니다.");
      if (state.players.length < MIN_SEATS) reject("NOT_ENOUGH_PLAYERS", `최소 ${MIN_SEATS}명이 필요합니다.`);
      const order = [...state.players].sort((a, b) => a.seat - b.seat).map((p) => p.playerId);
      emit({ type: "matchStarted", order });
      emit(turnStart(state, order[0], now));
      return;
    }
    case "roll": {
      const turn = requireTurn();
      if (turn.rolls >= MAX_ROLLS) reject("NO_ROLLS_LEFT", "더 이상 굴릴 수 없습니다.");
      if (turn.rolls === 0 && action.keep.length) reject("INVALID_KEEP", "첫 굴림에서는 주사위를 고정할 수 없습니다.");
      // Defense in depth for callers that bypass parseCommand.
      const kept = new Set(action.keep);
      if (kept.size !== action.keep.length || action.keep.some((i) => !Number.isInteger(i) || i < 0 || i >= DICE_COUNT))
        reject("INVALID_KEEP", "고정할 주사위 위치가 올바르지 않습니다.");
      if (kept.size >= DICE_COUNT) reject("INVALID_KEEP", "다시 굴릴 주사위를 하나 이상 남겨야 합니다.");
      const values = Array.from({ length: DICE_COUNT }, (_, i) => (kept.has(i) ? turn.dice[i] : drawFace(dice)));
      emit({ type: "diceRolled", playerId, kept: [...kept].sort((a, b) => a - b), dice: values, roll: turn.rolls + 1 });
      return;
    }
    case "score": {
      const turn = requireTurn();
      if (!(categories as readonly string[]).includes(action.category)) reject("INVALID_COMMAND", "알 수 없는 점수 칸입니다.");
      if (!turn.rolls) reject("MUST_ROLL_FIRST", "먼저 주사위를 굴려주세요.");
      if (me!.card[action.category] !== undefined) reject("CATEGORY_TAKEN", "이미 기록한 점수 칸입니다.");
      const points = score(turn.dice, action.category);
      const after = emit({ type: "categoryScored", playerId, category: action.category, points, dice: [...turn.dice] });
      advance(after, playerId, now, emit);
      return;
    }
    case "resign": {
      requirePhase("playing");
      if (requireMember().status !== "active") reject("WRONG_PHASE", "이미 기권 처리되었습니다.");
      const after = emit({ type: "playerForfeited", playerId, reason: "resign" });
      if (state.turn?.playerId === playerId || activePlayers(after).length <= 1) advance(after, playerId, now, emit);
      return;
    }
    case "claimTimeout": {
      requirePhase("playing");
      requireMember();
      const turn = state.turn!;
      if (turn.deadline === null) reject("NO_DEADLINE", "이 경기에는 턴 제한 시간이 없습니다.");
      if (now < turn.deadline!) reject("TIMEOUT_NOT_REACHED", "아직 제한 시간이 남아 있습니다.");
      const after = emit({ type: "playerForfeited", playerId: turn.playerId, reason: "timeout" });
      advance(after, turn.playerId, now, emit);
      return;
    }
  }
}

function drawFace(dice: DiceSource): number {
  const face = dice.rollDie();
  if (!Number.isInteger(face) || face < 1 || face > 6) throw Error("주사위 공급원이 1~6 범위를 벗어났습니다.");
  return face;
}

const phaseMessage = (status: OnlineMatchState["status"]) =>
  status === "lobby" ? "아직 경기가 시작되지 않았습니다." : status === "playing" ? "이미 경기가 진행 중입니다." : "이미 종료된 경기입니다.";

const activePlayers = (state: OnlineMatchState) => state.players.filter((p) => p.status === "active");
const filled = (player: OnlinePlayer) => categories.length - available(player.card).length;

function turnStart(state: OnlineMatchState, playerId: string, now: number): PendingEvent {
  const player = state.players.find((p) => p.playerId === playerId)!;
  return {
    type: "turnStarted",
    playerId,
    round: filled(player) + 1,
    deadline: state.turnTimeoutMs === null ? null : now + state.turnTimeoutMs,
  };
}

/** After a score or forfeit: hand the turn to the next active seat, or finish the match. */
function advance(
  state: OnlineMatchState,
  fromPlayerId: string,
  now: number,
  emit: (event: PendingEvent) => OnlineMatchState,
) {
  const active = activePlayers(state);
  const pending = active.filter((p) => filled(p) < categories.length);
  if (active.length <= 1 || pending.length === 0) {
    const standings = computeStandings(state);
    const winners = standings.filter((s) => s.rank === 1 && s.status === "active").map((s) => s.playerId);
    emit({ type: "matchFinished", standings, winners });
    return;
  }
  const fromSeat = state.players.find((p) => p.playerId === fromPlayerId)!.seat;
  // Round-robin in seat order. Every active player has the same number of filled cells, or one more
  // than the players after the current seat, so the next pending seat preserves fair turn order.
  for (let offset = 1; offset <= state.seats; offset++) {
    const next = pending.find((p) => p.seat === (fromSeat + offset) % state.seats);
    if (next) return void emit(turnStart(state, next.playerId, now));
  }
  throw Error("다음 차례를 찾을 수 없습니다.");
}

/** Active players are ranked by points (ties share a rank); forfeited players always rank after them. */
export function computeStandings(state: OnlineMatchState): Standing[] {
  const rows = state.players
    .map((p) => ({ playerId: p.playerId, seat: p.seat, points: total(p.card), status: p.status, rank: 0 }))
    .sort((a, b) => Number(a.status !== "active") - Number(b.status !== "active") || b.points - a.points || a.seat - b.seat);
  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    row.rank = prev && prev.points === row.points && prev.status === row.status ? prev.rank : i + 1;
  });
  return rows;
}

/** Rebuild and audit a match from its persisted event log. Throws if the log is inconsistent or tampered. */
export function rebuildFromEvents(events: OnlineEvent[]): OnlineMatchState {
  if (!events.length || events[0].type !== "matchCreated") throw Error("이벤트 로그는 matchCreated로 시작해야 합니다.");
  let state = emptyState();
  for (const [i, event] of events.entries()) {
    if (event.seq !== i) throw Error(`이벤트 순서가 올바르지 않습니다. (${i})`);
    if (i > 0 && event.type === "matchCreated") throw Error("matchCreated가 중복되었습니다.");
    if (event.type === "diceRolled" && (event.dice.length !== DICE_COUNT || event.dice.some((v) => !Number.isInteger(v) || v < 1 || v > 6)))
      throw Error(`잘못된 주사위 값입니다. (${i})`);
    if (event.type === "diceRolled" && state.turn) {
      const previous = state.turn.dice;
      if (event.kept.some((k) => previous[k] !== event.dice[k])) throw Error(`고정한 주사위가 바뀌었습니다. (${i})`);
    }
    if (event.type === "categoryScored") {
      if (state.turn?.playerId !== event.playerId || state.turn.dice.join() !== event.dice.join())
        throw Error(`기록 주사위가 현재 턴과 다릅니다. (${i})`);
      if (score(event.dice, event.category) !== event.points) throw Error(`점수 계산이 규칙과 다릅니다. (${i})`);
    }
    state = applyEvent(state, event);
  }
  return state;
}

/* ------------------------------------------------------------------ views ------------------------------------------------------------------ */

export type ScoreOption = { category: Category; points: number };
export type PlayerView = {
  protocol: typeof ONLINE_PROTOCOL_VERSION;
  matchId: string;
  version: number;
  status: OnlineMatchState["status"];
  seats: number;
  turnTimeoutMs: number | null;
  you: { playerId: string; seat: number; isHost: boolean } | null;
  players: {
    playerId: string;
    name: string;
    seat: number;
    status: OnlinePlayer["status"];
    card: OnlinePlayer["card"];
    upper: number;
    bonus: number;
    total: number;
  }[];
  turn: (OnlineMatchState["turn"] & { remainingMs: number | null }) | null;
  /** Only present for the player whose turn it is. Points are computed by the server. */
  legal: { canRoll: boolean; canKeep: boolean; rollsLeft: number; scores: ScoreOption[] } | null;
  standings: Standing[] | null;
  winners: string[];
  events: OnlineEvent[];
};

/**
 * Public projection for one viewer (or a spectator with `viewerId = null`).
 * Excludes the idempotency window and any server-only bookkeeping; the engine holds no RNG state at all.
 */
export function viewFor(state: OnlineMatchState, viewerId: string | null, now?: number, sinceSeq = state.log.length): PlayerView {
  const me = viewerId ? state.players.find((p) => p.playerId === viewerId) : undefined;
  const turn = state.turn;
  const myTurn = !!me && state.status === "playing" && turn?.playerId === me.playerId;
  return {
    protocol: state.protocol,
    matchId: state.matchId,
    version: state.version,
    status: state.status,
    seats: state.seats,
    turnTimeoutMs: state.turnTimeoutMs,
    you: me ? { playerId: me.playerId, seat: me.seat, isHost: state.players[0]?.playerId === me.playerId } : null,
    players: [...state.players].sort((a, b) => a.seat - b.seat).map((p) => ({
      playerId: p.playerId,
      name: p.name,
      seat: p.seat,
      status: p.status,
      card: { ...p.card },
      upper: upper(p.card),
      bonus: bonus(p.card),
      total: total(p.card),
    })),
    turn: turn
      ? {
          ...turn,
          dice: [...turn.dice],
          remainingMs: turn.deadline === null || now === undefined ? null : Math.max(0, turn.deadline - now),
        }
      : null,
    legal:
      myTurn && turn
        ? {
            canRoll: turn.rolls < MAX_ROLLS,
            canKeep: turn.rolls > 0 && turn.rolls < MAX_ROLLS,
            rollsLeft: MAX_ROLLS - turn.rolls,
            scores: turn.rolls ? available(me!.card).map((category) => ({ category, points: score(turn.dice, category) })) : [],
          }
        : null,
    standings: state.standings ? state.standings.map((s) => ({ ...s })) : null,
    winners: [...state.winners],
    events: state.log.slice(Math.max(0, Math.min(sinceSeq, state.log.length))),
  };
}
