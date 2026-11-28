import { categories, total, upper } from "../../src/engine";
import { closesAt, dayPhase, dayStart, DAILY_RULES, isDailyDate, kstDate } from "../../src/daily/calendar";
import { applyStep, DailyRuleError, finalScore, newDailyState, parseStep, replayLog, sameStep, viewOf, type DailyState, type DailyStep, type DailyView } from "../../src/daily/game";
import { deriveDayKey, type DayKey } from "../../src/daily/tape";
import { compareEntries, isVisibility, type BoardEntry, type Visibility } from "../../src/daily/ranking";
import type { PuzzleResult } from "../../src/daily/puzzles/types";

/**
 * 오늘의 요트 — storage (LIVE-1).
 *
 *   DailyPlayStore   inside each account's UserStore SQLite: that member's attempts, puzzle answers, settings
 *   DailyBoardCore   one DailyBoard Durable Object per (rules, date): first official results, counters
 *
 * Both are plain classes over a tiny SQL interface so they run under node:sqlite in tests and on the
 * Workers runtime unchanged. Every accepted step is ONE row write (the attempt row), written in the same
 * synchronous call that validated it — no await between reading the attempt and storing the step, so
 * two tabs (or a retried request) can never both apply a step: the second sees a different `seq`.
 */
export type DailySql = {
  exec<T = Record<string, unknown>>(query: string, ...params: unknown[]): { toArray(): T[] };
  transaction<T>(fn: () => T): T;
};

export type Mode = "official" | "practice";
export type AttemptStatus = "playing" | "finished" | "expired";
export type AttemptView = { mode: Mode; status: AttemptStatus; ranked: boolean; startedAt: number; finishedAt: number | null; state: DailyView };
export type DailyError = { ok: false; status: number; code: string; message: string; state?: AttemptView };
export type DailyOk<T> = { ok: true } & T;

const err = (status: number, code: string, message: string, state?: AttemptView): DailyError => ({ ok: false, status, code, message, ...(state ? { state } : {}) });

export type DailyLimits = { practicePerDay: number };

type Row = { date: string; rules: string; mode: Mode; state: string; status: AttemptStatus; started_at: number; finished_at: number | null; score: number | null; ranked: number; submitted: number; activity: number };

export class DailyPlayStore {
  constructor(private sql: DailySql) {}
  init() {
    this.sql.exec("CREATE TABLE IF NOT EXISTS daily_attempts (date TEXT NOT NULL, rules TEXT NOT NULL, mode TEXT NOT NULL, state TEXT NOT NULL, status TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER, score INTEGER, ranked INTEGER NOT NULL DEFAULT 0, submitted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (date, rules, mode))");
    // C5 continuous-activity report state (added with the C5 adapter; older rows default to "not sent")
    if (!this.sql.exec<{ name: string }>("PRAGMA table_info(daily_attempts)").toArray().some((c) => c.name === "activity"))
      this.sql.exec("ALTER TABLE daily_attempts ADD COLUMN activity INTEGER NOT NULL DEFAULT 0");
    this.sql.exec("CREATE TABLE IF NOT EXISTS daily_practice (date TEXT PRIMARY KEY, games INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS daily_puzzles (puzzle_id TEXT PRIMARY KEY, date TEXT NOT NULL, answer TEXT NOT NULL, correct INTEGER NOT NULL, value REAL, best REAL NOT NULL, at INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS daily_prefs (id INTEGER PRIMARY KEY CHECK (id = 1), visibility TEXT NOT NULL)");
  }

  private row(date: string, mode: Mode): Row | null {
    return this.sql.exec<Row>("SELECT * FROM daily_attempts WHERE date = ? AND rules = ? AND mode = ?", date, DAILY_RULES, mode).toArray()[0] ?? null;
  }
  private viewRow(r: Row, now: number): AttemptView {
    const state = JSON.parse(r.state) as DailyState;
    const expired = r.status === "playing" && now >= closesAt(r.date);
    return { mode: r.mode, status: expired ? "expired" : r.status, ranked: !!r.ranked, startedAt: r.started_at, finishedAt: r.finished_at, state: viewOf(state) };
  }

  visibility(): Visibility {
    const v = this.sql.exec<{ visibility: string }>("SELECT visibility FROM daily_prefs WHERE id = 1").toArray()[0]?.visibility;
    return isVisibility(v) ? v : "public";
  }
  setVisibility(v: Visibility) {
    this.sql.exec("INSERT INTO daily_prefs (id, visibility) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET visibility = excluded.visibility", v);
    return v;
  }

  /** Current attempt of a date (null when none). */
  attempt(date: string, mode: Mode, now: number): AttemptView | null {
    const r = this.row(date, mode);
    return r ? this.viewRow(r, now) : null;
  }

  /**
   * Start (or resume) an attempt. Official: only on its own KST date, once — a second start returns the
   * SAME attempt (refresh, second tab, retried request). Practice: only after that day's official attempt
   * is over (finished, or expired), so nobody can learn the day's dice before playing for the record;
   * a closed day is replayed in the browser instead (revealed key), never here.
   */
  start(date: string, mode: Mode, key: DayKey, now: number, opts: { ranked: boolean; limits: DailyLimits }): DailyOk<{ attempt: AttemptView; created: boolean }> | DailyError {
    const phase = dayPhase(date, now);
    if (phase === "future") return err(403, "DAILY_NOT_OPEN", "아직 열리지 않은 날짜예요.");
    return this.sql.transaction(() => {
      if (mode === "official") {
        const existing = this.row(date, "official");
        if (existing) return { ok: true as const, attempt: this.viewRow(existing, now), created: false };
        if (phase !== "open") return err(409, "DAILY_CLOSED", "이 날짜의 공식 도전은 끝났어요. 지난 도전으로 연습할 수 있어요.");
        const state = newDailyState(date, key);
        this.sql.exec("INSERT INTO daily_attempts (date, rules, mode, state, status, started_at, ranked) VALUES (?, ?, 'official', ?, 'playing', ?, ?)", date, DAILY_RULES, JSON.stringify(state), now, opts.ranked ? 1 : 0);
        return { ok: true as const, attempt: this.viewRow(this.row(date, "official")!, now), created: true };
      }
      if (phase === "closed") return err(409, "DAILY_CLOSED", "지난 날짜는 브라우저에서 바로 연습할 수 있어요.");
      const official = this.row(date, "official");
      const officialView = official && this.viewRow(official, now);
      if (!officialView || officialView.status === "playing") return err(403, "PRACTICE_LOCKED", "오늘의 공식 도전을 마친 뒤에 같은 주사위로 연습할 수 있어요.");
      const current = this.row(date, "practice");
      if (current && current.status === "playing") return { ok: true as const, attempt: this.viewRow(current, now), created: false };
      const used = this.sql.exec<{ games: number }>("SELECT games FROM daily_practice WHERE date = ?", date).toArray()[0]?.games ?? 0;
      if (used >= opts.limits.practicePerDay) return err(429, "PRACTICE_LIMIT", `오늘 연습은 ${opts.limits.practicePerDay}번까지예요. 지난 도전은 횟수 제한 없이 할 수 있어요.`);
      const state = newDailyState(date, key);
      this.sql.exec("INSERT INTO daily_attempts (date, rules, mode, state, status, started_at, ranked) VALUES (?, ?, 'practice', ?, 'playing', ?, 0) ON CONFLICT(date, rules, mode) DO UPDATE SET state = excluded.state, status = 'playing', started_at = excluded.started_at, finished_at = NULL, score = NULL, submitted = 0", date, DAILY_RULES, JSON.stringify(state), now);
      this.sql.exec("INSERT INTO daily_practice (date, games) VALUES (?, 1) ON CONFLICT(date) DO UPDATE SET games = games + 1", date);
      return { ok: true as const, attempt: this.viewRow(this.row(date, "practice")!, now), created: true };
    });
  }

  /**
   * Apply one step. `seq` is the number of steps the client has seen (its view's `seq`):
   *  - seq == log length          → apply (one row write)
   *  - seq <  log length, same step at that index → duplicate (a retried request): the current view, no write
   *  - otherwise                  → 409 STALE with the current view (another tab moved first)
   */
  act(date: string, mode: Mode, seq: unknown, rawStep: unknown, key: DayKey, now: number): DailyOk<{ attempt: AttemptView; duplicate: boolean; finished: boolean }> | DailyError {
    const step = parseStep(rawStep);
    if (!step || !Number.isInteger(seq)) return err(400, "INVALID_COMMAND", "요청 형식이 올바르지 않아요.");
    return this.sql.transaction(() => {
      const r = this.row(date, mode);
      if (!r) return err(404, "NO_ATTEMPT", "진행 중인 도전이 없어요.");
      const view = this.viewRow(r, now);
      const state = JSON.parse(r.state) as DailyState;
      const n = seq as number;
      if (n < state.log.length) {
        if (n >= 1 && sameStep(state.log[n], step)) return { ok: true as const, attempt: view, duplicate: true, finished: false };
        return err(409, "STALE", "다른 탭이나 기기에서 먼저 진행했어요. 최신 상태로 맞췄어요.", view);
      }
      if (n > state.log.length) return err(409, "STALE", "최신 상태로 맞췄어요.", view);
      if (view.status === "expired") return err(409, "DAILY_EXPIRED", "도전 시간이 끝났어요 (한국 시간 자정 + 30분).", view);
      if (view.status === "finished") return err(409, "DONE", "이미 끝난 도전이에요.", view);
      let next: DailyState;
      try {
        next = applyStep(state, step, key);
      } catch (e) {
        if (e instanceof DailyRuleError) return err(409, e.code, e.message, view);
        throw e;
      }
      const finished = next.done;
      this.sql.exec(
        "UPDATE daily_attempts SET state = ?, status = ?, finished_at = ?, score = ? WHERE date = ? AND rules = ? AND mode = ?",
        JSON.stringify(next), finished ? "finished" : "playing", finished ? now : null, finished ? finalScore(next) : null, date, DAILY_RULES, mode,
      );
      return { ok: true as const, attempt: this.viewRow(this.row(date, mode)!, now), duplicate: false, finished };
    });
  }

  /**
   * Finished official attempts with a pending step: the board submission (`submitted`) and/or the C5
   * activity report (`activity`). Each step is marked separately, so a retry never repeats a done step.
   */
  pendingSubmissions(): { date: string; score: number; finishedAt: number; ranked: boolean; state: DailyState; board: boolean; activity: boolean }[] {
    return this.sql.exec<Row>("SELECT * FROM daily_attempts WHERE mode = 'official' AND rules = ? AND status = 'finished' AND (submitted = 0 OR activity = 0)", DAILY_RULES).toArray()
      .map((r) => ({ date: r.date, score: r.score ?? 0, finishedAt: r.finished_at ?? r.started_at, ranked: !!r.ranked, state: JSON.parse(r.state) as DailyState, board: !r.submitted, activity: !r.activity }));
  }
  markSubmitted(date: string) {
    this.sql.exec("UPDATE daily_attempts SET submitted = 1 WHERE date = ? AND rules = ? AND mode = 'official'", date, DAILY_RULES);
  }
  markActivity(date: string) {
    this.sql.exec("UPDATE daily_attempts SET activity = 1 WHERE date = ? AND rules = ? AND mode = 'official'", date, DAILY_RULES);
  }

  /** Official history, newest first, with personal best and participation streak inputs. */
  history(now: number, limit = 120) {
    const rows = this.sql.exec<Row>("SELECT * FROM daily_attempts WHERE mode = 'official' AND rules = ? ORDER BY date DESC LIMIT ?", DAILY_RULES, Math.max(1, Math.min(400, limit))).toArray();
    const list = rows.map((r) => {
      const v = this.viewRow(r, now);
      return { date: r.date, status: v.status, score: v.status === "finished" ? r.score : null, ranked: !!r.ranked, finishedAt: r.finished_at, card: v.status === "playing" ? null : v.state.card };
    });
    const finished = list.filter((r) => r.status === "finished" && r.score !== null);
    const best = finished.reduce<(typeof finished)[number] | null>((b, r) => (!b || (r.score ?? 0) > (b.score ?? 0) ? r : b), null);
    return { records: list, best: best ? { date: best.date, score: best.score! } : null, played: list.length, completed: finished.length, average: finished.length ? finished.reduce((s, r) => s + (r.score ?? 0), 0) / finished.length : null };
  }

  /** The member's own step log of a CLOSED date (self-verification against the revealed key). */
  log(date: string, mode: Mode): DailyStep[] | null {
    const r = this.row(date, mode);
    return r ? (JSON.parse(r.state) as DailyState).log : null;
  }

  /* ------------------------------------------------------------------ puzzles ------------------------------------------------------------------ */
  puzzleResults(ids: string[]): PuzzleResult[] {
    if (!ids.length) return [];
    const rows = this.sql.exec<{ puzzle_id: string; answer: string; correct: number; value: number | null; best: number; at: number }>(
      `SELECT * FROM daily_puzzles WHERE puzzle_id IN (${ids.map(() => "?").join(",")})`, ...ids).toArray();
    return rows.map((r) => ({ puzzleId: r.puzzle_id, answer: r.answer, correct: !!r.correct, value: r.value, bestValue: r.best, loss: r.value === null ? null : Math.max(0, r.best - r.value), at: r.at }));
  }
  /** First answer is final: a later submission returns the stored result (`first: false`). */
  answerPuzzle(date: string, result: PuzzleResult): { result: PuzzleResult; first: boolean } {
    return this.sql.transaction(() => {
      const existing = this.puzzleResults([result.puzzleId])[0];
      if (existing) return { result: existing, first: false };
      this.sql.exec("INSERT INTO daily_puzzles (puzzle_id, date, answer, correct, value, best, at) VALUES (?, ?, ?, ?, ?, ?, ?)", result.puzzleId, date, result.answer, result.correct ? 1 : 0, result.value, result.bestValue, result.at);
      return { result, first: true };
    });
  }
  puzzleSummary() {
    const r = this.sql.exec<{ n: number; c: number }>("SELECT count(*) AS n, coalesce(sum(correct), 0) AS c FROM daily_puzzles").toArray()[0];
    const days = this.sql.exec<{ date: string }>("SELECT DISTINCT date FROM daily_puzzles ORDER BY date DESC LIMIT 400").toArray().map((x) => x.date);
    return { answered: r?.n ?? 0, correct: r?.c ?? 0, days };
  }
}

/**
 * After-completion steps of finished official attempts (UserStore.dailyFlush): 1) ranking board,
 * 2) C5 activity report. Each step is marked done on its own, so a failed step is retried on a later
 * call and a finished step never repeats (no double board counter, no second activity report).
 * A state that does not replay from its own log is never published and never reported.
 */
export type FlushSteps = {
  verify(state: DailyState, date: string): boolean;
  board(p: ReturnType<DailyPlayStore["pendingSubmissions"]>[number]): Promise<void>;
  activity(p: ReturnType<DailyPlayStore["pendingSubmissions"]>[number]): Promise<void>;
  onVerifyFailed?(): void;
};
export async function flushPending(store: DailyPlayStore, steps: FlushSteps): Promise<{ board: number; activity: number; failed: number; rejected: number }> {
  const out = { board: 0, activity: 0, failed: 0, rejected: 0 };
  for (const a of store.pendingSubmissions()) {
    try {
      if (!steps.verify(a.state, a.date)) {
        steps.onVerifyFailed?.();
        store.markSubmitted(a.date);
        store.markActivity(a.date);
        out.rejected++;
        continue;
      }
      if (a.board) {
        await steps.board(a);
        store.markSubmitted(a.date);
        out.board++;
      }
      if (a.activity) {
        await steps.activity(a);
        store.markActivity(a.date);
        out.activity++;
      }
    } catch {
      out.failed++; // the next call retries the step that did not complete
    }
  }
  return out;
}

/**
 * Clock of the daily service. `DAILY_TEST_OFFSET_MS` shifts it for local end-to-end tests only: it is
 * honoured only when APP_URL is a loopback http address, which a deployed Worker can never have.
 */
export function dailyClock(env: { DAILY_TEST_OFFSET_MS?: string; APP_URL?: string }): () => number {
  const offset = Number(env.DAILY_TEST_OFFSET_MS ?? "");
  if (Number.isFinite(offset) && offset !== 0 && /^http:\/\/127\.0\.0\.1:\d+\//.test(env.APP_URL ?? "")) return () => Date.now() + offset;
  return Date.now;
}

/** Day key for a date (Worker secret → per-day HMAC key). Throws if the secret is missing or short. */
export const dayKeyFor = (secret: string | undefined, date: string) => deriveDayKey(secret ?? "", date);

/**
 * DAILY_SECRET handling (D-LIVE1-2). The key of EVERY date derives from the secret, so replacing it in place
 * would change today's dice mid-game and the published keys of past days. A rotation is therefore dated:
 *
 *   DAILY_SECRET           current secret (≥ 32 chars), used for dates >= DAILY_SECRET_FROM
 *   DAILY_SECRET_PREVIOUS  the former secret, kept for dates  < DAILY_SECRET_FROM (reveal / verify / grace)
 *   DAILY_SECRET_FROM      YYYY-MM-DD, set to a FUTURE date (tomorrow at the earliest) when rotating
 *
 * Any inconsistent setting fails closed (daily stays off): a short secret, FROM without a valid PREVIOUS,
 * PREVIOUS equal to the current secret, or FROM that is not a date.
 */
export type DailySecretEnv = { DAILY_SECRET?: string; DAILY_SECRET_PREVIOUS?: string; DAILY_SECRET_FROM?: string };
export function dailySecrets(env: DailySecretEnv): { ok: true; secretFor(date: string): string } | { ok: false; reason: string } {
  const current = env.DAILY_SECRET ?? "";
  if (current.length < 32) return { ok: false, reason: "DAILY_SECRET missing or shorter than 32 characters" };
  const from = env.DAILY_SECRET_FROM;
  if (from === undefined || from === "") {
    if (env.DAILY_SECRET_PREVIOUS) return { ok: false, reason: "DAILY_SECRET_PREVIOUS without DAILY_SECRET_FROM" };
    return { ok: true, secretFor: () => current };
  }
  const previous = env.DAILY_SECRET_PREVIOUS ?? "";
  if (!isDailyDate(from)) return { ok: false, reason: "DAILY_SECRET_FROM is not YYYY-MM-DD" };
  if (previous.length < 32 || previous === current) return { ok: false, reason: "DAILY_SECRET_PREVIOUS missing, short or equal to DAILY_SECRET" };
  return { ok: true, secretFor: (date) => (date < from ? previous : current) };
}

/** Whether an account may rank on `date`: created before that KST day began (unless allowed by config). */
export const rankEligible = (createdAt: number, date: string, newAccountsRanked: boolean) => newAccountsRanked || createdAt < dayStart(date);

/** Ranking entry built from a finished attempt (server data only). */
export function entryFrom(userId: string, nickname: string | null, s: DailyState, finishedAt: number, visibility: Visibility): BoardEntry {
  return { userId, nickname: nickname ?? "이름 없는 플레이어", score: total(s.card), finishedAt, visibility, yacht: (s.card.yacht ?? 0) > 0, bonus: upper(s.card) >= 63 };
}

/** Re-derive a stored attempt from its log (defence in depth before publishing a score). */
export function verifyState(s: DailyState, key: DayKey): boolean {
  const again = replayLog(s.date, key, s.log);
  return !!again && again.done === s.done && categories.every((c) => again.card[c] === s.card[c]);
}

/* -------------------------------------------------------------------- board -------------------------------------------------------------------- */
type EntryRow = { user_id: string; nickname: string; score: number; finished_at: number; visibility: string; yacht: number; bonus: number };
const toEntry = (r: EntryRow): BoardEntry => ({ userId: r.user_id, nickname: r.nickname, score: r.score, finishedAt: r.finished_at, visibility: isVisibility(r.visibility) ? r.visibility : "public", yacht: !!r.yacht, bonus: !!r.bonus });

export class DailyBoardCore {
  constructor(private sql: DailySql) {}
  init() {
    this.sql.exec("CREATE TABLE IF NOT EXISTS participants (user_id TEXT PRIMARY KEY, at INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS entries (user_id TEXT PRIMARY KEY, nickname TEXT NOT NULL, score INTEGER NOT NULL, finished_at INTEGER NOT NULL, visibility TEXT NOT NULL, yacht INTEGER NOT NULL, bonus INTEGER NOT NULL)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS entries_order ON entries (score DESC, finished_at ASC, user_id ASC)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, n INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS puzzle_stats (puzzle_id TEXT PRIMARY KEY, answered INTEGER NOT NULL, correct INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS puzzle_flags (puzzle_id TEXT PRIMARY KEY, disabled INTEGER NOT NULL)");
  }
  /** Admission of a new official participant (daily cap). Idempotent per account. */
  admit(userId: string, limit: number, now: number): { ok: boolean; participants: number } {
    return this.sql.transaction(() => {
      const n = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM participants").toArray()[0].n;
      if (this.sql.exec("SELECT 1 FROM participants WHERE user_id = ?", userId).toArray().length) return { ok: true, participants: n };
      if (n >= limit) return { ok: false, participants: n };
      this.sql.exec("INSERT INTO participants (user_id, at) VALUES (?, ?)", userId, now);
      return { ok: true, participants: n + 1 };
    });
  }
  /** First official result of an account (later calls never replace it). Ranked results only. */
  submit(e: BoardEntry): { stored: boolean } {
    const before = this.sql.exec("SELECT 1 FROM entries WHERE user_id = ?", e.userId).toArray().length;
    if (before) return { stored: false };
    this.sql.exec("INSERT INTO entries (user_id, nickname, score, finished_at, visibility, yacht, bonus) VALUES (?, ?, ?, ?, ?, ?, ?)", e.userId, e.nickname, e.score, e.finishedAt, e.visibility, e.yacht ? 1 : 0, e.bonus ? 1 : 0);
    return { stored: true };
  }
  /** Completed but unranked attempts (new accounts) only count for completion statistics. */
  count(name: string, by = 1) {
    this.sql.exec("INSERT INTO counters (name, n) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET n = n + ?", name, by, by);
  }
  counter(name: string) {
    return this.sql.exec<{ n: number }>("SELECT n FROM counters WHERE name = ?", name).toArray()[0]?.n ?? 0;
  }
  /** Account deletion: the member's result leaves the board (counters keep only numbers). */
  remove(userId: string) {
    this.sql.exec("DELETE FROM entries WHERE user_id = ?", userId);
    this.sql.exec("DELETE FROM participants WHERE user_id = ?", userId);
  }
  setVisibility(userId: string, v: Visibility) {
    this.sql.exec("UPDATE entries SET visibility = ? WHERE user_id = ?", v, userId);
  }
  total() {
    return this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM entries").toArray()[0].n;
  }
  rankOfScore(score: number) {
    return this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM entries WHERE score > ?", score).toArray()[0].n + 1;
  }
  /**
   * One page of the full order (all visibilities, so ranks stay true), entries with ids for the Worker to
   * filter (visibility, blocks) before anything leaves the server.
   */
  page(offset: number, limit: number): { total: number; entries: (BoardEntry & { rank: number })[] } {
    const rows = this.sql.exec<EntryRow>("SELECT * FROM entries ORDER BY score DESC, finished_at ASC, user_id ASC LIMIT ? OFFSET ?", limit, offset).toArray().map(toEntry);
    // Competition rank: sorted by score, so the first entry of a score group sits at position
    // 1 + (entries with a higher score); a group continuing from the previous page needs one count.
    const ranked: (BoardEntry & { rank: number })[] = [];
    rows.forEach((e, i) => {
      const rank = i === 0 ? this.rankOfScore(e.score) : e.score === rows[i - 1].score ? ranked[i - 1].rank : offset + i + 1;
      ranked.push({ ...e, rank });
    });
    return { total: this.total(), entries: ranked };
  }
  entriesFor(ids: string[]): (BoardEntry & { rank: number })[] {
    if (!ids.length) return [];
    const rows = this.sql.exec<EntryRow>(`SELECT * FROM entries WHERE user_id IN (${ids.map(() => "?").join(",")})`, ...ids).toArray().map(toEntry);
    return rows.sort(compareEntries).map((e) => ({ ...e, rank: this.rankOfScore(e.score) }));
  }
  entry(userId: string) {
    const e = this.entriesFor([userId])[0];
    return e ?? null;
  }
  puzzleAnswered(puzzleId: string, correct: boolean) {
    this.sql.exec("INSERT INTO puzzle_stats (puzzle_id, answered, correct) VALUES (?, 1, ?) ON CONFLICT(puzzle_id) DO UPDATE SET answered = answered + 1, correct = correct + ?", puzzleId, correct ? 1 : 0, correct ? 1 : 0);
  }
  puzzleFlags(): Record<string, boolean> {
    return Object.fromEntries(this.sql.exec<{ puzzle_id: string; disabled: number }>("SELECT * FROM puzzle_flags").toArray().map((r) => [r.puzzle_id, !!r.disabled]));
  }
  setPuzzleFlag(puzzleId: string, disabled: boolean) {
    this.sql.exec("INSERT INTO puzzle_flags (puzzle_id, disabled) VALUES (?, ?) ON CONFLICT(puzzle_id) DO UPDATE SET disabled = excluded.disabled", puzzleId, disabled ? 1 : 0);
  }
  stats() {
    const started = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM participants").toArray()[0].n;
    const agg = this.sql.exec<{ n: number; avg: number | null; best: number | null }>("SELECT count(*) AS n, avg(score) AS avg, max(score) AS best FROM entries").toArray()[0];
    const buckets: Record<string, number> = {};
    for (const r of this.sql.exec<{ b: number; n: number }>("SELECT (score / 25) * 25 AS b, count(*) AS n FROM entries GROUP BY b ORDER BY b").toArray()) buckets[`${r.b}-${r.b + 24}`] = r.n;
    const puzzles = Object.fromEntries(this.sql.exec<{ puzzle_id: string; answered: number; correct: number }>("SELECT * FROM puzzle_stats").toArray().map((r) => [r.puzzle_id, { answered: r.answered, correct: r.correct }]));
    return { started, completed: agg.n + this.counter("completed.unranked"), ranked: agg.n, average: agg.avg, best: agg.best, buckets, practice: this.counter("practice"), puzzles, flags: this.puzzleFlags() };
  }
}

export { kstDate };
