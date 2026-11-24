/**
 * Multiplayer load test against the real Workers runtime (`wrangler dev --local`: workerd, SQLite
 * Durable Objects, WebSocket Hibernation). Nothing is deployed. For each size (2, 4, 6, 10, 20):
 *   1. one room, N guests join over HTTP, ready, host starts (simultaneous mode, 120 s rounds);
 *   2. every round all N players roll at the same instant (true concurrency on one object), then
 *      act with a simple strategy; ack latency is recorded for every command;
 *   3. after round 4 every socket is dropped at once and reconnects (reconnect storm) — the match must
 *      continue from the same state; after round 8 the server process is restarted (state from SQLite);
 *   4. the final standings must agree on every screen and every card must be full.
 * Also one turn-by-turn match per size. Usage: npx tsx scripts/online/load-workers.ts
 * → docs/online/results/load-workers.json
 */
import { writeFileSync, mkdirSync } from "node:fs";
import WebSocket from "ws";
import { startLocalWorker, type LocalWorker } from "../../tests/helpers/wrangler";

// Optional: --url <deployed server> --origin <allowed page origin> --sizes 2,10 --modes simultaneous
// runs against a deployed Worker instead (no process restart there; each match uses ⌈N/2⌉ daily units).
const arg = (name: string) => {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const REMOTE = arg("url");
const ORIGIN = arg("origin") ?? "http://127.0.0.1:5173";
const SIZES = (arg("sizes") ?? "2,4,6,10,20").split(",").map(Number);
const MODES = (arg("modes") ?? "simultaneous,turns").split(",") as ("turns" | "simultaneous")[];
type Msg = Record<string, any>;

class Player {
  ws!: WebSocket;
  view: any = null;
  pending = new Map<string, { at: number; resolve: (m: Msg) => void }>();
  latencies: number[] = [];
  errors: string[] = [];
  n = 0;
  constructor(readonly base: string, readonly code: string, readonly token: string, readonly name: string) {}
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.base.replace("http", "ws") + "/ws/" + this.code, { origin: ORIGIN });
      this.ws = ws;
      ws.on("open", () => ws.send(JSON.stringify({ t: "hello", token: this.token })));
      ws.on("message", (d) => {
        const m = JSON.parse(d.toString()) as Msg;
        if (m.t === "welcome") {
          this.view = m.view;
          resolve();
        }
        if (m.t === "view") this.view = m.view;
        if (m.t === "ack") {
          const p = this.pending.get(m.id);
          if (p) {
            this.latencies.push(performance.now() - p.at);
            this.pending.delete(m.id);
            if (!m.ok) this.errors.push(m.error.code);
            p.resolve(m);
          }
        }
        if (m.t === "error") this.errors.push(m.code);
      });
      ws.on("error", reject);
    });
  }
  send(msg: Msg) {
    this.ws.send(JSON.stringify(msg));
  }
  cmd(action: Msg): Promise<Msg> {
    const id = this.name + "-" + ++this.n;
    return new Promise((resolve) => {
      this.pending.set(id, { at: performance.now(), resolve });
      this.send({ t: "cmd", id, action });
    });
  }
  async settle() {
    await new Promise((r) => setTimeout(r, 30));
  }
}

async function api(base: string, path: string, body?: unknown) {
  const res = await fetch(base + path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: body === undefined ? undefined : JSON.stringify(body) });
  return (await res.json()) as Msg;
}

async function play(w: LocalWorker | { url: string; restart?: undefined }, players: number, mode: "turns" | "simultaneous") {
  const created = await api(w.url, "/api/rooms", { name: "p0", maxPlayers: players });
  const ps = [new Player(w.url, created.code, created.token, "p0")];
  for (let i = 1; i < players; i++) {
    const j = await api(w.url, `/api/rooms/${created.code}/join`, { name: "p" + i });
    if (!j.token) throw Error("join failed: " + JSON.stringify(j));
    ps.push(new Player(w.url, created.code, j.token, "p" + i));
  }
  await Promise.all(ps.map((p) => p.connect()));
  if (mode === "simultaneous") ps[0].send({ t: "settings", mode, timeoutMs: 120_000 });
  for (const p of ps.slice(1)) p.send({ t: "ready", ready: true });
  await new Promise((r) => setTimeout(r, 300));
  const t0 = performance.now();
  const start = await ps[0].cmd({ type: "start" });
  if (!start.ok) throw Error("start failed " + JSON.stringify(start));
  await Promise.all(ps.map((p) => p.settle()));
  let reconnectMs = 0,
    restartMs = 0;
  const act = async (p: Player) => {
    for (let roll = 0; roll < 3 && p.view?.legal; roll++) {
      const v = p.view;
      if (v.turn.rolls > 0) {
        const best = [...v.legal.scores].sort((a: Msg, b: Msg) => b.points - a.points)[0];
        if (best.points >= 25 || roll === 2) {
          await p.cmd({ type: "score", category: best.category });
          await p.settle();
          return;
        }
      }
      const counts = [0, 0, 0, 0, 0, 0, 0];
      v.turn.dice.forEach((d: number) => counts[d]++);
      const face = counts.indexOf(Math.max(...counts));
      const keep = v.turn.rolls ? v.turn.dice.map((d: number, i: number) => (d === face ? i : -1)).filter((i: number) => i >= 0).slice(0, 4) : [];
      await p.cmd({ type: "roll", keep });
      await p.settle();
    }
    if (p.view?.legal?.scores.length) {
      await p.cmd({ type: "score", category: [...p.view.legal.scores].sort((a: Msg, b: Msg) => b.points - a.points)[0].category });
      await p.settle();
    }
  };
  for (let guard = 0; guard < 400; guard++) {
    const v = ps[0].view;
    if (v.status === "finished") break;
    const round = v.round;
    if (mode === "simultaneous") {
      // the whole table rolls in the same instant, then everyone finishes their turn concurrently
      await Promise.all(ps.map((p) => (p.view?.legal ? act(p) : Promise.resolve())));
    } else {
      const who = ps.find((p) => p.view?.legal);
      if (who) await act(who);
      else await new Promise((r) => setTimeout(r, 30));
    }
    const now = ps[0].view;
    if (now.status === "playing" && now.round === 5 && round === 4 && !reconnectMs) {
      // reconnect storm: every socket drops at once and comes back
      const r0 = performance.now();
      ps.forEach((p) => p.ws.terminate());
      await Promise.all(ps.map((p) => p.connect()));
      reconnectMs = performance.now() - r0;
    }
    if (w.restart && now.status === "playing" && now.round === 9 && round === 8 && !restartMs) {
      const r0 = performance.now();
      ps.forEach((p) => p.ws.terminate());
      await w.restart();
      await Promise.all(ps.map((p) => p.connect()));
      restartMs = performance.now() - r0;
    }
  }
  const wall = performance.now() - t0;
  await Promise.all(ps.map((p) => p.settle()));
  const finals = ps.map((p) => JSON.stringify(p.view.standings));
  const allSame = finals.every((f) => f === finals[0]);
  const full = ps[0].view.players.every((pl: Msg) => Object.keys(pl.card).length === 12);
  const lat = ps.flatMap((p) => p.latencies).sort((a, b) => a - b);
  const q = (x: number) => lat[Math.min(lat.length - 1, Math.floor(x * lat.length))];
  const errors = ps.flatMap((p) => p.errors);
  ps.forEach((p) => p.ws.close());
  return { players, mode, finished: ps[0].view.status === "finished", standingsAgree: allSame, cardsFull: full, commands: lat.length, ackMs: { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: lat.at(-1) }, errors: [...new Set(errors)], errorCount: errors.length, reconnectStormMs: reconnectMs, restartRecoveryMs: restartMs, wallMs: wall };
}

const worker = REMOTE ? { url: REMOTE } : await startLocalWorker({ ALLOWED_ORIGINS: ORIGIN, TURN_TIMEOUT_MS: "120000", CREATE_PER_MINUTE: "500", JOIN_PER_MINUTE: "500" });
const rows = [];
try {
  for (const players of SIZES)
    for (const mode of MODES) {
      const row = await play(worker, players, mode);
      rows.push(row);
      console.log(JSON.stringify(row));
    }
} finally {
  if ("stop" in worker) await worker.stop();
}
mkdirSync("docs/online/results", { recursive: true });
writeFileSync(REMOTE ? "docs/online/results/load-live.json" : "docs/online/results/load-workers.json", JSON.stringify({ generatedAt: new Date().toISOString(), runtime: REMOTE ? "deployed Worker (Workers Free)" : "wrangler dev --local (workerd)", rows }, null, 1));
