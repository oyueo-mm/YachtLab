import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createHash, createHmac } from "node:crypto";
import { hmacSha256, sha256, toHex, utf8 } from "../src/daily/sha256";
import { addDays, archiveDates, closesAt, dailyStreak, dayEnd, dayPhase, dayStart, isDailyDate, kstDate } from "../src/daily/calendar";
import { commitmentOf, deriveDayKey, tapeFaces } from "../src/daily/tape";
import { applyStep, MAX_STEPS, newDailyState, parseStep, replayLog, type DailyState, type DailyStep } from "../src/daily/game";
import { compareEntries, pageParams, withRanks } from "../src/daily/ranking";
import { shareText } from "../src/daily/share";
import { categories, score, total, type Category } from "../src/engine";
import { DailyBoardCore, DailyPlayStore, rankEligible, verifyState, type DailySql } from "../worker/src/daily";

const SECRET = "test-daily-secret-".padEnd(40, "x");
const DATE = "2026-12-03";
const key = deriveDayKey(SECRET, DATE);
const T0 = dayStart(DATE) + 3600_000; // 01:00 KST

function sqlite(): DailySql {
  const db = new DatabaseSync(":memory:");
  let depth = 0;
  const sql: DailySql = {
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
  return sql;
}

/** Play a whole game with a simple policy: keep the most common face once, then score the best open category. */
function playAll(state: DailyState, apply: (s: DailyState, step: DailyStep) => DailyState): DailyState {
  let s = state;
  while (!s.done) {
    if (s.rolls === 1) {
      const counts = [0, 0, 0, 0, 0, 0, 0];
      s.dice.forEach((v) => counts[v]++);
      const face = counts.indexOf(Math.max(...counts));
      s = apply(s, { t: "roll", keep: s.dice.reduce((m, v, i) => (v === face ? m | (1 << i) : m), 0) });
    }
    const open = categories.filter((c) => s.card[c] === undefined);
    const c = open.reduce((b, x) => (score(s.dice, x) > score(s.dice, b) ? x : b), open[0]);
    s = apply(s, { t: "score", c });
  }
  return s;
}

describe("SHA-256 / HMAC (동기 구현)", () => {
  it("node:crypto와 비트 단위로 같다", () => {
    for (const text of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "한글 요트 🎲".repeat(9)]) {
      expect(toHex(sha256(utf8(text)))).toBe(createHash("sha256").update(text).digest("hex"));
      for (const k of ["k", "x".repeat(64), "y".repeat(100)]) expect(toHex(hmacSha256(utf8(k), utf8(text)))).toBe(createHmac("sha256", k).update(text).digest("hex"));
    }
  });
});

describe("한국 시간 날짜 경계", () => {
  it("KST 자정에 날짜가 바뀌고, 유예 30분 뒤 마감된다", () => {
    const start = dayStart(DATE);
    expect(new Date(start).toISOString()).toBe("2026-12-02T15:00:00.000Z");
    expect(kstDate(start - 1)).toBe("2026-12-02");
    expect(kstDate(start)).toBe(DATE);
    expect(kstDate(dayEnd(DATE) - 1)).toBe(DATE);
    expect(dayPhase(DATE, start - 1)).toBe("future");
    expect(dayPhase(DATE, start)).toBe("open");
    expect(dayPhase(DATE, dayEnd(DATE))).toBe("grace");
    expect(dayPhase(DATE, closesAt(DATE) - 1)).toBe("grace");
    expect(dayPhase(DATE, closesAt(DATE))).toBe("closed");
    expect(isDailyDate("2026-02-30")).toBe(false);
    expect(isDailyDate("2026-12-31")).toBe(true);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
  });
  it("지난 도전 목록과 연속 참여일", () => {
    expect(archiveDates(dayStart("2026-12-05") + 10, 10)).toEqual(["2026-12-03", "2026-12-02", "2026-12-01"]); // 12-04 still in grace
    expect(dailyStreak(["2026-12-01", "2026-12-02", "2026-12-04", "2026-12-05"], "2026-12-05")).toBe(2);
    expect(dailyStreak(["2026-12-03", "2026-12-04"], "2026-12-05")).toBe(2);
    expect(dailyStreak(["2026-12-02"], "2026-12-05")).toBe(0);
  });
});

describe("주사위 테이프: 위치 기반 인덱싱", () => {
  it("같은 비밀·날짜면 같고, 날짜·비밀이 다르면 다르다; 공개 확인값으로 키를 알 수 없다", () => {
    expect(tapeFaces(key, 4, 2)).toEqual(tapeFaces(deriveDayKey(SECRET, DATE), 4, 2));
    expect(toHex(deriveDayKey(SECRET, "2026-12-04"))).not.toBe(toHex(key));
    expect(toHex(deriveDayKey(SECRET.replace("x", "y"), DATE))).not.toBe(toHex(key));
    const c = commitmentOf(key);
    expect(c).toMatch(/^[0-9a-f]{64}$/);
    expect(c).not.toContain(toHex(key));
    expect(() => deriveDayKey("short", DATE)).toThrow();
  });
  it("킵 선택이 달라도 이후 굴림의 눈은 같은 위치에서 나온다 (소비 순서 문제 없음)", () => {
    const a = applyStep(newDailyState(DATE, key), { t: "roll", keep: 0b00011 }, key);
    const b = applyStep(newDailyState(DATE, key), { t: "roll", keep: 0b11000 }, key);
    const faces = tapeFaces(key, 1, 2);
    a.dice.forEach((v, j) => expect(v).toBe(0b00011 & (1 << j) ? newDailyState(DATE, key).dice[j] : faces[j]));
    b.dice.forEach((v, j) => expect(v).toBe(0b11000 & (1 << j) ? newDailyState(DATE, key).dice[j] : faces[j]));
    // a different category in round 1 does not change round 2's first roll
    const s1 = applyStep(newDailyState(DATE, key), { t: "score", c: "choice" }, key);
    const s2 = applyStep(newDailyState(DATE, key), { t: "score", c: "aces" }, key);
    expect(s1.dice).toEqual(s2.dice);
    expect(s1.dice).toEqual(tapeFaces(key, 2, 1));
  });
  it("면 분포가 균등하다 (카이제곱, 30일 × 180칸)", () => {
    const counts = [0, 0, 0, 0, 0, 0];
    for (let d = 0; d < 30; d++) {
      const k = deriveDayKey(SECRET, addDays("2026-12-01", d));
      for (let r = 1; r <= 12; r++) for (let roll = 1; roll <= 3; roll++) tapeFaces(k, r, roll).forEach((f) => counts[f - 1]++);
    }
    const n = counts.reduce((a, b) => a + b, 0), e = n / 6;
    const chi = counts.reduce((s, c) => s + ((c - e) ** 2) / e, 0);
    expect(n).toBe(5400);
    expect(chi).toBeLessThan(20.5); // p ≈ 0.001 for 5 degrees of freedom
  });
});

describe("서버 판정 게임", () => {
  it("한 경기를 끝까지: 13~37 단계, 점수는 서버가 계산, 로그 재생과 일치", () => {
    const end = playAll(newDailyState(DATE, key), (s, step) => applyStep(s, step, key));
    expect(end.done).toBe(true);
    expect(end.log.length).toBeGreaterThanOrEqual(13);
    expect(end.log.length).toBeLessThanOrEqual(MAX_STEPS);
    const again = replayLog(DATE, key, end.log)!;
    expect(again.card).toEqual(end.card);
    expect(total(again.card)).toBe(total(end.card));
    expect(verifyState(end, key)).toBe(true);
    expect(verifyState({ ...end, card: { ...end.card, yacht: 50 } }, key)).toBe(end.card.yacht === 50);
    // the same log under another day's key is a different game
    expect(replayLog(DATE, deriveDayKey(SECRET, "2026-12-04"), end.log)?.card).not.toEqual(end.card);
  });
  it("불법 단계 거부: 네 번째 굴림, 전부 고정, 이미 쓴 칸, 위조 형식", () => {
    let s = newDailyState(DATE, key);
    s = applyStep(s, { t: "roll", keep: 0 }, key);
    s = applyStep(s, { t: "roll", keep: 0 }, key);
    expect(() => applyStep(s, { t: "roll", keep: 0 }, key)).toThrow(/굴릴 수 없어요/);
    expect(() => applyStep(newDailyState(DATE, key), { t: "roll", keep: 31 }, key)).toThrow();
    const after = applyStep(s, { t: "score", c: "yacht" }, key);
    expect(() => applyStep(after, { t: "score", c: "yacht" }, key)).toThrow(/이미 기록한/);
    for (const bad of [null, { t: "roll" }, { t: "roll", keep: 32 }, { t: "score", c: "bonus" }, { t: "score", c: "yacht", points: 50 }]) {
      const p = parseStep(bad);
      if (p) expect(p).toEqual({ t: "score", c: "yacht" }); // extra fields are ignored, never trusted
      else expect(p).toBeNull();
    }
  });
});

describe("DailyPlayStore (계정 객체 SQLite)", () => {
  const limits = { practicePerDay: 2 };
  it("공식 도전은 하루 한 번: 다시 시작하면 같은 시도, 연습은 공식 완료 후에만", () => {
    const store = new DailyPlayStore(sqlite());
    store.init();
    expect(store.start(DATE, "practice", key, T0, { ranked: true, limits })).toMatchObject({ ok: false, code: "PRACTICE_LOCKED" });
    const a = store.start(DATE, "official", key, T0, { ranked: true, limits });
    const b = store.start(DATE, "official", key, T0 + 5, { ranked: true, limits });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.attempt.state).toEqual(a.attempt.state);
    expect(store.start(DATE, "practice", key, T0, { ranked: true, limits })).toMatchObject({ ok: false, code: "PRACTICE_LOCKED" });
  });

  it("중복 제출·다중 탭: 같은 seq의 같은 단계는 한 번만, 다른 단계는 STALE", () => {
    const store = new DailyPlayStore(sqlite());
    store.init();
    store.start(DATE, "official", key, T0, { ranked: true, limits });
    const first = store.act(DATE, "official", 1, { t: "roll", keep: 1 }, key, T0);
    expect(first.ok && !first.duplicate).toBe(true);
    const retry = store.act(DATE, "official", 1, { t: "roll", keep: 1 }, key, T0);
    expect(retry).toMatchObject({ ok: true, duplicate: true });
    const otherTab = store.act(DATE, "official", 1, { t: "roll", keep: 2 }, key, T0);
    expect(otherTab).toMatchObject({ ok: false, status: 409, code: "STALE" });
    expect(!otherTab.ok && otherTab.state?.state.seq).toBe(2);
    expect(store.act(DATE, "official", 7, { t: "score", c: "choice" }, key, T0)).toMatchObject({ ok: false, code: "STALE" });
    // a "reroll to fish for a better result" after seeing it is impossible: the roll is stored
    const view = store.attempt(DATE, "official", T0)!;
    expect(view.state.rolls).toBe(2);
    expect(view.state.dice).toEqual((first.ok && first.attempt.state.dice) || []);
  });

  it("새로고침·재접속 복구, 완료 기록, 완료 후 연습 횟수 제한", () => {
    const sql = sqlite();
    let store = new DailyPlayStore(sql);
    store.init();
    store.start(DATE, "official", key, T0, { ranked: true, limits });
    let seq = 1;
    const end = playAll(newDailyState(DATE, key), (s, step) => {
      // the object is "restarted" between some steps: a fresh store over the same SQLite
      if (seq % 5 === 0) store = new DailyPlayStore(sql);
      const r = store.act(DATE, "official", seq, step, key, T0 + seq);
      expect(r.ok).toBe(true);
      seq++;
      return applyStep(s, step, key);
    });
    const v = store.attempt(DATE, "official", T0 + 100)!;
    expect(v.status).toBe("finished");
    expect(v.state.score).toBe(total(end.card));
    expect(store.pendingSubmissions()).toHaveLength(1);
    store.markSubmitted(DATE);
    expect(store.pendingSubmissions()).toMatchObject([{ board: false, activity: true }]); // C5 report is its own step
    store.markActivity(DATE);
    expect(store.pendingSubmissions()).toHaveLength(0);
    expect(store.act(DATE, "official", seq, { t: "roll", keep: 0 }, key, T0)).toMatchObject({ ok: false });
    // same-day practice: same dice tape, limited, never ranked
    const p1 = store.start(DATE, "practice", key, T0 + 200, { ranked: true, limits });
    expect(p1.ok && p1.attempt.state.dice).toEqual(newDailyState(DATE, key).dice);
    expect(p1.ok && p1.attempt.ranked).toBe(false);
    expect(store.start(DATE, "practice", key, T0 + 201, { ranked: true, limits })).toMatchObject({ ok: true, created: false }); // resume
    const h = store.history(T0 + 300);
    expect(h.best).toEqual({ date: DATE, score: total(end.card) });
  });

  it("날짜 경계: 지난 날짜는 시작 불가, 자정 전 시작한 도전은 유예 30분까지 진행, 이후 만료", () => {
    const store = new DailyPlayStore(sqlite());
    store.init();
    const lateStart = dayEnd(DATE) - 60_000; // 23:59 KST
    expect(store.start(DATE, "official", key, lateStart, { ranked: true, limits }).ok).toBe(true);
    expect(store.act(DATE, "official", 1, { t: "score", c: "choice" }, key, dayEnd(DATE) + 60_000).ok).toBe(true); // 00:01 next day
    expect(store.act(DATE, "official", 2, { t: "score", c: "aces" }, key, closesAt(DATE))).toMatchObject({ ok: false, code: "DAILY_EXPIRED" });
    expect(store.attempt(DATE, "official", closesAt(DATE))!.status).toBe("expired");
    // the next day cannot be started before its KST midnight, yesterday not after it
    const next = addDays(DATE, 1);
    expect(store.start(next, "official", deriveDayKey(SECRET, next), dayStart(next) - 1, { ranked: true, limits })).toMatchObject({ ok: false, code: "DAILY_NOT_OPEN" });
    const fresh = new DailyPlayStore(sqlite());
    fresh.init();
    expect(fresh.start(DATE, "official", key, dayEnd(DATE) + 1, { ranked: true, limits })).toMatchObject({ ok: false, code: "DAILY_CLOSED" });
    // expired official unlocks practice only during the grace; afterwards the day is a browser replay
    expect(store.start(DATE, "practice", key, closesAt(DATE) + 1, { ranked: true, limits })).toMatchObject({ ok: false, code: "DAILY_CLOSED" });
  });

  it("순위 자격: 그날 0시(KST) 이전에 만든 계정만", () => {
    expect(rankEligible(dayStart(DATE) - 1, DATE, false)).toBe(true);
    expect(rankEligible(dayStart(DATE) + 1, DATE, false)).toBe(false);
    expect(rankEligible(dayStart(DATE) + 1, DATE, true)).toBe(true);
  });

  it("퍼즐은 첫 답만 기록", () => {
    const store = new DailyPlayStore(sqlite());
    store.init();
    const r = { puzzleId: "p1", answer: "s:yacht", correct: false, value: 1, bestValue: 2, loss: 1, at: 5 };
    expect(store.answerPuzzle(DATE, r).first).toBe(true);
    const again = store.answerPuzzle(DATE, { ...r, answer: "s:aces", correct: true });
    expect(again.first).toBe(false);
    expect(again.result.answer).toBe("s:yacht");
    expect(store.puzzleSummary()).toMatchObject({ answered: 1, correct: 0 });
  });
});

describe("일일 랭킹", () => {
  const entry = (userId: string, score: number, finishedAt: number, visibility: "public" | "friends" | "private" = "public") => ({ userId, nickname: userId, score, finishedAt, visibility, yacht: false, bonus: false });
  it("동점은 같은 순위(1,1,3), 표시 순서는 먼저 끝낸 사람, 첫 공식 기록만", () => {
    const b = new DailyBoardCore(sqlite());
    b.init();
    b.submit(entry("a", 200, 30));
    b.submit(entry("b", 250, 50));
    b.submit(entry("c", 250, 40));
    b.submit(entry("d", 180, 10, "private"));
    expect(b.submit(entry("a", 300, 99)).stored).toBe(false); // a later result never replaces the first
    const page = b.page(0, 10);
    expect(page.entries.map((e) => [e.userId, e.rank])).toEqual([["c", 1], ["b", 1], ["a", 3], ["d", 4]]);
    // pagination keeps true ranks across page borders
    expect(b.page(1, 2).entries.map((e) => [e.userId, e.rank])).toEqual([["b", 1], ["a", 3]]);
    expect(b.page(3, 2).entries.map((e) => [e.userId, e.rank])).toEqual([["d", 4]]);
    expect(b.entriesFor(["a", "zz"]).map((e) => e.rank)).toEqual([3]);
    expect(withRanks([{ score: 9 }, { score: 9 }, { score: 7 }]).map((e) => e.rank)).toEqual([1, 1, 3]);
    expect([entry("x", 1, 2), entry("y", 1, 1)].sort(compareEntries)[0].userId).toBe("y");
    expect(pageParams("-1", "999")).toEqual({ offset: 0, limit: 20 });
  });
  it("참가 상한과 통계, 탈퇴 시 삭제", () => {
    const b = new DailyBoardCore(sqlite());
    b.init();
    expect(b.admit("a", 2, 1).ok).toBe(true);
    expect(b.admit("a", 2, 1).ok).toBe(true); // idempotent
    expect(b.admit("b", 2, 1).ok).toBe(true);
    expect(b.admit("c", 2, 1).ok).toBe(false);
    b.submit(entry("a", 210, 3));
    b.count("completed.unranked");
    b.puzzleAnswered("p", true);
    b.puzzleAnswered("p", false);
    const s = b.stats();
    // D-141: no ranking — older entries still count as completions, new completions are counters only
    expect(s).toMatchObject({ started: 2, completed: 2, ranked: 0, best: 210, puzzles: { p: { answered: 2, correct: 1 } } });
    b.count("completed");
    b.count("score.175");
    b.count("score.sum", 190);
    expect(b.stats()).toMatchObject({ completed: 3, average: 200, buckets: { "200-224": 1, "175-199": 1 } });
    b.remove("a");
    expect(b.total()).toBe(0);
  });
});

describe("결과 공유", () => {
  it("점수와 칸 결과만, 주사위 눈은 포함하지 않는다", () => {
    const card = Object.fromEntries(categories.map((c, i) => [c, i === 11 ? 50 : i === 3 ? 0 : 10])) as Record<Category, number>;
    const text = shareText({ date: DATE, score: 222, card, rank: 3, players: 40, url: "https://example.test/#daily" });
    expect(text).toContain("오늘의 요트 2026-12-03 · 222점");
    expect(text).not.toMatch(/위|명/); // D-141: a share never carries a rank (even if an old caller passes one)
    expect(text).toContain("⭐");
    expect(text).not.toMatch(/[1-6]·[1-6]/);
  });
});
