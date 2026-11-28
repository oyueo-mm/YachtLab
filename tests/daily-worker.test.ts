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

    const all = await call(worker, null, `/api/daily/ranking?date=${DATE}`);
    expect(all.body.total).toBe(3);
    expect(all.body.entries.map((e: any) => e.score).sort()).toEqual([endA.score, endB.score, endC.score].sort());
    expect(JSON.stringify(all.body)).not.toMatch(/u_[A-Za-z0-9_-]{22}/);
    expect(all.cache).toBe("public, max-age=15");
    const scores = [endA.score, endB.score, endC.score];
    const rankA = 1 + scores.filter((x) => x > endA.score).length;
    expect((await call(worker, a, `/api/daily/ranking?date=${DATE}`)).body.me).toMatchObject({ rank: rankA, score: endA.score, nickname: "에이", me: true });

    // A and B become friends; C blocks A
    const codeOf = async (s: string) => (await call(worker, s, "/api/me/friends")).body.me.code as string;
    const [ca, cb] = [await codeOf(a), await codeOf(b)];
    const cc = await codeOf(c);
    await call(worker, a, "/api/me/friends/request", { code: cb });
    await call(worker, b, "/api/me/friends/accept", { code: ca });
    await call(worker, c, "/api/me/friends/block", { code: ca });
    void cc;
    const fr = await call(worker, a, `/api/daily/ranking/friends?date=${DATE}`);
    expect(fr.body.entries.map((e: any) => e.nickname).sort()).toEqual(["비", "에이"]);
    // blocks both ways: A no longer sees C, C no longer sees A (after the 15 s page cache, the filter is per viewer)
    const forA = await call(worker, a, `/api/daily/ranking?date=${DATE}`);
    expect(forA.body.entries.map((e: any) => e.nickname)).not.toContain("씨");
    const forC = await call(worker, c, `/api/daily/ranking?date=${DATE}`);
    expect(forC.body.entries.map((e: any) => e.nickname)).not.toContain("에이");
    // B goes private: hidden from friends and from the (uncached viewer-specific) global list of A after cache expiry
    expect((await call(worker, b, "/api/daily/visibility", { visibility: "private" })).body.visibility).toBe("private");
    const fr2 = await call(worker, a, `/api/daily/ranking/friends?date=${DATE}`);
    expect(fr2.body.entries.map((e: any) => e.nickname)).toEqual(["에이"]);
    expect((await call(worker, b, `/api/daily/ranking/friends?date=${DATE}`)).body.entries.map((e: any) => e.nickname)).toContain("비");

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
    const fin = await call(closed, null, `/api/daily/ranking?date=${DATE}`);
    expect(fin.body.final).toBe(true);
    expect(fin.cache).toBe("public, max-age=300");
    const pzClosed = await call(closed, b, `/api/daily/puzzles?date=${DATE}`);
    expect(pzClosed.body.puzzles.every((x: any) => x.key !== null)).toBe(true);
    // a closed day's puzzle: anyone answers, gets the key, nothing is recorded
    const q2 = pzClosed.body.puzzles[1].question;
    const guestAns = await call(closed, null, "/api/daily/puzzles/answer", { date: DATE, puzzleId: q2.id, answer: pzClosed.body.puzzles[1].key.best[0] });
    expect(guestAns.body).toMatchObject({ recorded: false, result: { correct: true } });

    // operations (06): participation / completion / puzzle numbers without ids, puzzle withdrawal
    const admin = (path: string, body?: unknown) => fetch(closed.url + path, { method: body ? "POST" : "GET", headers: { authorization: "Bearer " + ADMIN }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, any> }));
    expect((await fetch(closed.url + `/api/admin/daily?date=${DATE}`)).status).toBe(404);
    const report = await admin(`/api/admin/daily?date=${DATE}`);
    expect(report.body.official).toMatchObject({ started: 3, completed: 3, ranked: 3, completionRate: 1 });
    expect(report.body.practice.games).toBe(2);
    expect(report.body.puzzles[0]).toMatchObject({ answered: 1, disabled: false });
    expect(JSON.stringify(report.body)).not.toMatch(/u_[A-Za-z0-9_-]{22}|에이/);
    expect((await admin("/api/admin/daily/puzzle", { date: DATE, puzzleId: q.id, disabled: true })).status).toBe(200);
    expect((await call(closed, b, `/api/daily/puzzles?date=${DATE}`)).body.puzzles).toHaveLength(2);
  }, 240_000);
});
