import WebSocket from "ws";
import { Client } from "./online-client";
import { priceOf, itemById } from "../../src/economy/live/catalog";
import type { LocalWorker } from "./wrangler";

/**
 * Isolated member accounts with REAL equipped items for end-to-end tests (no Worker changes, no test
 * grants): a fake-provider member earns coins by finishing quick matches against guests (the real
 * server-verified reward path), buys the wanted items through `/api/me/shop/buy`, and saves a loadout
 * through `/api/me/loadout`. The look the other players then see is whatever the server validated.
 */
const ORIGIN = "http://127.0.0.1:5173";
type Msg = Record<string, any>;

export const apiCall = async (worker: LocalWorker, session: string, path: string, body?: unknown) => {
  const r = await fetch(worker.url + path, { method: body === undefined ? "GET" : "POST", headers: { origin: ORIGIN, "content-type": "application/json", authorization: "Bearer " + session }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Msg };
};

function queue(worker: LocalWorker, session: string | null, name: string, n: number) {
  return new Promise<Msg>((resolve, reject) => {
    const ws = new WebSocket(worker.url.replace("http", "ws") + "/ws/match", { origin: ORIGIN });
    const timer = setTimeout(() => { ws.terminate(); reject(new Error("no match")); }, 15_000);
    ws.on("open", () => ws.send(JSON.stringify({ t: "queue", name, ticket: ("ticket" + n + Date.now()).padEnd(30, "t"), device: ("device" + n + Math.random()).padEnd(30, "d"), ...(session ? { session } : {}) })));
    ws.on("message", (d) => {
      const m = JSON.parse(d.toString());
      if (m.t === "matched" || m.t === "error") { clearTimeout(timer); ws.close(); resolve(m); }
    });
  });
}

async function playOut(clients: Client[]) {
  for (let guard = 0; guard < 400; guard++) {
    await new Promise((r) => setTimeout(r, 20));
    if (clients.some((c) => c.view?.status === "finished")) return;
    const current = clients.find((c) => c.view?.legal);
    if (!current) continue;
    if (current.view!.turn!.rolls === 0) await current.cmd({ type: "roll", keep: [] });
    else {
      const best = [...current.view!.legal!.scores].sort((x, y) => y.points - x.points)[0];
      await current.cmd({ type: "score", category: best.category });
    }
  }
}

let seq = 0;
async function earnOne(worker: LocalWorker, session: string, name: string) {
  const n = ++seq;
  const [a, b] = await Promise.all([queue(worker, session, name, n), queue(worker, null, "손님" + n, n + 1000)]);
  const ca = new Client(worker.url, a.code);
  const cb = new Client(worker.url, b.code);
  await ca.hello(a.token);
  await cb.hello(b.token);
  await playOut([ca, cb]);
  await new Promise((r) => setTimeout(r, 250));
  ca.ws.terminate();
  cb.ws.terminate();
}

export type Wish = { dice?: string; board?: string; diceLv?: number; boardLv?: number };
export async function seedMember(worker: LocalWorker, session: string, name: string, wish: Wish) {
  const ids = [wish.dice, wish.board].filter((x): x is string => !!x);
  const need = ids.reduce((sum, id) => sum + (priceOf(itemById(id)!, "coins") ?? 0), 0);
  for (let i = 0; i < 60; i++) {
    const coins = (await apiCall(worker, session, "/api/me/economy")).body.snapshot.wallet.coins as number;
    if (coins >= need) break;
    await earnOne(worker, session, name);
  }
  for (const id of ids) {
    const r = await apiCall(worker, session, "/api/me/shop/buy", { itemId: id, currency: "coins", requestId: "seed-" + id.replace(/[^a-z0-9]/gi, "") + "-" + Math.random().toString(36).slice(2, 10) });
    if (r.status !== 200) throw new Error(`buy ${id}: ${r.status} ${JSON.stringify(r.body)}`);
  }
  const snap = (await apiCall(worker, session, "/api/me/economy")).body.snapshot;
  const loadout = { ...snap.loadout, ...(wish.dice ? { dice: wish.dice } : {}), ...(wish.board ? { board: wish.board } : {}) };
  const saved = await apiCall(worker, session, "/api/me/loadout", { loadout });
  if (saved.status !== 200) throw new Error("loadout: " + JSON.stringify(saved.body));
  return (await apiCall(worker, session, "/api/me/economy")).body.snapshot.look as Msg;
}

/** One full server-verified quick match between two signed-in members (protocol level, no browser). */
export async function playMatchBetween(worker: LocalWorker, sessionA: string, sessionB: string) {
  const n = ++seq;
  const [a, b] = await Promise.all([queue(worker, sessionA, "가", n), queue(worker, sessionB, "나", n + 5000)]);
  const ca = new Client(worker.url, a.code);
  const cb = new Client(worker.url, b.code);
  await ca.hello(a.token);
  await cb.hello(b.token);
  await playOut([ca, cb]);
  await new Promise((r) => setTimeout(r, 400));
  ca.ws.terminate();
  cb.ws.terminate();
}
