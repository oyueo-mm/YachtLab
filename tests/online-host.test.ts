import { describe, expect, it } from "vitest";
import { seededDiceSource } from "../src/online";
import { ROOM_LIMITS, type RoomRecord } from "../src/online/room";
import type { ServerMessage } from "../src/online/wire";
import { RoomHost, HELLO_TIMEOUT_MS, type HostSocket, type HostStorage } from "../worker/src/host";
import { readConfig } from "../worker/src/config";

/**
 * Durable Object host logic without the runtime: simulates WebSocket Hibernation (the object is
 * evicted, sockets stay open with their attachments) and alarm-driven timers with a fake clock.
 */
class FakeSocket implements HostSocket {
  sent: ServerMessage[] = [];
  closed: number | null = null;
  private attachment: string | null = null;
  send(data: string) {
    if (this.closed === null) this.sent.push(JSON.parse(data));
  }
  close(code = 1000) {
    this.closed = code;
  }
  serializeAttachment(value: unknown) {
    this.attachment = JSON.stringify(value); // structured clone in the real runtime
  }
  deserializeAttachment() {
    return this.attachment === null ? null : JSON.parse(this.attachment);
  }
  last<T extends ServerMessage["t"]>(t: T) {
    return [...this.sent].reverse().find((m) => m.t === t) as Extract<ServerMessage, { t: T }> | undefined;
  }
}

function fakeStorage() {
  const state = { record: null as string | null, alarm: null as number | null, writes: 0, cleared: false };
  const storage: HostStorage = {
    load: () => (state.record ? (JSON.parse(state.record) as RoomRecord) : null),
    save: (r) => {
      state.record = JSON.stringify(r);
      state.writes++;
    },
    getAlarm: () => state.alarm,
    setAlarm: (at) => {
      state.alarm = at;
      state.writes++;
    },
    deleteAlarm: () => {
      state.alarm = null;
    },
    clear: () => {
      state.record = null;
      state.cleared = true;
    },
  };
  return { state, storage };
}

const config = readConfig({ TURN_TIMEOUT_MS: "60000", LOBBY_IDLE_MS: "60000", FINISHED_IDLE_MS: "60000" });

describe("RoomHost (Durable Object logic, runtime-free)", () => {
  it("Hibernation: 객체가 메모리에서 내려간 뒤 같은 소켓으로 경기를 이어가고, 응답 유실 명령도 1회만 적용된다", async () => {
    let t = 1_000_000;
    const now = () => t;
    const { state, storage } = fakeStorage();
    const open: FakeSocket[] = [];
    const deleted: string[] = [];
    const make = () => new RoomHost(storage, () => open, config, now, seededDiceSource(3), { onDeleted: (c) => void deleted.push(c) });
    let host = make();
    host.init();
    const created = await host.create("ABCDEF", "민수");
    const joined = await host.join("지민");
    if (!created.ok || !joined.ok) throw Error("join failed");
    const [a, b] = [new FakeSocket(), new FakeSocket()];
    for (const ws of [a, b]) {
      expect(host.admit().ok).toBe(true);
      open.push(ws);
      host.accepted(ws);
    }
    await host.message(a, JSON.stringify({ t: "hello", token: created.token }));
    await host.message(b, JSON.stringify({ t: "hello", token: joined.token }));
    await host.message(a, JSON.stringify({ t: "cmd", id: "start", action: { type: "start" } }));
    await host.message(a, JSON.stringify({ t: "cmd", id: "r1", action: { type: "roll", keep: [] } }));
    const dice = a.last("view")!.view.turn!.dice;
    // the alarm is only ever moved earlier: it is at or before the turn deadline
    expect(state.alarm).not.toBeNull();
    expect(state.alarm!).toBeLessThanOrEqual(t + 60_000);

    // ---- eviction: a brand-new host over the same storage and the same open sockets ----
    t += 5_000;
    host = make();
    host.init();
    expect(host.code).toBe("ABCDEF");
    // the lost-ack retry is recognised (same id) — no extra roll
    await host.message(a, JSON.stringify({ t: "cmd", id: "r1", action: { type: "roll", keep: [] } }));
    expect(a.last("ack")).toMatchObject({ id: "r1", ok: true, duplicate: true });
    expect(a.last("view")!.view.turn!.dice).toEqual(dice);
    // play continues and the other socket (also adopted from its attachment) receives only new events
    const before = b.sent.length;
    await host.message(a, JSON.stringify({ t: "cmd", id: "s1", action: { type: "score", category: "choice" } }));
    const update = b.sent.slice(before).find((m) => m.t === "view") as Extract<ServerMessage, { t: "view" }>;
    expect(update.view.events.map((e) => e.type)).toEqual(["categoryScored", "turnStarted"]);
    expect(update.view.legal).not.toBeNull(); // b's turn
    // a wrong-turn command after the wake is still rejected
    await host.message(a, JSON.stringify({ t: "cmd", id: "x", action: { type: "roll", keep: [] } }));
    expect(a.last("ack")).toMatchObject({ id: "x", ok: false });
    expect(deleted).toEqual([]);
  });

  it("알람 하나로 턴 제한·인증 전 소켓·보존 기간을 처리하고, 정리 후 저장소를 비운다", async () => {
    let t = 2_000_000;
    const { state, storage } = fakeStorage();
    const open: FakeSocket[] = [];
    const deleted: string[] = [];
    const host = new RoomHost(storage, () => open, config, () => t, seededDiceSource(5), { onDeleted: (c) => void deleted.push(c) });
    host.init();
    const created = await host.create("QWERTY", "하나");
    const joined = await host.join("두리");
    if (!created.ok || !joined.ok) throw Error("join failed");
    const [a, b, lurker] = [new FakeSocket(), new FakeSocket(), new FakeSocket()];
    for (const ws of [a, b, lurker]) {
      open.push(ws);
      host.accepted(ws);
    }
    expect(state.alarm).toBe(t + HELLO_TIMEOUT_MS);
    await host.message(a, JSON.stringify({ t: "hello", token: created.token }));
    await host.message(b, JSON.stringify({ t: "hello", token: joined.token }));
    t += HELLO_TIMEOUT_MS;
    await host.alarm();
    expect(lurker.closed).toBe(4001);
    open.splice(open.indexOf(lurker), 1);
    await host.closed(lurker);
    await host.message(a, JSON.stringify({ t: "cmd", id: "go", action: { type: "start" } }));
    // an alarm that is already due fires right away and re-arms to the turn deadline
    await host.alarm();
    expect(state.alarm).toBe(t + 60_000);
    t += 60_000;
    await host.alarm();
    expect(b.last("view")!.view.status).toBe("finished");
    // finished room, everybody leaves → removed after the finished-idle period
    for (const ws of [a, b]) {
      open.splice(open.indexOf(ws), 1);
      await host.closed(ws);
    }
    expect(state.alarm).toBe(t + 60_000);
    t += 60_000;
    await host.alarm();
    expect(state.cleared).toBe(true);
    expect(state.record).toBeNull();
    expect(deleted).toEqual(["QWERTY"]);
    expect(host.summary()).toBeNull();
  });

  it("재접속을 반복해도 SQLite 행 쓰기(레코드·알람)가 늘지 않는다", async () => {
    let t = 5_000_000;
    const { state, storage } = fakeStorage();
    const open: FakeSocket[] = [];
    const host = new RoomHost(storage, () => open, config, () => (t += 1000), seededDiceSource(2));
    host.init();
    const c = await host.create("HJKMNP", "A");
    if (!c.ok) throw Error();
    const ws0 = new FakeSocket();
    open.push(ws0);
    host.accepted(ws0);
    await host.message(ws0, JSON.stringify({ t: "hello", token: c.token }));
    const writes = state.writes;
    for (let i = 0; i < 15; i++) {
      const ws = new FakeSocket();
      open.push(ws);
      host.accepted(ws);
      await host.message(ws, JSON.stringify({ t: "hello", token: c.token }));
      open.splice(open.indexOf(ws), 1);
      await host.closed(ws);
    }
    expect(state.writes - writes).toBe(0);
  });

  it("방당 연결 수·연결 속도 제한, 저장 비용: 명령 하나당 SQLite 행 쓰기 1회", async () => {
    const t = 3_000_000;
    const { state, storage } = fakeStorage();
    const open: FakeSocket[] = [];
    const host = new RoomHost(storage, () => open, config, () => t, seededDiceSource(9));
    host.init();
    const created = await host.create("ZXCVBN", "A");
    if (!created.ok) throw Error();
    for (let i = 0; i < ROOM_LIMITS.maxConnections; i++) {
      expect(host.admit().ok).toBe(true);
      const ws = new FakeSocket();
      open.push(ws);
      host.accepted(ws);
    }
    expect(host.admit()).toEqual({ ok: false, status: 503 });
    open.length = 0;
    let admitted = ROOM_LIMITS.maxConnections;
    while (host.admit().ok) admitted++;
    expect(admitted).toBe(20);
    expect(host.admit()).toEqual({ ok: false, status: 429 });
    // writes: record rows + alarm changes only
    const writes = state.writes;
    const j = await host.join("B");
    expect(j.ok).toBe(true);
    expect(state.writes - writes).toBeLessThanOrEqual(2);
  });

  it("깨어날 때 로그 감사 재실행 비용은 완주한 경기도 수 ms 이내다", async () => {
    let t = 4_000_000;
    const tick = () => (t += 250); // real time passes between messages (rate bucket refills)
    const { state, storage } = fakeStorage();
    const open: FakeSocket[] = [];
    const host = new RoomHost(storage, () => open, config, tick, seededDiceSource(11));
    host.init();
    const c = await host.create("PQRSTU", "A");
    const j = await host.join("B");
    if (!c.ok || !j.ok) throw Error();
    const [a, b] = [new FakeSocket(), new FakeSocket()];
    open.push(a, b);
    host.accepted(a);
    host.accepted(b);
    await host.message(a, JSON.stringify({ t: "hello", token: c.token }));
    await host.message(b, JSON.stringify({ t: "hello", token: j.token }));
    await host.message(a, JSON.stringify({ t: "cmd", id: "s", action: { type: "start" } }));
    let n = 0;
    while (host.room!.match.status === "playing") {
      const turn = host.room!.match.turn!;
      const ws = host.room!.match.players.findIndex((p) => p.playerId === turn.playerId) === 0 ? a : b;
      // three rolls per turn (the heaviest legal log), then score the first open box
      for (let r = 0; r < 3; r++) await host.message(ws, JSON.stringify({ t: "cmd", id: `r${n++}`, action: { type: "roll", keep: r ? [0] : [] } }));
      const open = ws.last("view")!.view.legal!.scores[0].category;
      await host.message(ws, JSON.stringify({ t: "cmd", id: `s${n++}`, action: { type: "score", category: open } }));
    }
    const events = JSON.parse(state.record!).log.length;
    expect(events).toBeGreaterThan(120);
    const runs: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      new RoomHost(storage, () => open, config, () => t).init();
      runs.push(performance.now() - start);
    }
    runs.sort((x, y) => x - y);
    console.log(`wake rebuild: ${events} events, median ${runs[10].toFixed(2)} ms, max ${runs[19].toFixed(2)} ms`);
    expect(runs[10]).toBeLessThan(25);
  });
  it("고정 순서는 다음 명령 전에 객체가 내려가도 소켓 첨부 데이터로 복구되고, 행 쓰기는 늘지 않는다", async () => {
    const t = 2_000_000;
    const { state, storage } = fakeStorage();
    const open: FakeSocket[] = [];
    const make = () => new RoomHost(storage, () => open, config, () => t, seededDiceSource(5));
    let host = make();
    host.init();
    const created = await host.create("HQKDAB", "민수");
    const joined = await host.join("지민");
    if (!created.ok || !joined.ok) throw Error("join failed");
    const [a, b] = [new FakeSocket(), new FakeSocket()];
    for (const ws of [a, b]) {
      host.admit();
      open.push(ws);
      host.accepted(ws);
    }
    await host.message(a, JSON.stringify({ t: "hello", token: created.token }));
    await host.message(b, JSON.stringify({ t: "hello", token: joined.token }));
    await host.message(a, JSON.stringify({ t: "cmd", id: "start", action: { type: "start" } }));
    await host.message(a, JSON.stringify({ t: "cmd", id: "r1", action: { type: "roll", keep: [] } }));
    const writes = state.writes;
    await host.message(a, JSON.stringify({ t: "hold", keep: [3, 0], n: 1 }));
    await host.message(a, JSON.stringify({ t: "hold", keep: [3, 0, 4], n: 2 }));
    expect(state.writes).toBe(writes); // hold toggles never write SQLite rows
    // Eviction: memory is gone, sockets stay. The opponent reconnects and must see the same order.
    host = make();
    host.init();
    const c = new FakeSocket();
    host.admit();
    open.splice(1, 1, c);
    host.accepted(c);
    await host.message(c, JSON.stringify({ t: "hello", token: joined.token }));
    expect(c.last("welcome")?.hold).toEqual({ playerId: created.playerId, keep: [3, 0, 4], n: 2 });
    // The roll keeps that order for both screens.
    await host.message(a, JSON.stringify({ t: "cmd", id: "r2", action: { type: "roll", keep: [3, 0, 4] } }));
    expect(c.last("view")?.hold?.keep).toEqual([3, 0, 4]);
    // A stale copy (older match version) is ignored after the next command.
    expect(host.room!.adoptHold({ hold: { playerId: created.playerId, keep: [1], n: 9 }, v: 0 })).toBe(false);
  });
});

describe("회원 좌석의 서버 검증 경기 기록 (Phase 4)", () => {
  it("경기 종료 시 회원마다 server-verified 기록 1건, 전달 실패는 알람으로 재시도, 재대결은 새 기록, 중복 집계 없음", async () => {
    let t = 5_000_000;
    const { storage } = fakeStorage();
    const open: FakeSocket[] = [];
    const delivered: { userId: string; recordId: string; outcome: string; kind: string; verification: string }[] = [];
    let failNext = true;
    const host = new RoomHost(storage, () => open, config, () => t, seededDiceSource(21), {
      deliverRecord: async (userId, record) => {
        if (failNext) {
          failNext = false;
          return false; // the account store was unreachable once
        }
        if (!delivered.some((d) => d.userId === userId && d.recordId === record.recordId))
          delivered.push({ userId, recordId: record.recordId, outcome: record.outcome, kind: record.opponent.kind, verification: record.verification });
        return true;
      },
    });
    host.init();
    const A = "u_" + "A".repeat(22);
    const created = await host.create("RECRDS", "민수", { userId: A });
    const joined = await host.join("지민"); // a guest
    if (!created.ok || !joined.ok) throw Error();
    const [a, b] = [new FakeSocket(), new FakeSocket()];
    for (const ws of [a, b]) {
      host.admit();
      open.push(ws);
      host.accepted(ws);
    }
    await host.message(a, JSON.stringify({ t: "hello", token: created.token }));
    await host.message(b, JSON.stringify({ t: "hello", token: joined.token }));
    expect(b.last("welcome")!.members).toEqual({ [created.playerId]: A }); // opponent can open the member's public profile
    let n = 0;
    const play = async () => {
      for (let i = 0; i < 40 && host.room!.match.status === "playing"; i++) {
        const turn = host.room!.match.turn!;
        const ws = turn.playerId === created.playerId ? a : b;
        t += 10;
        await host.message(ws, JSON.stringify({ t: "cmd", id: "x" + ++n, action: { type: "roll", keep: [] } }));
        const me = host.room!.match.players.find((p) => p.playerId === turn.playerId)!;
        const cat = (["aces", "deuces", "threes", "fours", "fives", "sixes", "choice", "four", "full", "small", "large", "yacht"] as const).find((c) => me.card[c] === undefined);
        await host.message(ws, JSON.stringify({ t: "cmd", id: "x" + ++n, action: { type: "score", category: cat } }));
      }
    };
    await host.message(a, JSON.stringify({ t: "cmd", id: "start", action: { type: "start" } }));
    const first = host.room!.match.matchId;
    await play();
    expect(delivered).toHaveLength(0); // first delivery failed
    expect(host.room!.pendingRecords()).toHaveLength(1); // only the member seat gets an account record
    t += 61_000;
    await host.alarm();
    expect(delivered).toEqual([{ userId: A, recordId: first, outcome: expect.any(String), kind: "guest", verification: "server-verified" }]);
    expect(host.room!.pendingRecords()).toHaveLength(0);
    t += 2000;
    await host.message(a, JSON.stringify({ t: "rematch", op: "request" }));
    t += 2000;
    await host.message(b, JSON.stringify({ t: "rematch", op: "request" }));
    const second = host.room!.match.matchId;
    expect(second).not.toBe(first);
    await play();
    expect(delivered.map((d) => d.recordId)).toEqual([first, second]);
  });

  it("세션 없이 들어온 좌석은 회원으로 기록되지 않고, 같은 계정은 한 방에 두 좌석을 가질 수 없다", async () => {
    const { storage } = fakeStorage();
    const host = new RoomHost(storage, () => [], config, () => 1, seededDiceSource(2));
    host.init();
    const A = "u_" + "B".repeat(22);
    expect((await host.create("NQRDS2", "하나", { userId: A })).ok).toBe(true);
    const dup = await host.join("둘", { userId: A });
    expect(dup.ok).toBe(false);
    expect((await host.join("둘")).ok).toBe(true);
    expect(Object.values(host.room!.members())).toEqual([A]);
  });
});
