import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startLocalWorker, type LocalWorker } from "./helpers/wrangler";
import { Client, closeAllClients } from "./helpers/online-client";

/**
 * 20-player friend room in the real Workers runtime (wrangler dev --local): 20 guests join by code,
 * the host starts, all 12 rounds are played to the end over WebSockets, every seat sees the final standings.
 */
const ORIGIN = "http://127.0.0.1:5173";
let worker: LocalWorker;
beforeAll(async () => {
  worker = await startLocalWorker({ ALLOWED_ORIGINS: ORIGIN, TURN_TIMEOUT_MS: "0", CREATE_PER_MINUTE: "500", JOIN_PER_MINUTE: "500" });
}, 120_000);
afterAll(async () => {
  closeAllClients();
  await worker?.stop();
});
const post = async (path: string, body: unknown) => {
  const r = await fetch(worker.url + path, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as Record<string, any> };
};

describe("20인 온라인 경기 (wrangler dev)", () => {
  it("게스트 20명이 한 방에서 12라운드를 끝까지 진행하고 모두 같은 최종 순위를 받는다", async () => {
    const created = await post("/api/rooms", { name: "방장", maxPlayers: 20 });
    expect(created.status).toBe(201);
    const code = created.body.code as string;
    const seats = [created.body as { token: string }];
    for (let i = 2; i <= 20; i++) {
      const j = await post(`/api/rooms/${code}/join`, { name: "참가" + i });
      expect(j.status).toBe(201);
      seats.push(j.body as { token: string });
    }
    expect((await post(`/api/rooms/${code}/join`, { name: "21번째" })).status).toBeGreaterThanOrEqual(400); // full
    const clients = seats.map(() => new Client(worker.url, code));
    for (const [i, c] of clients.entries()) await c.hello(seats[i].token);
    for (const c of clients.slice(1)) c.ws.send(JSON.stringify({ t: "intent", value: "ready" }));
    await expect.poll(async () => (await clients[0].cmd({ type: "start" })).ok, { timeout: 10_000 }).toBe(true);
    const started = Date.now();
    for (let guard = 0; guard < 2000 && !clients.every((c) => c.view?.status === "finished"); guard++) {
      await new Promise((r) => setTimeout(r, 10));
      const cur = clients.find((c) => c.view?.legal && c.view.status === "playing");
      if (!cur) continue;
      if ((cur.view!.turn?.rolls ?? 0) === 0) await cur.cmd({ type: "roll", keep: [] });
      else await cur.cmd({ type: "score", category: [...cur.view!.legal!.scores].sort((x, y) => y.points - x.points)[0].category });
    }
    expect(clients.every((c) => c.view?.status === "finished")).toBe(true);
    const standings = clients.map((c) => JSON.stringify((c.view as unknown as { standings?: unknown }).standings ?? null));
    expect(new Set(standings).size).toBe(1);
    expect(JSON.parse(standings[0])).toHaveLength(20);
    expect(Date.now() - started).toBeLessThan(180_000);
  }, 240_000);
});
