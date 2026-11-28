import { describe, expect, it } from "vitest";
import { seededDiceSource } from "../src/online";
import type { RoomRecord } from "../src/online/room";
import { RoomHost, type HostSocket, type HostStorage } from "../worker/src/host";
import { readConfig } from "../worker/src/config";

/**
 * C3.1 (SOC-1): friend-room members vs the match roster. Members choose "ready" / "watch" / "idle" in the
 * waiting room; watchers are not counted for ready or the minimum, get the spectator projection, no
 * commands, no records, no external watch key; after the match the host brings everyone back to the
 * waiting room to choose again. Runtime-free (fake sockets, fake clock), same harness as online-multi.
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


const you = (p: { sock: Sock }) => (p.sock.last("view") ?? p.sock.last("welcome"))!.view;
async function playOut(h: ReturnType<typeof harness>, ps: { sock: Sock; id: string }[]) {
  for (let guard = 0; guard < 400; guard++) {
    const v = you(ps[0]);
    if (v.status === "finished") return;
    const turn = v.turn?.playerId;
    const p = ps.find((x) => x.id === turn)!;
    h.advance(2_000);
    const mine = you(p);
    if (mine.legal?.canRoll && (mine.turn?.rolls ?? 0) === 0) await h.cmd(p, { type: "roll", keep: [] });
    const best = you(p).legal.scores.sort((x: any, y: any) => y.points - x.points)[0];
    await h.cmd(p, { type: "score", category: best.category });
  }
  throw Error("match did not finish");
}

describe("C3.1 대기실 참가/관전 분리", () => {
  it("관전 선택자는 준비·최소 인원에서 빠지고, 경기 중에는 관전 화면(조작 불가·외부 관전 키 없음)을 받는다", async () => {
    const h = harness(4);
    const host = await h.join("방장", true);
    const b = await h.join("관전", true);
    const c = await h.join("셋째", true);
    await h.send(b, { t: "intent", value: "watch" });
    let lobby = host.sock.last("lobby")!.lobby;
    expect(lobby.intent).toEqual({ [host.id]: "idle", [b.id]: "watch", [c.id]: "idle" });
    expect(lobby.watchers).toEqual({ [b.id]: "관전" });
    expect(lobby.minPlayers).toBe(2);
    // the watcher is not needed as "ready", but the other player is (watchers in the room)
    expect((await h.cmd(host, { type: "start" })).error.code).toBe("NOT_READY");
    await h.send(c, { t: "intent", value: "ready" });
    // external spectating on (link): players get the key, the watching member will not
    await h.send(host, { t: "spectate", allow: true, visibility: "invite" });
    expect((await h.cmd(host, { type: "start" })).ok).toBe(true);
    const v = you(host);
    expect(v.players.map((p: any) => p.playerId).sort()).toEqual([host.id, c.id].sort());
    const bv = you(b);
    expect(bv.status).toBe("playing");
    expect(bv.you).toBeNull();
    expect(bv.legal ?? null).toBeNull();
    expect((await h.cmd(b, { type: "roll", keep: [] }))).toBeUndefined();
    expect(b.sock.last("error")!.code).toBe("SPECTATOR");
    await h.send(b, { t: "say", id: "x" });
    expect(b.sock.last("error")!.code).toBe("SPECTATOR");
    lobby = host.sock.last("lobby")!.lobby;
    expect(lobby.watchers).toEqual({ [b.id]: "관전" });
    // reconnecting watcher: role watcher, neutral view, no key / sid
    const again = new Sock();
    (h.host as unknown as { sockets: () => Sock[] }).sockets().push(again);
    h.host.accepted(again);
    await h.host.message(again, JSON.stringify({ t: "hello", token: b.token }));
    const w = again.last("welcome")!;
    expect(w.role).toBe("watcher");
    expect(w.view.you).toBeNull();
    expect(w.spectate.key).toBeNull();
    expect(w.spectate.sid).toBeUndefined();
    expect(host.sock.last("welcome")!.role).toBe("player");
    // participant-only rooms: the roster accounts only are reserved
    // intent changes are refused during the match
    await h.send(c, { t: "intent", value: "watch" });
    expect(c.sock.last("error")!.code).toBe("LOBBY");
  });

  it("참가자가 2명 미만이면 시작할 수 없다(관전자는 인원에 포함되지 않음)", async () => {
    const h = harness(3);
    const host = await h.join("방장");
    const b = await h.join("둘");
    const c = await h.join("셋");
    await h.send(b, { t: "intent", value: "watch" });
    await h.send(c, { t: "intent", value: "watch" });
    const r = await h.cmd(host, { type: "start" });
    expect(r.error.code).toBe("NOT_ENOUGH_PLAYERS");
    expect(r.error.message).toContain("관전");
  });

  it("방장도 관전할 수 있고 방장 권한(시작·외부 관전 범위·대기실 복귀)을 유지한다; 기록·보상은 참가자에게만", async () => {
    const h = harness(3);
    const host = await h.join("방장", true);
    const b = await h.join("둘", true);
    const c = await h.join("셋", true);
    await h.send(host, { t: "intent", value: "watch" });
    await h.send(b, { t: "intent", value: "ready" });
    await h.send(c, { t: "ready", ready: true }); // older page: ready == intent ready
    expect(host.sock.last("lobby")!.lobby.intent[c.id]).toBe("ready");
    expect((await h.cmd(host, { type: "start" })).ok).toBe(true);
    expect(you(host).you).toBeNull();
    expect(host.sock.last("lobby")!.lobby.hostId).toBe(host.id);
    await h.send(host, { t: "spectate", allow: true, visibility: "invite" });
    expect(b.sock.last("spectate")!.spectate.visibility).toBe("invite");
    // the watching host has no key, players have it
    expect(host.sock.last("spectate")!.spectate.key).toBeNull();
    expect(typeof b.sock.last("spectate")!.spectate.key).toBe("string");
    await playOut(h, [b, c]);
    await new Promise((r) => setTimeout(r, 0));
    await h.host.flushRecords();
    const users = h.delivered.map((d) => d.userId).sort();
    expect(users).toEqual(["u_둘".padEnd(24, "x").slice(0, 24), "u_셋".padEnd(24, "x").slice(0, 24)].sort());
    expect(h.delivered.some((d) => d.userId.startsWith("u_방장"))).toBe(false);
    // not the host: cannot bring the room back
    await h.send(b, { t: "return" });
    expect(b.sock.last("error")!.code).toBe("LOBBY");
    h.advance(1000);
    await h.send(host, { t: "return" });
    const lobby = c.sock.last("lobby")!.lobby;
    expect(you(c).status).toBe("lobby");
    expect(you(c).players.map((p: any) => p.playerId).sort()).toEqual([host.id, b.id, c.id].sort());
    expect(lobby.intent).toEqual({ [host.id]: "idle", [b.id]: "idle", [c.id]: "idle" });
    expect(lobby.hostId).toBe(host.id);
    // choose again: host plays now, c watches
    h.advance(1000);
    await h.send(c, { t: "intent", value: "watch" });
    await h.send(b, { t: "intent", value: "ready" });
    expect((await h.cmd(host, { type: "start" })).ok).toBe(true);
    expect(you(c).you).toBeNull();
    expect(you(host).you.playerId).toBe(host.id);
    // the second match pays its own budget unit
    expect(h.allowed.at(-1)).toBe(1);
    expect(JSON.parse(h.st.record!).matchNo).toBe(2);
  });

  it("관전 중인 구성원이 나가면 좌석 토큰이 끝나고, 대기실 복귀 때 빠진다; 방장 이양은 관전자에게도 가능", async () => {
    const h = harness(3);
    const host = await h.join("방장");
    const b = await h.join("둘");
    const c = await h.join("셋");
    await h.send(host, { t: "host", to: c.id });
    expect(b.sock.last("lobby")!.lobby.hostId).toBe(c.id);
    h.advance(400);
    await h.send(c, { t: "intent", value: "watch" });
    await h.send(b, { t: "intent", value: "ready" });
    await h.send(host, { t: "intent", value: "ready" });
    expect((await h.cmd(c, { type: "start" })).ok).toBe(true);
    await h.send(c, { t: "bye" });
    expect(c.sock.closed).toBe(4002);
    // host passes to the earliest remaining member
    expect(host.sock.last("lobby")!.lobby.hostId).toBe(host.id);
    const again = new Sock();
    (h.host as unknown as { sockets: () => Sock[] }).sockets().push(again);
    h.host.accepted(again);
    await h.host.message(again, JSON.stringify({ t: "hello", token: c.token }));
    expect(again.closed).toBe(4001);
    await playOut(h, [host, b]);
    h.advance(1000);
    await h.send(host, { t: "return" });
    expect(you(b).players.map((p: any) => p.playerId).sort()).toEqual([host.id, b.id].sort());
  });

  it("20인 방: 2명 관전, 18명 동시 진행 경기, 관전자는 순위·기록에 없다", async () => {
    const h = harness(20);
    const ps = [];
    for (let i = 0; i < 20; i++) ps.push(await h.join("p" + i, true));
    await h.send(ps[0], { t: "settings", mode: "simultaneous", timeoutMs: 60_000 });
    await h.send(ps[18], { t: "intent", value: "watch" });
    await h.send(ps[19], { t: "intent", value: "watch" });
    for (const p of ps.slice(1, 18)) await h.send(p, { t: "intent", value: "ready" });
    expect((await h.cmd(ps[0], { type: "start" })).ok).toBe(true);
    const v = you(ps[0]);
    expect(v.players).toHaveLength(18);
    expect(Object.keys(v.progress)).toHaveLength(18);
    expect(you(ps[19]).you).toBeNull();
    // budget: 18 players → 9 units (1 at creation + 8 here)
    expect(h.allowed.at(-1)).toBe(8);
    const lobby = ps[0].sock.last("lobby")!.lobby;
    expect(Object.keys(lobby.watchers)).toEqual([ps[18].id, ps[19].id]);
  });

  it("C3.1 이전에 저장된 방(members 없음)은 좌석 = 구성원으로 읽는다", async () => {
    const h = harness(3);
    const a = await h.join("하나");
    const b = await h.join("둘");
    const rec = JSON.parse(h.st.record!) as RoomRecord;
    delete rec.members;
    h.st.record = JSON.stringify(rec);
    const h2host = new RoomHost(
      { load: () => JSON.parse(h.st.record!), save: (r) => void (h.st.record = JSON.stringify(r)), getAlarm: () => null, setAlarm: () => undefined, deleteAlarm: () => undefined, clear: () => undefined },
      () => [],
      readConfig({ TURN_TIMEOUT_MS: "120000" }),
      () => h.now(),
      seededDiceSource(3),
    );
    h2host.init();
    const c = await h2host.join("셋", null);
    expect(c.ok).toBe(true);
    const after = JSON.parse(h.st.record!) as RoomRecord;
    expect(Object.keys(after.members!).sort()).toEqual([a.id, b.id, (c as any).playerId].sort());
  });
});
