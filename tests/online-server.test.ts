import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { categories } from "../src/engine";
import { seededDiceSource } from "../src/online";
import type { PlayerView } from "../src/online";
import type { ServerMessage } from "../src/online/wire";
import { startOnlineServer, type OnlineServerOptions, type RunningOnlineServer } from "../server/online/server";

const ORIGIN = "http://127.0.0.1:5173";
let servers: RunningOnlineServer[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.terminate());
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function boot(options: OnlineServerOptions = {}) {
  const s = await startOnlineServer({ port: 0, dataDir: null, dice: seededDiceSource(7), allowedOrigins: [ORIGIN], ...options });
  servers.push(s);
  return s;
}

async function api(s: RunningOnlineServer, path: string, body?: unknown, origin = ORIGIN) {
  const res = await fetch(s.url + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", origin },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

/** Minimal test client: records every message, lets tests await a predicate. */
class Client {
  messages: ServerMessage[] = [];
  view: PlayerView | null = null;
  ws: WebSocket;
  closed: { code: number } | null = null;
  private waiters: { test: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  private n = 0;
  constructor(s: RunningOnlineServer, code: string, origin = ORIGIN) {
    this.ws = new WebSocket(s.url.replace("http", "ws") + "/ws/" + code, { origin });
    sockets.push(this.ws);
    this.ws.on("message", (data) => {
      const m = JSON.parse(data.toString()) as ServerMessage;
      this.messages.push(m);
      if (m.t === "welcome" || m.t === "view") this.view = m.view;
      this.waiters = this.waiters.filter((w) => (w.test(m) ? (w.resolve(m), false) : true));
    });
    this.ws.on("close", (code) => (this.closed = { code }));
  }
  opened() {
    return new Promise<void>((resolve, reject) => {
      if (this.ws.readyState === WebSocket.OPEN) return resolve();
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
  }
  next(test: (m: ServerMessage) => boolean, ms = 3000) {
    return new Promise<ServerMessage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout waiting for message")), ms);
      this.waiters.push({ test, resolve: (m) => (clearTimeout(timer), resolve(m)) });
    });
  }
  async hello(token: string, since?: number) {
    await this.opened();
    const welcome = this.next((m) => m.t === "welcome" || m.t === "error");
    this.ws.send(JSON.stringify({ t: "hello", token, since }));
    return welcome;
  }
  async cmd(action: unknown, id = `c${++this.n}-${Math.random().toString(36).slice(2, 8)}`, v?: number) {
    const ack = this.next((m) => m.t === "ack" && m.id === id);
    this.ws.send(JSON.stringify({ t: "cmd", id, v, action }));
    return (await ack) as Extract<ServerMessage, { t: "ack" }>;
  }
  async settled() {
    // Views are sent right after the ack; give the socket a moment to deliver them.
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function twoPlayerRoom(s: RunningOnlineServer) {
  const created = await api(s, "/api/rooms", { name: "민수" });
  expect(created.status).toBe(201);
  const joined = await api(s, `/api/rooms/${created.body.code}/join`, { name: "지민" });
  expect(joined.status).toBe(201);
  const a = new Client(s, created.body.code);
  const b = new Client(s, created.body.code);
  await a.hello(created.body.token);
  await b.hello(joined.body.token);
  return { code: created.body.code as string, a, b, tokens: [created.body.token as string, joined.body.token as string] };
}

/** Plays one turn for whoever's turn it is: roll once, score the best open category. */
async function playTurn(clients: Client[]) {
  const current = clients.find((c) => c.view?.legal)!;
  expect(current).toBeTruthy();
  const roll = await current.cmd({ type: "roll", keep: [] });
  expect(roll.ok).toBe(true);
  await current.settled();
  const scores = current.view!.legal!.scores;
  const best = [...scores].sort((x, y) => y.points - x.points)[0];
  const ack = await current.cmd({ type: "score", category: best.category });
  expect(ack.ok).toBe(true);
  await current.settled();
}

describe("Online Phase 2 — local WebSocket server", () => {
  it("두 브라우저가 방 코드로 입장해 12라운드를 끝까지 플레이하고 양쪽 화면이 같은 결과를 받는다", async () => {
    const s = await boot();
    const { code, a, b } = await twoPlayerRoom(s);
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    await a.settled();
    expect(a.view!.players.map((p) => p.name)).toEqual(["민수", "지민"]);
    expect(a.view!.you!.isHost).toBe(true);
    // guest cannot start
    expect((await b.cmd({ type: "start" })).ok).toBe(false);
    expect((await a.cmd({ type: "start" })).ok).toBe(true);
    await a.settled();
    expect(b.view!.status).toBe("playing");
    for (let turn = 0; turn < 24; turn++) await playTurn([a, b]);
    await b.settled();
    expect(a.view!.status).toBe("finished");
    expect(b.view!.standings).toEqual(a.view!.standings);
    for (const p of a.view!.players) expect(Object.keys(p.card)).toHaveLength(categories.length);
    expect(a.view!.version).toBe(b.view!.version);
  });

  it("방 코드만으로는 좌석을 빼앗을 수 없다: 잘못된 토큰 거부, 만석 입장 거부, 페이로드 playerId 무시", async () => {
    const s = await boot();
    const { code, a, b } = await twoPlayerRoom(s);
    const third = await api(s, `/api/rooms/${code}/join`, { name: "도윤" });
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe("MATCH_FULL");
    const intruder = new Client(s, code);
    const res = await intruder.hello("x".repeat(43));
    expect(res.t).toBe("error");
    await new Promise((r) => setTimeout(r, 50));
    expect(intruder.closed?.code).toBe(4001);
    await a.cmd({ type: "start" });
    await a.settled();
    // b tries to act as a (playerId in payload is ignored; the socket identity is b)
    const forged = await b.cmd({ type: "roll", keep: [], playerId: a.view!.you!.playerId });
    expect(forged.ok).toBe(false);
    if (!forged.ok) expect(forged.error.code).toBe("NOT_YOUR_TURN");
  });

  it("닉네임 충돌·잘못된 닉네임·없는 방을 거부한다", async () => {
    const s = await boot();
    const created = await api(s, "/api/rooms", { name: "Mina" });
    expect((await api(s, `/api/rooms/${created.body.code}/join`, { name: " mina " })).body.error.code).toBe("NAME_TAKEN");
    expect((await api(s, `/api/rooms/${created.body.code}/join`, { name: "" })).status).toBe(400);
    expect((await api(s, "/api/rooms", { name: "a\u0007b" })).status).toBe(400);
    expect((await api(s, "/api/rooms/ZZZZZZ/join", { name: "x" })).status).toBe(404);
    const summary = await api(s, `/api/rooms/${created.body.code}`);
    expect(summary.body).toEqual({ code: created.body.code, status: "lobby", seats: 2, players: ["Mina"] });
    expect(JSON.stringify(summary.body)).not.toContain("token");
  });

  it("같은 명령 재전송은 한 번만 적용되고, 차례 위반·오래된 버전은 거부된다", async () => {
    const s = await boot();
    const { a, b } = await twoPlayerRoom(s);
    await a.cmd({ type: "start" });
    await a.settled();
    const first = await a.cmd({ type: "roll", keep: [] }, "roll-1");
    expect(first).toMatchObject({ ok: true, duplicate: false });
    await a.settled();
    const dice = a.view!.turn!.dice;
    const again = await a.cmd({ type: "roll", keep: [] }, "roll-1");
    expect(again).toMatchObject({ ok: true, duplicate: true });
    await a.settled();
    expect(a.view!.turn!.rolls).toBe(1);
    expect(a.view!.turn!.dice).toEqual(dice);
    const stale = await a.cmd({ type: "roll", keep: [0] }, "roll-2", 1);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe("STALE_VERSION");
    const wrong = await b.cmd({ type: "score", category: "aces" });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.code).toBe("NOT_YOUR_TURN");
  });

  it("고정 미리보기는 현재 차례인 플레이어만 보낼 수 있고 상대에게만 전달된다", async () => {
    const s = await boot();
    const { a, b } = await twoPlayerRoom(s);
    await a.cmd({ type: "start" });
    await a.cmd({ type: "roll", keep: [] });
    await a.settled();
    const hint = b.next((m) => m.t === "hold");
    a.ws.send(JSON.stringify({ t: "hold", keep: [3, 1] }));
    expect(await hint).toMatchObject({ t: "hold", keep: [1, 3], playerId: a.view!.you!.playerId });
    b.ws.send(JSON.stringify({ t: "hold", keep: [0] }));
    await expect(a.next((m) => m.t === "hold", 200)).rejects.toThrow();
  });

  it("새로고침·재접속: 같은 토큰으로 다시 연결하면 sinceSeq 이후 이벤트와 현재 상태를 받는다", async () => {
    const s = await boot();
    const { code, a, b, tokens } = await twoPlayerRoom(s);
    await a.cmd({ type: "start" });
    await a.settled();
    const seen = b.view!.version;
    b.ws.close();
    await a.cmd({ type: "roll", keep: [] });
    await a.cmd({ type: "score", category: "choice" });
    await a.settled();
    const b2 = new Client(s, code);
    const welcome = (await b2.hello(tokens[1], seen)) as Extract<ServerMessage, { t: "welcome" }>;
    expect(welcome.t).toBe("welcome");
    expect(welcome.view.events.map((e) => e.type)).toEqual(["diceRolled", "categoryScored", "turnStarted"]);
    expect(welcome.view.legal).not.toBeNull();
    expect(welcome.online.sort()).toEqual([a.view!.you!.playerId, welcome.playerId].sort());
    // a duplicate tab with the same token also works and both receive updates
    const b3 = new Client(s, code);
    await b3.hello(tokens[1]);
    await b2.cmd({ type: "roll", keep: [] });
    await b3.settled();
    expect(b3.view!.turn!.rolls).toBe(1);
  });

  it("서버 재시작 후 저장된 로그를 감사·복구하고 같은 토큰으로 경기를 이어간다; 변조된 파일은 거부한다", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "yachtlab-online-"));
    const s = await boot({ dataDir });
    const { code, a, tokens } = await twoPlayerRoom(s);
    await a.cmd({ type: "start" });
    await a.cmd({ type: "roll", keep: [] }, "r-before-restart");
    await a.settled();
    const before = a.view!;
    await s.close();
    servers = servers.filter((x) => x !== s);
    const raw = await readFile(join(dataDir, `${code}.json`), "utf8");
    expect(raw).not.toContain(tokens[0]);
    const s2 = await boot({ dataDir, dice: seededDiceSource(99) });
    const a2 = new Client(s2, code);
    const welcome = (await a2.hello(tokens[0])) as Extract<ServerMessage, { t: "welcome" }>;
    expect(welcome.view.version).toBe(before.version);
    expect(welcome.view.turn!.dice).toEqual(before.turn!.dice);
    // the retried command after a lost response is recognised after the restart too
    expect(await a2.cmd({ type: "roll", keep: [] }, "r-before-restart")).toMatchObject({ ok: true, duplicate: true });
    expect((await a2.cmd({ type: "score", category: "choice" })).ok).toBe(true);
    await s2.close();
    servers = servers.filter((x) => x !== s2);
    // tamper: change a rolled die
    const record = JSON.parse(await readFile(join(dataDir, `${code}.json`), "utf8"));
    const rolled = record.log.find((e: { type: string }) => e.type === "categoryScored");
    rolled.points += 10;
    await writeFile(join(dataDir, `${code}.json`), JSON.stringify(record));
    const lines: string[] = [];
    const s3 = await boot({ dataDir, log: (l) => lines.push(l) });
    expect(s3.rooms.has(code)).toBe(false);
    expect(lines.join("\n")).toContain(`skip room ${code}`);
    expect(await readdir(dataDir)).toContain(`${code}.json`);
  });

  it("서버 턴 타이머: 제한 시간이 지나면 서버가 시간 초과를 처리해 경기를 끝낸다", async () => {
    const s = await boot({ turnTimeoutMs: 1000 });
    const { a, b } = await twoPlayerRoom(s);
    await a.cmd({ type: "start" });
    await a.settled();
    expect(a.view!.turn!.deadline).not.toBeNull();
    const finished = b.next((m) => (m.t === "view" || m.t === "welcome") && m.view.status === "finished", 4000);
    await finished;
    expect(b.view!.winners).toEqual([b.view!.you!.playerId]);
    expect(b.view!.players.find((p) => p.playerId === a.view!.you!.playerId)!.status).toBe("forfeited");
  });

  it("방장 이탈 시 남은 사람이 방장이 되고, 모두 나간 방과 오래 비어 있는 방은 정리된다", async () => {
    let t = 1_000_000;
    const s = await boot({ now: () => t, idle: { lobbyMs: 60_000, finishedMs: 60_000, playingMs: 600_000 } });
    const { code, a, b } = await twoPlayerRoom(s);
    expect((await a.cmd({ type: "leave" })).ok).toBe(true);
    await b.settled();
    expect(b.view!.players.map((p) => p.name)).toEqual(["지민"]);
    expect(b.view!.you!.isHost).toBe(true);
    expect((await api(s, `/api/rooms/${code}`)).body.players).toEqual(["지민"]);
    await b.cmd({ type: "leave" });
    await new Promise((r) => setTimeout(r, 30));
    await s.sweep();
    expect(s.rooms.has(code)).toBe(false);
    // idle lobby without sockets
    const idleRoom = await api(s, "/api/rooms", { name: "혼자" });
    await s.sweep();
    expect(s.rooms.has(idleRoom.body.code)).toBe(true);
    t += 61_000;
    await s.sweep();
    expect(s.rooms.has(idleRoom.body.code)).toBe(false);
  });

  it("남용 방어: 허용되지 않은 출처, 너무 큰 메시지, 과도한 요청, 방 개수 한도", async () => {
    const s = await boot();
    expect((await api(s, "/api/rooms", { name: "x" }, "https://evil.example")).status).toBe(403);
    const { code, a } = await twoPlayerRoom(s);
    const evil = new Client(s, code, "https://evil.example");
    await expect(evil.opened()).rejects.toThrow();
    a.ws.send("x".repeat(3000));
    await new Promise((r) => setTimeout(r, 50));
    expect(a.closed?.code).toBe(1009);
    // per-IP creation limit (3/min here; the first room above used one)
    const s2 = await boot({ perMinute: { create: 3, join: 30 } });
    for (let i = 0; i < 3; i++) expect((await api(s2, "/api/rooms", { name: "n" + i })).status).toBe(201);
    expect((await api(s2, "/api/rooms", { name: "n4" })).status).toBe(429);
    // server-wide room cap
    const s3 = await boot({ maxRooms: 1 });
    expect((await api(s3, "/api/rooms", { name: "a" })).status).toBe(201);
    expect((await api(s3, "/api/rooms", { name: "b" })).status).toBe(503);
    // message flood closes the socket
    const s4 = await boot();
    const r = await twoPlayerRoom(s4);
    for (let i = 0; i < 60; i++) r.a.ws.send(JSON.stringify({ t: "ping" }));
    await new Promise((res) => setTimeout(res, 100));
    expect(r.a.closed?.code).toBe(1008);
  });
});
