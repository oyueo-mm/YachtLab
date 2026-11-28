import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { categories } from "../src/engine";
import { seededDiceSource } from "../src/online";
import type { ServerMessage } from "../src/online/wire";
import { Client, ORIGIN, api as httpApi, closeAllClients } from "./helpers/online-client";
import { startOnlineServer, type OnlineServerOptions, type RunningOnlineServer } from "../server/online/server";

let servers: RunningOnlineServer[] = [];
afterEach(async () => {
  closeAllClients();
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function boot(options: OnlineServerOptions = {}) {
  const s = await startOnlineServer({ port: 0, dataDir: null, dice: seededDiceSource(7), allowedOrigins: [ORIGIN], ...options });
  servers.push(s);
  return s;
}

const api = (s: RunningOnlineServer, path: string, body?: unknown, origin = ORIGIN) => httpApi(s.url, path, body, origin);

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
    // wait for the close frame itself (it follows the error message; a fixed sleep can race it)
    expect(await intruder.waitForClose()).toBe(4001);
    await a.cmd({ type: "start" });
    await a.settled();
    // b tries to act as a (playerId in payload is ignored; the socket identity is b)
    const forged = await b.cmd({ type: "roll", keep: [], playerId: a.view!.you!.playerId });
    expect(forged.ok).toBe(false);
    if (!forged.ok) expect(forged.error.code).toBe("NOT_YOUR_TURN");
  });

  it("같은 닉네임 번호 붙이기·잘못된 닉네임·없는 방을 거부한다", async () => {
    const s = await boot();
    const created = await api(s, "/api/rooms", { name: "Mina" });
    // the same nickname in one room gets a number instead of a refusal (nicknames are set on the profile page)
    expect((await api(s, `/api/rooms/${created.body.code}/join`, { name: " mina " })).status).toBe(201);
    expect((await api(s, `/api/rooms/${created.body.code}/join`, { name: "" })).status).toBe(400);
    expect((await api(s, "/api/rooms", { name: "a\u0007b" })).status).toBe(400);
    expect((await api(s, "/api/rooms/ZZZZZZ/join", { name: "x" })).status).toBe(404);
    const summary = await api(s, `/api/rooms/${created.body.code}`);
    expect(summary.body).toEqual({ code: created.body.code, status: "lobby", seats: 2, players: ["Mina", "mina 2"], mode: "turns" });
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

  it("고정 순서는 서버가 공유한다: 선택 순서 그대로 양쪽에 전달되고, 굴린 뒤·재접속 후에도 같고, 턴이 바뀌면 비워진다", async () => {
    const s = await boot();
    const { code, a, b, tokens } = await twoPlayerRoom(s);
    await a.cmd({ type: "start" });
    await a.cmd({ type: "roll", keep: [] });
    await a.settled();
    // C(2) → A(0) → E(4): everyone, the sender included, gets the same ordered list
    const toB = b.next((m) => m.t === "hold" && m.keep.length === 3);
    const toA = a.next((m) => m.t === "hold" && m.n === 3);
    a.ws.send(JSON.stringify({ t: "hold", keep: [2], n: 1 }));
    a.ws.send(JSON.stringify({ t: "hold", keep: [2, 0], n: 2 }));
    a.ws.send(JSON.stringify({ t: "hold", keep: [2, 0, 4], n: 3 }));
    expect(await toB).toMatchObject({ t: "hold", playerId: a.view!.you!.playerId, keep: [2, 0, 4] });
    expect(await toA).toMatchObject({ keep: [2, 0, 4], n: 3 });
    // the opponent cannot change it
    b.ws.send(JSON.stringify({ t: "hold", keep: [1] }));
    await expect(a.next((m) => m.t === "hold" && m.keep[0] === 1, 200)).rejects.toThrow();
    // re-roll with the same keep (any order in the command): views carry the selection order
    const viewB = b.next((m) => m.t === "view" && m.view.turn?.rolls === 2);
    expect((await a.cmd({ type: "roll", keep: [2, 0, 4] })).ok).toBe(true);
    const v = (await viewB) as Extract<ServerMessage, { t: "view" }>;
    expect(v.hold).toMatchObject({ keep: [2, 0, 4] });
    expect(v.view.turn!.dice[2]).toBe(a.view!.turn!.dice[2]);
    // release A(0): the rest keep their order; selecting it again appends it
    a.ws.send(JSON.stringify({ t: "hold", keep: [2, 4], n: 4 }));
    a.ws.send(JSON.stringify({ t: "hold", keep: [2, 4, 0], n: 5 }));
    await b.next((m) => m.t === "hold" && m.keep.join() === "2,4,0");
    // a reconnecting screen gets the same order
    const b2 = new Client(s, code);
    const w = (await b2.hello(tokens[1])) as Extract<ServerMessage, { t: "welcome" }>;
    expect(w.hold).toMatchObject({ keep: [2, 4, 0] });
    // scoring ends the turn: hold cleared for everyone
    const cleared = b.next((m) => m.t === "view" && m.view.turn?.playerId === b.view!.you!.playerId);
    await a.cmd({ type: "score", category: "choice" });
    expect(((await cleared) as Extract<ServerMessage, { t: "view" }>).hold).toBeNull();
    // malformed hold (duplicates) is refused
    b.ws.send(JSON.stringify({ t: "hold", keep: [1, 1] }));
    expect((await b.next((m) => m.t === "error")).t).toBe("error");
  });

  it("고정 순서는 다음 명령과 함께 저장되어 서버 재시작 후에도 복구된다(별도 저장 없음)", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "yachtlab-hold-"));
    const s = await boot({ dataDir });
    const { code, a, tokens } = await twoPlayerRoom(s);
    await a.cmd({ type: "start" });
    await a.cmd({ type: "roll", keep: [] });
    a.ws.send(JSON.stringify({ t: "hold", keep: [3, 1], n: 1 }));
    await a.next((m) => m.t === "hold");
    await a.cmd({ type: "roll", keep: [3, 1] });
    await a.settled();
    await s.close();
    servers = servers.filter((x) => x !== s);
    const s2 = await boot({ dataDir });
    const a2 = new Client(s2, code);
    const w = (await a2.hello(tokens[0])) as Extract<ServerMessage, { t: "welcome" }>;
    expect(w.hold).toMatchObject({ keep: [3, 1] });
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
    await expect(a.waitForClose()).resolves.toBe(1009);
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
    await expect(r.a.waitForClose()).resolves.toBe(1008);
  });
});

describe("종료(close)", () => {
  it("브라우저가 미리 열어 두고 쓰지 않은 연결·유휴 keep-alive·열린 웹소켓이 있어도 바로 종료된다", async () => {
    const { connect } = await import("node:net");
    const { default: WebSocket } = await import("ws");
    const srv = await startOnlineServer({ port: 0, dataDir: null, allowedOrigins: ["http://127.0.0.1:5173"], turnTimeoutMs: null });
    // 1) a pre-opened socket that never sends a request (what Chromium's preconnect does)
    const idle = connect(srv.port, "127.0.0.1");
    await new Promise((r) => idle.once("connect", r));
    // 2) a keep-alive HTTP connection after one request
    await fetch(srv.url + "/healthz", { keepalive: true });
    // 3) a WebSocket into a room
    const created = await (await fetch(srv.url + "/api/rooms", { method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:5173" }, body: JSON.stringify({ name: "민수" }) })).json();
    const ws = new WebSocket(srv.url.replace("http", "ws") + "/ws/" + created.code, { origin: "http://127.0.0.1:5173" });
    await new Promise((r) => ws.once("open", r));
    const t = Date.now();
    await srv.close();
    expect(Date.now() - t).toBeLessThan(2000);
    // nothing can connect afterwards
    await expect(fetch(srv.url + "/healthz")).rejects.toThrow();
  });
});

it("방 만들기의 진행 설정을 저장하고 지원하지 않는 시간을 거부한다", async () => {
  const server = await boot();
  const settings = { mode: "simultaneous", timeoutMs: 60_000 };
  expect((await api(server, "/api/features")).body.createSettings).toBe(true);
  expect((await api(server, "/api/rooms", { name: "민수", settings: { ...settings, timeoutMs: null } })).status).toBe(400);
  const created = await api(server, "/api/rooms", { name: "민수", maxPlayers: 3, settings });
  expect(created.status).toBe(201);
  expect((await api(server, `/api/rooms/${created.body.code}`)).body).toMatchObject({ seats: 3, mode: "simultaneous" });
  const client = new Client(server, created.body.code);
  const welcome = await client.hello(created.body.token);
  expect(welcome).toMatchObject({ lobby: { settings, maxPlayers: 3 } });
});
