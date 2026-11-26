import { describe, expect, it } from "vitest";
import { seededDiceSource } from "../src/online";
import { MAX_MISSED_ROUNDS } from "../src/online/protocol";
import { applyCommand, createOnlineMatch, rebuildFromEvents } from "../src/online/server-engine";
import type { RoomRecord } from "../src/online/room";
import { RoomHost, LIFECYCLE, type HostEvents, type HostSocket, type HostStorage } from "../worker/src/host";
import { readConfig } from "../worker/src/config";
import { categories } from "../src/engine";

/**
 * Online friend rooms for 2–20 players: simultaneous rounds (every player plays the same round at
 * once), lobby (ready, settings, host transfer), round time limit with server auto-record, AFK
 * forfeit, rematch with a subset, records for N players. Runtime-free (fake sockets, fake clock).
 */
class Sock implements HostSocket {
  sent: Record<string, any>[] = [];
  closed: number | null = null;
  private a: string | null = null;
  send(d: string) {
    if (this.closed === null) this.sent.push(JSON.parse(d));
  }
  close(c = 1000) {
    this.closed = c;
  }
  serializeAttachment(v: unknown) {
    this.a = JSON.stringify(v);
  }
  deserializeAttachment() {
    return this.a === null ? null : JSON.parse(this.a);
  }
  last(t: string): Record<string, any> | undefined {
    return [...this.sent].reverse().find((m) => m.t === t);
  }
}
function harness(seats: number, opts: { turnTimeoutMs?: string } = {}) {
  const st = { record: null as string | null, writes: 0, bytes: 0 };
  const storage: HostStorage = {
    load: () => (st.record ? (JSON.parse(st.record) as RoomRecord) : null),
    save: (r) => {
      st.record = JSON.stringify(r);
      st.writes++;
      st.bytes = st.record.length;
    },
    getAlarm: () => null,
    setAlarm: () => void st.writes++,
    deleteAlarm: () => undefined,
    clear: () => void (st.record = null),
  };
  let t = 1_000_000;
  const open: Sock[] = [];
  const delivered: { userId: string; record: any }[] = [];
  const allowed: number[] = [];
  const host = new RoomHost(storage, () => open, readConfig({ TURN_TIMEOUT_MS: opts.turnTimeoutMs ?? "120000" }), () => t, seededDiceSource(seats * 7 + 1), {
    deliverRecord: async (userId, record) => (delivered.push({ userId, record }), true),
    allowMatch: (_code, weight) => (allowed.push(weight ?? 1), null),
  });
  host.init();
  const players: { sock: Sock; id: string; token: string; name: string }[] = [];
  const join = async (name: string, member = false) => {
    const r = players.length === 0 ? await host.create("ABCDEF", name, member ? { userId: "u_" + name.padEnd(22, "x") } : null, null, seats) : await host.join(name, member ? { userId: "u_" + name.padEnd(22, "x") } : null);
    if (!r.ok) throw Error(JSON.stringify(r.error));
    const sock = new Sock();
    open.push(sock);
    host.accepted(sock);
    await host.message(sock, JSON.stringify({ t: "hello", token: r.token }));
    const p = { sock, id: r.playerId, token: r.token, name };
    players.push(p);
    return p;
  };
  let n = 0;
  const send = (p: { sock: Sock }, msg: unknown) => host.message(p.sock, JSON.stringify(msg));
  const cmd = async (p: { sock: Sock }, action: unknown) => {
    const id = "c" + ++n;
    await send(p, { t: "cmd", id, action });
    return p.sock.sent.find((m) => m.t === "ack" && m.id === id)!;
  };
  return { host, st, players, join, send, cmd, delivered, allowed, advance: (ms: number) => (t += ms), now: () => t };
}

describe("다인전 로비", () => {
  it("방장 권한: 설정·방장 이전은 방장만, 준비는 누구나; 모두 준비해야 시작; 시작하면 설정이 경기에 적용된다", async () => {
    const h = harness(6);
    const host = await h.join("방장");
    const b = await h.join("둘째");
    const c = await h.join("셋째");
    expect(host.sock.last("lobby")!.lobby).toMatchObject({ hostId: host.id, maxPlayers: 6 });
    await h.send(b, { t: "settings", mode: "simultaneous", timeoutMs: 90_000 });
    expect(b.sock.last("error")!.code).toBe("LOBBY");
    await h.send(host, { t: "settings", mode: "simultaneous", timeoutMs: null });
    expect(host.sock.last("error")!.message).toContain("라운드 제한 시간");
    h.advance(400);
    await h.send(host, { t: "settings", mode: "simultaneous", timeoutMs: 90_000 });
    expect(c.sock.last("lobby")!.lobby.settings).toEqual({ mode: "simultaneous", timeoutMs: 90_000 });
    expect((await h.cmd(host, { type: "start" })).error.code).toBe("NOT_READY");
    await h.send(b, { t: "ready", ready: true });
    await h.send(c, { t: "ready", ready: true });
    expect(host.sock.last("lobby")!.lobby.ready).toEqual({ [host.id]: false, [b.id]: true, [c.id]: true });
    expect((await h.cmd(b, { type: "start" })).error.code).toBe("NOT_HOST");
    expect((await h.cmd(host, { type: "start" })).ok).toBe(true);
    const v = host.sock.last("view")!.view;
    expect(v.status).toBe("playing");
    expect(v.mode).toBe("simultaneous");
    expect(v.round).toBe(1);
    expect(Object.keys(v.progress)).toHaveLength(3);
    // 3 players → 2 units of the daily budget (1 at creation + 1 more here)
    expect(h.allowed).toEqual([1]);
  });

  it("방장 이전과 방장 퇴장 시 자동 승계", async () => {
    const h = harness(4);
    const a = await h.join("하나");
    const b = await h.join("둘");
    const c = await h.join("셋");
    await h.send(a, { t: "host", to: c.id });
    expect(b.sock.last("lobby")!.lobby.hostId).toBe(c.id);
    h.advance(400);
    await h.cmd(c, { type: "leave" });
    expect(a.sock.last("lobby")!.lobby.hostId).toBe(a.id);
  });
});

describe("동시 진행 모드", () => {
  async function started(n: number, timeout = 60_000) {
    const h = harness(n);
    const ps = [];
    for (let i = 0; i < n; i++) ps.push(await h.join("p" + i, i < 2));
    await h.send(ps[0], { t: "settings", mode: "simultaneous", timeoutMs: timeout });
    for (const p of ps.slice(1)) await h.send(p, { t: "ready", ready: true });
    expect((await h.cmd(ps[0], { type: "start" })).ok).toBe(true);
    return { h, ps };
  }
  const myView = (p: { sock: Sock }) => p.sock.last("view")?.view ?? p.sock.last("welcome")?.view;

  it("모든 참가자가 각자의 주사위로 같은 라운드를 동시에 진행하고, 전원 기록하면 다음 라운드, 12라운드 후 순위", async () => {
    const { h, ps } = await started(10);
    for (let round = 1; round <= 12; round++) {
      h.advance(5_000); // real players take seconds per round (per-socket rate limit: 30 burst, 8/s)
      // everyone rolls first (interleaved), then everyone scores
      for (const p of ps) expect((await h.cmd(p, { type: "roll", keep: [] })).ok).toBe(true);
      for (const p of ps.slice(0, -1)) {
        const best = myView(p).legal.scores.sort((x: any, y: any) => y.points - x.points)[0];
        expect((await h.cmd(p, { type: "score", category: best.category })).ok).toBe(true);
        // after scoring, this player waits: no turn, no legal moves
        expect(myView(p).legal).toBeNull();
        expect((await h.cmd(p, { type: "roll", keep: [] })).error.code).toBe("NOT_YOUR_TURN");
      }
      expect(myView(ps[0]).round).toBe(round);
      const last = ps.at(-1)!;
      const best = myView(last).legal.scores.sort((x: any, y: any) => y.points - x.points)[0];
      await h.cmd(last, { type: "score", category: best.category });
    }
    const final = myView(ps[0]);
    expect(final.status).toBe("finished");
    expect(final.standings).toHaveLength(10);
    for (const p of final.players) expect(Object.keys(p.card)).toHaveLength(categories.length);
    // the stored log is audited by re-execution on restart
    const rebuilt = rebuildFromEvents(JSON.parse(h.st.record!).log);
    expect(rebuilt.status).toBe("finished");
    // two signed-in seats get one server-verified record each, with their rank among 10
    await new Promise((r) => setTimeout(r, 0));
    expect(h.delivered).toHaveLength(2);
    expect(h.delivered[0].record.field).toMatchObject({ players: 10, mode: "simultaneous" });
  });

  it("라운드 제한 시간이 지나면 서버가 미기록자를 자동 기록하고, 3라운드 연속이면 기권 처리; 재접속 후에도 진행", async () => {
    const { h, ps } = await started(4, 60_000);
    // p0..p2 play, p3 never does anything
    for (let round = 1; round <= MAX_MISSED_ROUNDS; round++) {
      for (const p of ps.slice(0, 3)) {
        await h.cmd(p, { type: "roll", keep: [] });
        const best = myView(p).legal.scores[0];
        await h.cmd(p, { type: "score", category: best.category });
      }
      expect(myView(ps[0]).round).toBe(round); // waiting for p3
      h.advance(61_000);
      await h.host.alarm();
      const v = myView(ps[0]);
      const p3 = v.players.find((p: any) => p.playerId === ps[3].id);
      expect(Object.keys(p3.card)).toHaveLength(round);
      if (round < MAX_MISSED_ROUNDS) expect(p3.status).toBe("active");
    }
    const v = myView(ps[0]);
    expect(v.players.find((p: any) => p.playerId === ps[3].id).status).toBe("forfeited");
    expect(v.round).toBe(MAX_MISSED_ROUNDS + 1);
    expect(v.events.some((e: any) => e.type === "categoryScored" && e.auto)).toBe(true);
    // p1 reconnects (new socket, same token) mid-round and continues
    const again = new Sock();
    (h.host as unknown as { sockets: () => Sock[] }).sockets().push(again);
    h.host.accepted(again);
    await h.host.message(again, JSON.stringify({ t: "hello", token: ps[1].token }));
    expect(again.last("welcome")!.view.legal.canRoll).toBe(true);
    // the audited log replays, including server-made rolls in the timeout group
    expect(rebuildFromEvents(JSON.parse(h.st.record!).log).round).toBe(MAX_MISSED_ROUNDS + 1);
  });

  it("다른 사람의 행동으로 버전이 바뀌어도 내 명령은 거절되지 않는다(동시 진행은 버전 검사 없음), 기권은 라운드 진행을 막지 않는다", async () => {
    const { h, ps } = await started(3);
    const v0 = myView(ps[0]).version;
    await h.cmd(ps[1], { type: "roll", keep: [] });
    await h.send(ps[0], { t: "cmd", id: "stale1", v: v0, action: { type: "roll", keep: [] } });
    expect(ps[0].sock.sent.find((m) => m.id === "stale1")!.ok).toBe(true);
    await h.cmd(ps[2], { type: "resign" });
    for (const p of ps.slice(0, 2)) {
      if (!myView(p).turn?.rolls) await h.cmd(p, { type: "roll", keep: [] });
      await h.cmd(p, { type: "score", category: myView(p).legal.scores[0].category });
    }
    expect(myView(ps[0]).round).toBe(2);
  });
});

describe("다인 재대결", () => {
  it("방장이 요청한 사람들만으로 다음 경기를 시작하고, 요청하지 않은 사람의 좌석은 닫힌다", async () => {
    const h = harness(4);
    const ps = [await h.join("a"), await h.join("b"), await h.join("c")];
    for (const p of ps.slice(1)) await h.send(p, { t: "ready", ready: true });
    await h.cmd(ps[0], { type: "start" });
    for (const p of ps) await h.cmd(p, { type: "resign" }).catch(() => undefined);
    expect(h.host.room!.match.status).toBe("finished");
    await h.send(ps[1], { t: "rematch", op: "request" });
    await h.send(ps[0], { t: "rematch", op: "start" });
    expect(h.host.room!.match.status).toBe("playing");
    expect(h.host.room!.match.players.map((p) => p.playerId).sort()).toEqual([ps[0].id, ps[1].id].sort());
    expect(ps[2].sock.closed).toBe(4002);
  });
});

describe("엔진: 20명", () => {
  it("20명 순차 진행 경기를 끝까지 두고 로그 감사가 통과한다", () => {
    let s = createOnlineMatch({ matchId: "m20", seats: 20, turnTimeoutMs: null }, 0);
    const dice = seededDiceSource(20);
    const ids = Array.from({ length: 20 }, (_, i) => "p" + i);
    let k = 0;
    const run = (playerId: string, action: unknown) => {
      const r = applyCommand(s, { commandId: "k" + k++, playerId, action: action as never }, { now: k, dice });
      if (!r.ok) throw Error(r.error.message);
      s = r.state;
    };
    for (const id of ids) run(id, { type: "join", name: id });
    run("p0", { type: "start" });
    while (s.status === "playing") {
      const who = s.turn!.playerId;
      run(who, { type: "roll", keep: [] });
      const card = s.players.find((p) => p.playerId === who)!.card;
      run(who, { type: "score", category: categories.find((c) => card[c] === undefined) });
    }
    expect(s.standings).toHaveLength(20);
    expect(rebuildFromEvents(s.log).status).toBe("finished");
  });
});

describe("방 정리 (D-046: 재접속 유예·서버 알람)", () => {
  type Room = Awaited<ReturnType<typeof setup>>;
  async function setup(seats: number, opts: { start?: boolean; kind?: "friend" | "random"; members?: boolean; deliverRecord?: HostEvents["deliverRecord"] } = {}) {
    const st = { record: null as string | null, alarm: null as number | null, cleared: false };
    const storage: HostStorage = {
      load: () => (st.record ? JSON.parse(st.record) : null),
      save: (r) => void (st.record = JSON.stringify(r)),
      getAlarm: () => st.alarm,
      setAlarm: (at) => void (st.alarm = at),
      deleteAlarm: () => void (st.alarm = null),
      clear: () => void ((st.record = null), (st.cleared = true)),
    };
    const clock = { t: 1_000_000 };
    const open: Sock[] = [];
    const deleted: string[] = [];
    const make = () => new RoomHost(storage, () => open, readConfig({ TURN_TIMEOUT_MS: "0" }), () => clock.t, seededDiceSource(1), { onDeleted: (c) => void deleted.push(c), deliverRecord: opts.deliverRecord });
    let host = make();
    host.init();
    const tokens: string[] = [];
    if (opts.kind === "random") {
      const made = await host.createMatched("ABCDEF", Array.from({ length: seats }, (_, i) => ({ name: "p" + i })), { kind: "random", public: true });
      if (!made.ok) throw Error(made.message);
      tokens.push(...made.seats.map((x) => x.token));
    } else for (let i = 0; i < seats; i++) {
      const identity = opts.members ? { userId: "u_" + String(i).padStart(22, "0") } : null;
      const r = i === 0 ? await host.create("ABCDEF", "p" + i, identity, null, seats) : await host.join("p" + i, identity);
      if (!r.ok) throw Error("join");
      tokens.push(r.token);
    }
    const socks: Sock[] = [];
    const connect = async (i: number) => {
      const x = new Sock();
      open.push(x);
      host.accepted(x);
      await host.message(x, JSON.stringify({ t: "hello", token: tokens[i] }));
      socks[i] = x;
      return x;
    };
    for (let i = 0; i < seats; i++) await connect(i);
    if (opts.kind !== "random" && opts.start !== false) {
      for (let i = 1; i < seats; i++) await host.message(socks[i], JSON.stringify({ t: "ready", ready: true }));
      await host.message(socks[0], JSON.stringify({ t: "cmd", id: "go", action: { type: "start" } }));
    }
    const drop = async (i: number) => {
      open.splice(open.indexOf(socks[i]), 1);
      await host.closed(socks[i]);
    };
    /** Advance the clock to the pending alarm (or by `ms`) and run it. */
    const tick = async (ms?: number) => {
      clock.t = ms === undefined ? Math.max(clock.t, st.alarm ?? clock.t) : clock.t + ms;
      await host.alarm();
    };
    const evict = () => {
      host = make();
      host.init();
    };
    return { st, clock, open, socks, tokens, deleted, connect, drop, tick, evict, get host() {
      return host;
    } };
  }
  const status = (r: Room) => r.host.room?.match.status ?? "removed";

  it("모두 나간 진행 중 경기: 친구 방은 15분, 빠른 대전은 5분 뒤 정리된다 (그 전에는 남는다)", async () => {
    for (const [seats, kind, wait] of [[2, "friend", 15], [4, "friend", 15], [2, "random", 5]] as const) {
      const r = await setup(seats, { kind });
      expect(status(r)).toBe("playing");
      for (let i = 0; i < seats; i++) await r.drop(i);
      await r.tick(wait * 60_000 - 1000);
      expect(r.st.cleared).toBe(false);
      await r.tick(2000);
      expect(r.st.cleared).toBe(true);
      expect(r.deleted).toEqual(["ABCDEF"]);
    }
  });

  it("경기 중 한 명이 끊기면 남은 사람에게 유예 시간을 알리고, 돌아오면 이어서, 2분 넘게 안 오면 'left'로 기권 처리한다", async () => {
    const r = await setup(2);
    const [a, b] = r.socks;
    await r.drop(1);
    const away = a.last("presence")!.away as Record<string, number>;
    expect(Object.values(away)[0]).toBe(LIFECYCLE.reconnectGraceMs);
    // back within the grace: nothing happens
    await r.tick(LIFECYCLE.reconnectGraceMs - 5000);
    await r.connect(1);
    expect(a.last("presence")!.away).toBeUndefined();
    await r.tick(LIFECYCLE.reconnectGraceMs * 2);
    expect(status(r)).toBe("playing");
    void b;
    // gone for good: forfeited "left" once the grace is over (not a resignation)
    await r.drop(1);
    await r.tick();
    const forfeit = r.host.room!.match.log.find((e) => e.type === "playerForfeited");
    expect(forfeit).toMatchObject({ reason: "left" });
    expect(status(r)).toBe("finished");
    expect(r.host.room!.match.winners).toEqual([r.host.room!.match.players[0].playerId]);
    // the stored log still passes the engine audit (abandon replays)
    expect(() => rebuildFromEvents(r.host.room!.match.log)).not.toThrow();
  });

  it("3명 이상: 끊긴 한 명만 기권 처리되고 나머지는 계속한다", async () => {
    const r = await setup(4);
    const gone = r.socks[2].last("welcome")!.playerId as string;
    await r.drop(2);
    await r.tick(LIFECYCLE.reconnectGraceMs + 1000);
    const p2 = r.host.room!.match.players.find((p) => p.playerId === gone)!;
    expect(p2.status).toBe("forfeited");
    expect(status(r)).toBe("playing");
    expect(r.host.room!.match.players.filter((p) => p.status === "active")).toHaveLength(3);
  });

  it("유예 기록은 저장 쓰기 없이 남은 소켓에 보관되어 Hibernation 뒤에도 이어진다", async () => {
    const r = await setup(2);
    await r.drop(1);
    const before = r.st.record;
    await r.tick(60_000);
    r.evict(); // memory gone; the remaining socket carries when the other player left
    await r.tick(LIFECYCLE.reconnectGraceMs - 60_000 + 1000);
    expect(r.host.room!.match.log.find((e) => e.type === "playerForfeited")).toMatchObject({ reason: "left" });
    void before;
  });

  it("클라이언트는 abandon 명령을 보낼 수 없다", async () => {
    const r = await setup(2);
    await r.host.message(r.socks[0], JSON.stringify({ t: "cmd", id: "x", action: { type: "abandon" } }));
    expect(r.socks[0].last("ack")).toMatchObject({ id: "x", ok: false });
    expect(status(r)).toBe("playing");
  });

  it("대기실: 끊긴 자리는 10분 뒤 비워지고(방장은 넘어감), 모두 떠나면 방이 정리된다", async () => {
    const r = await setup(3, { start: false });
    await r.drop(0); // the host
    await r.tick(LIFECYCLE.lobbySeatGraceMs + 1000);
    expect(r.host.room!.match.players.map((p) => p.name)).toEqual(["p1", "p2"]);
    expect(r.socks[1].last("lobby")!.lobby.hostId).toBe(r.host.room!.match.players[0].playerId);
    await r.drop(1);
    await r.drop(2);
    await r.tick(LIFECYCLE.lobbySeatGraceMs + 1000);
    expect(r.st.cleared).toBe(true);
  });

  it("시작하지 않은 대기실은 접속해 있어도 2시간 뒤 정리된다", async () => {
    const r = await setup(3, { start: false });
    await r.tick(LIFECYCLE.unusedLobbyMs + 1000);
    expect(r.st.cleared).toBe(true);
  });

  it("정산 응답을 받지 못해도 종료한 방의 영속 기록은 알람과 재시작 뒤 재전달된다", async () => {
    let ack = false;
    const settlements = new Set<string>();
    const r = await setup(2, { members: true, deliverRecord: async (userId, record) => {
      settlements.add(userId + ":" + record.recordId);
      return ack;
    } });
    await r.host.message(r.socks[1], JSON.stringify({ t: "cmd", id: "rs", action: { type: "resign" } }));
    expect(status(r)).toBe("finished");
    expect(r.host.room!.pendingRecords()).toHaveLength(2);
    await r.drop(0);
    await r.drop(1);
    await r.tick(LIFECYCLE.emptyFinishedMs + 1000);
    expect(r.st.cleared).toBe(false);
    r.evict();
    expect(r.host.room!.pendingRecords()).toHaveLength(2);
    ack = true;
    await r.tick(60_000);
    expect(r.st.cleared).toBe(true);
    expect(r.deleted).toEqual(["ABCDEF"]);
    expect(settlements.size).toBe(2);
  });

  it("끝난 경기: 모두 나가면 3분 뒤, 결과 화면에 남아 있으면 10분 뒤 정리된다", async () => {
    const r = await setup(2);
    await r.host.message(r.socks[1], JSON.stringify({ t: "cmd", id: "rs", action: { type: "resign" } }));
    expect(status(r)).toBe("finished");
    await r.tick(9 * 60_000);
    expect(r.st.cleared).toBe(false);
    await r.drop(0);
    await r.drop(1);
    await r.tick(LIFECYCLE.emptyFinishedMs + 1000);
    expect(r.st.cleared).toBe(true);
    const r2 = await setup(2);
    await r2.host.message(r2.socks[1], JSON.stringify({ t: "cmd", id: "rs", action: { type: "resign" } }));
    await r2.tick(10 * 60_000 + 1000);
    expect(r2.st.cleared).toBe(true);
  });
});

describe("같은 방의 같은 닉네임", () => {
  it("번호를 붙여 구분하고 12자 제한을 지킨다", async () => {
    const { uniqueName } = await import("../src/online/room");
    expect(uniqueName("하늘", ["민수"])).toBe("하늘");
    expect(uniqueName("하늘", ["하늘"])).toBe("하늘 2");
    expect(uniqueName("Mina", ["mina", "MINA 2"])).toBe("Mina 3");
    expect(uniqueName("가나다라마바사아자차카타", ["가나다라마바사아자차카타"])).toBe("가나다라마바사아자차 2");
  });
});
