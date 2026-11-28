import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startLocalWorker, type LocalWorker } from "./helpers/wrangler";
import { fakeLogin, startFakeIdp, type FakeIdp } from "./helpers/fake-idp";
import { categories, score, total, type Category } from "../src/engine";
import { closesAt, dayStart } from "../src/daily/calendar";
import { commitmentOf, deriveDayKey } from "../src/daily/tape";
import { fromHex } from "../src/daily/sha256";
import { replayLog } from "../src/daily/game";
import { readFileSync } from "node:fs";

/**
 * 오늘의 요트 in the real Workers runtime (wrangler dev --local, UserStore + DailyBoard objects, migration v5)
 * with a FAKE local sign-in. The daily clock is shifted to 2026-12-03 01:00 KST (DAILY_TEST_OFFSET_MS,
 * loopback only) so the test does not depend on today's date.
 */
const ORIGIN = "http://127.0.0.1:5173";
const DATE = "2026-12-03";
const OFFSET = dayStart(DATE) + 3600_000 - Date.now();
const ADMIN = "a".repeat(40);
const SECRET = "worker-test-daily-secret-".padEnd(48, "z");
let worker: LocalWorker;
let closed: LocalWorker;
let idp: FakeIdp;
const base = { ALLOWED_ORIGINS: ORIGIN, CREATE_PER_MINUTE: "500", JOIN_PER_MINUTE: "500", GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret", AUTH_SECRET: "s".repeat(40), APP_URL: ORIGIN + "/YachtLab/", ECONOMY: "on" };
beforeAll(async () => {
  idp = await startFakeIdp();
  // (the flag-off state is covered by tests/ui/daily.spec.ts and by the default wrangler.toml value)
  worker = await startLocalWorker({ ...base, TEST_OIDC_ISSUER: idp.issuer, DAILY: "on", DAILY_SECRET: SECRET, DAILY_TEST_OFFSET_MS: String(OFFSET), DAILY_PRACTICE_PER_DAY: "2" });
}, 180_000);
afterAll(async () => {
  await Promise.all([worker?.stop(), closed?.stop()]);
  idp?.close();
});

const call = async (w: LocalWorker, session: string | null, path: string, body?: unknown) => {
  const r = await fetch(w.url + path, { method: body === undefined ? "GET" : "POST", headers: { origin: ORIGIN, "content-type": "application/json", ...(session ? { authorization: "Bearer " + session } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, cache: r.headers.get("cache-control"), body: (await r.json().catch(() => ({}))) as Record<string, any> };
};
type View = { round: number; rolls: number; dice: number[]; card: Partial<Record<Category, number>>; seq: number; done: boolean; score: number };

/** Plays an official/practice attempt to the end through the API; checks every server score against the dice it showed. */
async function playThrough(w: LocalWorker, s: string, mode: "official" | "practice", start: View) {
  let v = start;
  while (!v.done) {
    if (v.rolls === 1) {
      const counts = [0, 0, 0, 0, 0, 0, 0];
      v.dice.forEach((x) => counts[x]++);
      const face = counts.indexOf(Math.max(...counts));
      const keep = v.dice.reduce((m, x, i) => (x === face ? m | (1 << i) : m), 0);
      const r = await call(w, s, "/api/daily/play", { date: DATE, mode, seq: v.seq, step: { t: "roll", keep } });
      expect(r.status).toBe(200);
      const nv = r.body.attempt.state as View;
      v.dice.forEach((x, i) => keep & (1 << i) && expect(nv.dice[i]).toBe(x)); // held dice stay
      v = nv;
    }
    const open = categories.filter((c) => v.card[c] === undefined);
    const c = open.reduce((b, x) => (score(v.dice, x) > score(v.dice, b) ? x : b), open[0]);
    // a forged "points" field is ignored: the server scores the dice it rolled
    const r = await call(w, s, "/api/daily/play", { date: DATE, mode, seq: v.seq, step: { t: "score", c, points: 50 } });
    expect(r.status).toBe(200);
    const nv = r.body.attempt.state as View;
    expect(nv.card[c]).toBe(score(v.dice, c));
    v = nv;
  }
  expect(v.score).toBe(total(v.card));
  return v;
}

describe("오늘의 요트 (wrangler dev + 가짜 로컬 로그인)", () => {
  it("플래그는 기본으로 꺼져 있다 (wrangler.toml)", () => {
    expect(readFileSync("worker/wrangler.toml", "utf8")).toMatch(/^DAILY = "off"$/m);
  });

  it("SEC-1 2차 DLY-2: 같은 날 탈퇴·재가입해도 공식 도전을 다시 시작할 수 없다(본 주사위로 재도전 불가)", async () => {
    const a = await fakeLogin(worker.url, idp, "dly2-rejoin", ORIGIN, "198.51.100.21");
    const first = await call(worker, a, "/api/daily/start", { date: DATE, mode: "official" });
    expect(first.status).toBe(200);
    expect((await call(worker, a, "/api/me/delete", { confirm: "DELETE" })).status).toBe(200);
    const again = await fakeLogin(worker.url, idp, "dly2-rejoin", ORIGIN, "198.51.100.21");
    const retry = await call(worker, again, "/api/daily/start", { date: DATE, mode: "official" });
    expect([retry.status, retry.body.error?.code]).toEqual([409, "DAILY_USED"]);
    // another account is not affected
    const other = await fakeLogin(worker.url, idp, "dly2-other", ORIGIN, "198.51.100.22");
    expect((await call(worker, other, "/api/daily/start", { date: DATE, mode: "official" })).status).toBe(200);
  }, 60_000);
  it("공식 도전: 하루 한 번, 서버 판정, 중복·다중 탭, 재접속, 연습 잠금, 랭킹·친구·차단·비공개, 퍼즐", async () => {
    expect((await call(worker, null, "/api/features")).body.daily).toBe(true);
    const today = await call(worker, null, "/api/daily/today");
    expect(today.body).toMatchObject({ date: DATE, phase: "open", me: null });
    expect(today.body.commitment).toBe(commitmentOf(deriveDayKey(SECRET, DATE)));
    expect(JSON.stringify(today.body)).not.toContain(Buffer.from(deriveDayKey(SECRET, DATE)).toString("hex"));
    expect((await call(worker, null, "/api/daily/start", { date: DATE, mode: "official" })).status).toBe(401);

    const [a, b, c] = await Promise.all(["dw-a", "dw-b", "dw-c"].map((sub) => fakeLogin(worker.url, idp, sub, ORIGIN)));
    await call(worker, a, "/api/me/nickname", { nickname: "에이" });
    await call(worker, b, "/api/me/nickname", { nickname: "비" });
    await call(worker, c, "/api/me/nickname", { nickname: "씨" });

    // practice before the official attempt is locked (no way to learn the day's dice first)
    expect((await call(worker, a, "/api/daily/start", { date: DATE, mode: "practice" })).body.error.code).toBe("PRACTICE_LOCKED");
    // other dates: future refused, a past (already closed) date cannot be started officially
    expect((await call(worker, a, "/api/daily/start", { date: "2026-12-04", mode: "official" })).body.error.code).toBe("DAILY_NOT_OPEN");
    expect((await call(worker, a, "/api/daily/start", { date: "2026-12-01", mode: "official" })).body.error.code).toBe("DAILY_CLOSED");
    // SEC-1 2차 DLY-3: refused dates admit nobody (the board of that date stays empty)
    expect((await call(worker, a, "/api/daily/start", { date: "2099-12-31", mode: "official" })).body.error.code).toBe("DAILY_NOT_OPEN");

    // two tabs start at once → one attempt
    const [s1, s2] = await Promise.all([call(worker, a, "/api/daily/start", { date: DATE, mode: "official" }), call(worker, a, "/api/daily/start", { date: DATE, mode: "official" })]);
    expect(s1.status).toBe(200);
    expect(s2.body.attempt.state).toEqual(s1.body.attempt.state);
    expect([s1.body.created, s2.body.created].filter(Boolean)).toHaveLength(1);
    expect(s1.cache).toBe("private, no-store");
    let v = s1.body.attempt.state as View;

    // duplicate request (network retry) and a second tab sending a different step at the same seq
    const step = { t: "roll", keep: 0 };
    const [r1, r2] = await Promise.all([call(worker, a, "/api/daily/play", { date: DATE, mode: "official", seq: v.seq, step }), call(worker, a, "/api/daily/play", { date: DATE, mode: "official", seq: v.seq, step })]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect([r1.body.duplicate, r2.body.duplicate].sort()).toEqual([false, true]);
    v = r1.body.attempt.state;
    const stale = await call(worker, a, "/api/daily/play", { date: DATE, mode: "official", seq: v.seq - 1, step: { t: "roll", keep: 3 } });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("STALE");
    expect(stale.body.attempt.state).toEqual(v);
    // refresh / reconnect
    expect((await call(worker, a, `/api/daily/attempt?date=${DATE}&mode=official`)).body.attempt.state).toEqual(v);
    // garbage steps and invented endpoints
    expect((await call(worker, a, "/api/daily/play", { date: DATE, mode: "official", seq: v.seq, step: { t: "roll", keep: 99 } })).status).toBe(400);
    expect((await call(worker, a, "/api/daily/submit", { date: DATE, score: 380 })).status).toBe(404);

    const endA = await playThrough(worker, a, "official", v);
    // a finished attempt cannot continue, and starting again returns the finished attempt
    expect((await call(worker, a, "/api/daily/start", { date: DATE, mode: "official" })).body).toMatchObject({ created: false, attempt: { status: "finished" } });

    // practice after the official: same tape, limited, not ranked
    const p = await call(worker, a, "/api/daily/start", { date: DATE, mode: "practice" });
    expect(p.status).toBe(200);
    expect(p.body.attempt.ranked).toBe(false);
    const firstOfficialRoll = s1.body.attempt.state.dice;
    expect(p.body.attempt.state.dice).toEqual(firstOfficialRoll);
    await playThrough(worker, a, "practice", p.body.attempt.state);
    expect((await call(worker, a, "/api/daily/start", { date: DATE, mode: "practice" })).status).toBe(200);
    // the 2nd practice is resumed by start; finishing it and starting a 3rd exceeds DAILY_PRACTICE_PER_DAY=2
    const p2 = await call(worker, a, `/api/daily/attempt?date=${DATE}&mode=practice`);
    await playThrough(worker, a, "practice", p2.body.attempt.state);
    expect((await call(worker, a, "/api/daily/start", { date: DATE, mode: "practice" })).body.error.code).toBe("PRACTICE_LIMIT");

    // B and C play too
    const sb = await call(worker, b, "/api/daily/start", { date: DATE, mode: "official" });
    const endB = await playThrough(worker, b, "official", sb.body.attempt.state);
    const sc = await call(worker, c, "/api/daily/start", { date: DATE, mode: "official" });
    const endC = await playThrough(worker, c, "official", sc.body.attempt.state);

    // everyone met the same dice: each attempt's first roll is identical
    expect(sb.body.attempt.state.dice).toEqual(firstOfficialRoll);
    expect(sc.body.attempt.state.dice).toEqual(firstOfficialRoll);

    // D-141: non-competitive — no ranking API (public, friends) and no visibility setting; nothing about other
    // players' results is exposed anywhere
    for (const path of [`/api/daily/ranking?date=${DATE}`, `/api/daily/ranking/friends?date=${DATE}`]) {
      for (const who of [null, a]) {
        const r = await call(worker, who, path);
        expect([r.status, r.body.error?.code]).toEqual([410, "RANKING_REMOVED"]);
        expect(JSON.stringify(r.body)).not.toMatch(/u_[A-Za-z0-9_-]{22}|에이|비|씨/);
      }
    }
    expect((await call(worker, b, "/api/daily/visibility", { visibility: "private" })).status).toBe(410);
    const todayA = await call(worker, a, "/api/daily/today");
    expect(JSON.stringify(todayA.body)).not.toMatch(/"rank"|"total"|비|씨/);
    void endB; void endC;

    // history, best
    const h = await call(worker, a, "/api/daily/history");
    expect(h.body.history.best).toEqual({ date: DATE, score: endA.score });
    expect(h.body.history.records[0]).toMatchObject({ date: DATE, status: "finished", score: endA.score });

    // the key of today is not revealed
    expect((await call(worker, a, `/api/daily/reveal?date=${DATE}`)).body.error.code).toBe("NOT_REVEALED");

    // puzzles: questions without keys, first answer recorded, key after answering
    const pz = await call(worker, a, `/api/daily/puzzles?date=${DATE}`);
    expect(pz.body.puzzles).toHaveLength(3);
    for (const x of pz.body.puzzles) {
      expect(x.key).toBeNull();
      expect(JSON.stringify(x.question)).not.toContain("best");
    }
    const q = pz.body.puzzles[0].question;
    // guests may read today's questions but not get today's answers
    expect((await call(worker, null, `/api/daily/puzzles?date=${DATE}`)).body.puzzles[0].key).toBeNull();
    expect((await call(worker, null, "/api/daily/puzzles/answer", { date: DATE, puzzleId: pz.body.puzzles[0].question.id, answer: "k:" })).status).toBe(401);
    const anyAnswer = q.objective === "probability" ? "o:A" : q.position.rollsLeft > 0 ? "k:" : "s:" + categories.find((c) => q.position.card[c] === undefined);
    const ans = await call(worker, a, "/api/daily/puzzles/answer", { date: DATE, puzzleId: q.id, answer: anyAnswer });
    expect(ans.status).toBe(200);
    expect(ans.body).toMatchObject({ first: true, recorded: true });
    expect(ans.body.key.best.length).toBeGreaterThan(0);
    const again = await call(worker, a, "/api/daily/puzzles/answer", { date: DATE, puzzleId: q.id, answer: ans.body.key.best[0] });
    expect(again.body.first).toBe(false);
    expect(again.body.result.answer).toBe(anyAnswer);
    expect((await call(worker, a, "/api/daily/puzzles/answer", { date: DATE, puzzleId: q.id, answer: "s:bogus" })).status).toBe(400);
    expect((await call(worker, a, "/api/daily/puzzles/answer", { date: DATE, puzzleId: "2026-12-10-intro", answer: "k:" })).status).toBe(400);
    const pz2 = await call(worker, a, `/api/daily/puzzles?date=${DATE}`);
    expect(pz2.body.puzzles[0].key).not.toBeNull();
    expect(pz2.body.puzzles[1].key).toBeNull();

    // after the day closes (a second server process on the same storage, clock past the grace)
    await worker.stop();
    closed = await startLocalWorker({ ...base, TEST_OIDC_ISSUER: idp.issuer, DAILY: "on", DAILY_SECRET: SECRET, DAILY_TEST_OFFSET_MS: String(closesAt(DATE) + 60_000 - Date.now()), ADMIN_TOKEN: ADMIN }, { persistDir: worker.persistDir });
    const rev = await call(closed, a, `/api/daily/reveal?date=${DATE}`);
    expect(rev.status).toBe(200);
    const key = fromHex(rev.body.key)!;
    expect(commitmentOf(key)).toBe(today.body.commitment); // matches what was published at the start of the day
    const verified = replayLog(DATE, key, rev.body.log)!;
    expect(total(verified.card)).toBe(endA.score); // anyone can re-check the official score
    expect((await call(closed, a, "/api/daily/start", { date: DATE, mode: "official" })).body).toMatchObject({ attempt: { status: "finished" } });
    expect((await call(closed, b, "/api/daily/start", { date: DATE, mode: "practice" })).body.error.code).toBe("DAILY_CLOSED");
    expect((await call(closed, null, `/api/daily/ranking?date=${DATE}`)).status).toBe(410); // D-141
    const pzClosed = await call(closed, b, `/api/daily/puzzles?date=${DATE}`);
    expect(pzClosed.body.puzzles.every((x: any) => x.key !== null)).toBe(true);
    // a closed day's puzzle: anyone answers, gets the key, nothing is recorded
    const q2 = pzClosed.body.puzzles[1].question;
    const guestAns = await call(closed, null, "/api/daily/puzzles/answer", { date: DATE, puzzleId: q2.id, answer: pzClosed.body.puzzles[1].key.best[0] });
    expect(guestAns.body).toMatchObject({ recorded: false, result: { correct: true } });

    // operations (06): no shared-token path any more — the report and puzzle withdrawal are ADMIN-1
    // extension routes (stats.read / content.write, tests/daily-integration.test.ts), registered by INT-1
    const admin = (path: string, body?: unknown) => fetch(closed.url + path, { method: body ? "POST" : "GET", headers: { authorization: "Bearer " + ADMIN }, body: body ? JSON.stringify(body) : undefined });
    expect((await admin(`/api/admin/daily?date=${DATE}`)).status).toBe(404);
    expect((await admin("/api/admin/daily/puzzle", { date: DATE, puzzleId: q.id, disabled: true })).status).toBe(404);
    expect((await call(closed, b, `/api/daily/puzzles?date=${DATE}`)).body.puzzles).toHaveLength(3);
  }, 240_000);

});

