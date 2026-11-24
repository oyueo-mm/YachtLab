/**
 * Measures storage writes of one real online match on the Durable Object host logic (worker/src/host.ts)
 * with a counting storage adapter — the same code path the deployed YachtRoom uses (record upsert = 1 row,
 * setAlarm = 1 row per Cloudflare billing). Players are DP Expert (realistic roll counts per turn).
 * Also counts the directory writes (room insert + daily counter) by reading worker/src/index.ts SQL.
 * Usage: npx tsx scripts/economy/measure-room-writes.ts [matches=20]
 */
import { writeFileSync } from "node:fs";
import { seededDiceSource } from "../../src/online";
import type { RoomRecord } from "../../src/online/room";
import { RoomHost, type HostSocket, type HostStorage } from "../../worker/src/host";
import { readConfig } from "../../worker/src/config";
import { categories, type Game } from "../../src/engine";
import { dpActionValues } from "../../src/dp";
import { loadDPTable } from "./policies";

loadDPTable();
class Sock implements HostSocket {
  sent: any[] = [];
  private a: string | null = null;
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close() {}
  serializeAttachment(v: unknown) { this.a = JSON.stringify(v); }
  deserializeAttachment() { return this.a === null ? null : JSON.parse(this.a); }
  last(t: string) { return [...this.sent].reverse().find((m) => m.t === t); }
}
const MATCHES = Number(process.argv[2] ?? 20);
const config = readConfig({}); // production defaults (turn limit 120 s)
type Count = { save: number; saveByAction: Record<string, number>; setAlarm: number; deleteAlarm: number; commands: number; rolls: number; holdsSent: number; alarmsFired: number; recordBytes: number };
async function oneMatch(seed: number, holdMessages: boolean) {
  let t = 1_700_000_000_000;
  let current = "create";
  const c: Count = { save: 0, saveByAction: {}, setAlarm: 0, deleteAlarm: 0, commands: 0, rolls: 0, holdsSent: 0, alarmsFired: 0, recordBytes: 0 };
  let rec: string | null = null, alarm: number | null = null;
  const storage: HostStorage = {
    load: () => (rec ? (JSON.parse(rec) as RoomRecord) : null),
    save: (r) => { rec = JSON.stringify(r); c.save++; c.saveByAction[current] = (c.saveByAction[current] ?? 0) + 1; c.recordBytes = Math.max(c.recordBytes, rec.length); },
    getAlarm: () => alarm,
    setAlarm: (at) => { alarm = at; c.setAlarm++; },
    deleteAlarm: () => { alarm = null; c.deleteAlarm++; },
    clear: () => { rec = null; },
  };
  const open: Sock[] = [];
  const host = new RoomHost(storage, () => open, config, () => t, seededDiceSource(seed));
  host.init();
  const created = await host.create("ABCDEF", "민수");
  current = "join";
  const joined = await host.join("지민");
  if (!created.ok || !joined.ok) throw Error("join");
  const socks = [new Sock(), new Sock()];
  for (const s of socks) { host.admit(); open.push(s); host.accepted(s); }
  current = "hello";
  await host.message(socks[0], JSON.stringify({ t: "hello", token: created.token }));
  await host.message(socks[1], JSON.stringify({ t: "hello", token: joined.token }));
  current = "start";
  const tick = async (ms: number) => { t += ms; if (alarm !== null && t >= alarm) { c.alarmsFired++; current = "alarm"; await host.alarm(); } };
  let n = 0;
  const cmd = async (s: Sock, action: unknown, kind: string) => { current = kind; c.commands++; await host.message(s, JSON.stringify({ t: "cmd", id: `c${n++}`, action })); };
  await cmd(socks[0], { type: "start" }, "start");
  for (let guard = 0; guard < 400; guard++) {
    const view = socks[0].last("view")?.view;
    if (!view || view.status === "finished" || view.match?.status === "finished" || view.winner !== undefined && view.status !== "playing") break;
    const turn = view.turn;
    if (!turn) break;
    const seat = view.players.findIndex((p: any) => p.playerId === turn.playerId);
    const s = socks[seat];
    await tick(4000);
    if (!turn.rolls) { c.rolls++; await cmd(s, { type: "roll", keep: [] }, "roll"); continue; }
    const cards = view.players.map((p: any) => p.card ?? p.scores ?? {});
    const g = { dice: turn.dice.map((d: any, i: number) => ({ id: d.id ?? i, value: d.value ?? d, held: false })), cards: [cards[seat], {}], player: 0, rolls: turn.rolls, done: false } as unknown as Game;
    const q = dpActionValues(g);
    // holding all five dice equals stopping: score the best open category instead
    let best = -1, bestScore = 32;
    for (let i = 0; i < q.length; i++) if (i !== 31 && Number.isFinite(q[i]) && (best < 0 || q[i] > q[best])) best = i;
    for (let i = 33; i < 44; i++) if (Number.isFinite(q[i]) && q[i] > q[bestScore]) bestScore = i;
    if (!Number.isFinite(q[bestScore])) for (let i = 32; i < 44; i++) if (Number.isFinite(q[i])) { bestScore = i; break; }
    if (best >= 32 || turn.rolls >= 3) { await cmd(s, { type: "score", category: categories[bestScore - 32] }, "score"); continue; }
    const keep = g.dice.filter((d) => best & (1 << d.id)).map((d) => d.id);
    if (holdMessages) { current = "hold"; for (const id of keep) { c.holdsSent++; await host.message(s, JSON.stringify({ t: "hold", keep: keep.slice(0, keep.indexOf(id) + 1) })); } }
    c.rolls++;
    await cmd(s, { type: "roll", keep }, "roll");
  }
  const finalView = socks[0].last("view")?.view;
  // after the match: finished-idle cleanup alarm
  current = "cleanup";
  await tick(config.finishedIdleMs + 1000);
  return { c, finished: JSON.stringify(finalView?.status ?? finalView?.match?.status), scored: c.saveByAction.score ?? 0 };
}
const runs = [];
for (let i = 0; i < MATCHES; i++) runs.push(await oneMatch(1000 + i, i % 2 === 0));
const avg = (f: (r: (typeof runs)[number]) => number) => runs.reduce((a, r) => a + f(r), 0) / runs.length;
const byAction: Record<string, number> = {};
for (const r of runs) for (const [k, v] of Object.entries(r.c.saveByAction)) byAction[k] = (byAction[k] ?? 0) + v / runs.length;
// Directory DO (worker/src/index.ts RoomDirectory): create = INSERT rooms (TEXT PK → table row + autoindex row = 2)
// + daily UPSERT (INTEGER PK, 1); cleanup = DELETE rooms (2). Account delivery per logged-in seat ≈ 2–3 (D-028 table).
const directory = { create: 3, cleanup: 2 };
const out = {
  generatedBy: "scripts/economy/measure-room-writes.ts",
  method: "worker/src/host.ts RoomHost with a counting HostStorage; production default config (turn limit 120 s); DP Expert players; 4 s per action",
  matches: MATCHES,
  perMatch: {
    recordSaves: avg((r) => r.c.save), setAlarm: avg((r) => r.c.setAlarm), deleteAlarm: avg((r) => r.c.deleteAlarm), commands: avg((r) => r.c.commands), rolls: avg((r) => r.c.rolls), alarmsFired: avg((r) => r.c.alarmsFired), holdMessages: avg((r) => r.c.holdsSent), maxRecordBytes: Math.max(...runs.map((r) => r.c.recordBytes)),
    saveByAction: byAction,
  },
  directory,
  totalRoomRowWrites: avg((r) => r.c.save + r.c.setAlarm + r.c.deleteAlarm) + directory.create + directory.cleanup,
  finished: runs.map((r) => r.finished),
  scoredPerMatch: runs.map((r) => r.scored),
  note: "Row-write billing: an UPSERT into a table with INTEGER PRIMARY KEY writes 1 row; a TEXT PRIMARY KEY adds an autoindex row; setAlarm/deleteAlarm are billed as row writes; deleteAll counts the rows it deletes. Hold toggles are not persisted (socket attachment).",
};
writeFileSync("docs/economy/results/room-writes.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1).slice(0, 1500));
