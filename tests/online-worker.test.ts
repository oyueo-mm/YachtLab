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

  it("같은 닉네임 번호 붙이기·잘못된 닉네임·없는 방, 초대 미리보기에는 토큰이 없다", async () => {
    const created = await api(main, "/api/rooms", { name: "Mina" });
    // the same nickname in one room gets a number instead of a refusal (nicknames are set on the profile page)
    expect((await api(main, `/api/rooms/${created.body.code}/join`, { name: " mina " })).status).toBe(201);
    expect((await api(main, `/api/rooms/${created.body.code}/join`, { name: "" })).status).toBe(400);
    expect((await api(main, "/api/rooms", { name: "a\u0007b" })).status).toBe(400);
    expect((await api(main, "/api/rooms/ZZZZZZ/join", { name: "x" })).status).toBe(404);
    const summary = await api(main, `/api/rooms/${created.body.code}`);
    expect(summary.body).toEqual({ code: created.body.code, status: "lobby", seats: 2, players: ["Mina", "mina 2"], mode: "turns" });
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
    await expect(b.waitForClose()).resolves.toBe(1009);
    expect((await api(w, "/api/rooms", { name: "n2" })).status).toBe(201);
    expect((await api(w, "/api/rooms", { name: "n3" })).status).toBe(201);
    expect((await api(w, "/api/rooms", { name: "n4" })).status).toBe(429);
    const r = await twoPlayerRoom(main);
    for (let i = 0; i < 60; i++) r.a.ws.send(JSON.stringify({ t: "hold", keep: [] }));
    await expect(r.a.waitForClose()).resolves.toBe(1008);
  }, 60_000);

  it("Phase 4: 로그인 설정이 없으면 계정 API는 꺼져 있고(성공한 척 없음) 방 생성·입장은 그대로 동작한다", async () => {
    const cfg = await fetch(main.url + "/api/auth/config");
    expect(await cfg.json()).toEqual({ google: false });
    const start = await fetch(main.url + "/auth/google/start?cs=" + "a".repeat(43), { redirect: "manual" });
    expect(start.status).toBe(404);
    const me = await fetch(main.url + "/api/me", { headers: { authorization: "Bearer s1.u_" + "a".repeat(22) + "." + "b".repeat(43) } });
    expect(me.status).toBe(404);
    // A forged session header on room join is ignored: the seat is simply a guest seat.
    const created = await fetch(main.url + "/api/rooms", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer s1.u_" + "a".repeat(22) + "." + "b".repeat(43) }, body: JSON.stringify({ name: "손님" }) });
    expect(created.status).toBe(201);
    // CORS preflight for signed-in calls allows the authorization header only for allowed origins.
    const pre = await fetch(main.url + "/api/rooms", { method: "OPTIONS", headers: { origin: "http://127.0.0.1:5173", "access-control-request-headers": "authorization" } });
    expect(pre.headers.get("access-control-allow-headers")).toContain("authorization");
    const evil = await fetch(main.url + "/api/me/delete", { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
    expect(evil.status).toBe(403);
  });
});

/* ------------------------------------------------------------ Phase 4.5: quick match ------------------------------------------------------------ */
import WebSocket from "ws";
function queueSocket(w: LocalWorker, body: Record<string, unknown>) {
  const ws = new WebSocket(w.url.replace("http", "ws") + "/ws/match", { origin: "http://127.0.0.1:5173" });
  const messages: Record<string, any>[] = [];
  const wait = (t: string, ms = 5000) =>
    new Promise<Record<string, any>>((resolve, reject) => {
      const found = messages.find((m) => m.t === t);
      if (found) return resolve(found);
      const timer = setTimeout(() => reject(new Error("timeout " + t)), ms);
      ws.on("message", (d) => {
        const m = JSON.parse(d.toString());
        if (m.t === t) {
          clearTimeout(timer);
          resolve(m);
        }
      });
    });
  ws.on("message", (d) => messages.push(JSON.parse(d.toString())));
  ws.on("open", () => ws.send(JSON.stringify({ t: "queue", ...body })));
  return { ws, messages, wait };
}
const tk = (n: number) => ("tk" + n).padEnd(30, "q");

describe("C3 친구 대전 관전과 공개 서버 현황", () => {
  it("비공개 상태는 숫자로만 집계하며, 공개 권한과 관전 키를 실시간으로 검증한다", async () => {
    const { code, a, b } = await twoPlayerRoom(main);
    expect((await a.cmd({ type: "start" })).ok).toBe(true);
    const list = async () => (await api(main, "/api/spectate/rooms")).body.rooms;
    const entries = async () => (await list()).filter((room: { code: string }) => room.code === code);
    const activity = async () => (await api(main, "/api/activity")).body;
    await expect.poll(async () => (await activity()).playing?.friend).toBeGreaterThanOrEqual(1);
    expect(await entries()).toEqual([]);
    expect(JSON.stringify(await activity())).not.toContain(code);
    expect((await api(main, `/api/spectate/${code}/watch`, {})).status).toBe(409);
    const preference = (client: Client, visibility: string) => client.ws.send(JSON.stringify({ t: "spectate", allow: visibility !== "private", visibility }));
    preference(a, "public");
    preference(b, "public");
    await expect.poll(entries).toMatchObject([{ code, kind: "friend", participants: 2, status: "playing", round: 1 }]);
    const publicKey = (await api(main, `/api/spectate/${code}/watch`, {})).body.key;
    expect(typeof publicKey).toBe("string");
    const watcher = new Client(main.url, code);
    await watcher.opened();
    const watching = watcher.next((m) => m.t === "watching");
    watcher.ws.send(JSON.stringify({ t: "watch", key: publicKey }));
    await watching;
    await expect.poll(async () => (await activity()).spectators).toBeGreaterThanOrEqual(1);
    expect((await api(main, `/api/rooms/${code}/join`, { name: "관전자", key: publicKey })).status).toBe(409);
    preference(a, "private");
    await watcher.waitForClose();
    await expect.poll(entries).toEqual([]);
    expect((await api(main, `/api/spectate/${code}/watch`, {})).status).toBe(409);
  });
});

describe("Phase 4.5 — 빠른 대전·공개 관전 (wrangler dev, local)", () => {
  it("두 게스트가 매칭되어 시작된 방에 들어가고, 빠른 대전은 항상 관전방 목록에 뜨며(끌 수 없음) 끝나면 바로 빠진다", async () => {
    const features = await (await fetch(main.url + "/api/features", { headers: { origin: "http://127.0.0.1:5173" } })).json();
    expect(features).toMatchObject({ quickMatch: true, publicSpectate: true });
    const a = queueSocket(main, { name: "민수", ticket: tk(1), device: tk(11), spectate: true });
    await a.wait("queued");
    // an old client that still says "not public" gets a public match anyway (D-045)
    const b = queueSocket(main, { name: "지민", ticket: tk(2), device: tk(12), spectate: false });
    const [ma, mb] = await Promise.all([a.wait("matched"), b.wait("matched")]);
    expect(ma.code).toBe(mb.code);
    const ca = new Client(main.url, ma.code);
    const cb = new Client(main.url, mb.code);
    const wa = (await ca.hello(ma.token)) as Extract<ServerMessage, { t: "welcome" }>;
    await cb.hello(mb.token);
    expect(wa.kind).toBe("random");
    expect(wa.view.status).toBe("playing");
    expect(wa.spectate?.public).toBe(true);
    // invite join into a quick-match room is refused
    expect((await api(main, `/api/rooms/${ma.code}/join`, { name: "끼어들기" })).status).toBe(409);
    // public list: names, scores, round — no tokens or keys
    const list = await (await fetch(main.url + "/api/spectate/rooms", { headers: { origin: "http://127.0.0.1:5173" } })).json();
    const entry = list.rooms.find((r: { code: string }) => r.code === ma.code);
    expect(entry).toMatchObject({ round: 1, spectators: 0, max: 5 });
    expect(JSON.stringify(list)).not.toContain(ma.token);
    const watch = await api(main, `/api/spectate/${ma.code}/watch`, {});
    expect(watch.status).toBe(200);
    const spectator = new Client(main.url, ma.code);
    await spectator.opened();
    const watching = spectator.next((m) => m.t === "watching");
    spectator.ws.send(JSON.stringify({ t: "watch", key: watch.body.key }));
    expect((await watching).t).toBe("watching");
    // a player cannot switch it off: refused, the spectator stays
    ca.ws.send(JSON.stringify({ t: "spectate", allow: false }));
    await new Promise((r) => setTimeout(r, 400));
    expect(spectator.closed).toBeNull();
    expect(ca.messages.some((m) => m.t === "error" && m.code === "SPECTATE")).toBe(true);
    // the match ends → the room leaves the list at once
    expect((await ca.cmd({ type: "resign" })).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 400));
    const after = await (await fetch(main.url + "/api/spectate/rooms?x=1", { headers: { origin: "http://127.0.0.1:5173" } })).json();
    expect(after.rooms.find((r: { code: string }) => r.code === ma.code)).toBeUndefined();
    expect((await api(main, `/api/spectate/${ma.code}/watch`, {})).status).toBe(409);
  }, 60_000);

  it("서버 AI 대전은 회원 전용: 로그인이 꺼진 서버·세션 없는 요청은 방을 만들지 않는다", async () => {
    const before = await (await fetch(main.url + "/usage")).json();
    const r = await api(main, "/api/ai/start", { name: "민수" });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe("AUTH_DISABLED");
    const after = await (await fetch(main.url + "/usage")).json();
    expect(after.roomsToday).toBe(before.roomsToday);
    expect((await (await fetch(main.url + "/api/features", { headers: { origin: "http://127.0.0.1:5173" } })).json()).serverAi).toBe(false);
  });

  it("같은 기기의 두 탭은 서로 매칭되지 않고, 취소하면 대기열에서 빠진다", async () => {
    const a = queueSocket(main, { name: "혼자", ticket: tk(3), device: tk(13) });
    await a.wait("queued");
    const b = queueSocket(main, { name: "혼자2", ticket: tk(4), device: tk(13) });
    await b.wait("queued");
    await new Promise((r) => setTimeout(r, 300));
    expect(a.messages.find((m) => m.t === "matched")).toBeUndefined();
    a.ws.send(JSON.stringify({ t: "cancel" }));
    b.ws.send(JSON.stringify({ t: "cancel" }));
    await new Promise((r) => setTimeout(r, 200));
    expect(a.ws.readyState).toBeGreaterThanOrEqual(2);
  }, 30_000);
});

it("Worker에서 생성 시의 진행 방식을 저장하고 입력을 검증한다", async () => {
  const settings = { mode: "simultaneous", timeoutMs: 120_000 };
  expect((await api(main, "/api/features")).body.createSettings).toBe(true);
  expect((await api(main, "/api/features")).body.defaultTurnTimeoutMs).toBeNull();
  expect((await api(main, "/api/rooms", { name: "민수", settings: { ...settings, timeoutMs: 1 } })).status).toBe(400);
  const created = await api(main, "/api/rooms", { name: "민수", maxPlayers: 4, settings });
  expect(created.status).toBe(201);
  expect((await api(main, `/api/rooms/${created.body.code}`)).body).toMatchObject({ seats: 4, mode: "simultaneous" });
  const client = new Client(main.url, created.body.code);
  const welcome = await client.hello(created.body.token);
  expect(welcome).toMatchObject({ lobby: { settings, maxPlayers: 4 } });
});
