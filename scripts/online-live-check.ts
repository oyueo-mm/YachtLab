/**
 * Live check of a deployed YachtLab Online server (Phase 4). Uses 3 rooms in total:
 *   1) full 12-round game for two players + reconnect (since) + duplicate command + wrong turn,
 *      then (same room) emote, refused free text, spectating, rematch with swapped first player
 *   2) seat security: bad token, full room, forged playerId, unknown code
 *   3) server-side turn timer (waits for TURN_TIMEOUT_MS, 120 s in production)
 * Usage: npx tsx scripts/online-live-check.ts https://<worker host> https://<allowed origin>
 */
import { Client, api, closeAllClients } from "../tests/helpers/online-client";
import type { ServerMessage } from "../src/online/wire";

const [base, origin] = process.argv.slice(2);
if (!base || !origin) throw new Error("usage: online-live-check.ts <server> <origin>");
const ok = (cond: unknown, label: string) => {
  if (!cond) throw new Error("FAIL: " + label);
  console.log("ok  " + label);
};
const call = (path: string, body?: unknown) => api(base, path, body, origin);

async function room() {
  const created = await call("/api/rooms", { name: "라이브A" });
  ok(created.status === 201 && /^[A-Z2-9]{6}$/.test(created.body.code), `방 생성 ${created.status} ${created.body.code}`);
  const peek = await call(`/api/rooms/${created.body.code}`);
  ok(peek.status === 200 && peek.body.players?.[0] === "라이브A" && !JSON.stringify(peek.body).includes("token"), "초대 미리보기(토큰 없음)");
  const joined = await call(`/api/rooms/${created.body.code}/join`, { name: "라이브B" });
  ok(joined.status === 201, "초대 코드로 입장");
  const a = new Client(base, created.body.code, origin);
  const b = new Client(base, created.body.code, origin);
  ok((await a.hello(created.body.token)).t === "welcome" && (await b.hello(joined.body.token)).t === "welcome", "WebSocket 연결·인증");
  return { code: created.body.code as string, a, b, tokens: [created.body.token as string, joined.body.token as string] };
}

async function turn(clients: Client[]) {
  // The next player's view travels on its own socket: wait for it instead of assuming a delay.
  let c: Client | undefined;
  for (const deadline = Date.now() + 10_000; !(c = clients.find((x) => x.view?.legal)) && Date.now() < deadline; ) await new Promise((r) => setTimeout(r, 25));
  if (!c) throw new Error("FAIL: no player received its turn");
  ok((await c.cmd({ type: "roll", keep: [] })).ok, "굴림");
  await c.settled();
  const best = [...c.view!.legal!.scores].sort((x, y) => y.points - x.points)[0];
  const r = await c.cmd({ type: "score", category: best.category });
  if (!r.ok) throw new Error("score failed");
  await c.settled();
}

const started = Date.now();
try {
  // ---------- 1. full game, reconnect, duplicate, wrong turn ----------
  const g = await room();
  ok((await g.a.cmd({ type: "start" })).ok, "방장 게임 시작");
  await g.a.settled();
  const roll = await g.a.cmd({ type: "roll", keep: [] }, "live-roll-1");
  await g.a.settled();
  const dice = g.a.view!.turn!.dice;
  const dup = await g.a.cmd({ type: "roll", keep: [] }, "live-roll-1");
  await g.a.settled();
  ok(roll.ok && dup.ok && dup.duplicate && g.a.view!.turn!.rolls === 1 && JSON.stringify(g.a.view!.turn!.dice) === JSON.stringify(dice), "중복 명령 1회만 적용");
  // Shared hold order: selection order C(2) → A(0) reaches both players, survives the re-roll.
  const order = g.b.next((m) => m.t === "hold" && m.keep.join() === "2,0");
  g.a.ws.send(JSON.stringify({ t: "hold", keep: [2], n: 1 }));
  g.a.ws.send(JSON.stringify({ t: "hold", keep: [2, 0], n: 2 }));
  ok(!!(await order), "고정 순서 공유 (C→A)");
  const rerolled = g.b.next((m) => m.t === "view" && m.view.turn?.rolls === 2);
  ok((await g.a.cmd({ type: "roll", keep: [2, 0] })).ok, "고정 후 재굴림");
  const rv = (await rerolled) as Extract<ServerMessage, { t: "view" }>;
  ok(rv.hold?.keep.join() === "2,0", "재굴림 후에도 고정 순서 유지 (양쪽 동일)");
  const wrong = await g.b.cmd({ type: "roll", keep: [] });
  ok(!wrong.ok && wrong.error.code === "NOT_YOUR_TURN", "잘못된 차례 거부");
  const seen = g.b.view!.version;
  g.b.ws.close();
  ok((await g.a.cmd({ type: "score", category: "choice" })).ok, "상대 연결 끊김 중 진행");
  await g.a.settled();
  const b2 = new Client(base, g.code, origin);
  const w = (await b2.hello(g.tokens[1], seen)) as Extract<ServerMessage, { t: "welcome" }>;
  ok(w.t === "welcome" && w.view.events.map((e) => e.type).join() === "categoryScored,turnStarted" && !!w.view.legal && w.hold === null, "재접속 since 동기화 (새 턴은 고정 없음)");
  const pong = b2.next((m) => m.t === "pong");
  b2.ws.send('{"t":"ping"}');
  ok((await pong).t === "pong", "ping 자동 응답");
  const players = [g.a, b2];
  for (let i = 1; i < 24; i++) await turn(players);
  await g.a.settled();
  ok(g.a.view!.status === "finished" && JSON.stringify(g.a.view!.standings) === JSON.stringify(b2.view!.standings), "12라운드 완주·양쪽 결과 일치");
  console.log("     결과:", g.a.view!.players.map((p) => `${p.name} ${p.total}`).join(" : "));

  // ---------- 1b. Phase 3 social on the same room (no extra room): chat, spectating, rematch ----------
  const said = b2.next((m) => m.t === "said" && m.id === "emote.clap");
  g.a.ws.send(JSON.stringify({ t: "say", id: "emote.clap" }));
  ok(!!(await said), "이모티콘 실시간 전달");
  const refused = g.a.next((m) => m.t === "error" && m.code === "INVALID_SOCIAL");
  g.a.ws.send(JSON.stringify({ t: "say", id: "아무 말" }));
  ok(!!(await refused), "임의 문자열 채팅 거부");
  const allowA = g.a.next((m) => m.t === "spectate");
  g.a.ws.send(JSON.stringify({ t: "spectate", allow: true }));
  await allowA;
  const active = g.a.next((m) => m.t === "spectate" && m.spectate.active);
  b2.ws.send(JSON.stringify({ t: "spectate", allow: true }));
  const key = ((await active) as Extract<ServerMessage, { t: "spectate" }>).spectate.key!;
  const watcher = new Client(base, g.code, origin);
  await watcher.opened();
  const watching = watcher.next((m) => m.t === "watching");
  watcher.ws.send(JSON.stringify({ t: "watch", key }));
  const wv = (await watching) as Extract<ServerMessage, { t: "watching" }>;
  ok(wv.view.you === null && wv.view.legal === null && !JSON.stringify(wv).includes(g.tokens[0]), "관전: 중립 시점·토큰 미노출");
  const denied = watcher.next((m) => m.t === "error" && m.code === "SPECTATOR");
  watcher.ws.send(JSON.stringify({ t: "cmd", id: "w1", action: { type: "start" } }));
  ok(!!(await denied), "관전자 조작 거부");
  const req = b2.next((m) => m.t === "rematch" && m.rematch.requests.length === 1);
  g.a.ws.send(JSON.stringify({ t: "rematch", op: "request" }));
  await req;
  const firstMatch = g.a.view!.matchId;
  const newMatch = g.a.next((m) => m.t === "view" && m.view.matchId !== firstMatch);
  const watcherNew = watcher.next((m) => m.t === "view" && m.view.matchId !== firstMatch);
  await new Promise((r) => setTimeout(r, 1100));
  b2.ws.send(JSON.stringify({ t: "rematch", op: "request" }));
  const nv = (await newMatch) as Extract<ServerMessage, { t: "view" }>;
  ok(nv.view.status === "playing" && nv.view.turn!.playerId === b2.view!.you!.playerId, `재대결: 같은 방 새 경기(${nv.view.matchId}), 선공 교대`);
  ok(!!(await watcherNew), "재대결 경기도 이어서 관전");
  const kicked = new Promise<boolean>((resolve) => watcher.ws.once("close", (code) => resolve(code === 4003)));
  await new Promise((r) => setTimeout(r, 300));
  b2.ws.send(JSON.stringify({ t: "spectate", allow: false }));
  ok(await kicked, "관전 동의 철회 시 관전자 즉시 종료");
  ok((await b2.cmd({ type: "resign" })).ok, "새 경기 기권으로 정리");
  const config = await call("/api/auth/config");
  ok(config.status === 200 && typeof config.body.google === "boolean", `계정 API 응답 (google=${config.body.google})`);

  // ---------- 2. seat security ----------
  const s = await room();
  ok((await call(`/api/rooms/${s.code}/join`, { name: "도둑" })).body.error?.code === "MATCH_FULL", "만석 방 입장 거부");
  const thief = new Client(base, s.code, origin);
  ok((await thief.hello("x".repeat(43))).t === "error", "잘못된 토큰 거부");
  await s.a.cmd({ type: "start" });
  await s.a.settled();
  const forged = await s.b.cmd({ type: "roll", keep: [], playerId: s.a.view!.you!.playerId });
  ok(!forged.ok && forged.error.code === "NOT_YOUR_TURN", "playerId 위조 무시");
  ok((await call("/api/rooms/ZZZZZZ")).status === 404, "없는 코드 404");
  ok((await api(base, "/api/rooms", { name: "x" }, "https://evil.example")).status === 403, "허용되지 않은 출처 403");
  ok((await s.a.cmd({ type: "resign" })).ok, "기권으로 정리");

  // ---------- 3. server turn timer ----------
  const t = await room();
  await t.a.cmd({ type: "start" });
  await t.a.settled();
  const deadline = t.a.view!.turn!.deadline!;
  ok(!!deadline, `턴 제한 시각 설정 (${Math.round((deadline - Date.now()) / 1000)}초 남음)`);
  const finished = await t.b.next((m) => (m.t === "view" || m.t === "welcome") && m.view.status === "finished", deadline - Date.now() + 30_000);
  ok(finished && t.b.view!.winners[0] === t.b.view!.you!.playerId, `서버 알람 턴 타이머로 시간 초과 처리 (${Math.round((Date.now() - deadline) / 1000)}초 지연)`);
  console.log(`PASS (${Math.round((Date.now() - started) / 1000)}s)`);
} finally {
  closeAllClients();
}
