import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dayStart, DAILY_RULES, addDays } from "../src/daily/calendar";
import { applyStep, newDailyState, type DailyState } from "../src/daily/game";
import { deriveDayKey } from "../src/daily/tape";
import { ACTIVITY_KINDS, DAILY_REWARDS_APPROVED, NO_DAILY_REWARDS, type DailyActivity } from "../src/daily/contract";
import { grade } from "../src/daily/puzzles/types";
import { DailyBoardCore, DailyPlayStore, dailySecrets, flushPending, type DailySql } from "../worker/src/daily";
import { dailyAdminRoutes } from "../worker/src/daily-admin";
import { activityFor, reportCompletion } from "../worker/src/daily-activity";
import { bank, lastScheduledDate, puzzleById, puzzleRunway, puzzlesOf, rerunSource } from "../worker/src/daily-api";

/**
 * LIVE-1 integration contracts (2026-11-28 follow-up):
 *  - ADMIN-1 (#141) AdminExtensionRoute: stats.read report, content.write withdraw/restore, no ADMIN_TOKEN path
 *  - C5 (#140) dailyContentDone: official completion only, retried separately, coins stay off
 *  - puzzle bank run-out, DAILY_SECRET dated rotation
 */
function sqlite(db = new DatabaseSync(":memory:")): DailySql {
  let depth = 0;
  return {
    exec<T>(query: string, ...params: unknown[]) {
      const stmt = db.prepare(query);
      const rows = /^\s*(select|pragma)/i.test(query) ? (stmt.all(...(params as never[])) as T[]) : (stmt.run(...(params as never[])), [] as T[]);
      return { toArray: () => rows };
    },
    transaction<T>(fn: () => T): T {
      if (depth) return fn();
      depth++;
      db.exec("BEGIN");
      try {
        const r = fn();
        db.exec("COMMIT");
        return r;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      } finally {
        depth--;
      }
    },
  };
}
const SECRET = "integration-daily-secret-".padEnd(40, "k");
const DATE = "2026-12-05";
const key = deriveDayKey(SECRET, DATE);
const T0 = dayStart(DATE) + 3600_000;

function finishOfficial(store: DailyPlayStore) {
  store.start(DATE, "official", key, T0, { ranked: true, limits: { practicePerDay: 5 } });
  let s: DailyState = newDailyState(DATE, key);
  const cats = ["aces", "deuces", "threes", "fours", "fives", "sixes", "choice", "four", "full", "small", "large", "yacht"] as const;
  for (const c of cats) {
    const r = store.act(DATE, "official", s.log.length, { t: "score", c }, key, T0 + 10);
    expect(r.ok).toBe(true);
    s = applyStep(s, { t: "score", c }, key);
  }
  return s;
}

describe("ADMIN-1 AdminExtensionRoute 계약", () => {
  const board = new DailyBoardCore(sqlite());
  board.init();
  const routes = dailyAdminRoutes({ board: () => ({ stats: async () => board.stats(), setPuzzleFlag: async (id, d) => board.setPuzzleFlag(id, d) }), now: () => T0 });
  const [report, puzzle] = routes;
  const ctx = (path: string, body: Record<string, unknown> | null = null) => {
    const url = new URL("https://w.test" + path);
    const route = routes.find((r) => r.path.test(url.pathname))!;
    return { route, ctx: { url, match: route.path.exec(url.pathname)!, body, actor: "u_" + "A".repeat(22), now: T0 } };
  };

  it("통계는 stats.read 읽기, 퍼즐 내리기·복구는 content.write 쓰기(감사 action daily.puzzle)", () => {
    expect(report).toMatchObject({ method: "GET", permission: "stats.read", write: false });
    expect(report.auditRead).toBeFalsy();
    expect(report.path.test("/api/admin/daily")).toBe(true);
    expect(puzzle).toMatchObject({ method: "POST", permission: "content.write", write: true, highRisk: false, action: "daily.puzzle" });
    expect(puzzle.path.test("/api/admin/daily/puzzle")).toBe(true);
    expect(puzzle.path.test("/api/admin/daily/puzzle/x")).toBe(false);
  });

  it("보고서: ID·닉네임 없음, 퍼즐 은행 잔여일 포함, 잘못된 날짜 400", async () => {
    board.submit({ userId: "u_secret_" + "x".repeat(13), nickname: "비밀닉", score: 200, finishedAt: 1, visibility: "public", yacht: false, bonus: true });
    const { ctx: c } = ctx(`/api/admin/daily?date=${DATE}`);
    const out = await report.handle(c);
    expect(out.status).toBe(200);
    expect(JSON.stringify(out.body)).not.toMatch(/u_secret|비밀닉/);
    expect(out.body).toMatchObject({ official: { ranked: 1 }, puzzleBank: { lastScheduledDate: lastScheduledDate(), rerun: false } });
    expect((await report.handle(ctx("/api/admin/daily?date=bad").ctx)).status).toBe(400);
  });

  it("내리기·복구: 감사 대상(target=puzzleId, detail={date, disabled}), 예약되지 않은 문제·잘못된 값 400", async () => {
    const pid = bank.schedule[DATE][0];
    const down = await puzzle.handle(ctx("/api/admin/daily/puzzle", { date: DATE, puzzleId: pid, disabled: true }).ctx);
    expect(down).toMatchObject({ status: 200, target: pid, detail: { date: DATE, disabled: true } });
    expect(board.puzzleFlags()[pid]).toBe(true);
    const up = await puzzle.handle(ctx("/api/admin/daily/puzzle", { date: DATE, puzzleId: pid, disabled: false }).ctx);
    expect(up.detail).toEqual({ date: DATE, disabled: false });
    expect(board.puzzleFlags()[pid]).toBe(false);
    expect((await puzzle.handle(ctx("/api/admin/daily/puzzle", { date: DATE, puzzleId: bank.schedule[addDays(DATE, 1)][0] }).ctx)).status).toBe(400);
    expect((await puzzle.handle(ctx("/api/admin/daily/puzzle", { date: DATE, puzzleId: pid, disabled: "yes" }).ctx)).status).toBe(400);
  });

  it("공유 ADMIN_TOKEN 경로가 Worker 라우터에 남아 있지 않다", () => {
    const index = readFileSync("worker/src/index.ts", "utf8");
    expect(index).not.toMatch(/\/api\/admin\/daily/);
    expect(index).not.toMatch(/setPuzzleFlag\(body/);
  });
});

describe("C5 dailyContentDone 연동점", () => {
  it("공식 완료만 활동, 연습·시작·퍼즐은 아님, 코인 지급은 비활성", async () => {
    expect([...ACTIVITY_KINDS]).toEqual(["daily.official.completed"]);
    expect(DAILY_REWARDS_APPROVED).toBe(false);
    const kinds: DailyActivity[] = [
      { kind: "daily.official.started", userId: "u", date: DATE, rules: DAILY_RULES, at: 1 },
      { kind: "daily.official.completed", userId: "u", date: DATE, rules: DAILY_RULES, score: 1, ranked: true, at: 1 },
      { kind: "daily.puzzle.answered", userId: "u", date: DATE, puzzleId: "p", correct: true, at: 1 },
    ];
    for (const k of kinds) expect(NO_DAILY_REWARDS.proposals(k)).toEqual([]);
    expect(activityFor({ mode: "practice", status: "finished", finishedAt: 5 }, "u", DATE, DAILY_RULES, 1, true)).toBeNull();
    expect(activityFor({ mode: "official", status: "expired", finishedAt: null }, "u", DATE, DAILY_RULES, 1, true)).toBeNull();
    expect(activityFor({ mode: "official", status: "finished", finishedAt: 5 }, "u", DATE, DAILY_RULES, 1, false)).toMatchObject({ kind: "daily.official.completed", at: 5 });
    const calls: unknown[] = [];
    const sink = { dailyContentDone: async (a: unknown) => void calls.push(a) };
    expect(await reportCompletion(sink, kinds[2])).toBe("skipped");
    expect(await reportCompletion(sink, kinds[0])).toBe("skipped");
    expect(await reportCompletion(sink, kinds[1])).toBe("sent");
    expect(calls).toEqual([{ kind: "daily.official.completed", at: 1 }]); // no score, no ids: only what C5 needs
    expect(await reportCompletion({}, kinds[1])).toBe("skipped"); // C5 not merged yet: no-op
  });

  it("보드·활동을 따로 재시도: C5가 실패해도 보드는 한 번만, 다음 호출에서 활동만 다시", async () => {
    const store = new DailyPlayStore(sqlite());
    store.init();
    const end = finishOfficial(store);
    let fail = true;
    const board: string[] = [], activity: number[] = [];
    const steps = {
      verify: () => true,
      board: async (a: { date: string }) => void board.push(a.date),
      activity: async (a: { finishedAt: number }) => {
        if (fail) throw Error("c5 down");
        activity.push(a.finishedAt);
      },
    };
    expect(await flushPending(store, steps)).toMatchObject({ board: 1, activity: 0, failed: 1 });
    fail = false;
    expect(await flushPending(store, steps)).toMatchObject({ board: 0, activity: 1, failed: 0 });
    expect(await flushPending(store, steps)).toMatchObject({ board: 0, activity: 0 });
    expect(board).toEqual([DATE]);
    expect(activity).toEqual([T0 + 10]); // the server's finish time
    expect(end.done).toBe(true);
    // practice never produces a pending step
    store.start(DATE, "practice", key, T0 + 20, { ranked: true, limits: { practicePerDay: 5 } });
    expect(store.pendingSubmissions()).toEqual([]);
  });

  it("재생 검증에 실패한 기록은 게시·활동 보고 모두 하지 않는다", async () => {
    const store = new DailyPlayStore(sqlite());
    store.init();
    finishOfficial(store);
    let called = 0;
    const r = await flushPending(store, { verify: () => false, board: async () => void called++, activity: async () => void called++ });
    expect(r.rejected).toBe(1);
    expect(called).toBe(0);
    expect(store.pendingSubmissions()).toEqual([]);
  });

  it("이전 스키마(activity 열 없음)도 init에서 열을 추가한다", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE daily_attempts (date TEXT NOT NULL, rules TEXT NOT NULL, mode TEXT NOT NULL, state TEXT NOT NULL, status TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER, score INTEGER, ranked INTEGER NOT NULL DEFAULT 0, submitted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (date, rules, mode))");
    const store = new DailyPlayStore(sqlite(db));
    store.init();
    store.init(); // idempotent
    expect((db.prepare("PRAGMA table_info(daily_attempts)").all() as { name: string }[]).map((c) => c.name)).toContain("activity");
  });
});

describe("퍼즐 소진 대응", () => {
  const last = lastScheduledDate();
  it("예약이 끝난 뒤에도 매일 3문제(다시 보는 퍼즐), 원래 답 기록과 분리된 ID", () => {
    expect(last).toBe("2027-02-22");
    for (const d of [addDays(last, 1), addDays(last, 2), addDays(last, 400)]) {
      const list = puzzlesOf(d);
      expect(list.map((p) => p.level)).toEqual(["intro", "normal", "advanced"]);
      for (const p of list) {
        expect(p.id.startsWith(`rerun:${d}:`)).toBe(true);
        expect(p.title).toContain("다시 보는 퍼즐");
        const again = puzzleById(p.id)!;
        expect(again.key).toEqual(p.key);
        expect(grade(again.key, again.key.best[0])?.correct).toBe(true);
      }
    }
    expect(rerunSource(addDays(last, 1))).toBe("2026-12-01"); // deterministic rotation from the start
    expect(rerunSource(last)).toBeNull();
    expect(puzzlesOf("2026-11-01")).toEqual([]); // before the epoch: nothing
    expect(puzzleById("rerun:2027-03-01:nope")).toBeNull();
  });
  it("운영 잔여일", () => {
    expect(puzzleRunway("2027-02-08")).toBe(14);
    expect(puzzleRunway("2027-03-01")).toBe(0);
  });
});

describe("DAILY_SECRET 관리", () => {
  const A = "a".repeat(32), B = "b".repeat(40);
  it("짧거나 없으면 꺼짐(fail closed)", () => {
    expect(dailySecrets({}).ok).toBe(false);
    expect(dailySecrets({ DAILY_SECRET: "short" }).ok).toBe(false);
    const ok = dailySecrets({ DAILY_SECRET: A });
    expect(ok.ok && ok.secretFor("2030-01-01")).toBe(A);
  });
  it("날짜 지정 교체: FROM 이전 날짜는 이전 비밀(오늘 진행 중 경기·과거 공개 키 유지), 이후는 새 비밀", () => {
    const r = dailySecrets({ DAILY_SECRET: B, DAILY_SECRET_PREVIOUS: A, DAILY_SECRET_FROM: "2026-12-10" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.secretFor("2026-12-09")).toBe(A);
    expect(r.secretFor("2026-12-10")).toBe(B);
    expect(deriveDayKey(r.secretFor("2026-12-09"), "2026-12-09")).toEqual(deriveDayKey(A, "2026-12-09"));
  });
  it("불완전한 교체 설정은 꺼짐", () => {
    expect(dailySecrets({ DAILY_SECRET: B, DAILY_SECRET_FROM: "2026-12-10" }).ok).toBe(false);
    expect(dailySecrets({ DAILY_SECRET: B, DAILY_SECRET_PREVIOUS: A }).ok).toBe(false);
    expect(dailySecrets({ DAILY_SECRET: B, DAILY_SECRET_PREVIOUS: B, DAILY_SECRET_FROM: "2026-12-10" }).ok).toBe(false);
    expect(dailySecrets({ DAILY_SECRET: B, DAILY_SECRET_PREVIOUS: A, DAILY_SECRET_FROM: "12/10" }).ok).toBe(false);
    expect(dailySecrets({ DAILY_SECRET: B, DAILY_SECRET_PREVIOUS: "x", DAILY_SECRET_FROM: "2026-12-10" }).ok).toBe(false);
  });
  it("비밀 값은 저장소 설정 파일에 없다", () => {
    const toml = readFileSync("worker/wrangler.toml", "utf8");
    expect(toml).not.toMatch(/^DAILY_SECRET(_PREVIOUS)?\s*=/m);
    expect(toml).toMatch(/^tag = "v5-live1-daily"$/m);
  });
});
