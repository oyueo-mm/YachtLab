import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { categories } from "../src/engine";
import type { ServerMessage } from "../src/online/wire";
import { Client, api as httpApi, closeAllClients } from "./helpers/online-client";
import { startLocalWorker, type LocalWorker } from "./helpers/wrangler";

/**
 * Phase 3: the same black-box scenarios as the Node server, against the real Cloudflare runtime
 * (`wrangler dev --local`: workerd, SQLite-backed Durable Objects, WebSocket Hibernation API, alarms).
 * Nothing is deployed and no Cloudflare account is used.
 */
const HIGH = { CREATE_PER_MINUTE: "500", JOIN_PER_MINUTE: "500", TURN_TIMEOUT_MS: "0" };
let main: LocalWorker;
const extra: LocalWorker[] = [];
beforeAll(async () => {
  main = await startLocalWorker(HIGH);
}, 90_000);
afterAll(async () => {
  await Promise.all([main?.stop(), ...extra.map((w) => w.stop())]);
});
afterEach(() => closeAllClients());
const boot = async (vars: Record<string, string>) => {
  const w = await startLocalWorker({ ...HIGH, ...vars });
  extra.push(w);
  return w;
};
const api = (w: LocalWorker, path: string, body?: unknown, origin?: string) => httpApi(w.url, path, body, origin);

async function twoPlayerRoom(w: LocalWorker) {
  const created = await api(w, "/api/rooms", { name: "민수" });
  expect(created.status).toBe(201);
  const joined = await api(w, `/api/rooms/${created.body.code}/join`, { name: "지민" });
  expect(joined.status).toBe(201);
  const a = new Client(w.url, created.body.code);
  const b = new Client(w.url, created.body.code);
  expect((await a.hello(created.body.token)).t).toBe("welcome");
  expect((await b.hello(joined.body.token)).t).toBe("welcome");
  return { code: created.body.code as string, a, b, tokens: [created.body.token as string, joined.body.token as string] };
}

async function playTurn(clients: Client[]) {
  const current = clients.find((c) => c.view?.legal)!;
  expect(current).toBeTruthy();
  expect((await current.cmd({ type: "roll", keep: [] })).ok).toBe(true);
  await current.settled();
  const best = [...current.view!.legal!.scores].sort((x, y) => y.points - x.points)[0];
  expect((await current.cmd({ type: "score", category: best.category })).ok).toBe(true);
  await current.settled();
}

describe("Online Phase 3 — Workers + SQLite Durable Objects (wrangler dev, local)", () => {
  it("두 사람이 12라운드를 완주하고 양쪽 결과가 같다 (Hibernation 소켓·SQLite 저장)", async () => {
    const { a, b } = await twoPlayerRoom(main);
    await a.settled();
    expect(a.view!.players.map((p) => p.name)).toEqual(["민수", "지민"]);
    expect((await b.cmd({ type: "start" })).ok).toBe(false);
    expect((await a.cmd({ type: "start" })).ok).toBe(true);
    for (let turn = 0; turn < 24; turn++) await playTurn([a, b]);
    await b.settled();
    expect(a.view!.status).toBe("finished");
    expect(b.view!.standings).toEqual(a.view!.standings);
    for (const p of a.view!.players) expect(Object.keys(p.card)).toHaveLength(categories.length);
  }, 60_000);

  it("좌석 탈취 방지: 잘못된 토큰·만석 입장·페이로드 playerId 위조를 거부한다", async () => {
    const { code, a, b } = await twoPlayerRoom(main);
    expect((await api(main, `/api/rooms/${code}/join`, { name: "도윤" })).body.error.code).toBe("MATCH_FULL");
    const intruder = new Client(main.url, code);
    expect((await intruder.hello("x".repeat(43))).t).toBe("error");
    await new Promise((r) => setTimeout(r, 100));
    expect(intruder.closed?.code).toBe(4001);
    await a.cmd({ type: "start" });
    await a.settled();
    const forged = await b.cmd({ type: "roll", keep: [], playerId: a.view!.you!.playerId });
    expect(forged.ok).toBe(false);
    if (!forged.ok) expect(forged.error.code).toBe("NOT_YOUR_TURN");
  });

  it("중복 명령은 한 번만 적용되고, 잘못된 차례·오래된 버전은 거부된다", async () => {
    const { a, b } = await twoPlayerRoom(main);
    await a.cmd({ type: "start" });
    await a.settled();
    expect(await a.cmd({ type: "roll", keep: [] }, "roll-1")).toMatchObject({ ok: true, duplicate: false });
    await a.settled();
    const dice = a.view!.turn!.dice;
    expect(await a.cmd({ type: "roll", keep: [] }, "roll-1")).toMatchObject({ ok: true, duplicate: true });
    await a.settled();
    expect(a.view!.turn!.rolls).toBe(1);
    expect(a.view!.turn!.dice).toEqual(dice);
    const stale = await a.cmd({ type: "roll", keep: [0] }, "roll-2", 1);
    expect(stale.ok === false && stale.error.code).toBe("STALE_VERSION");
    const wrong = await b.cmd({ type: "score", category: "aces" });
    expect(wrong.ok === false && wrong.error.code).toBe("NOT_YOUR_TURN");
  });

  it("닉네임 충돌·잘못된 닉네임·없는 방, 초대 미리보기에는 토큰이 없다", async () => {
    const created = await api(main, "/api/rooms", { name: "Mina" });
    expect((await api(main, `/api/rooms/${created.body.code}/join`, { name: " mina " })).body.error.code).toBe("NAME_TAKEN");
    expect((await api(main, `/api/rooms/${created.body.code}/join`, { name: "" })).status).toBe(400);
    expect((await api(main, "/api/rooms", { name: "a\u0007b" })).status).toBe(400);
    expect((await api(main, "/api/rooms/ZZZZZZ/join", { name: "x" })).status).toBe(404);
    const summary = await api(main, `/api/rooms/${created.body.code}`);
    expect(summary.body).toEqual({ code: created.body.code, status: "lobby", seats: 2, players: ["Mina"] });
  });

  it("재접속: 같은 토큰으로 다시 연결하면 since 이후 이벤트를 받고, 중복 탭도 갱신된다; 핑은 자동 응답된다", async () => {
    const { code, a, b, tokens } = await twoPlayerRoom(main);
    await a.cmd({ type: "start" });
    await a.settled();
    const seen = b.view!.version;
    b.ws.close();
    await a.cmd({ type: "roll", keep: [] });
    await a.cmd({ type: "score", category: "choice" });
    await a.settled();
    const b2 = new Client(main.url, code);
    const welcome = (await b2.hello(tokens[1], seen)) as Extract<ServerMessage, { t: "welcome" }>;
    expect(welcome.view.events.map((e) => e.type)).toEqual(["diceRolled", "categoryScored", "turnStarted"]);
    expect(welcome.view.legal).not.toBeNull();
    const b3 = new Client(main.url, code);
    await b3.hello(tokens[1]);
    await b2.cmd({ type: "roll", keep: [] });
    await b3.settled();
    expect(b3.view!.turn!.rolls).toBe(1);
    // Keep-alive handled by setWebSocketAutoResponse (does not wake the object).
    const pong = b3.next((m) => m.t === "pong");
    b3.ws.send('{"t":"ping"}');
    expect((await pong).t).toBe("pong");
    // the hold preview reaches the opponent only
    const hint = a.next((m) => m.t === "hold");
    b2.ws.send(JSON.stringify({ t: "hold", keep: [2] }));
    expect(await hint).toMatchObject({ t: "hold", keep: [2] });
  });

  it("서버 재시작 후 SQLite에서 감사·복구하고 같은 토큰·같은 명령 id로 이어간다; 토큰 원문은 저장되지 않는다", async () => {
    const w = await boot({});
    const { code, a, tokens } = await twoPlayerRoom(w);
    await a.cmd({ type: "start" });
    await a.cmd({ type: "roll", keep: [] }, "r-before-restart");
    await a.settled();
    const before = a.view!;
    closeAllClients();
    await w.restart();
    const a2 = new Client(w.url, code);
    const welcome = (await a2.hello(tokens[0])) as Extract<ServerMessage, { t: "welcome" }>;
    expect(welcome.t).toBe("welcome");
    expect(welcome.view.version).toBe(before.version);
    expect(welcome.view.turn!.dice).toEqual(before.turn!.dice);
    expect(await a2.cmd({ type: "roll", keep: [] }, "r-before-restart")).toMatchObject({ ok: true, duplicate: true });
    expect((await a2.cmd({ type: "score", category: "choice" })).ok).toBe(true);
    // Look through every persisted file: the secret tokens are never stored, only their hashes.
    const files: string[] = [];
    const walk = async (dir: string) => {
      for (const name of await readdir(dir)) {
        const p = join(dir, name);
        if ((await stat(p)).isDirectory()) await walk(p);
        else files.push(p);
      }
    };
    await walk(w.persistDir);
    expect(files.some((f) => f.endsWith(".sqlite"))).toBe(true);
    for (const f of files) {
      const raw = await readFile(f);
      for (const t of tokens) expect(raw.includes(Buffer.from(t))).toBe(false);
    }
  }, 120_000);

  it("서버 턴 타이머(Durable Object 알람): 제한 시간이 지나면 시간 초과로 경기가 끝난다", async () => {
    const w = await boot({ TURN_TIMEOUT_MS: "1500" });
    const { a, b } = await twoPlayerRoom(w);
    await a.cmd({ type: "start" });
    await a.settled();
    expect(a.view!.turn!.deadline).not.toBeNull();
    await b.next((m) => (m.t === "view" || m.t === "welcome") && m.view.status === "finished", 8000);
    expect(b.view!.winners).toEqual([b.view!.you!.playerId]);
  }, 60_000);

  it("보존 기간·자동 정리: 빈 대기실은 알람으로 삭제되고, 모두 나간 방은 즉시 삭제되어 방 수 한도가 풀린다", async () => {
    const w = await boot({ LOBBY_IDLE_MS: "1500", MAX_ROOMS: "1" });
    const first = await api(w, "/api/rooms", { name: "혼자" });
    expect(first.status).toBe(201);
    expect((await api(w, "/api/rooms", { name: "둘째" })).status).toBe(503);
    await new Promise((r) => setTimeout(r, 3500));
    expect((await api(w, `/api/rooms/${first.body.code}`)).status).toBe(404);
    // empty lobby → deleted immediately
    const second = await api(w, "/api/rooms", { name: "방장" });
    expect(second.status).toBe(201);
    const host = new Client(w.url, second.body.code);
    await host.hello(second.body.token);
    expect((await host.cmd({ type: "leave" })).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect((await api(w, `/api/rooms/${second.body.code}`)).status).toBe(404);
    expect((await api(w, "/api/rooms", { name: "셋째" })).status).toBe(201);
  }, 60_000);

  it("하루 방 생성 한도(DAILY_ROOM_LIMIT)를 넘으면 실패로 닫히고, /usage로 현황을 볼 수 있다", async () => {
    const w = await boot({ DAILY_ROOM_LIMIT: "2" });
    expect((await api(w, "/api/rooms", { name: "a" })).status).toBe(201);
    expect((await api(w, "/api/rooms", { name: "b" })).status).toBe(201);
    const third = await api(w, "/api/rooms", { name: "c" });
    expect(third.status).toBe(503);
    expect(third.body.error.code).toBe("DAILY_LIMIT");
    const usage = await api(w, "/usage");
    expect(usage.body).toMatchObject({ roomsToday: 2, dailyRoomLimit: 2, liveRooms: 2 });
  }, 60_000);

  it("방장 이탈 시 승계, 남용 방어: 출처·메시지 크기·생성 속도·메시지 폭주·인증 전 소켓", async () => {
    const w = await boot({ CREATE_PER_MINUTE: "3" });
    expect((await api(w, "/api/rooms", { name: "x" }, "https://evil.example")).status).toBe(403);
    const { code, a, b } = await twoPlayerRoom(w);
    expect((await a.cmd({ type: "leave" })).ok).toBe(true);
    await b.settled();
    expect(b.view!.you!.isHost).toBe(true);
    const evil = new Client(w.url, code, "https://evil.example");
    await expect(evil.opened()).rejects.toThrow();
    b.ws.send("x".repeat(3000));
    await new Promise((r) => setTimeout(r, 200));
    expect(b.closed?.code).toBe(1009);
    expect((await api(w, "/api/rooms", { name: "n2" })).status).toBe(201);
    expect((await api(w, "/api/rooms", { name: "n3" })).status).toBe(201);
    expect((await api(w, "/api/rooms", { name: "n4" })).status).toBe(429);
    const r = await twoPlayerRoom(main);
    for (let i = 0; i < 60; i++) r.a.ws.send(JSON.stringify({ t: "hold", keep: [] }));
    await new Promise((res) => setTimeout(res, 300));
    expect(r.a.closed?.code).toBe(1008);
  }, 60_000);
});
