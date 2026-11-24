import { describe, expect, it } from "vitest";
import { available, categories, score, total } from "../src/engine";
import {
  LogIntegrityError,
  OnlineMatchHost,
  applyCommand,
  auditEventLog,
  createOnlineMatch,
  cryptoDiceSource,
  parseCommand,
  rebuildFromEvents,
  scriptedDiceSource,
  seededDiceSource,
  viewFor,
  type CommandEnvelope,
  type DiceSource,
  type OnlineAction,
  type OnlineMatchState,
} from "../src/online";

let counter = 0;
const cmd = (playerId: string, action: OnlineAction, extra: Partial<CommandEnvelope> = {}): CommandEnvelope => ({
  commandId: `c${++counter}`,
  playerId,
  action,
  ...extra,
});

function run(state: OnlineMatchState, command: CommandEnvelope, dice: DiceSource, now = 1000) {
  const result = applyCommand(state, command, { now, dice });
  if (!result.ok) throw Error(`${result.error.code}: ${result.error.message}`);
  return result.state;
}
function expectError(state: OnlineMatchState, command: CommandEnvelope, code: string, dice: DiceSource = seededDiceSource(1), now = 1000) {
  const result = applyCommand(state, command, { now, dice });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
}

function lobby(ids: string[], dice: DiceSource, options: { seats?: number; turnTimeoutMs?: number | null } = {}) {
  let state = createOnlineMatch({ matchId: "m1", seats: options.seats ?? ids.length, turnTimeoutMs: options.turnTimeoutMs ?? null }, 0);
  for (const id of ids) state = run(state, cmd(id, { type: "join", name: id.toUpperCase() }), dice, 0);
  return state;
}

/** Plays a random but legal turn for whoever is to move. */
function playTurn(state: OnlineMatchState, dice: DiceSource, pick: () => number, now = 1000) {
  const id = state.turn!.playerId;
  state = run(state, cmd(id, { type: "roll", keep: [] }), dice, now);
  while (state.turn!.rolls < 3 && pick() < 0.6) {
    const keep = [0, 1, 2, 3, 4].filter(() => pick() < 0.5).slice(0, 4);
    state = run(state, cmd(id, { type: "roll", keep }), dice, now);
  }
  const me = state.players.find((p) => p.playerId === id)!;
  const open = available(me.card);
  return run(state, cmd(id, { type: "score", category: open[Math.floor(pick() * open.length)] }), dice, now);
}
const without = (state: OnlineMatchState) => state; // rebuild now restores the full state, idempotency keys included

describe("YachtLab Online v0.1 authoritative engine", () => {
  it("plays a complete 2-player match and the event log rebuilds the exact state", () => {
    const dice = seededDiceSource(12345);
    const rng = seededDiceSource(999);
    const pick = () => (rng.rollDie() - 1) / 6;
    let state = lobby(["alice", "bob"], dice);
    state = run(state, cmd("alice", { type: "start" }), dice);
    expect(state.status).toBe("playing");
    expect(state.turn).toMatchObject({ playerId: "alice", round: 1, rolls: 0 });
    let turns = 0;
    while (state.status === "playing") {
      state = playTurn(state, dice, pick);
      turns++;
    }
    expect(turns).toBe(24);
    for (const p of state.players) expect(available(p.card)).toEqual([]);
    const [a, b] = state.players.map((p) => total(p.card));
    expect(state.standings!.map((s) => s.points).sort((x, y) => y - x)).toEqual([a, b].sort((x, y) => y - x));
    expect(state.winners).toEqual(a === b ? ["alice", "bob"] : a > b ? ["alice"] : ["bob"]);
    expect(state.version).toBe(state.log.length);
    expect(state.log.every((e, i) => e.seq === i)).toBe(true);
    expect(without(rebuildFromEvents(state.log))).toEqual(without(state));
    // Persisted JSON snapshot is complete and continues to validate.
    expect(without(rebuildFromEvents(JSON.parse(JSON.stringify(state)).log))).toEqual(without(state));
  });

  it("alternates turns in seat order and reports the round per player", () => {
    const dice = seededDiceSource(7);
    let state = lobby(["a", "b", "c"], dice);
    state = run(state, cmd("a", { type: "start" }), dice);
    const order: string[] = [];
    const rng = seededDiceSource(3);
    for (let i = 0; i < 7; i++) {
      order.push(`${state.turn!.playerId}${state.turn!.round}`);
      state = playTurn(state, dice, () => (rng.rollDie() - 1) / 6);
    }
    expect(order).toEqual(["a1", "b1", "c1", "a2", "b2", "c2", "a3"]);
  });

  it("keeps held dice, rerolls the rest and scores with the shared engine rules", () => {
    const dice = scriptedDiceSource([6, 6, 2, 6, 3, /* reroll idx 2,4 */ 6, 6]);
    let state = lobby(["a", "b"], dice);
    state = run(state, cmd("a", { type: "start" }), dice);
    state = run(state, cmd("a", { type: "roll", keep: [] }), dice);
    expect(state.turn!.dice).toEqual([6, 6, 2, 6, 3]);
    state = run(state, cmd("a", { type: "roll", keep: [3, 0, 1] }), dice);
    expect(state.turn!.dice).toEqual([6, 6, 6, 6, 6]);
    expect(state.log.at(-1)).toMatchObject({ type: "diceRolled", kept: [0, 1, 3], roll: 2 });
    state = run(state, cmd("a", { type: "score", category: "yacht" }), dice);
    expect(state.players[0].card.yacht).toBe(50);
    expect(state.turn).toMatchObject({ playerId: "b", rolls: 0, dice: [] });
  });

  it("rejects illegal commands with typed errors and without changing state", () => {
    const dice = seededDiceSource(5);
    let state = lobby(["a", "b"], dice, { seats: 3 });
    expectError(state, cmd("a", { type: "join", name: "A" }), "ALREADY_JOINED");
    expectError(state, cmd("b", { type: "start" }), "NOT_HOST");
    expectError(state, cmd("a", { type: "roll", keep: [] }), "WRONG_PHASE");
    expectError(state, cmd("z", { type: "leave" }), "NOT_IN_MATCH");
    const solo = lobby(["a"], dice, { seats: 2 });
    expectError(solo, cmd("a", { type: "start" }), "NOT_ENOUGH_PLAYERS");
    state = run(state, cmd("a", { type: "start" }), dice);
    expectError(state, cmd("c", { type: "join", name: "C" }), "WRONG_PHASE");
    expectError(state, cmd("b", { type: "roll", keep: [] }), "NOT_YOUR_TURN");
    expectError(state, cmd("z", { type: "roll", keep: [] }), "NOT_IN_MATCH");
    expectError(state, cmd("a", { type: "score", category: "choice" }), "MUST_ROLL_FIRST");
    expectError(state, cmd("a", { type: "roll", keep: [1] }), "INVALID_KEEP");
    expectError(state, cmd("a", { type: "leave" }), "WRONG_PHASE");
    expectError(state, cmd("a", { type: "claimTimeout" }), "NO_DEADLINE");
    state = run(state, cmd("a", { type: "roll", keep: [] }), dice);
    expectError(state, cmd("a", { type: "roll", keep: [0, 1, 2, 3, 4] }), "INVALID_KEEP");
    expectError(state, cmd("a", { type: "roll", keep: [0, 0] }), "INVALID_KEEP");
    expectError(state, cmd("a", { type: "roll", keep: [7] }), "INVALID_KEEP");
    expectError(state, cmd("a", { type: "score", category: "chance" as never }), "INVALID_COMMAND");
    state = run(state, cmd("a", { type: "roll", keep: [] }), dice);
    state = run(state, cmd("a", { type: "roll", keep: [] }), dice);
    expectError(state, cmd("a", { type: "roll", keep: [] }), "NO_ROLLS_LEFT");
    expectError(state, cmd("a", { type: "score", category: "choice" }, { expectedVersion: state.version - 1 }), "STALE_VERSION");
    state = run(state, cmd("a", { type: "score", category: "choice" }, { expectedVersion: state.version }), dice);
    // a's turn comes back after b; choice is now taken.
    state = run(state, cmd("b", { type: "roll", keep: [] }), dice);
    state = run(state, cmd("b", { type: "score", category: "choice" }), dice);
    state = run(state, cmd("a", { type: "roll", keep: [] }), dice);
    const before = state;
    expectError(state, cmd("a", { type: "score", category: "choice" }), "CATEGORY_TAKEN");
    expect(state).toBe(before);
  });

  it("is idempotent per (player, commandId) and never consumes dice for a duplicate", () => {
    let rolls = 0;
    const base = seededDiceSource(1);
    const dice: DiceSource = { rollDie: () => (rolls++, base.rollDie()) };
    let state = lobby(["a", "b"], dice);
    state = run(state, cmd("a", { type: "start" }), dice);
    const roll = cmd("a", { type: "roll", keep: [] });
    const first = applyCommand(state, roll, { now: 1, dice });
    expect(first.ok && !first.duplicate).toBe(true);
    if (!first.ok) return;
    const again = applyCommand(first.state, roll, { now: 2, dice });
    expect(again).toMatchObject({ ok: true, duplicate: true, events: [] });
    if (again.ok) expect(again.state).toBe(first.state);
    expect(rolls).toBe(5);
    // Same commandId from a different player is a different command.
    expectError(first.state, { ...roll, playerId: "b" }, "NOT_YOUR_TURN");
  });

  it("handles resignation and turn timeouts, ranking forfeited players last", () => {
    const dice = seededDiceSource(77);
    const rng = seededDiceSource(78);
    const pick = () => (rng.rollDie() - 1) / 6;
    let state = lobby(["a", "b", "c", "d"], dice, { turnTimeoutMs: 30_000 });
    state = run(state, cmd("a", { type: "start" }), dice, 0);
    expect(state.turn!.deadline).toBe(30_000);
    state = playTurn(state, dice, pick, 10); // a
    expect(state.turn).toMatchObject({ playerId: "b", deadline: 30_010 });
    expectError(state, cmd("c", { type: "claimTimeout" }), "TIMEOUT_NOT_REACHED", dice, 30_009);
    state = run(state, cmd("c", { type: "claimTimeout" }), dice, 30_010);
    expect(state.players.find((p) => p.playerId === "b")!.status).toBe("forfeited");
    expect(state.turn!.playerId).toBe("c");
    // d resigns while it is c's turn: c keeps the turn, d is skipped afterwards.
    state = run(state, cmd("d", { type: "resign" }), dice, 30_020);
    expect(state.turn!.playerId).toBe("c");
    expectError(state, cmd("d", { type: "resign" }), "WRONG_PHASE");
    expectError(state, cmd("b", { type: "roll", keep: [] }), "NOT_YOUR_TURN");
    state = playTurn(state, dice, pick, 30_030); // c
    expect(state.turn!.playerId).toBe("a");
    while (state.status === "playing") state = playTurn(state, dice, pick, 40_000);
    const ranking = state.standings!.map((s) => s.playerId);
    expect(ranking.slice(2).sort()).toEqual(["b", "d"]);
    expect(state.standings!.slice(0, 2).every((s) => s.status === "active")).toBe(true);
    expect(state.winners.every((w) => ["a", "c"].includes(w))).toBe(true);
    expect(without(rebuildFromEvents(state.log))).toEqual(without(state));
  });

  it("ends the match when only one active player remains", () => {
    const dice = seededDiceSource(9);
    let state = lobby(["a", "b"], dice);
    state = run(state, cmd("a", { type: "start" }), dice);
    state = run(state, cmd("b", { type: "resign" }), dice);
    expect(state.status).toBe("finished");
    expect(state.winners).toEqual(["a"]);
    expect(state.turn).toBeNull();
    expectError(state, cmd("a", { type: "roll", keep: [] }), "WRONG_PHASE");
  });

  it("transfers host to the earliest remaining joiner and reuses free seats", () => {
    const dice = seededDiceSource(2);
    let state = lobby(["a", "b"], dice, { seats: 3 });
    state = run(state, cmd("a", { type: "leave" }), dice);
    state = run(state, cmd("c", { type: "join", name: "C" }), dice);
    expect(state.players.map((p) => [p.playerId, p.seat])).toEqual([["b", 1], ["c", 0]]);
    expectError(state, cmd("c", { type: "start" }), "NOT_HOST");
    state = run(state, cmd("b", { type: "start" }), dice);
    expect(state.turn!.playerId).toBe("c"); // seat 0 moves first
    const full = lobby(["a", "b"], dice);
    expectError(full, cmd("c", { type: "join", name: "C" }), "MATCH_FULL");
  });

  it("exposes only public information in player views", () => {
    const dice = seededDiceSource(11);
    let state = lobby(["a", "b"], dice, { turnTimeoutMs: 60_000 });
    state = run(state, cmd("a", { type: "start" }), dice, 0);
    state = run(state, cmd("a", { type: "roll", keep: [] }), dice, 0);
    const mine = viewFor(state, "a", 15_000);
    const theirs = viewFor(state, "b", 15_000);
    const spectator = viewFor(state, null);
    expect(JSON.stringify([mine, theirs, spectator])).not.toMatch(/processedCommands|"seed"|"rng"/);
    // Command ids are only echoed back to the player who issued them.
    expect(JSON.stringify([theirs, spectator])).not.toMatch(/commandId|"by"/);
    const own = viewFor(state, "a", undefined, 0).events.filter((e) => e.by);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((e) => e.by!.playerId === "a")).toBe(true);
    expect(mine.legal!.scores).toHaveLength(12);
    for (const option of mine.legal!.scores) expect(option.points).toBe(score(state.turn!.dice, option.category));
    expect(mine.legal).toMatchObject({ canRoll: true, canKeep: true, rollsLeft: 2 });
    expect(mine.you).toEqual({ playerId: "a", seat: 0, isHost: true });
    expect(theirs.legal).toBeNull();
    expect(spectator.you).toBeNull();
    expect(mine.turn!.remainingMs).toBe(45_000);
    expect(viewFor(state, "a", undefined, 0).events).toHaveLength(state.log.length);
    expect(viewFor(state, "a", undefined, state.log.length - 1).events).toHaveLength(1);
  });

});

/* ------------------------------------------------------- restart idempotency ------------------------------------------------------- */

/** Simulates a server restart: only the JSON log survives, state is rebuilt from it. */
const restart = (state: OnlineMatchState) => rebuildFromEvents(JSON.parse(JSON.stringify(state.log)));
function countingDice(seed: number) {
  const base = seededDiceSource(seed);
  const counter = { rolls: 0 };
  const dice: DiceSource = { rollDie: () => (counter.rolls++, base.rollDie()) };
  return { dice, counter };
}

describe("Online idempotency survives a restart", () => {
  it("restores processed command keys from the log", () => {
    const dice = seededDiceSource(21);
    let state = lobby(["a", "b"], dice);
    state = run(state, cmd("a", { type: "start" }), dice);
    state = run(state, cmd("a", { type: "roll", keep: [] }), dice);
    const rebuilt = restart(state);
    expect(rebuilt.processedCommands).toEqual(state.processedCommands);
    expect(rebuilt.processedCommands).toHaveLength(4); // 2 joins, start, roll
    expect(rebuilt).toEqual(state);
  });

  it("does not re-roll dice or re-score when a client retries after the restart", () => {
    const { dice, counter } = countingDice(31);
    let state = lobby(["a", "b"], dice);
    state = run(state, cmd("a", { type: "start" }), dice);
    const roll = cmd("a", { type: "roll", keep: [] }, { expectedVersion: state.version });
    state = run(state, roll, dice);
    const reroll = cmd("a", { type: "roll", keep: [0, 1] }, { expectedVersion: state.version });
    state = run(state, reroll, dice);
    const scoreCmd = cmd("a", { type: "score", category: "choice" }, { expectedVersion: state.version });
    state = run(state, scoreCmd, dice);
    const points = state.players.find((p) => p.playerId === "a")!.card.choice;

    const rebuilt = restart(state);
    const before = counter.rolls;
    // The retries carry their original (now stale) expectedVersion: they must be acknowledged, not re-run or rejected.
    for (const retry of [roll, reroll, scoreCmd]) {
      const result = applyCommand(rebuilt, retry, { now: 5000, dice });
      expect(result).toMatchObject({ ok: true, duplicate: true, events: [] });
      if (result.ok) expect(result.state).toBe(rebuilt);
    }
    expect(counter.rolls).toBe(before);
    expect(rebuilt.players.find((p) => p.playerId === "a")!.card.choice).toBe(points);
    expect(rebuilt.log.filter((e) => e.type === "categoryScored")).toHaveLength(1);
    expect(rebuilt.turn).toMatchObject({ playerId: "b", rolls: 0 });
  });

  it("acknowledges a retry whose response was lost by a crash right after persisting", () => {
    const { dice, counter } = countingDice(41);
    let now = 0;
    const host = new OnlineMatchHost({ matchId: "r1" }, () => now, dice);
    host.handle({ commandId: "j1", action: { type: "join", name: "A" } }, "a");
    host.handle({ commandId: "j1", action: { type: "join", name: "B" } }, "b");
    host.handle({ commandId: "s1", action: { type: "start" } }, "a");
    const message = { commandId: "roll-1", expectedVersion: host.state.version, action: { type: "roll" } };
    expect(host.handle(message, "a")).toMatchObject({ ok: true, duplicate: false });
    const persisted = JSON.stringify(host.state.log);
    const rolled = counter.rolls;

    now = 1000;
    const revived = new OnlineMatchHost({ matchId: "r1" }, () => now, dice, rebuildFromEvents(JSON.parse(persisted)));
    expect(revived.handle(message, "a")).toMatchObject({ ok: true, duplicate: true });
    expect(counter.rolls).toBe(rolled);
    // A new command id is processed normally; the same id from another player is a different command.
    expect(revived.handle({ commandId: "roll-2", action: { type: "roll", keep: [0] } }, "a")).toMatchObject({ ok: true, duplicate: false });
    expect(revived.handle({ commandId: "roll-1", action: { type: "roll" } }, "b")).toMatchObject({ ok: false, error: { code: "NOT_YOUR_TURN" } });
  });

  it("tracks every command of a full match, not just a recent window", () => {
    const dice = seededDiceSource(51);
    const rng = seededDiceSource(52);
    let state = lobby(["a", "b"], dice);
    state = run(state, cmd("a", { type: "start" }), dice);
    const first = cmd("a", { type: "roll", keep: [] });
    state = run(state, first, dice);
    state = run(state, cmd("a", { type: "score", category: "aces" }), dice);
    while (state.status === "playing") state = playTurn(state, dice, () => (rng.rollDie() - 1) / 6);
    const rebuilt = restart(state);
    expect(new Set(rebuilt.processedCommands).size).toBe(rebuilt.processedCommands.length);
    expect(applyCommand(rebuilt, first, { now: 0, dice })).toMatchObject({ ok: true, duplicate: true });
  });
});

/* --------------------------------------------------------- log integrity --------------------------------------------------------- */

type AnyEvent = Record<string, unknown> & { type: string; seq: number; at: number; by?: { playerId: string; commandId: string } };
/** A complete, valid 2-player match with a turn timeout, used as the base for tampering. */
function sampleMatch() {
  const dice = seededDiceSource(61);
  const rng = seededDiceSource(62);
  let state = lobby(["a", "b"], dice, { turnTimeoutMs: 60_000 });
  state = run(state, cmd("a", { type: "start" }), dice, 0);
  let now = 0;
  while (state.status === "playing") state = playTurn(state, dice, () => (rng.rollDie() - 1) / 6, (now += 100));
  return state;
}
const clone = (state: OnlineMatchState) => structuredClone(state.log) as unknown as AnyEvent[];
const indexOf = (log: AnyEvent[], predicate: (e: AnyEvent) => boolean, from = 0) => log.findIndex((e, i) => i >= from && predicate(e));
function expectRejected(log: unknown, index?: number, reason?: RegExp) {
  const audit = auditEventLog(log);
  expect(audit.ok).toBe(false);
  if (audit.ok) return;
  if (index !== undefined) expect(audit.index).toBe(index);
  if (reason) expect(audit.reason).toMatch(reason);
  expect(() => rebuildFromEvents(log)).toThrow(LogIntegrityError);
}
/** Renumber seq after structural edits so the test targets the intended rule, not just seq numbering. */
const renumber = (log: AnyEvent[]) => log.map((e, i) => ({ ...e, seq: i }));

describe("Online event log audit — detectable rule violations", () => {
  const base = sampleMatch();

  it("accepts the untouched log and its JSON round trip", () => {
    expect(auditEventLog(base.log)).toMatchObject({ ok: true });
    expect(auditEventLog(JSON.parse(JSON.stringify(base.log)))).toMatchObject({ ok: true });
  });

  it("keeps event time monotonic when the host clock goes backwards, so the log still audits", () => {
    const dice = seededDiceSource(63);
    let state = lobby(["a", "b"], dice, { turnTimeoutMs: 10_000 });
    state = run(state, cmd("a", { type: "start" }), dice, 5_000);
    state = run(state, cmd("a", { type: "roll", keep: [] }), dice, 4_000); // clock skew
    expect(state.log.at(-1)!.at).toBe(5_000);
    expect(state.log.every((e, i) => i === 0 || e.at >= state.log[i - 1].at)).toBe(true);
    expect(auditEventLog(state.log)).toMatchObject({ ok: true });
  });

  it("rejects malformed containers and headers", () => {
    expectRejected([], 0);
    expectRejected("log", 0);
    expectRejected(null, 0);
    const header = clone(base);
    header[0].protocol = 2;
    expectRejected(header, 0, /프로토콜/);
    const seats = clone(base);
    seats[0].seats = 99;
    expectRejected(seats, 0);
    const extra = clone(base);
    extra[0].note = "x";
    expectRejected(extra, 0);
  });

  it("rejects a score that differs from the rule engine", () => {
    const log = clone(base);
    const i = indexOf(log, (e) => e.type === "categoryScored");
    log[i].points = (log[i].points as number) + 1;
    expectRejected(log, i, /categoryScored/);
  });

  it("rejects a held die whose value changed between rolls", () => {
    const log = clone(base);
    const i = indexOf(log, (e) => e.type === "diceRolled" && (e.kept as number[]).length > 0);
    const k = (log[i].kept as number[])[0];
    const dice = log[i].dice as number[];
    dice[k] = (dice[k] % 6) + 1;
    expectRejected(log, i);
  });

  it("rejects out-of-range dice values and fewer/more faces than re-rolled", () => {
    const face = clone(base);
    const i = indexOf(face, (e) => e.type === "diceRolled");
    (face[i].dice as number[])[0] = 7;
    expectRejected(face, i);
    const short = clone(base);
    (short[i].dice as number[]).pop();
    expectRejected(short, i);
  });

  it("rejects a fourth roll in one turn", () => {
    const log = clone(base);
    const third = indexOf(log, (e) => e.type === "diceRolled" && e.roll === 3);
    expect(third).toBeGreaterThan(0);
    const extra: AnyEvent = { ...structuredClone(log[third]), roll: 4, kept: [], by: { playerId: log[third].playerId as string, commandId: "forged4" } };
    log.splice(third + 1, 0, extra);
    expectRejected(renumber(log), third + 1, /NO_ROLLS_LEFT/);
  });

  it("rejects a roll attributed to a player who does not hold the turn", () => {
    const log = clone(base);
    const i = indexOf(log, (e) => e.type === "diceRolled" && e.playerId === "a");
    log[i].by = { playerId: "b", commandId: "forged" };
    log[i].playerId = "b";
    expectRejected(log, i, /NOT_YOUR_TURN/);
  });

  it("rejects writing a category that is already filled", () => {
    const log = clone(base);
    const scored = log.filter((e) => e.type === "categoryScored" && e.playerId === "a");
    const later = indexOf(log, (e) => e === scored[1]);
    log[later].category = scored[0].category;
    expectRejected(log, later, /CATEGORY_TAKEN/);
  });

  it("rejects handing the turn to the wrong player or with a wrong round/deadline", () => {
    for (const [field, value] of [["playerId", "a"], ["round", 5], ["deadline", 1]] as const) {
      const log = clone(base);
      const i = indexOf(log, (e) => e.type === "turnStarted" && e.playerId === "b");
      log[i][field] = value;
      expectRejected(log, i, /turnStarted/);
    }
  });

  it("rejects a missing derived event and an unexplained extra event", () => {
    const missing = clone(base);
    const i = indexOf(missing, (e) => e.type === "turnStarted", 5);
    missing.splice(i, 1);
    expectRejected(renumber(missing), i, /누락|by/);
    const extra = clone(base);
    const j = indexOf(extra, (e) => e.type === "diceRolled");
    extra.splice(j + 1, 0, { ...structuredClone(extra[j]), by: undefined });
    expectRejected(renumber(extra), j + 1);
  });

  it("rejects forged standings or winners", () => {
    const winners = clone(base);
    const end = winners.length - 1;
    expect(winners[end].type).toBe("matchFinished");
    winners[end].winners = ["a", "b"];
    expectRejected(winners, end, /matchFinished/);
    const standings = clone(base);
    (standings[end].standings as { points: number }[])[0].points += 10;
    expectRejected(standings, end, /matchFinished/);
  });

  it("rejects events appended after the match finished", () => {
    const log = clone(base);
    log.push({ seq: log.length, at: log.at(-1)!.at + 1, type: "playerForfeited", playerId: "a", reason: "resign", by: { playerId: "a", commandId: "late" } });
    expectRejected(log, log.length - 1, /WRONG_PHASE/);
  });

  it("rejects missing attribution, reused command ids, broken seq and backwards time", () => {
    const noBy = clone(base);
    const i = indexOf(noBy, (e) => e.type === "diceRolled");
    delete noBy[i].by;
    expectRejected(noBy, i, /추가 이벤트/); // absorbed into the previous group, which the engine cannot explain

    const reused = clone(base);
    const rolls = reused.filter((e) => e.type === "diceRolled" && e.by?.playerId === "a");
    rolls[1].by = { ...rolls[0].by! };
    expectRejected(reused, indexOf(reused, (e) => e === rolls[1]), /이미 처리된/);

    const seq = clone(base);
    seq[4].seq = 40;
    expectRejected(seq, 4);

    const time = clone(base);
    const k = indexOf(time, (e) => e.type === "categoryScored", 10);
    time[k].at = 0; // earlier than the preceding roll
    expectRejected(time, k);
  });

  it("rejects a timeout claimed before the deadline and a lobby join after start", () => {
    const dice = seededDiceSource(71);
    let state = lobby(["a", "b", "c"], dice, { turnTimeoutMs: 10_000 });
    state = run(state, cmd("a", { type: "start" }), dice, 0);
    state = run(state, cmd("b", { type: "claimTimeout" }), dice, 10_000);
    expect(auditEventLog(state.log)).toMatchObject({ ok: true });
    const early = clone(state);
    const i = indexOf(early, (e) => e.type === "playerForfeited");
    for (let j = i; j < early.length; j++) early[j].at = 9_999;
    expectRejected(early, i, /TIMEOUT_NOT_REACHED/);
    const lateJoin = clone(state);
    lateJoin.push({ seq: lateJoin.length, at: 10_000, type: "playerJoined", playerId: "d", name: "D", seat: 3, by: { playerId: "d", commandId: "j" } });
    expectRejected(lateJoin, lateJoin.length - 1, /WRONG_PHASE/);
  });

  it("rejects a resignation recorded for someone other than the issuer", () => {
    const dice = seededDiceSource(72);
    let state = lobby(["a", "b", "c"], dice);
    state = run(state, cmd("a", { type: "start" }), dice);
    state = run(state, cmd("c", { type: "resign" }), dice);
    const log = clone(state);
    const i = indexOf(log, (e) => e.type === "playerForfeited");
    log[i].playerId = "b";
    expectRejected(log, i);
  });
});

describe("Online event log audit — documented limits (not detectable by rule checks)", () => {
  it("accepts fabricated but rule-consistent dice values", () => {
    const dice = scriptedDiceSource([6, 6, 2, 6, 3, 6, 6]);
    let state = lobby(["a", "b"], dice);
    state = run(state, cmd("a", { type: "start" }), dice);
    state = run(state, cmd("a", { type: "roll", keep: [] }), dice);
    state = run(state, cmd("a", { type: "roll", keep: [0, 1, 3] }), dice);
    state = run(state, cmd("a", { type: "score", category: "yacht" }), dice);
    const forged = clone(state);
    const first = indexOf(forged, (e) => e.type === "diceRolled");
    forged[first].dice = [6, 6, 6, 6, 6]; // a "luckier" first roll; later events stay consistent
    expect(auditEventLog(forged)).toMatchObject({ ok: true });
  });

  it("accepts a log truncated at a command boundary", () => {
    const base = sampleMatch();
    const log = clone(base);
    const cut = indexOf(log, (e) => e.type === "diceRolled", 20);
    expect(auditEventLog(log.slice(0, cut))).toMatchObject({ ok: true });
  });

  it("accepts a different command id attributed to the same player", () => {
    const log = clone(sampleMatch());
    const i = indexOf(log, (e) => e.type === "diceRolled");
    log[i].by = { ...log[i].by!, commandId: "rewritten" };
    expect(auditEventLog(log)).toMatchObject({ ok: true });
  });
});

describe("Online command parsing", () => {
  it("binds the authenticated player and ignores any playerId in the payload", () => {
    const parsed = parseCommand({ commandId: "x1", playerId: "mallory", action: { type: "roll", keep: [4, 1] } }, "alice");
    expect(parsed).toEqual({ ok: true, command: { commandId: "x1", playerId: "alice", action: { type: "roll", keep: [1, 4] } } });
  });

  it("rejects malformed untrusted input", () => {
    const bad: unknown[] = [
      null,
      [],
      "roll",
      { commandId: "", action: { type: "start" } },
      { commandId: "has space", action: { type: "start" } },
      { commandId: "a", action: { type: "nope" } },
      { commandId: "a", action: { type: "roll", keep: [0, 0] } },
      { commandId: "a", action: { type: "roll", keep: [5] } },
      { commandId: "a", action: { type: "roll", keep: [1.5] } },
      { commandId: "a", action: { type: "roll", keep: "0" } },
      { commandId: "a", action: { type: "score", category: "chance" } },
      { commandId: "a", action: { type: "score", category: "__proto__" } },
      { commandId: "a", action: { type: "join", name: "   " } },
      { commandId: "a", action: { type: "join", name: "a\u0000b" } },
      { commandId: "a", action: { type: "join", name: "x".repeat(25) } },
      { commandId: "a", expectedVersion: -1, action: { type: "start" } },
      { commandId: "a", expectedVersion: "3", action: { type: "start" } },
    ];
    for (const raw of bad) expect(parseCommand(raw, "alice")).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });
    expect(parseCommand({ commandId: "a", action: { type: "start" } }, "bad id")).toMatchObject({ ok: false });
    expect(parseCommand({ commandId: "a", action: { type: "join", name: "  요트왕  " } }, "alice")).toMatchObject({
      ok: true,
      command: { action: { name: "요트왕" } },
    });
  });

  it("accepts every rule category", () => {
    for (const category of categories)
      expect(parseCommand({ commandId: "a", action: { type: "score", category } }, "p")).toMatchObject({ ok: true });
  });
});

describe("Online dice sources", () => {
  it("uses rejection sampling so every face is exactly uniform", () => {
    let call = 0;
    const source = cryptoDiceSource((buffer) => {
      buffer.fill(0);
      if (call++ === 0) buffer.set([255, 252, 253, 254, 0, 5, 251, 6]);
      return buffer;
    });
    expect([source.rollDie(), source.rollDie(), source.rollDie(), source.rollDie()]).toEqual([1, 6, 6, 1]);
  });

  it("produces statistically uniform faces from the platform CSPRNG", () => {
    const source = cryptoDiceSource();
    const counts = Array(7).fill(0);
    const n = 60_000;
    for (let i = 0; i < n; i++) counts[source.rollDie()]++;
    const expected = n / 6;
    const chi = counts.slice(1).reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
    expect(counts[0]).toBe(0);
    expect(chi).toBeLessThan(25.7); // df=5, p≈0.0001
  });

  it("fails loudly when an injected source returns an invalid face", () => {
    const dice: DiceSource = { rollDie: () => 7 };
    let state = lobby(["a", "b"], seededDiceSource(1));
    state = run(state, cmd("a", { type: "start" }), dice);
    expect(() => applyCommand(state, cmd("a", { type: "roll", keep: [] }), { now: 0, dice })).toThrow(/범위/);
  });
});

describe("OnlineMatchHost", () => {
  it("runs a match from raw JSON messages with an injected clock and dice", () => {
    let now = 0;
    const host = new OnlineMatchHost({ matchId: "room-1", turnTimeoutMs: 5000 }, () => now, seededDiceSource(4));
    const send = (playerId: string, body: unknown) => host.handle(JSON.parse(JSON.stringify(body)), playerId);
    expect(send("p1", { commandId: "1", action: { type: "join", name: "One" } }).ok).toBe(true);
    expect(send("p2", { commandId: "1", action: { type: "join", name: "Two" } }).ok).toBe(true);
    expect(send("p1", { commandId: "2", action: { type: "start" } }).ok).toBe(true);
    expect(send("p2", { commandId: "x", playerId: "p1", action: { type: "roll" } })).toMatchObject({
      ok: false,
      error: { code: "NOT_YOUR_TURN" },
    });
    expect(send("p1", { commandId: "3", expectedVersion: host.state.version, action: { type: "roll" } }).ok).toBe(true);
    now = 6000;
    expect(host.view("p2").turn!.remainingMs).toBe(0);
    expect(send("p2", { commandId: "y", action: { type: "claimTimeout" } }).ok).toBe(true);
    expect(host.view(null)).toMatchObject({ status: "finished", winners: ["p2"] });
  });

  it("throws on invalid match options", () => {
    expect(() => createOnlineMatch({ matchId: "m", seats: 1 }, 0)).toThrow();
    expect(() => createOnlineMatch({ matchId: "m", seats: 21 }, 0)).toThrow(); // 2..20 players
    expect(createOnlineMatch({ matchId: "m", seats: 20 }, 0).seats).toBe(20);
    expect(() => createOnlineMatch({ matchId: "bad id" }, 0)).toThrow();
    expect(() => createOnlineMatch({ matchId: "m", turnTimeoutMs: 10 }, 0)).toThrow();
  });
});
