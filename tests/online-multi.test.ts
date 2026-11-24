import { describe, expect, it } from "vitest";
import { seededDiceSource } from "../src/online";
import { MAX_MISSED_ROUNDS } from "../src/online/protocol";
import { applyCommand, createOnlineMatch, rebuildFromEvents } from "../src/online/server-engine";
import type { RoomRecord } from "../src/online/room";
import { RoomHost, type HostSocket, type HostStorage } from "../worker/src/host";
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

describe("방 정리", () => {
  it("3명 이상 방에서 모두 나간 진행 중 경기는 2시간 뒤 정리되고, 1:1 방은 기존 유예를 유지한다", async () => {
    const run = async (seats: number) => {
      const st = { record: null as string | null, alarm: null as number | null, cleared: false };
      const storage: HostStorage = {
        load: () => (st.record ? JSON.parse(st.record) : null),
        save: (r) => void (st.record = JSON.stringify(r)),
        getAlarm: () => st.alarm,
        setAlarm: (at) => void (st.alarm = at),
        deleteAlarm: () => void (st.alarm = null),
        clear: () => void ((st.record = null), (st.cleared = true)),
      };
      let t = 1_000_000;
      const open: Sock[] = [];
      const host = new RoomHost(storage, () => open, readConfig({ TURN_TIMEOUT_MS: "0" }), () => t, seededDiceSource(1));
      host.init();
      const ids = [];
      for (let i = 0; i < seats; i++) ids.push(i === 0 ? await host.create("ABCDEF", "p" + i, null, null, seats) : await host.join("p" + i, null));
      const s = new Sock();
      open.push(s);
      host.accepted(s);
      await host.message(s, JSON.stringify({ t: "hello", token: (ids[0] as { token: string }).token }));
      for (const [i, r] of ids.entries()) if (i > 0) {
        const x = new Sock();
        open.push(x);
        host.accepted(x);
        await host.message(x, JSON.stringify({ t: "hello", token: (r as { token: string }).token }));
        await host.message(x, JSON.stringify({ t: "ready", ready: true }));
      }
      await host.message(s, JSON.stringify({ t: "cmd", id: "go", action: { type: "start" } }));
      expect(host.room!.match.status).toBe("playing");
      for (const x of [...open]) await host.closed(x);
      open.length = 0;
      t += 2 * 3600_000 + 1000;
      await host.alarm();
      return st.cleared;
    };
    expect(await run(4)).toBe(true);
    expect(await run(2)).toBe(false);
  });
});
