import { addDays, closesAt, dayPhase, DAILY_EPOCH, DAILY_RULES, daysBetween, isDailyDate, kstDate } from "../../src/daily/calendar";
import { commitmentOf } from "../../src/daily/tape";
import { toHex } from "../../src/daily/sha256";
import { boardName, isVisibility, pageParams, withRanks, type BoardEntry, type RankedEntry, type Visibility } from "../../src/daily/ranking";
import { grade, questionOf, type Puzzle, type PuzzleBank, type PuzzleKey, type PuzzleResult } from "../../src/daily/puzzles/types";
import { NO_DAILY_REWARDS, type DailyAdminReport } from "../../src/daily/contract";
import type { AttemptView, DailyError, Mode } from "./daily";
import { dayKeyFor } from "./daily";
import bankJson from "../../src/daily/puzzles/bank.json";

/**
 * 오늘의 요트 / 오늘의 퍼즐 HTTP API (LIVE-1). Behind the `DAILY` flag ("off" in production until the
 * operator turns it on together with the `DAILY_SECRET` Worker secret).
 *
 *   GET  /api/daily/today                         date (KST), phase, dice commitment, my status
 *   POST /api/daily/start      { date, mode }     official (once) / practice (after the official)
 *   POST /api/daily/play       { date, mode, seq, step }   one step, server-verified
 *   GET  /api/daily/attempt?date=&mode=           reconnect / refresh
 *   GET  /api/daily/history                       my official records, best, streak inputs
 *   GET  /api/daily/ranking?date=&offset=&limit=  everyone (public entries, blocks applied)
 *   GET  /api/daily/ranking/friends?date=         friends + me
 *   GET  /api/daily/reveal?date=                  closed days only: day key (+ my own log when signed in)
 *   GET  /api/daily/puzzles?date=                 questions; keys only once answered or the day is closed
 *   POST /api/daily/puzzles/answer { date, puzzleId, answer }
 *   POST /api/daily/visibility { visibility }     public | friends | private
 *
 * Heavy work is never done here: puzzle keys come precomputed from bank.json, a step is one HMAC and
 * one row write on the member's own object.
 */
export const bank = bankJson as unknown as PuzzleBank;

export type DailyUserApi = {
  dailyStart(date: string, mode: Mode): Promise<{ ok: true; attempt: AttemptView; created: boolean } | DailyError>;
  dailyAct(date: string, mode: Mode, seq: unknown, step: unknown): Promise<{ ok: true; attempt: AttemptView; duplicate: boolean; finished: boolean } | DailyError>;
  dailyAttempt(date: string, mode: Mode): Promise<AttemptView | null>;
  dailyHistory(): Promise<unknown>;
  dailyVisibility(v?: Visibility): Promise<Visibility>;
  dailyHidden(): Promise<string[]>;
  dailyFriendIds(): Promise<string[]>;
  dailyPuzzleResults(ids: string[]): Promise<PuzzleResult[]>;
  dailyAnswer(date: string, result: PuzzleResult): Promise<{ result: PuzzleResult; first: boolean }>;
  dailyLog(date: string): Promise<unknown>;
  dailyPracticeLeft(date: string): Promise<number>;
};
export type DailyBoardApi = {
  page(offset: number, limit: number): Promise<{ total: number; entries: (BoardEntry & { rank: number })[] }>;
  entriesFor(ids: string[]): Promise<(BoardEntry & { rank: number })[]>;
  total(): Promise<number>;
  stats(): Promise<ReturnType<import("./daily").DailyBoardCore["stats"]>>;
  puzzleAnswered(id: string, correct: boolean): Promise<void>;
  puzzleFlags(): Promise<Record<string, boolean>>;
  setPuzzleFlag(id: string, disabled: boolean): Promise<void>;
  setVisibility(userId: string, v: Visibility): Promise<void>;
};
export type DailyDeps = {
  /** Worker secret for a date (dailySecrets: dated rotation). */
  secretFor(date: string): string;
  now(): number;
  me(): Promise<{ userId: string } | null>;
  user(id: string): DailyUserApi;
  board(date: string): DailyBoardApi;
  limited(key: string, perMinute: number): boolean;
  clientKey(): Promise<string>;
  reply(status: number, body: unknown, cache?: string): Response;
};

const fail = (deps: DailyDeps, status: number, code: string, message: string, extra: Record<string, unknown> = {}) => deps.reply(status, { error: { code, message }, ...extra });
const MODES: readonly Mode[] = ["official", "practice"];

/* -------------------------------------------------------------------- puzzles -------------------------------------------------------------------- */
/**
 * Puzzle run-out (LIVE-1): the bank is scheduled up to `lastScheduledDate()`. A later date gets a
 * deterministic RE-RUN of an earlier day's three puzzles (date index modulo the schedule length), under
 * new ids `rerun:<date>:<original id>` — answers are separate records, the title says it is a re-run —
 * so the service never shows an empty puzzle card. A fresh bank (`--days` up) replaces re-runs.
 */
const scheduledDates = Object.keys(bank.schedule).sort();
export const lastScheduledDate = () => scheduledDates[scheduledDates.length - 1];
const RERUN = /^rerun:(\d{4}-\d{2}-\d{2}):(.+)$/;
export function rerunSource(date: string): string | null {
  if (bank.schedule[date] || date <= lastScheduledDate() || date < bank.epoch) return null;
  return scheduledDates[daysBetween(scheduledDates[0], date) % scheduledDates.length];
}
const rerun = (date: string, p: Puzzle): Puzzle => ({ ...p, id: `rerun:${date}:${p.id}`, title: p.title + " · 다시 보는 퍼즐", source: p.source + " (rerun)" });
export function puzzlesOf(date: string): Puzzle[] {
  const direct = bank.schedule[date];
  if (direct) return direct.map((id) => bank.puzzles[id]).filter(Boolean);
  const from = rerunSource(date);
  return from ? bank.schedule[from].map((id) => rerun(date, bank.puzzles[id])).filter(Boolean) : [];
}
export function puzzleById(id: string): Puzzle | null {
  const m = RERUN.exec(id);
  if (!m) return bank.puzzles[id] ?? null;
  const original = bank.puzzles[m[2]];
  return original ? rerun(m[1], original) : null;
}
/** Days of scheduled (non-re-run) puzzles left after `today` (ops warning below 14). */
export const puzzleRunway = (today: string) => Math.max(0, daysBetween(today, lastScheduledDate()));
const keyView = (k: PuzzleKey) => ({ best: k.best, values: k.values, unit: k.unit, explanation: k.explanation, ...(k.expected ? { expected: k.expected } : {}), model: k.model });

/* ---------------------------------------------------------------- ranking cache ---------------------------------------------------------------- */
const pageCache = new Map<string, { at: number; value: { total: number; entries: (BoardEntry & { rank: number })[] } }>();
async function cachedPage(deps: DailyDeps, date: string, offset: number, limit: number) {
  const key = `${date}:${offset}:${limit}`;
  const ttl = dayPhase(date, deps.now()) === "closed" ? 300_000 : 15_000;
  const hit = pageCache.get(key);
  if (hit && deps.now() - hit.at < ttl) return hit.value;
  const value = await deps.board(date).page(offset, limit);
  pageCache.set(key, { at: deps.now(), value });
  if (pageCache.size > 500) for (const [k, v] of pageCache) if (deps.now() - v.at > 300_000) pageCache.delete(k);
  return value;
}
const publicEntry = (e: BoardEntry & { rank: number }, me?: string): RankedEntry => ({ rank: e.rank, nickname: e.nickname, score: e.score, finishedAt: e.finishedAt, yacht: e.yacht, bonus: e.bonus, ...(me && e.userId === me ? { me: true as const } : {}) });

/* --------------------------------------------------------------------- routes --------------------------------------------------------------------- */
export async function handleDailyRoute(request: Request, url: URL, deps: DailyDeps, readJson: () => Promise<Record<string, unknown>>): Promise<Response | null> {
  const path = url.pathname;
  if (!path.startsWith("/api/daily/")) return null;
  const now = deps.now();
  const today = kstDate(now);
  const method = request.method;
  const dateParam = (v: unknown) => (isDailyDate(v) && v >= DAILY_EPOCH && dayPhase(v, now) !== "future" ? v : null);

  if (path === "/api/daily/today" && method === "GET") {
    if (deps.limited("daily-today:" + (await deps.clientKey()), 60)) return fail(deps, 429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.");
    const key = dayKeyFor(deps.secretFor(today), today);
    const me = await deps.me();
    const flags = await deps.board(today).puzzleFlags().catch(() => ({} as Record<string, boolean>));
    const puzzles = puzzlesOf(today).filter((p) => !flags[p.id]).map((p) => ({ id: p.id, level: p.level, kind: p.kind, title: p.title }));
    const base = { now, date: today, rules: DAILY_RULES, phase: dayPhase(today, now), closesAt: closesAt(today), nextDate: addDays(today, 1), commitment: commitmentOf(key), puzzles, epoch: DAILY_EPOCH };
    if (!me) return deps.reply(200, { ...base, me: null }, "private, max-age=30");
    const u = deps.user(me.userId);
    const [official, practice, practiceLeft, results, visibility] = await Promise.all([
      u.dailyAttempt(today, "official"), u.dailyAttempt(today, "practice"), u.dailyPracticeLeft(today), u.dailyPuzzleResults(puzzles.map((p) => p.id)), u.dailyVisibility(),
    ]);
    return deps.reply(200, { ...base, me: { official, practice, practiceLeft, puzzleResults: results, visibility } }, "private, no-store");
  }

  if (path === "/api/daily/reveal" && method === "GET") {
    const date = dateParam(url.searchParams.get("date"));
    if (!date) return fail(deps, 404, "NOT_FOUND", "없는 날짜예요.");
    if (dayPhase(date, now) !== "closed") return fail(deps, 403, "NOT_REVEALED", "주사위 키는 그날 도전이 끝난 뒤(한국 시간 자정 + 30분)에 공개돼요.");
    const key = dayKeyFor(deps.secretFor(date), date);
    const me = await deps.me();
    const log = me ? await deps.user(me.userId).dailyLog(date) : null;
    return deps.reply(200, { date, rules: DAILY_RULES, key: toHex(key), commitment: commitmentOf(key), log }, me ? "private, max-age=300" : "public, max-age=86400");
  }

  if (path === "/api/daily/ranking" && method === "GET") {
    const date = dateParam(url.searchParams.get("date") ?? today);
    if (!date) return fail(deps, 404, "NOT_FOUND", "없는 날짜예요.");
    if (deps.limited("daily-rank:" + (await deps.clientKey()), 60)) return fail(deps, 429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.");
    const { offset, limit } = pageParams(url.searchParams.get("offset") ?? 0, url.searchParams.get("limit") ?? 20);
    const me = await deps.me();
    const page = await cachedPage(deps, date, offset, limit);
    const hidden = new Set(me ? await deps.user(me.userId).dailyHidden() : []);
    const entries = page.entries.filter((e) => (e.visibility === "public" || e.userId === me?.userId) && !hidden.has(e.userId)).map((e) => publicEntry(e, me?.userId));
    const mine = me ? (await deps.board(date).entriesFor([me.userId]))[0] : undefined;
    // The shared page cache may predate my own result (just finished): my fresh row joins its page.
    if (mine && !entries.some((e) => e.me) && mine.rank >= offset + 1 && (mine.rank <= offset + limit || entries.length < limit)) {
      entries.push(publicEntry(mine, me!.userId));
      entries.sort((x, y) => x.rank - y.rank || x.finishedAt - y.finishedAt);
    }
    return deps.reply(200, { date, rules: DAILY_RULES, final: dayPhase(date, now) === "closed", total: page.total, offset, limit, entries, me: mine ? publicEntry(mine, me!.userId) : null, hiddenCount: page.entries.length - entries.length },
      me ? "private, no-store" : `public, max-age=${dayPhase(date, now) === "closed" ? 300 : 15}`);
  }

  if (path === "/api/daily/puzzles" && method === "GET") {
    const date = dateParam(url.searchParams.get("date") ?? today);
    if (!date) return fail(deps, 404, "NOT_FOUND", "없는 날짜예요.");
    const flags = await deps.board(date).puzzleFlags().catch(() => ({} as Record<string, boolean>));
    const list = puzzlesOf(date).filter((p) => !flags[p.id]);
    const viewer = await deps.me();
    if (!viewer && deps.limited("daily-pz:" + (await deps.clientKey()), 30)) return fail(deps, 429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.");
    const results = viewer ? await deps.user(viewer.userId).dailyPuzzleResults(list.map((p) => p.id)) : [];
    const closed = dayPhase(date, now) === "closed";
    return deps.reply(200, {
      date, closed,
      puzzles: list.map((p) => {
        const result = results.find((r) => r.puzzleId === p.id) ?? null;
        return { question: questionOf(p), result, key: result || closed ? keyView(p.key) : null };
      }),
    }, viewer ? "private, no-store" : closed ? "public, max-age=3600" : "public, max-age=60");
  }

  if (path === "/api/daily/puzzles/answer" && method === "POST") {
    if (deps.limited("daily-ans:" + (await deps.clientKey()), 60)) return fail(deps, 429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.");
    const input = await readJson();
    const date = dateParam(input.date);
    const p = typeof input.puzzleId === "string" ? puzzleById(input.puzzleId) : null;
    if (!date || !p || !puzzlesOf(date).some((x) => x.id === p.id) || typeof input.answer !== "string") return fail(deps, 400, "INVALID_COMMAND", "요청 형식이 올바르지 않아요.");
    const open = dayPhase(date, now) !== "closed";
    const viewer = open ? await deps.me() : null;
    if (open && !viewer) return fail(deps, 401, "UNAUTHENTICATED", "오늘의 퍼즐 기록은 로그인한 회원만 남길 수 있어요. 지난 퍼즐은 누구나 풀 수 있어요.");
    if ((await deps.board(date).puzzleFlags().catch(() => ({} as Record<string, boolean>)))[p.id]) return fail(deps, 410, "PUZZLE_WITHDRAWN", "운영자가 내린 문제예요.");
    const g = grade(p.key, input.answer);
    if (!g) return fail(deps, 400, "INVALID_ANSWER", "이 문제에서 고를 수 없는 행동이에요.");
    // Only today's puzzles are participation records; a closed day is practice (answer shown, nothing stored).
    if (!open || !viewer) return deps.reply(200, { result: { puzzleId: p.id, answer: input.answer, ...g, at: now }, first: false, recorded: false, key: keyView(p.key) });
    if (deps.limited("daily:" + viewer.userId, 150)) return fail(deps, 429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.");
    const stored = await deps.user(viewer.userId).dailyAnswer(date, { puzzleId: p.id, answer: input.answer, ...g, at: now });
    if (stored.first) await deps.board(date).puzzleAnswered(p.id, stored.result.correct).catch(() => undefined);
    void NO_DAILY_REWARDS; // 07 contract: no grant for puzzles (DAILY_REWARDS_APPROVED = false)
    return deps.reply(200, { result: stored.result, first: stored.first, recorded: true, key: keyView(p.key) });
  }

  // Everything below needs a member.
  const me = await deps.me();
  if (!me) return fail(deps, 401, "UNAUTHENTICATED", "오늘의 요트 공식 기록은 로그인한 회원만 남길 수 있어요.");
  if (deps.limited("daily:" + me.userId, 150)) return fail(deps, 429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.");
  const u = deps.user(me.userId);

  if (path === "/api/daily/ranking/friends" && method === "GET") {
    const date = dateParam(url.searchParams.get("date") ?? today);
    if (!date) return fail(deps, 404, "NOT_FOUND", "없는 날짜예요.");
    const [friends, hidden] = await Promise.all([u.dailyFriendIds(), u.dailyHidden()]);
    const hide = new Set(hidden);
    const ids = [me.userId, ...friends.filter((id) => !hide.has(id)).slice(0, 300)];
    const rows = (await deps.board(date).entriesFor(ids)).filter((e) => e.userId === me.userId || e.visibility !== "private");
    const ranked = withRanks(rows.map((e) => ({ ...e, globalRank: e.rank })));
    return deps.reply(200, { date, final: dayPhase(date, now) === "closed", entries: ranked.map((e) => ({ ...publicEntry(e, me.userId), globalRank: e.globalRank })), friends: friends.length }, "private, no-store");
  }

  if (path === "/api/daily/history" && method === "GET") return deps.reply(200, { today, history: await u.dailyHistory() }, "private, no-store");

  if (path === "/api/daily/attempt" && method === "GET") {
    const date = dateParam(url.searchParams.get("date"));
    const mode = url.searchParams.get("mode") as Mode;
    if (!date || !MODES.includes(mode)) return fail(deps, 400, "INVALID_COMMAND", "요청 형식이 올바르지 않아요.");
    return deps.reply(200, { attempt: await u.dailyAttempt(date, mode) }, "private, no-store");
  }

  if (path === "/api/daily/visibility" && method === "POST") {
    const input = await readJson();
    if (!isVisibility(input.visibility)) return fail(deps, 400, "INVALID_COMMAND", "공개 범위를 다시 골라 주세요.");
    const v = await u.dailyVisibility(input.visibility);
    // today's and yesterday's boards follow the new setting (older days keep what was shown then)
    await Promise.all([today, addDays(today, -1)].map((d) => deps.board(d).setVisibility(me.userId, v))).catch(() => undefined);
    return deps.reply(200, { visibility: v });
  }

  if ((path === "/api/daily/start" || path === "/api/daily/play") && method === "POST") {
    const input = await readJson();
    const date = isDailyDate(input.date) ? input.date : null;
    const mode = input.mode as Mode;
    if (!date || !MODES.includes(mode)) return fail(deps, 400, "INVALID_COMMAND", "요청 형식이 올바르지 않아요.");
    const r = path === "/api/daily/start" ? await u.dailyStart(date, mode) : await u.dailyAct(date, mode, input.seq, input.step);
    if (!r.ok) return fail(deps, r.status, r.code, r.message, r.state ? { attempt: r.state } : {});
    return deps.reply(200, r, "private, no-store");
  }

  return fail(deps, 404, "NOT_FOUND", "없는 주소입니다.");
}

/* ---------------------------------------------------------------- admin (06) ---------------------------------------------------------------- */
export async function dailyAdminReport(deps: Pick<DailyDeps, "board" | "now">, date: string): Promise<DailyAdminReport> {
  const s = await deps.board(date).stats();
  return {
    date, rules: DAILY_RULES, phase: dayPhase(date, deps.now()),
    official: { started: s.started, completed: s.completed, ranked: s.ranked, completionRate: s.started ? s.completed / s.started : null, scoreBuckets: s.buckets, average: s.average, best: s.best },
    practice: { games: s.practice },
    puzzleBank: { lastScheduledDate: lastScheduledDate(), runwayDays: puzzleRunway(kstDate(deps.now())), rerun: !!rerunSource(date) },
    puzzles: puzzlesOf(date).map((p) => {
      const st = s.puzzles[p.id] ?? { answered: 0, correct: 0 };
      return { id: p.id, level: p.level, kind: p.kind, answered: st.answered, correct: st.correct, correctRate: st.answered ? st.correct / st.answered : null, disabled: !!s.flags[p.id] };
    }),
  };
}

export { boardName };
