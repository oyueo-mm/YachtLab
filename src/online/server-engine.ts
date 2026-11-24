import { available, bonus, categories, score, total, upper, type Category } from "../engine";
import type { DiceSource } from "./dice-source";
import {
  DICE_COUNT,
  MAX_MISSED_ROUNDS,
  MAX_ROLLS,
  MAX_SEATS,
  MIN_SEATS,
  ONLINE_PROTOCOL_VERSION,
  isRecord,
  isValidId,
  parseCommand,
  type CommandEnvelope,
  type CommandResult,
  type MatchMode,
  type TurnState,
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
 *   so `rebuildFromEvents(state.log)` reproduces the state exactly, including the idempotency keys
 *   (used for persistence/restart/reconnect) after auditing the log by re-execution.
 * - Scoring reuses `score/total/upper/bonus` from ../engine so local play, AI research and online
 *   play share one rule implementation (12-category Nintendo-style Yacht Dice).
 */

export type CommandContext = { now: number; dice: DiceSource };
export type MatchOptions = { matchId: string; seats?: number; turnTimeoutMs?: number | null; mode?: MatchMode };

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
  if (options.mode !== undefined && options.mode !== "turns" && options.mode !== "simultaneous") throw Error("알 수 없는 진행 방식입니다.");
  return applyEvent(emptyState(), {
    seq: 0,
    at: now,
    type: "matchCreated",
    matchId: options.matchId,
    seats,
    turnTimeoutMs,
    protocol: ONLINE_PROTOCOL_VERSION,
    // Only written for the new mode, so logs of turn-by-turn matches stay byte-identical.
    ...(options.mode === "simultaneous" ? { mode: "simultaneous" as const } : {}),
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
    processedCommands: [],
  };
}

/** The single reducer. Trusts its input: validation happens in `applyCommand`/`rebuildFromEvents`. */
export function applyEvent(state: OnlineMatchState, event: OnlineEvent): OnlineMatchState {
  const next: OnlineMatchState = { ...state, log: [...state.log, event] };
  next.version = next.log.length;
  if (event.by) next.processedCommands = [...state.processedCommands, refKey(event.by.playerId, event.by.commandId)];
  switch (event.type) {
    case "matchCreated":
      next.matchId = event.matchId;
      next.seats = event.seats;
      next.turnTimeoutMs = event.turnTimeoutMs;
      if (event.mode === "simultaneous") {
        next.mode = "simultaneous";
        next.turns = {};
        next.missed = {};
      }
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
      if (state.mode === "simultaneous") next.turns = { ...state.turns, [event.playerId]: { ...state.turns![event.playerId], rolls: event.roll, dice: [...event.dice] } };
      else next.turn = { ...state.turn!, rolls: event.roll, dice: [...event.dice] };
      break;
    case "categoryScored":
      next.players = state.players.map((p) =>
        p.playerId === event.playerId ? { ...p, card: { ...p.card, [event.category]: event.points } } : p,
      );
      if (state.mode === "simultaneous") {
        const { [event.playerId]: _done, ...rest } = state.turns!;
        next.turns = rest;
        // Scoring yourself resets the missed-deadline count; an automatic record adds to it.
        next.missed = { ...state.missed, [event.playerId]: event.auto ? (state.missed?.[event.playerId] ?? 0) + 1 : 0 };
      }
      break;
    case "roundStarted": {
      next.round = event.round;
      next.roundDeadline = event.deadline;
      const turns: Record<string, TurnState> = {};
      for (const p of state.players) if (p.status === "active") turns[p.playerId] = { playerId: p.playerId, round: event.round, rolls: 0, dice: [], deadline: event.deadline };
      next.turns = turns;
      break;
    }
    case "roundTimedOut":
      break;
    case "playerForfeited":
      next.players = state.players.map((p) => (p.playerId === event.playerId ? { ...p, status: "forfeited" } : p));
      if (state.mode === "simultaneous") {
        const { [event.playerId]: _gone, ...rest } = state.turns!;
        next.turns = rest;
      }
      break;
    case "matchFinished":
      next.status = "finished";
      next.turn = null;
      if (state.mode === "simultaneous") {
        next.turns = {};
        next.roundDeadline = null;
      }
      next.standings = event.standings.map((s) => ({ ...s }));
      next.winners = [...event.winners];
      break;
  }
  return next;
}

const refKey = (playerId: string, commandId: string) => `${playerId}\u0000${commandId}`;

/** Validate and apply one command. Never throws for client mistakes; returns a typed rejection instead. */
export function applyCommand(state: OnlineMatchState, command: CommandEnvelope, context: CommandContext): CommandResult {
  // Checked before the version so a retry of an applied command is acknowledged, not rejected as stale.
  if (state.processedCommands.includes(refKey(command.playerId, command.commandId)))
    return { ok: true, state, events: [], duplicate: true };
  if (command.expectedVersion !== undefined && command.expectedVersion !== state.version)
    return failure("STALE_VERSION", `상태가 갱신되었습니다. (현재 ${state.version}, 요청 ${command.expectedVersion})`);
  if (!isValidId(command.playerId) || !isValidId(command.commandId)) return failure("INVALID_COMMAND", "잘못된 식별자입니다.");
  if (!Number.isFinite(context.now)) return failure("INVALID_COMMAND", "잘못된 시각입니다.");
  // Event time never goes backwards, even if the host clock does; the log audit relies on this.
  const now = Math.max(context.now, state.log.at(-1)?.at ?? -Infinity);
  let draft = state;
  const emitted: OnlineEvent[] = [];
  const emit = (pending: PendingEvent) => {
    const stamp = { seq: draft.log.length, at: now };
    // The first event of each group records who issued the command (idempotency + audit replay).
    const event = (
      emitted.length ? { ...pending, ...stamp } : { ...pending, ...stamp, by: { playerId: command.playerId, commandId: command.commandId } }
    ) as OnlineEvent;
    draft = applyEvent(draft, event);
    emitted.push(event);
    return draft;
  };
  try {
    decide(state, command, { now, dice: context.dice }, emit);
  } catch (error) {
    if (error instanceof Rejection) return failure(error.code, error.message);
    throw error;
  }
  if (!emitted.length) throw Error("명령이 이벤트를 만들지 않았습니다.");
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
  const simultaneous = state.mode === "simultaneous";
  const requireTurn = (): TurnState => {
    requirePhase("playing");
    requireMember();
    if (simultaneous) {
      const mine = state.turns?.[playerId];
      if (!mine) reject("NOT_YOUR_TURN", me!.status === "active" ? "이번 라운드는 이미 기록했어요. 다른 사람을 기다리는 중이에요." : "기권한 참가자입니다.");
      return mine!;
    }
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
      if (simultaneous && state.turnTimeoutMs === null) reject("INVALID_COMMAND", "동시 진행에는 라운드 제한 시간이 필요합니다.");
      const order = [...state.players].sort((a, b) => a.seat - b.seat).map((p) => p.playerId);
      emit({ type: "matchStarted", order });
      if (simultaneous) emit(roundStart(state, 1, now));
      else emit(turnStart(state, order[0], now));
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
      if (simultaneous) advanceRound(after, now, emit);
      else advance(after, playerId, now, emit);
      return;
    }
    case "resign": {
      requirePhase("playing");
      if (requireMember().status !== "active") reject("WRONG_PHASE", "이미 기권 처리되었습니다.");
      const after = emit({ type: "playerForfeited", playerId, reason: "resign" });
      if (simultaneous) advanceRound(after, now, emit);
      else if (state.turn?.playerId === playerId || activePlayers(after).length <= 1) advance(after, playerId, now, emit);
      return;
    }
    case "claimTimeout": {
      requirePhase("playing");
      requireMember();
      if (simultaneous) {
        if (state.roundDeadline === null || state.roundDeadline === undefined) reject("NO_DEADLINE", "이 경기에는 라운드 제한 시간이 없습니다.");
        if (now < state.roundDeadline!) reject("TIMEOUT_NOT_REACHED", "아직 제한 시간이 남아 있습니다.");
        const late = Object.keys(state.turns ?? {}).sort((a, b) => seatOf(state, a) - seatOf(state, b));
        if (!late.length) reject("INVALID_COMMAND", "기다리는 참가자가 없습니다.");
        let draft = emit({ type: "roundTimedOut", round: state.round!, players: late });
        // Everyone who had not scored is recorded by the server: one roll if they had not rolled,
        // then the open category worth the most points now (ties: the first in category order).
        for (const id of late) {
          let turn = draft.turns![id];
          if (turn.rolls === 0) {
            const values = Array.from({ length: DICE_COUNT }, () => drawFace(dice));
            draft = emit({ type: "diceRolled", playerId: id, kept: [], dice: values, roll: 1 });
            turn = draft.turns![id];
          }
          const card = draft.players.find((p) => p.playerId === id)!.card;
          const best = available(card).reduce((b, c) => (score(turn.dice, c) > score(turn.dice, b) ? c : b), available(card)[0]);
          draft = emit({ type: "categoryScored", playerId: id, category: best, points: score(turn.dice, best), dice: [...turn.dice], auto: true });
          if ((draft.missed?.[id] ?? 0) >= MAX_MISSED_ROUNDS) draft = emit({ type: "playerForfeited", playerId: id, reason: "timeout" });
        }
        advanceRound(draft, now, emit);
        return;
      }
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

const seatOf = (state: OnlineMatchState, id: string) => state.players.find((p) => p.playerId === id)?.seat ?? 0;

function roundStart(state: OnlineMatchState, round: number, now: number): PendingEvent {
  return { type: "roundStarted", round, deadline: state.turnTimeoutMs === null ? null : now + state.turnTimeoutMs };
}

/** Simultaneous mode: when every active player has scored this round, start the next one or finish. */
function advanceRound(state: OnlineMatchState, now: number, emit: (event: PendingEvent) => OnlineMatchState) {
  const active = activePlayers(state);
  if (active.length <= 1 || active.every((p) => filled(p) >= categories.length)) {
    const standings = computeStandings(state);
    const winners = standings.filter((s) => s.rank === 1 && s.status === "active").map((s) => s.playerId);
    emit({ type: "matchFinished", standings, winners });
    return;
  }
  if (Object.keys(state.turns ?? {}).length) return; // others are still playing this round
  emit(roundStart(state, (state.round ?? 0) + 1, now));
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

/* ---------------------------------------------------------------- log audit ---------------------------------------------------------------- */

export class LogIntegrityError extends Error {
  constructor(readonly index: number, readonly reason: string) {
    super(`이벤트 로그 검증 실패 (#${index}): ${reason}`);
    this.name = "LogIntegrityError";
  }
}
export type LogAudit = { ok: true; state: OnlineMatchState } | { ok: false; index: number; reason: string };

/** Structural equality for JSON values; keys whose value is `undefined` count as absent. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b))
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameJson(v, b[i]));
  if (!isRecord(a) || !isRecord(b)) return false;
  const ka = Object.keys(a).filter((k) => a[k] !== undefined).sort();
  const kb = Object.keys(b).filter((k) => b[k] !== undefined).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && sameJson(a[k], b[k]));
}

/** Map the first event of a group back to the client action that must have produced it. */
function actionFromEvent(event: Record<string, unknown>): unknown {
  switch (event.type) {
    case "playerJoined":
      return { type: "join", name: event.name };
    case "playerLeft":
      return { type: "leave" };
    case "matchStarted":
      return { type: "start" };
    case "diceRolled":
      return { type: "roll", keep: event.kept };
    case "categoryScored":
      return { type: "score", category: event.category };
    case "playerForfeited":
      return { type: event.reason === "timeout" ? "claimTimeout" : "resign" };
    case "roundTimedOut":
      return { type: "claimTimeout" };
    default:
      return null;
  }
}

/**
 * Replays exactly the logged faces for the re-rolled positions, in the order the engine draws them —
 * over every diceRolled event of the command group (a simultaneous-round timeout rolls for each
 * player who had not rolled; every other group has at most one roll, its first event).
 */
function loggedDice(group: unknown[]) {
  const faces: unknown[] = [];
  for (const raw of group) {
    if (!isRecord(raw) || raw.type !== "diceRolled" || !Array.isArray(raw.dice)) continue;
    const kept = Array.isArray(raw.kept) ? raw.kept : [];
    faces.push(...raw.dice.filter((_, i) => !kept.includes(i)));
  }
  let used = 0;
  const source: DiceSource = {
    rollDie() {
      if (used >= faces.length) throw new Error("로그에 기록된 것보다 많은 주사위가 필요합니다.");
      return faces[used++] as number;
    },
  };
  return { source, exhausted: () => used === faces.length };
}

/**
 * Audit an untrusted event log by **re-executing it through the engine**.
 *
 * The log is split into command groups (each starts with an event carrying `by`). For every group the
 * original command is reconstructed, run through `parseCommand` + `applyCommand` against the state rebuilt
 * so far, with the logged faces as the dice source and the logged time as `now`, and the produced events
 * must equal the logged group exactly. Therefore every accepted log is one the engine itself could have
 * written: all rule, turn-order, scoring, timing, attribution and derived-event (turn/standings/winner)
 * checks are the engine's own, with no second rule implementation to drift.
 *
 * NOT detectable here (see docs/online/ONLINE-V01-PHASE1.md): fabricated but legal dice values, a log
 * truncated at a command boundary, a wholly rewritten but legal history, forged `by` attribution, or
 * fabricated timestamps that remain monotonic and consistent with deadlines. Those need authenticity
 * mechanisms (keyed hash chain, external anchoring, signed commands, verifiable dice) — not rule checks.
 */
export function auditEventLog(events: unknown): LogAudit {
  const fail = (index: number, reason: string): LogAudit => ({ ok: false, index, reason });
  if (!Array.isArray(events) || !events.length) return fail(0, "로그가 비어 있거나 배열이 아닙니다.");
  const head = events[0];
  if (!isRecord(head) || head.type !== "matchCreated") return fail(0, "로그는 matchCreated로 시작해야 합니다.");
  if (head.protocol !== ONLINE_PROTOCOL_VERSION) return fail(0, "지원하지 않는 프로토콜 버전입니다.");
  let state: OnlineMatchState;
  try {
    state = createOnlineMatch(
      { matchId: head.matchId as string, seats: head.seats as number, turnTimeoutMs: head.turnTimeoutMs as number | null, ...(head.mode === "simultaneous" ? { mode: "simultaneous" as const } : {}) },
      head.at as number,
    );
  } catch (error) {
    return fail(0, error instanceof Error ? error.message : String(error));
  }
  if (!sameJson(state.log[0], head)) return fail(0, "matchCreated 이벤트 형식이 엔진 출력과 다릅니다.");

  for (let start = 1; start < events.length; ) {
    const first = events[start];
    if (!isRecord(first) || !isRecord(first.by)) return fail(start, "명령 출처(by)가 없는 이벤트로 명령 그룹이 시작됩니다.");
    let end = start + 1;
    while (end < events.length && !(isRecord(events[end]) && "by" in (events[end] as object))) end++;
    const group = events.slice(start, end);
    const action = actionFromEvent(first);
    if (!action) return fail(start, `명령으로 시작할 수 없는 이벤트 유형입니다: ${String(first.type)}`);
    const parsed = parseCommand({ commandId: first.by.commandId, action }, first.by.playerId as string);
    if (!parsed.ok) return fail(start, `명령을 복원할 수 없습니다: ${parsed.error.message}`);
    const dice = loggedDice(group);
    let result: CommandResult;
    try {
      result = applyCommand(state, parsed.command, { now: first.at as number, dice: dice.source });
    } catch (error) {
      return fail(start, error instanceof Error ? error.message : String(error));
    }
    if (!result.ok) return fail(start, `규칙상 불가능한 명령입니다 (${result.error.code}): ${result.error.message}`);
    if (result.duplicate) return fail(start, "이미 처리된 명령 식별자가 다시 기록되었습니다.");
    for (let k = 0; k < Math.max(group.length, result.events.length); k++)
      if (!sameJson(result.events[k], group[k]))
        return fail(
          start + k,
          k >= group.length ? "엔진이 만들어야 할 후속 이벤트가 누락되었습니다." : k >= result.events.length ? "명령으로 설명되지 않는 추가 이벤트입니다." : `엔진 출력과 다른 ${String((group[k] as { type?: unknown })?.type)} 이벤트입니다.`,
        );
    if (!dice.exhausted()) return fail(start, "기록된 주사위 수가 실제 재굴림 수와 다릅니다.");
    state = result.state;
    start = end;
  }
  return { ok: true, state };
}

/** Rebuild a match (including its idempotency keys) from a persisted log. Throws `LogIntegrityError` if the audit fails. */
export function rebuildFromEvents(events: unknown): OnlineMatchState {
  const audit = auditEventLog(events);
  if (!audit.ok) throw new LogIntegrityError(audit.index, audit.reason);
  return audit.state;
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
  mode: MatchMode;
  /** Current round (1..12). */
  round: number;
  /** Simultaneous mode: time left in the round. */
  roundRemainingMs: number | null;
  /** Simultaneous mode: players still playing this round → rolls used. */
  progress: Record<string, { rolls: number }> | null;
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
 * Excludes the idempotency keys and other players' commandIds; the engine holds no RNG state at all.
 */
export function viewFor(state: OnlineMatchState, viewerId: string | null, now?: number, sinceSeq = state.log.length): PlayerView {
  const me = viewerId ? state.players.find((p) => p.playerId === viewerId) : undefined;
  const simultaneous = state.mode === "simultaneous";
  // Simultaneous mode: the viewer's own turn (null after they scored this round, and for spectators).
  const turn = simultaneous ? (viewerId ? (state.turns?.[viewerId] ?? null) : null) : state.turn;
  const myTurn = !!me && state.status === "playing" && !!turn && turn.playerId === me.playerId;
  return {
    protocol: state.protocol,
    matchId: state.matchId,
    version: state.version,
    status: state.status,
    seats: state.seats,
    turnTimeoutMs: state.turnTimeoutMs,
    mode: simultaneous ? "simultaneous" : "turns",
    round: simultaneous ? (state.round ?? 0) : (state.turn?.round ?? 0),
    roundRemainingMs: simultaneous && state.roundDeadline != null && now !== undefined ? Math.max(0, state.roundDeadline - now) : null,
    // Who is still playing this round and how far (simultaneous). Rolled dice of others stay private
    // to keep the message small; scores are public in the cards.
    progress: simultaneous ? Object.fromEntries(Object.entries(state.turns ?? {}).map(([id, t]) => [id, { rolls: t.rolls }])) : null,
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
    // A viewer sees `by` only on its own commands (to confirm pending commandIds); others' ids are not exposed.
    events: state.log.slice(Math.max(0, Math.min(sinceSeq, state.log.length))).map((event) => {
      if (!event.by || event.by.playerId === viewerId) return event;
      const { by: _by, ...rest } = event;
      return rest as OnlineEvent;
    }),
  };
}
