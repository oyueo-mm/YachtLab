/**
 * Multiplayer cost simulation through the real Durable Object room logic (worker/src/host.ts +
 * src/online/room.ts), runtime-free: N players each on their own socket, a full 12-round match,
 * in turn-by-turn and simultaneous mode. Measures what the Workers Free budget is charged on:
 *   - SQLite row writes (record saves + alarm changes),
 *   - stored record size (one row; serialized every write),
 *   - CPU per command (host.message wall time in Node, single thread — a proxy for workerd CPU),
 *   - restart audit cost (rebuild from the stored log = what a woken Durable Object does),
 *   - outgoing socket messages (fan-out; not billed as requests, but CPU and bandwidth).
 * Usage: npx tsx scripts/online/load-sim.ts [repeats]   → docs/online/results/load-sim.json
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { seededDiceSource } from "../../src/online";
import type { RoomRecord } from "../../src/online/room";
import { RoomHost, type HostSocket, type HostStorage } from "../../worker/src/host";
import { readConfig } from "../../worker/src/config";

class Sock implements HostSocket {
  out = 0;
  last: Record<string, any> | null = null;
  view: any = null;
  private a: string | null = null;
  send(d: string) {
    this.out++;
    const m = JSON.parse(d);
    if (m.t === "view" || m.t === "welcome") this.view = m.view;
    this.last = m;
  }
  close() {}
  serializeAttachment(v: unknown) {
    this.a = JSON.stringify(v);
  }
  deserializeAttachment() {
    return this.a === null ? null : JSON.parse(this.a);
  }
}

async function simulate(players: number, mode: "turns" | "simultaneous", seed: number) {
  const st = { record: null as string | null, writes: 0, alarms: 0, maxBytes: 0, serializeMs: 0 };
  const storage: HostStorage = {
    load: () => (st.record ? (JSON.parse(st.record) as RoomRecord) : null),
    save: (r) => {
      const t0 = performance.now();
      st.record = JSON.stringify(r);
      st.serializeMs += performance.now() - t0;
      st.writes++;
      st.maxBytes = Math.max(st.maxBytes, st.record.length);
    },
    getAlarm: () => null,
    setAlarm: () => void st.alarms++,
    deleteAlarm: () => undefined,
    clear: () => void (st.record = null),
  };
  let t = 1_000_000;
  const open: Sock[] = [];
  const host = new RoomHost(storage, () => open, readConfig({ TURN_TIMEOUT_MS: "120000" }), () => t, seededDiceSource(seed));
  host.init();
  const seats: { sock: Sock; id: string }[] = [];
  for (let i = 0; i < players; i++) {
    const r = i === 0 ? await host.create("ABCDEF", "p" + i, null, null, players) : await host.join("p" + i, null);
    if (!r.ok) throw Error(JSON.stringify(r.error));
    const sock = new Sock();
    open.push(sock);
    host.accepted(sock);
    await host.message(sock, JSON.stringify({ t: "hello", token: r.token }));
    seats.push({ sock, id: r.playerId });
  }
  if (mode === "simultaneous") await host.message(seats[0].sock, JSON.stringify({ t: "settings", mode, timeoutMs: 120_000 }));
  for (const p of seats.slice(1)) await host.message(p.sock, JSON.stringify({ t: "ready", ready: true }));
  const lobbyWrites = st.writes + st.alarms;
  const times: number[] = [];
  let n = 0;
  const cmd = async (p: { sock: Sock }, action: unknown) => {
    t += 300;
    const t0 = performance.now();
    await host.message(p.sock, JSON.stringify({ t: "cmd", id: "c" + ++n, action }));
    times.push(performance.now() - t0);
  };
  await cmd(seats[0], { type: "start" });
  const writesAtStart = st.writes + st.alarms;
  const strategy = async (p: { sock: Sock }) => {
    // A simple player: up to three rolls keeping the most common face, then the best score.
    for (let roll = 0; roll < 3; roll++) {
      const v = p.sock.view;
      if (!v?.legal) return;
      if (v.turn.rolls > 0) {
        const best = [...v.legal.scores].sort((a: any, b: any) => b.points - a.points)[0];
        if (best.points >= 25 || roll === 2) return cmd(p, { type: "score", category: best.category });
      }
      const dice: number[] = v.turn.dice;
      const counts = [0, 0, 0, 0, 0, 0, 0];
      dice.forEach((d) => counts[d]++);
      const face = counts.indexOf(Math.max(...counts));
      const keep = v.turn.rolls ? dice.map((d, i) => (d === face ? i : -1)).filter((i) => i >= 0).slice(0, 4) : [];
      await cmd(p, { type: "roll", keep });
    }
    const v = p.sock.view;
    if (v?.legal) await cmd(p, { type: "score", category: [...v.legal.scores].sort((a: any, b: any) => b.points - a.points)[0].category });
  };
  for (let guard = 0; guard < 100_000 && host.room!.match.status === "playing"; guard++) {
    if (mode === "simultaneous") {
      // everyone acts in the same round, interleaved
      const round = host.room!.match.round;
      for (const p of seats) await strategy(p);
      if (host.room!.match.round === round && host.room!.match.status === "playing") throw Error("round did not advance");
    } else {
      const who = host.room!.match.turn!.playerId;
      await strategy(seats.find((s) => s.id === who)!);
    }
  }
  if (host.room!.match.status !== "finished") throw Error("did not finish");
  const events = host.room!.match.log.length;
  // restart: a woken Durable Object re-audits the whole stored log
  const r0 = performance.now();
  const again = new RoomHost(storage, () => open, readConfig({ TURN_TIMEOUT_MS: "120000" }), () => t, seededDiceSource(1));
  again.init();
  const rebuildMs = performance.now() - r0;
  const sorted = [...times].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return {
    players,
    mode,
    commands: times.length,
    events,
    rowWritesLobby: lobbyWrites,
    rowWritesMatch: st.writes + st.alarms - writesAtStart,
    rowWritesTotal: st.writes + st.alarms,
    recordBytesMax: st.maxBytes,
    cpuMsPerCommand: { avg: times.reduce((a, b) => a + b, 0) / times.length, p50: q(0.5), p95: q(0.95), max: sorted.at(-1)! },
    serializeMsTotal: st.serializeMs,
    rebuildMs,
    messagesOut: open.reduce((a, s) => a + s.out, 0),
  };
}

const repeats = Number(process.argv[2] ?? 3);
const rows: Awaited<ReturnType<typeof simulate>>[] = [];
// warm-up (JIT) so the first measured run is not dominated by compilation
await simulate(4, "turns", 999);
for (const players of [2, 4, 6, 10, 20])
  for (const mode of ["turns", "simultaneous"] as const)
    for (let r = 0; r < repeats; r++) {
      const row = await simulate(players, mode, 1000 + players * 10 + r);
      rows.push(row);
      console.log(`${String(players).padStart(2)}명 ${mode.padEnd(12)} cmds ${row.commands} writes ${row.rowWritesTotal} record ${(row.recordBytesMax / 1024).toFixed(0)}KB cpu/cmd avg ${row.cpuMsPerCommand.avg.toFixed(2)} p95 ${row.cpuMsPerCommand.p95.toFixed(2)} max ${row.cpuMsPerCommand.max.toFixed(1)} ms rebuild ${row.rebuildMs.toFixed(0)} ms out ${row.messagesOut}`);
    }
mkdirSync("docs/online/results", { recursive: true });
writeFileSync("docs/online/results/load-sim.json", JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, repeats, rows }, null, 1));
