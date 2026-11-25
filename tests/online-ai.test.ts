import { describe, expect, it } from "vitest";
import { seededDiceSource } from "../src/online";
import type { RoomRecord } from "../src/online/room";
import { serverAiMove } from "../src/online/server-ai";
import { AI_TIMING, RoomHost, type HostSocket, type HostStorage } from "../worker/src/host";
import { readConfig } from "../worker/src/config";
import { categories, score } from "../src/engine";
import type { MatchRecord } from "../src/identity/records";

/** Server-verified AI match (Phase 4.5): the room plays the AI seat with the same engine and storage. */
class Sock implements HostSocket {
  sent: Record<string, any>[] = [];
  closed: number | null = null;
  private a: string | null = null;
  send(d: string) {
    if (this.closed === null) this.sent.push(JSON.parse(d));
  }
  close(c = 1000) {
    this.closed = c;
  }
  serializeAttachment(v: unknown) {
    this.a = JSON.stringify(v);
  }
  deserializeAttachment() {
    return this.a === null ? null : JSON.parse(this.a);
  }
  last(t: string): Record<string, any> | undefined {
    return [...this.sent].reverse().find((m) => m.t === t);
  }
}
function storage(failWrites = () => false) {
  const st = { record: null as string | null, writes: 0, alarm: null as number | null };
  const s: HostStorage = {
    load: () => (st.record ? (JSON.parse(st.record) as RoomRecord) : null),
    save: (r) => {
      if (failWrites()) throw Error("storage down");
      st.record = JSON.stringify(r);
      st.writes++;
    },
    getAlarm: () => st.alarm,
    setAlarm: (at) => void ((st.alarm = at), st.writes++),
    deleteAlarm: () => void (st.alarm = null),
    clear: () => void (st.record = null),
  };
  return { st, s };
}
const settle = () => new Promise((r) => setTimeout(r, 15));

describe("서버 검증 AI 대전", () => {
  it("AI 좌석은 토큰이 없고, 서버가 주사위·점수를 결정하며 12라운드를 끝내면 회원 기록(kind=ai)이 한 번 전달된다", async () => {
    AI_TIMING.stepMs = 1;
    const { st, s } = storage();
    const open: Sock[] = [];
    const delivered: MatchRecord[] = [];
    let t = 1_000_000;
    const host = new RoomHost(s, () => open, readConfig({ TURN_TIMEOUT_MS: "0" }), () => t, seededDiceSource(11), { deliverRecord: async (_u, r) => (delivered.push(r), true) });
    host.init();
    const made = await host.createMatched("ABCDEF", [{ name: "민수", identity: { userId: "u_" + "m".repeat(22) } }, { name: "AI (보통)", ai: true }], { kind: "ai", public: true });
    if (!made.ok) throw Error(made.message);
    expect(made.seats[1].token).toBe("");
    expect(JSON.parse(st.record!).credentials[made.seats[1].playerId]).toBeUndefined();
    expect(JSON.parse(st.record!).public).toBeUndefined(); // AI matches are never public
    const a = new Sock();
    open.push(a);
    host.accepted(a);
    await host.message(a, JSON.stringify({ t: "hello", token: made.seats[0].token }));
    expect(a.last("welcome")!.ai).toMatchObject({ playerId: made.seats[1].playerId, level: "보통" });
    expect(a.last("welcome")!.online).toContain(made.seats[1].playerId);
    // nobody can connect as the AI
    const fake = new Sock();
    open.push(fake);
    host.accepted(fake);
    await host.message(fake, JSON.stringify({ t: "hello", token: "" }));
    expect(fake.closed).toBe(4001);
    let n = 0;
    for (let guard = 0; guard < 400 && host.room!.match.status === "playing"; guard++) {
      const turn = host.room!.match.turn!;
      if (turn.playerId === made.seats[0].playerId) {
        await host.message(a, JSON.stringify({ t: "cmd", id: "r" + ++n, action: { type: "roll", keep: [] } }));
        const view = a.last("view")!.view;
        const best = view.legal.scores.sort((x: { points: number }, y: { points: number }) => y.points - x.points)[0];
        await host.message(a, JSON.stringify({ t: "cmd", id: "s" + n, action: { type: "score", category: best.category } }));
      } else await settle(); // the AI plays on its timer
      t += 100;
    }
    expect(host.room!.match.status).toBe("finished");
    const ai = host.room!.match.players.find((p) => p.playerId === made.seats[1].playerId)!;
    expect(Object.keys(ai.card)).toHaveLength(12);
    await settle();
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ kind: "ai", verification: "server-verified", opponent: { kind: "ai", aiLevel: "보통" } });
    // no rematch with the AI
    await host.message(a, JSON.stringify({ t: "rematch", op: "request" }));
    expect(a.last("error")!.code).toBe("REMATCH");
  });

  it("저장 실패 시 AI 행동은 적용되지 않는다(fail-closed), 사람이 시간 초과하면 AI가 승리하고 기록은 본인 기권으로 남는다", async () => {
    AI_TIMING.stepMs = 1;
    let down = false;
    const { s } = storage(() => down);
    const open: Sock[] = [];
    let t = 5_000_000;
    const delivered: MatchRecord[] = [];
    const host = new RoomHost(s, () => open, readConfig({ TURN_TIMEOUT_MS: "60000" }), () => t, seededDiceSource(3), { deliverRecord: async (_u, r) => (delivered.push(r), true) });
    host.init();
    const made = await host.createMatched("ABCDEG", [{ name: "AI (보통)", ai: true }, { name: "지민", identity: { userId: "u_" + "j".repeat(22) } }], { kind: "ai", public: false });
    if (!made.ok) throw Error(made.message);
    down = true;
    const v = host.room!.match.version;
    await host.runAi();
    expect(host.room!.match.version).toBe(v);
    down = false;
    await host.runAi();
    expect(host.room!.match.version).toBeGreaterThan(v);
    for (let i = 0; i < 20 && host.room!.match.turn!.playerId === made.seats[0].playerId; i++) await settle();
    expect(host.room!.match.turn!.playerId).toBe(made.seats[1].playerId);
    t += 61_000;
    await host.alarm();
    expect(host.room!.match.status).toBe("finished");
    await settle();
    expect(delivered[0]).toMatchObject({ outcome: "loss", endReason: "timeout" });
  });

  it("AI 결정은 Workers Free CPU 예산(10 ms) 안: 스레드 CPU 평균·p99, 미래 주사위를 보지 않는다", () => {
    const times: number[] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) % 6) + 1;
    for (let i = 0; i < 300; i++) {
      const dice = Array.from({ length: 5 }, rnd);
      const card = Object.fromEntries(categories.filter(() => rnd() <= 2).map((c) => [c, 0]));
      if (Object.keys(card).length === 12) continue;
      // Workers Free is a CPU budget. Wall time includes time the shared runner deschedules this test.
      const start = process.threadCpuUsage();
      const m = serverAiMove(dice, 1 + (i % 3), card);
      const cpu = process.threadCpuUsage(start);
      times.push((cpu.user + cpu.system) / 1000);
      if (m.type === "score") expect(card[m.category]).toBeUndefined();
      else expect(m.keep.every((k) => k >= 0 && k < 5)).toBe(true);
    }
    const sorted = times.slice(5).sort((a, b) => a - b);
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    console.log(`server AI decision CPU: avg ${avg.toFixed(2)} ms, p99 ${sorted[Math.floor(sorted.length * 0.99)].toFixed(2)} ms`);
    expect(avg).toBeLessThan(3);
    expect(sorted[Math.floor(sorted.length * 0.99)]).toBeLessThan(8);
    // with three rolls used it must score the best open category
    expect(serverAiMove([6, 6, 6, 6, 6], 3, {})).toEqual({ type: "score", category: categories.reduce((b, c) => (score([6, 6, 6, 6, 6], c) > score([6, 6, 6, 6, 6], b) ? c : b)) });
  });
});
