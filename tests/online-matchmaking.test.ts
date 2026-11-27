import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { seededDiceSource } from "../src/online";
import type { RoomRecord } from "../src/online/room";
import { HubCore, HUB_LIMITS, type HubSql, type MatchResult, type QueueSeat } from "../worker/src/hub";
import { RoomHost, type HostSocket, type HostStorage } from "../worker/src/host";
import { readConfig } from "../worker/src/config";

/**
 * Quick match queue + public spectating list (Phase 4.5), runtime-free: fake hibernatable sockets
 * (attachments survive), node:sqlite for the hub's result table, fake clock.
 */
class Sock implements HostSocket {
  sent: Record<string, any>[] = [];
  closed: number | null = null;
  private attachment: string | null = null;
  send(data: string) {
    if (this.closed === null) this.sent.push(JSON.parse(data));
  }
  close(code = 1000) {
    this.closed = code;
  }
  serializeAttachment(v: unknown) {
    this.attachment = JSON.stringify(v);
  }
  deserializeAttachment() {
    return this.attachment === null ? null : JSON.parse(this.attachment);
  }
  last(t: string) {
    return [...this.sent].reverse().find((m) => m.t === t);
  }
}
function sqlite(): HubSql {
  const db = new DatabaseSync(":memory:");
  return {
    exec<T>(query: string, ...params: unknown[]) {
      const stmt = db.prepare(query);
      const rows = /^\s*select/i.test(query) ? (stmt.all(...(params as never[])) as T[]) : (stmt.run(...(params as never[])), [] as T[]);
      return { toArray: () => rows };
    },
  };
}
const ticket = (n: number) => ("ticket" + n).padEnd(30, "x");
const device = (n: number) => ("device" + n).padEnd(30, "y");

function harness(opts: { sessions?: Record<string, string>; fail?: string; slow?: boolean; beforeCreate?: () => Promise<void>; afterCreate?: () => void } = {}) {
  let t = 1_700_000_000_000;
  const open: Sock[] = [];
  const made: { a: QueueSeat; b: QueueSeat; pub: boolean; code: string }[] = [];
  let n = 0;
  const allocations = new Map<string, MatchResult>();
  const sql = sqlite();
  async function createMatch(a: QueueSeat, b: QueueSeat, o: { public: boolean; assignmentId: string }) {
    await opts.beforeCreate?.();
    const old = allocations.get(o.assignmentId);
    if (old) return old;
    if (opts.slow) await new Promise((r) => setTimeout(r, 5));
    if (opts.fail) return { ok: false as const, message: opts.fail };
    const code = "ROOM" + String.fromCharCode(65 + n++) + "Z";
    made.push({ a, b, pub: o.public, code });
    const result = { ok: true as const, code, seats: [{ playerId: "p_a" + n, token: "tok-a" + n }, { playerId: "p_b" + n, token: "tok-b" + n }] as [{ playerId: string; token: string }, { playerId: string; token: string }] };
    allocations.set(o.assignmentId, result);
    opts.afterCreate?.();
    return result;
  }
  const deps = {
    now: () => t,
    sockets: () => open.filter((s) => s.closed === null),
    sql,
    auth: async (s: string) => opts.sessions?.[s] ?? null,
    createMatch,
  };
  let hub = new HubCore(deps);
  hub.init();
  const connect = () => {
    const s = new Sock();
    open.push(s);
    return s;
  };
  const queue = async (s: Sock, m: Record<string, unknown>) => hub.message(s, JSON.stringify({ t: "queue", ...m }));
  return {
    hub: () => hub,
    /** Simulate hibernation: memory is gone, sockets and their attachments stay. */
    evict: () => {
      hub = new HubCore(deps);
      hub.init();
    },
    connect,
    queue,
    made,
    open,
    advance: (ms: number) => (t += ms),
  };
}

describe("빠른 대전 매칭 큐", () => {
  it("두 명을 짝짓고 좌석 정보를 한 번씩만 주며, 게스트도 매칭된다", async () => {
    const h = harness();
    const a = h.connect();
    await h.queue(a, { name: "민수", ticket: ticket(1), device: device(1), spectate: true });
    expect(a.last("queued")).toBeTruthy();
    expect(h.made).toHaveLength(0);
    const b = h.connect();
    await h.queue(b, { name: "지민", ticket: ticket(2), device: device(2), spectate: true });
    expect(h.made).toHaveLength(1);
    expect(h.made[0].pub).toBe(true);
    const ma = a.last("matched")!,
      mb = b.last("matched")!;
    expect(ma.code).toBe(mb.code);
    expect(new Set([ma.token, mb.token]).size).toBe(2);
    expect([ma.opponent, mb.opponent].sort()).toEqual(["민수", "지민"]);
    expect(a.closed).toBe(1000);
    expect(b.closed).toBe(1000);
  });

  it("빠른 대전은 클라이언트가 보낸 공개 여부와 관계없이 항상 공개 경기로 만든다 (D-045)", async () => {
    const h = harness();
    await h.queue(h.connect(), { name: "민수", ticket: ticket(1), device: device(1), spectate: true });
    await h.queue(h.connect(), { name: "지민", ticket: ticket(2), device: device(2), spectate: false });
    expect(h.made[0].pub).toBe(true);
    await h.queue(h.connect(), { name: "수아", ticket: ticket(3), device: device(3) });
    await h.queue(h.connect(), { name: "도윤", ticket: ticket(4), device: device(4) });
    expect(h.made[1].pub).toBe(true);
  });

  it("자기 자신(같은 계정·같은 기기·같은 탭)과는 매칭하지 않는다 — 같은 IP는 막지 않는다", async () => {
    const h = harness({ sessions: { ["s1.u_" + "a".repeat(22) + "." + "b".repeat(43)]: "u_" + "a".repeat(22) } });
    const session = "s1.u_" + "a".repeat(22) + "." + "b".repeat(43);
    const a = h.connect();
    await h.queue(a, { name: "민수", ticket: ticket(1), device: device(1), session });
    // the same account in another browser: refused (already waiting)
    const a2 = h.connect();
    await h.queue(a2, { name: "민수", ticket: ticket(2), device: device(2), session });
    expect(a2.last("error")?.code).toBe("DUPLICATE");
    // the same browser (device id) in another tab as a guest: waits but is never paired with it
    const a3 = h.connect();
    await h.queue(a3, { name: "민수2", ticket: ticket(3), device: device(1) });
    expect(h.made).toHaveLength(0);
    // a different device (could be the same IP — not used): paired with the oldest compatible
    const b = h.connect();
    await h.queue(b, { name: "지민", ticket: ticket(4), device: device(4) });
    expect(h.made).toHaveLength(1);
    expect([h.made[0].a.name, h.made[0].b.name].sort()).toEqual(["민수", "지민"]);
    expect(a3.closed).toBeNull(); // still waiting
  });

  it("동시에 들어온 요청에서도 한 사람이 두 경기에 배정되지 않는다", async () => {
    const h = harness({ slow: true });
    const socks = Array.from({ length: 7 }, () => h.connect());
    await Promise.all(socks.map((s, i) => h.queue(s, { name: "p" + i, ticket: ticket(i), device: device(i) })));
    await new Promise((r) => setTimeout(r, 60));
    const seats = h.made.flatMap((m) => [m.a.key, m.b.key]);
    expect(new Set(seats).size).toBe(seats.length);
    expect(h.made).toHaveLength(3);
    expect(socks.filter((s) => s.last("matched")).length).toBe(6);
  });

  it("새로고침(같은 티켓)은 자리를 이어받고, 매칭 직후 끊긴 화면은 같은 좌석을 다시 받는다", async () => {
    const h = harness();
    const a = h.connect();
    await h.queue(a, { name: "민수", ticket: ticket(1), device: device(1) });
    h.advance(3000);
    const a2 = h.connect();
    await h.queue(a2, { name: "민수", ticket: ticket(1), device: device(1) });
    expect(a.closed).toBe(4010); // replaced
    expect(a2.last("queued")).toBeTruthy();
    const b = h.connect();
    await h.queue(b, { name: "지민", ticket: ticket(2), device: device(2) });
    const first = a2.last("matched")!;
    // the page reloads right after the match was made: the same ticket gets the same seat
    const a3 = h.connect();
    await h.queue(a3, { name: "민수", ticket: ticket(1), device: device(1) });
    expect(a3.last("matched")).toEqual(first);
    expect(h.made).toHaveLength(1);
    // after 5 minutes the stored result is gone
    h.advance(HUB_LIMITS.resultTtlMs + 1);
    const a4 = h.connect();
    await h.queue(a4, { name: "민수", ticket: ticket(1), device: device(1) });
    expect(a4.last("matched")).toBeUndefined();
  });

  it("짧게 끊긴 탭은 살아 있는 동일 티켓으로 다시 연결해 큐 순서를 유지한다", async () => {
    const h = harness();
    const a = h.connect();
    const info = { name: "민수", ticket: ticket(1), device: device(1), v: 2 };
    await h.queue(a, info);
    const since = a.last("queued")?.since;
    a.close();
    h.hub().closed(a);
    h.advance(1_000);
    const b = h.connect();
    await h.queue(b, info);
    expect(b.last("queued")?.since).toBe(since);
    expect(h.hub().waiting()).toBe(1);
  });

  it("진행 중인 무작위 대전이 있으면 다시 매칭하지 않고, 경기가 끝나면 다시 가능하다", async () => {
    const h = harness();
    await h.queue(h.connect(), { name: "민수", ticket: ticket(1), device: device(1) });
    await h.queue(h.connect(), { name: "지민", ticket: ticket(2), device: device(2) });
    const again = h.connect();
    await h.queue(again, { name: "민수", ticket: ticket(3), device: device(1) });
    expect(again.last("error")).toMatchObject({ code: "IN_MATCH", room: h.made[0].code });
    h.hub().ended(h.made[0].code);
    const ok = h.connect();
    await h.queue(ok, { name: "민수", ticket: ticket(4), device: device(1) });
    expect(ok.last("queued")).toBeTruthy();
  });

  it("같은 두 사람은 10분 안에 바로 다시 짝지어지지 않지만, 둘 다 20초 넘게 기다리면 허용한다", async () => {
    const h = harness();
    await h.queue(h.connect(), { name: "민수", ticket: ticket(1), device: device(1) });
    await h.queue(h.connect(), { name: "지민", ticket: ticket(2), device: device(2) });
    h.hub().ended(h.made[0].code);
    const a = h.connect(),
      b = h.connect();
    await h.queue(a, { name: "민수", ticket: ticket(3), device: device(1) });
    await h.queue(b, { name: "지민", ticket: ticket(4), device: device(2) });
    expect(h.made).toHaveLength(1);
    // a third player arrives: paired with one of them
    await h.queue(h.connect(), { name: "수아", ticket: ticket(5), device: device(5) });
    expect(h.made).toHaveLength(2);
    expect([h.made[1].a.name, h.made[1].b.name]).toContain("수아");
    // the two old opponents meet again only after both waited 20 s (alive messages keep them in)
    const left = [a, b].find((s) => s.closed === null)!;
    // the one paired with 수아 comes back after that match ended; the other is still waiting
    const back = h.made[1].a.name === "수아" ? h.made[1].b.name : h.made[1].a.name;
    h.hub().ended(h.made[1].code);
    const other = h.connect();
    await h.queue(other, { name: back, ticket: ticket(6), device: back === "민수" ? device(1) : device(2) });
    expect(h.made).toHaveLength(2); // the same two people: not right away
    for (let i = 0; i < 2; i++) {
      h.advance(15_000);
      await h.hub().message(left, JSON.stringify({ t: "alive" }));
      await h.hub().message(other, JSON.stringify({ t: "alive" }));
    }
    expect(h.made).toHaveLength(3); // both waited ≥ 20 s: allowed (a heartbeat re-tries pairing)
  });

  it("유령 대기열: 신호가 끊긴 대기자와 5분 지난 대기자는 정리된다 (Hibernation 후에도)", async () => {
    const h = harness();
    const a = h.connect();
    await h.queue(a, { name: "민수", ticket: ticket(1), device: device(1) });
    const b = h.connect();
    await h.queue(b, { name: "지민", ticket: ticket(2), device: device(1) }); // same device: never paired
    h.evict(); // memory gone, attachments stay
    expect(h.hub().waiting()).toBe(2);
    for (let i = 0; i < 6; i++) {
      h.advance(15_000);
      await h.hub().message(b, JSON.stringify({ t: "alive" }));
    }
    expect(a.closed).toBe(4012); // silent for 45 s
    expect(b.closed).toBeNull();
    for (let i = 0; i < 16; i++) {
      h.advance(15_000);
      await h.hub().message(b, JSON.stringify({ t: "alive" }));
    }
    expect(b.last("expired")).toBeTruthy();
    expect(b.closed).toBe(4013);
    expect(h.hub().waiting()).toBe(0);
  });

  it("취소하면 즉시 대기열에서 빠지고, 서버 한도에 걸리면 두 사람 모두 안내를 받는다", async () => {
    const h = harness({ fail: "오늘은 빠른 대전을 더 할 수 없어요." });
    const a = h.connect();
    await h.queue(a, { name: "민수", ticket: ticket(1), device: device(1) });
    await h.hub().message(a, JSON.stringify({ t: "cancel" }));
    expect(a.closed).toBe(1000);
    expect(h.hub().waiting()).toBe(0);
    const b = h.connect(),
      c = h.connect();
    await h.queue(b, { name: "지민", ticket: ticket(2), device: device(2) });
    await h.queue(c, { name: "수아", ticket: ticket(3), device: device(3) });
    expect(b.last("error")).toMatchObject({ code: "UNAVAILABLE", message: "오늘은 빠른 대전을 더 할 수 없어요." });
    expect(c.last("error")?.code).toBe("UNAVAILABLE");
  });

  it("두 탭 중 하나만 대기하고, 체크 중 취소하면 상대는 기존 대기로 복귀한다", async () => {
    const h = harness();
    const a = h.connect(), duplicate = h.connect(), b = h.connect();
    await h.queue(a, { name: "민수", ticket: ticket(1), device: device(1), v: 2 });
    await h.queue(duplicate, { name: "민수", ticket: ticket(2), device: device(1), v: 2 });
    expect(duplicate.last("error")?.code).toBe("DUPLICATE");
    const pairing = h.queue(b, { name: "지민", ticket: ticket(3), device: device(3), v: 2 });
    await expect.poll(() => a.last("check")).toBeTruthy();
    await h.hub().message(b, JSON.stringify({ t: "ready", id: b.last("check")!.id }));
    await h.hub().message(a, JSON.stringify({ t: "cancel", v: 2 }));
    await pairing;
    expect(a.last("cancelled")).toBeTruthy();
    expect(b.last("queued")).toBeTruthy();
    expect(h.hub().waiting()).toBe(1);
    expect(h.made).toHaveLength(0);
  });

  it("상대방이 연결 확인 중 끊기면 방을 만들지 않고 남은 대기자를 보존한다", async () => {
    const h = harness();
    const a = h.connect(), b = h.connect();
    await h.queue(a, { name: "민수", ticket: ticket(1), device: device(1), v: 2 });
    const pairing = h.queue(b, { name: "지민", ticket: ticket(2), device: device(2), v: 2 });
    await expect.poll(() => a.last("check")).toBeTruthy();
    await h.hub().message(a, JSON.stringify({ t: "ready", id: a.last("check")!.id }));
    h.hub().closed(b);
    await pairing;
    expect(h.made).toHaveLength(0);
    expect(h.hub().waiting()).toBe(1);
  });

  it("할당 이후 취소·연결 종료·허브 재시작에도 동일한 좌석 결과를 회수한다", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const h = harness({ beforeCreate: () => gate });
    const a = h.connect(), b = h.connect();
    await h.queue(a, { name: "민수", ticket: ticket(1), device: device(1), v: 2 });
    const pairing = h.queue(b, { name: "지민", ticket: ticket(2), device: device(2), v: 2 });
    await expect.poll(() => a.last("check")).toBeTruthy();
    await h.hub().message(a, JSON.stringify({ t: "ready", id: a.last("check")!.id }));
    await h.hub().message(b, JSON.stringify({ t: "ready", id: b.last("check")!.id }));
    await expect.poll(() => a.last("pairing")).toBeTruthy();
    await h.hub().message(a, JSON.stringify({ t: "cancel", v: 2 }));
    expect(a.last("cancelled")).toBeUndefined();
    a.close();
    h.hub().closed(a);
    release();
    await pairing;
    h.evict();
    const recovered = h.connect();
    await h.hub().message(recovered, JSON.stringify({ t: "cancel", v: 2, ticket: ticket(1) }));
    expect(recovered.last("matched")?.code).toBe(b.last("matched")?.code);
    const duplicate = h.connect();
    await h.queue(duplicate, { name: "민수", ticket: ticket(3), device: device(1), v: 2 });
    expect(duplicate.last("error")?.code).toBe("IN_MATCH");
    expect(h.made).toHaveLength(1);
  });

  it("방 생성 응답 유실 후 허브 재시작에서도 새 방을 할당하지 않는다", async () => {
    let created = 0;
    let losingReply = true;
    const h = harness({ afterCreate: () => {
      if (!losingReply) return;
      losingReply = false;
      created++;
      throw new Error("room committed, reply lost");
    } });
    const a = h.connect(), b = h.connect();
    await h.queue(a, { name: "민수", ticket: ticket(1), device: device(1) });
    await h.queue(b, { name: "지민", ticket: ticket(2), device: device(2) });
    expect(a.closed).toBe(1012);
    h.evict();
    const resumed = h.connect();
    await h.queue(resumed, { name: "민수", ticket: ticket(1), device: device(1) });
    const other = h.connect();
    await h.queue(other, { name: "지민", ticket: ticket(2), device: device(2) });
    expect(created).toBe(1);
    expect(h.made).toHaveLength(1);
    expect(resumed.last("matched")?.code).toBe(other.last("matched")?.code);
  });

  it("서버 현황은 관측 범위를 확인하고 완료·요트 이벤트를 UTC 일자로 중복 제거한다", () => {
    const h = harness();
    expect(h.hub().activity(["MISSING"])).toMatchObject({ playing: null, activeUsers: null, spectators: null, privatePlaying: null });
    h.hub().observeRoom("SECRET", { kind: "friend", status: "playing", spectators: 1, public: false });
    const now = h.hub().activity(["SECRET"]).asOf;
    h.hub().completed("m_a", now);
    h.hub().completed("m_a", now);
    h.hub().yachts("m_a", [{ at: now, seq: 4 }, { at: now, seq: 4 }, { at: now - 86_400_000, seq: 2 }]);
    const activity = h.hub().activity(["SECRET"]);
    expect(activity).toMatchObject({ playing: { random: 0, friend: 1, ai: 0 }, spectators: 1, privatePlaying: 1, completedToday: 1, yachtsToday: 1, timezone: "UTC" });
    expect(JSON.stringify(activity)).not.toContain("SECRET");
    h.advance(86_400_000);
    expect(h.hub().activity(["SECRET"])).toMatchObject({ completedToday: 0, yachtsToday: 0 });
  });

  it("C3 세션이 만료되면 게스트로 바꾸지 않고 재로그인을 안내한다", async () => {
    const h = harness();
    const a = h.connect();
    await h.queue(a, { name: "민수", ticket: ticket(1), device: device(1), v: 2, session: "s1.u_" + "a".repeat(22) + "." + "b".repeat(43) });
    expect(a.last("error")?.code).toBe("SESSION_EXPIRED");
    expect(h.hub().waiting()).toBe(0);
  });

  it("잘못된 닉네임·티켓은 거부한다", async () => {
    const h = harness();
    const a = h.connect();
    await h.queue(a, { name: "운영자", ticket: ticket(1) });
    expect(a.last("error")?.code).toBe("NAME");
    const b = h.connect();
    await h.queue(b, { name: "민수", ticket: "short" });
    expect(b.last("error")?.code).toBe("INVALID");
  });
});

describe("공개 관전 목록", () => {
  it("항목에 좌석 토큰·관전 키·계정 ID가 없고, 3분간 갱신이 없으면 사라진다", async () => {
    const h = harness();
    h.hub().publish({ code: "ABCDEF", players: [{ name: "민수", score: 30, look: {} }, { name: "지민", score: 12, look: {} }], round: 3, spectators: 1, max: 5, token: "secret", key: "k" });
    const list = h.hub().list();
    expect(list).toHaveLength(1);
    const text = JSON.stringify(list);
    for (const leak of ["secret", '"key"', "token", "u_"]) expect(text).not.toContain(leak);
    h.advance(HUB_LIMITS.publicTtlMs + 1);
    expect(h.hub().list()).toHaveLength(0);
  });
});

/* ------------------------------------------------- room side: matched rooms and the public entry ------------------------------------------------- */
function storage() {
  const state = { record: null as string | null, writes: 0 };
  const s: HostStorage = {
    load: () => (state.record ? (JSON.parse(state.record) as RoomRecord) : null),
    save: (r) => {
      state.record = JSON.stringify(r);
      state.writes++;
    },
    getAlarm: () => null,
    setAlarm: () => void state.writes++,
    deleteAlarm: () => undefined,
    clear: () => void (state.record = null),
  };
  return { state, s };
}

describe("빠른 대전 방 (RoomHost)", () => {
  it("매칭된 방은 한 번의 저장으로 두 좌석과 시작을 기록하고, 초대 입장은 막으며, 공개 항목을 올리고 경기 중 공개를 끌 수 없으며 종료 즉시 내린다", async () => {
    const { state, s } = storage();
    const open: Sock[] = [];
    const published: unknown[] = [];
    const ended: string[] = [];
    const host = new RoomHost(s, () => open, readConfig({ TURN_TIMEOUT_MS: "0" }), () => 1_000, seededDiceSource(5), {
      publish: (_code, entry) => void published.push(entry),
      matchEnded: (code) => void ended.push(code),
    });
    host.init();
    const made = await host.createMatched("ABCDEF", [{ name: "민수" }, { name: "지민" }], { kind: "random", public: true });
    if (!made.ok) throw Error(made.message);
    expect(state.writes).toBeLessThanOrEqual(2); // the record (+ at most one alarm)
    expect(host.room!.match.status).toBe("playing");
    expect(host.room!.kind).toBe("random");
    expect((await host.join("수아")).ok).toBe(false);
    expect(published.at(-1)).toMatchObject({ code: "ABCDEF", round: 1, spectators: 0, max: 5 });
    expect(JSON.stringify(published)).not.toContain("tok");
    expect(host.publicWatch()).toBeTruthy();
    // the list entry carries no seat token, watch key or account id
    for (const e of published) expect(Object.keys(e as object).sort()).toEqual(["code", "kind", "max", "participants", "players", "round", "rounds", "spectators", "status"]);
    expect(JSON.stringify(published)).not.toContain(made.seats[0].token);
    // a player cannot switch the public match off (refused, the entry and key stay)
    const [a] = [new Sock()];
    open.push(a);
    host.accepted(a);
    await host.message(a, JSON.stringify({ t: "hello", token: made.seats[0].token }));
    const before = host.publicWatch();
    await host.message(a, JSON.stringify({ t: "spectate", allow: false }));
    expect(a.last("error")).toMatchObject({ code: "SPECTATE" });
    expect(a.last("spectate")!.spectate).toMatchObject({ active: true, public: true });
    expect(host.publicWatch()).toBe(before);
    expect(published.at(-1)).not.toBeNull();
    // resign ends the match → matchEnded for the queue
    await host.message(a, JSON.stringify({ t: "cmd", id: "r1", action: { type: "resign" } }));
    expect(host.room!.match.status).toBe("finished");
    expect(ended).toEqual(["ABCDEF"]);
    // finished → removed from the public list at once
    expect(published.at(-1)).toBeNull();
    expect(host.publicWatch()).toBeNull();
  });
});
