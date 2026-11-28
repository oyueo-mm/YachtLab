import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { AccountStore, type Sql } from "../worker/src/account";
import { EconomyStore, type EconSql } from "../worker/src/economy";
import { RULES_ID, type MatchRecord } from "../src/identity/records";

/**
 * SEC-1-01 follow-up: the record + reward settlement of one delivered match, composed exactly as
 * `UserStore.recordMatch` does (worker/src/index.ts) — one SQLite transaction around the record insert
 * and the economy settlement — over node:sqlite with real BEGIN/COMMIT/ROLLBACK.
 */
function account() {
  const db = new DatabaseSync(":memory:");
  let depth = 0;
  const sql: EconSql & Sql = {
    exec<T>(q: string, ...p: unknown[]) {
      const s = db.prepare(q);
      const rows = /^\s*(select|pragma)/i.test(q) ? (s.all(...(p as never[])) as T[]) : (s.run(...(p as never[])), [] as T[]);
      return { toArray: () => rows as never[] };
    },
    transaction<T>(fn: () => T): T {
      if (depth > 0) return fn();
      depth++;
      db.exec("BEGIN");
      try {
        const out = fn();
        db.exec("COMMIT");
        return out;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      } finally {
        depth--;
      }
    },
  } as EconSql & Sql;
  const userId = "u_" + "s".repeat(22);
  const store = new AccountStore(sql);
  const econ = new EconomyStore(sql);
  store.init();
  econ.init();
  const createdAt = Date.UTC(2026, 10, 1);
  store.ensureUser(userId, "google", createdAt);
  let failNext = false;
  /** Server delivery of one result (the UserStore.recordMatch composition). */
  const deliver = (record: MatchRecord, now: number) =>
    sql.transaction(() =>
      store.recordMatch(record, () => {
        econ.welcome(userId, now, null);
        const result = econ.applyMatch(userId, createdAt, { matchId: record.recordId, kind: record.kind ?? "friend", outcome: record.outcome, endReason: record.endReason, score: record.score, card: record.card, opponentUserId: record.opponent.userId, stats: record.stats, endedAt: record.endedAt }, now);
        if (failNext) {
          failNext = false;
          throw new Error("storage failure after settlement");
        }
        return result.receipt.quests.length || result.receipt.grants.length ? result.receipt : undefined;
      }),
    );
  const matchRows = () => econ.snapshot(userId, Date.now(), 200).ledger.filter((r) => r.id.startsWith("m:"));
  return { store, econ, userId, deliver, failOnce: () => (failNext = true), matchRows, verify: () => econ.verify() };
}

const T0 = Date.UTC(2026, 10, 20, 3);
const card = { aces: 3, deuces: 6, threes: 9, fours: 12, fives: 15, sixes: 18, choice: 20, four: 0, full: 0, small: 15, large: 30, yacht: 0 };
const score = Object.values(card).reduce((a, b) => a + b, 0);
const rec = (id: string, over: Partial<MatchRecord> = {}): MatchRecord => ({
  recordId: id, mode: "online", rules: RULES_ID, source: "server", verification: "server-verified", kind: "random",
  startedAt: T0, endedAt: T0 + 600_000, name: "나", score, card, outcome: "win", endReason: "completed",
  opponent: { name: "상대", kind: "member", score: 100, userId: "u_" + id.slice(-1).repeat(22) }, ...over,
} as MatchRecord);
const device = (r: MatchRecord): MatchRecord => ({ ...r, source: "device", verification: "client-reported", opponent: { name: r.opponent.name, kind: "guest", score: r.opponent.score } } as MatchRecord);

describe("SEC-1-01 후속: 기록·정산 호환성", () => {
  it("기존 기기 기록(같은 ID)은 서버 결과로 대체되고, 다른 ID의 기기 기록은 그대로 남는다", () => {
    const a = account();
    expect(a.store.importRecords([device(rec("m_preA", { outcome: "win" })), device(rec("d_local1", { mode: "ai", kind: undefined }))], "device", T0)).toEqual({ added: 2, skipped: 0 });
    expect(a.deliver(rec("m_preA", { outcome: "loss" }), T0 + 600_000)).toBe(true);
    const all = a.store.records();
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.recordId === "m_preA")).toMatchObject({ outcome: "loss", source: "server", verification: "server-verified", reward: expect.any(Object) });
    expect(all.find((r) => r.recordId === "d_local1")).toMatchObject({ verification: "client-reported" });
    expect(a.store.matchReward("m_preA")?.receipt).toBeTruthy();
    expect(a.matchRows().map((r) => r.id)).toEqual(["m:m_preA"]);
    expect(a.verify().ok).toBe(true);
  });

  it("서버 결과 재배달은 기록·원장을 다시 쓰지 않는다 (대체 후에도 멱등)", () => {
    const a = account();
    a.store.importRecords([device(rec("m_redel"))], "device", T0);
    expect(a.deliver(rec("m_redel"), T0 + 600_000)).toBe(true);
    const wallet = a.econ.snapshot(a.userId, T0 + 700_000).wallet;
    for (let i = 0; i < 3; i++) expect(a.deliver(rec("m_redel"), T0 + 700_000 + i)).toBe(false);
    expect(a.econ.snapshot(a.userId, T0 + 800_000).wallet).toEqual(wallet);
    expect(a.matchRows()).toHaveLength(1);
    expect(a.store.records().filter((r) => r.recordId === "m_redel")).toHaveLength(1);
    // a later device upload of the same id is skipped and does not downgrade the verified record
    expect(a.store.importRecords([device(rec("m_redel", { outcome: "loss" }))], "device", T0)).toEqual({ added: 0, skipped: 1 });
    expect(a.store.records()[0]).toMatchObject({ outcome: "win", verification: "server-verified" });
    expect(a.verify().ok).toBe(true);
  });

  it("정산 도중 실패하면 대체·정산 모두 되돌아가고(기기 기록 복원), 재배달에서 정확히 한 번 정산된다", () => {
    const a = account();
    a.store.importRecords([device(rec("m_fail", { outcome: "draw" }))], "device", T0);
    a.failOnce();
    expect(() => a.deliver(rec("m_fail", { outcome: "loss" }), T0 + 600_000)).toThrow();
    expect(a.store.records()).toEqual([expect.objectContaining({ recordId: "m_fail", outcome: "draw", verification: "client-reported" })]);
    expect(a.matchRows()).toHaveLength(0);
    expect(a.econ.snapshot(a.userId, T0).wallet).toEqual({ coins: 0, gems: 0 }); // welcome rolled back too
    expect(a.deliver(rec("m_fail", { outcome: "loss" }), T0 + 660_000)).toBe(true);
    expect(a.store.records()).toEqual([expect.objectContaining({ outcome: "loss", verification: "server-verified" })]);
    expect(a.matchRows()).toHaveLength(1);
    expect(a.deliver(rec("m_fail", { outcome: "loss" }), T0 + 720_000)).toBe(false);
    expect(a.matchRows()).toHaveLength(1);
    expect(a.verify().ok).toBe(true);
  });

  it("기기 기록이 있던 경기의 서버 결과도 연승·업적 정산에 그대로 반영된다", () => {
    const a = account();
    const at = (i: number) => T0 + i * 3600_000;
    for (let i = 1; i <= 4; i++) expect(a.deliver(rec("m_w" + i, { endedAt: at(i) }), at(i))).toBe(true);
    expect(a.econ.snapshot(a.userId, at(4)).state.streak).toBe(4);
    a.store.importRecords([device(rec("m_l5", { outcome: "win", endedAt: at(5) }))], "device", at(5));
    expect(a.deliver(rec("m_l5", { outcome: "loss", endedAt: at(5) }), at(5))).toBe(true);
    expect(a.econ.snapshot(a.userId, at(5)).state.streak).toBe(0);
    expect(a.deliver(rec("m_w6", { endedAt: at(6) }), at(6))).toBe(true);
    const snap = a.econ.snapshot(a.userId, at(6));
    expect(snap.state.streak).toBe(1);
    expect(Object.keys(snap.state.achievements ?? {})).not.toContain("s.streak5");
    expect(a.store.publicProfile()!.online).toMatchObject({ games: 6, wins: 5, losses: 1 });
    expect(a.verify().ok).toBe(true);
  });

  it("대조군: 기기 기록이 없으면 같은 순서에서 5연승 업적이 열린다 (업적 경로를 실제로 탄다)", () => {
    const a = account();
    const at = (i: number) => T0 + i * 3600_000;
    for (let i = 1; i <= 5; i++) a.deliver(rec("m_c" + i, { endedAt: at(i) }), at(i));
    const snap = a.econ.snapshot(a.userId, at(5));
    expect(snap.state.streak).toBe(5);
    expect(JSON.stringify(snap.state.achievements)).toContain("s.streak5");
  });
});
