import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { STALE_RESERVATION_CHECK_MS, clearStaleReservations, migrateReservations, reserve, type ReservationSql } from "../worker/src/reservations";
import { OnlineRoom } from "../src/online/room";

/**
 * PR118-03: a lost release must not lock an account out of matches for hours, and recovery must never
 * free an account that is still seated in a live match.
 */
function sql(): ReservationSql & { db: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  return {
    db,
    exec<T>(query: string, ...params: unknown[]) {
      const stmt = db.prepare(query);
      const rows = /^\s*(select|pragma)/i.test(query) ? (stmt.all(...(params as never[])) as T[]) : (stmt.run(...(params as never[])), [] as T[]);
      return { toArray: () => rows };
    },
  };
}
const rows = (s: ReturnType<typeof sql>) => s.exec<{ user_id: string; code: string; match_no: number }>("SELECT user_id, code, match_no FROM playing_users ORDER BY user_id").toArray();

describe("경기 참가 잠금 복구 (PR118-03)", () => {
  it("이전 스키마(at 없음)를 보존해 이전하고, 방이 놓아준 잠금만 지운다", async () => {
    const s = sql();
    s.exec("CREATE TABLE playing_users (user_id TEXT PRIMARY KEY, code TEXT NOT NULL, match_no INTEGER NOT NULL)");
    s.exec("INSERT INTO playing_users (user_id, code, match_no) VALUES ('u_old', 'AAAAAA', 1)");
    migrateReservations(s);
    migrateReservations(s); // idempotent
    expect(rows(s)).toEqual([{ user_id: "u_old", code: "AAAAAA", match_no: 1 }]);
    const asked: string[] = [];
    const now = 10 * STALE_RESERVATION_CHECK_MS;
    reserve(s, ["u_live"], "BBBBBB", 2, 0);
    const held = async (code: string, userId: string) => (asked.push(`${code}:${userId}`), code === "BBBBBB");
    expect(await clearStaleReservations(s, ["u_old", "u_live", "u_none"], held, now)).toBe(true);
    expect(asked.sort()).toEqual(["AAAAAA:u_old", "BBBBBB:u_live"]);
    expect(rows(s)).toEqual([{ user_id: "u_live", code: "BBBBBB", match_no: 2 }]);
  });

  it("방금 잡은 잠금·같은 방 재입장·확인 실패는 풀지 않는다(시간만으로 해제하지 않음)", async () => {
    const s = sql();
    migrateReservations(s);
    const now = 10 * STALE_RESERVATION_CHECK_MS;
    reserve(s, ["u_new"], "CCCCCC", 1, now - 1000);
    reserve(s, ["u_same"], "DDDDDD", 1, 0);
    reserve(s, ["u_err"], "EEEEEE", 1, 0);
    let asked = 0;
    const disown = async (code: string) => {
      asked++;
      if (code === "EEEEEE") throw Error("room unreachable");
      return false;
    };
    expect(await clearStaleReservations(s, ["u_new"], disown, now)).toBe(false);
    expect(await clearStaleReservations(s, ["u_same"], disown, now, "DDDDDD")).toBe(false);
    expect(await clearStaleReservations(s, ["u_err"], disown, now)).toBe(false);
    expect(asked).toBe(1);
    expect(rows(s).map((r) => r.user_id)).toEqual(["u_err", "u_new", "u_same"]);
  });

  it("확인하는 사이 새 경기로 잠금이 바뀌었으면 새 잠금을 지우지 않는다", async () => {
    const s = sql();
    migrateReservations(s);
    reserve(s, ["u"], "FFFFFF", 1, 0);
    const changed = await clearStaleReservations(s, ["u"], async () => {
      reserve(s, ["u"], "GGGGGG", 1, 0); // a new match was reserved meanwhile
      return false;
    }, 10 * STALE_RESERVATION_CHECK_MS);
    expect(changed).toBe(true);
    expect(rows(s)).toEqual([{ user_id: "u", code: "GGGGGG", match_no: 1 }]);
  });

  it("방은 진행 중이고 기권하지 않은 해당 경기 좌석만 잡고 있다고 답한다", async () => {
    let t = 1;
    const room = OnlineRoom.create("ABCDEF", { now: () => t, save: () => {}, schedule: () => {} });
    const a = await room.join("민수", { userId: "u_a" });
    const b = await room.join("지민", { userId: "u_b" });
    if (!a.ok || !b.ok) throw Error();
    expect(room.holdsAccount("u_a", 1)).toBe(false); // lobby
    const conn = { playerId: null, seenSeq: 0, bucket: { tokens: 30, at: 0 }, send: () => {}, close: () => {} };
    room.connect(conn);
    await room.message(conn, JSON.stringify({ t: "hello", token: a.token }));
    t += 10;
    await room.message(conn, JSON.stringify({ t: "cmd", id: "s", action: { type: "start" } }));
    expect(room.match.status).toBe("playing");
    expect(room.holdsAccount("u_a", 1)).toBe(true);
    expect(room.holdsAccount("u_b", 1)).toBe(true);
    expect(room.holdsAccount("u_a", 2)).toBe(false); // another match number
    expect(room.holdsAccount("u_x", 1)).toBe(false);
    t += 10;
    await room.message(conn, JSON.stringify({ t: "cmd", id: "r", action: { type: "resign" } }));
    expect(room.match.status).toBe("finished");
    expect(room.holdsAccount("u_a", 1)).toBe(false);
    expect(room.holdsAccount("u_b", 1)).toBe(false);
  });
});
