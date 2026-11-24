/**
 * Live economy rules (pure): what a finished, server-verified match grants, quest assignment and
 * progress, achievement counters. No I/O — the per-account store (worker/src/economy.ts) persists the
 * state and the ledger in one transaction; tests call these functions directly.
 *
 * Order of calculation for one match of a signed-in player (docs/economy/LIVE-ECONOMY.md §계산 순서):
 *  1. Trust: only `server/server-verified` records with a known kind (random / friend / ai).
 *  2. Countable: completed (12 rounds), or the opponent forfeited after I filled ≥ 6 categories.
 *     My own resign/timeout: nothing (no coins, quests or achievements; a random win streak ends).
 *  3. Mode caps (before the shared order): friend ≤ 10 rewarded per day; random vs the same signed-in
 *     opponent ≤ 3 rewarded per day. A capped match is not "rewarded" and does not use a daily position.
 *  4. Daily position k (shared by all modes, KST day): k ≤ 10 → mode reward (complete + win/draw bonus;
 *     completion only after an opponent forfeit) + new-user boost (+5, first 7 days) + active event
 *     per-match bonus; 11 ≤ k ≤ 30 → flat 3; k ≥ 31 → 0.
 *  5. Quests progress on every countable match (also beyond the coin cap). Achievement counters take
 *     at most 40 countable matches per day. Records and statistics are never capped.
 */
import { categories, type Card, type Category } from "../../engine";
import { ACHIEVEMENTS, ECONOMY, QUESTS, economyDay, economyWeek, questById, type MatchKind, type QuestDef } from "./config";

export type MatchStats = {
  /** Turns whose first roll was a yacht / a large straight. */
  firstRollYachts: number;
  firstRollLarge: number;
  /** Yacht scored in round 12. */
  finalRoundYacht: boolean;
  /** Faces of the yachts scored (50 points) this match. */
  yachtFaces: number[];
  /** Behind by ≥ 30 after round 9 and won. */
  comeback30: boolean;
};
export type RewardInput = {
  matchId: string;
  kind: MatchKind;
  outcome: "win" | "loss" | "draw";
  endReason: "completed" | "resign" | "timeout";
  score: number;
  card: Card;
  opponentUserId?: string;
  stats?: MatchStats;
  endedAt: number;
};
export type QuestSlot = { id: string; progress: number; done: boolean };
export type EconState = {
  v: 1;
  day: number;
  rewarded: number;
  friend: number;
  achMatches: number;
  opp: Record<string, number>;
  aiStarts: number;
  /** Daily quests of `day`. */
  daily: QuestSlot[];
  rerolls: number;
  dailyAll: boolean;
  week: number;
  weekly: QuestSlot[];
  weeklyAll: boolean;
  /** Economy days with a countable match this week. */
  weekDays: number[];
  lastPlayDay: number;
  streak: number;
  counters: Record<string, number>;
  yachtFaceMask: number;
  achievements: string[];
  events: Record<string, { matches: number; paid: boolean }>;
};
export type Grant = { key: string; kind: "match" | "quest" | "quest-bonus" | "achievement" | "welcome" | "event"; coins: number; gems: number; label: string; item?: string };

/* --------------------------------------------------------------- quests --------------------------------------------------------------- */

/** FNV-1a 32-bit: a stable, cheap hash for deterministic quest picks (not security relevant). */
function fnv(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
const pool = (period: QuestDef["period"], difficulty: number) => QUESTS.filter((q) => q.period === period && q.difficulty === difficulty);
function pickQuests(userId: string, period: QuestDef["period"], key: number): QuestSlot[] {
  return [0, 1, 2].map((d) => {
    const options = pool(period, d);
    return { id: options[fnv(`${userId}:${period}:${key}:${d}`) % options.length].id, progress: 0, done: false };
  });
}

export function newEconState(userId: string, now: number): EconState {
  const day = economyDay(now);
  const week = economyWeek(now);
  return {
    v: 1,
    day,
    rewarded: 0,
    friend: 0,
    achMatches: 0,
    opp: {},
    aiStarts: 0,
    daily: pickQuests(userId, "daily", day),
    rerolls: 0,
    dailyAll: false,
    week,
    weekly: pickQuests(userId, "weekly", week),
    weeklyAll: false,
    weekDays: [],
    lastPlayDay: -1,
    streak: 0,
    counters: {},
    yachtFaceMask: 0,
    achievements: [],
    events: {},
  };
}

/** Start a new day / week when the server clock passed a reset (KST 00:00, weeks from Monday). */
export function rollover(state: EconState, userId: string, now: number): EconState {
  const day = economyDay(now);
  const week = economyWeek(now);
  let s = state;
  if (s.day !== day) s = { ...s, day, rewarded: 0, friend: 0, achMatches: 0, opp: {}, aiStarts: 0, daily: pickQuests(userId, "daily", day), rerolls: 0, dailyAll: false };
  if (s.week !== week) s = { ...s, week, weekly: pickQuests(userId, "weekly", week), weeklyAll: false, weekDays: [] };
  return s;
}

/** Replace one unfinished daily quest by another of the same difficulty (free, once a day). */
export function rerollDaily(state: EconState, userId: string, index: number): { ok: true; state: EconState } | { ok: false; message: string } {
  const slot = state.daily[index];
  if (!slot) return { ok: false, message: "퀘스트를 찾을 수 없어요." };
  if (slot.done) return { ok: false, message: "완료한 퀘스트는 바꿀 수 없어요." };
  if (state.rerolls >= ECONOMY.quests.dailyRerolls) return { ok: false, message: "오늘은 이미 퀘스트를 교체했어요." };
  const def = questById(slot.id)!;
  const taken = new Set(state.daily.map((q) => q.id));
  const options = pool("daily", def.difficulty).filter((q) => !taken.has(q.id));
  if (!options.length) return { ok: false, message: "바꿀 수 있는 퀘스트가 없어요." };
  const next = options[fnv(`${userId}:reroll:${state.day}:${index}`) % options.length];
  const daily = state.daily.map((q, i) => (i === index ? { id: next.id, progress: 0, done: false } : q));
  return { ok: true, state: { ...state, daily, rerolls: state.rerolls + 1 } };
}

function questGain(def: QuestDef, m: { win: boolean; card: Card; newDay: boolean }): number {
  if (def.metric === "play") return 1;
  if (def.metric === "win") return m.win ? 1 : 0;
  if (def.metric === "days") return m.newDay ? 1 : 0;
  return (m.card[def.metric as Category] ?? 0) > 0 ? 1 : 0;
}

/* --------------------------------------------------------------- matches --------------------------------------------------------------- */

const filled = (card: Card) => categories.filter((c) => card[c] !== undefined).length;

export type MatchOutcome = { state: EconState; grants: Grant[]; countable: boolean; rewarded: boolean; position: number | null; reason: string };

/**
 * Apply one finished match to a player's economy state. Pure and deterministic; the caller makes the
 * whole result durable in one transaction keyed by the match id (a second call is never made for the
 * same match id — the store checks first).
 */
export function applyMatch(prev: EconState, input: RewardInput, account: { userId: string; createdAt: number }): MatchOutcome {
  let state = rollover(prev, account.userId, input.endedAt);
  const grants: Grant[] = [];
  const completed = input.endReason === "completed";
  const ownForfeit = !completed && input.outcome === "loss";
  const oppForfeit = !completed && input.outcome === "win";
  const countable = completed || (oppForfeit && filled(input.card) >= ECONOMY.forfeitCompletionMinCategories);
  if (input.kind === "random" && (ownForfeit || !countable)) state = { ...state, streak: 0 };
  if (!countable) return { state, grants, countable: false, rewarded: false, position: null, reason: ownForfeit ? "own-forfeit" : "too-short" };

  const win = input.outcome === "win";
  /* coins */
  let rewarded = true;
  let reason = "ok";
  if (input.kind === "friend" && state.friend >= ECONOMY.daily.friendRewarded) [rewarded, reason] = [false, "friend-cap"];
  const opp = input.kind === "random" ? input.opponentUserId : undefined;
  if (rewarded && opp && (state.opp[opp] ?? 0) >= ECONOMY.daily.sameOpponentRewarded) [rewarded, reason] = [false, "same-opponent-cap"];
  let position: number | null = null;
  if (rewarded) {
    position = state.rewarded + 1;
    state = { ...state, rewarded: position, friend: state.friend + (input.kind === "friend" ? 1 : 0), opp: opp ? { ...state.opp, [opp]: (state.opp[opp] ?? 0) + 1 } : state.opp };
    const mode = ECONOMY.match[input.kind];
    let coins = 0;
    if (position <= ECONOMY.daily.fullMatches) {
      coins = mode.complete + (completed ? (win ? mode.win : input.outcome === "draw" ? mode.draw : 0) : 0);
      if (input.endedAt < account.createdAt + ECONOMY.newUser.boostDays * 86_400_000) coins += ECONOMY.newUser.boostPerMatch;
      for (const ev of ECONOMY.events) if (input.endedAt >= ev.start && input.endedAt < ev.end) coins += ev.perMatch;
    } else if (position <= ECONOMY.daily.reducedUntil) coins = ECONOMY.daily.reducedCoins;
    else reason = "daily-cap";
    if (coins > 0) grants.push({ key: `m:${input.matchId}`, kind: "match", coins, gems: 0, label: input.kind === "ai" ? "AI 대전 완료" : input.kind === "friend" ? "친구 대전 완료" : "무작위 대전 완료" });
    // events: completion reward after N rewarded matches inside the window
    for (const ev of ECONOMY.events) {
      if (input.endedAt < ev.start || input.endedAt >= ev.end) continue;
      const cur = state.events[ev.id] ?? { matches: 0, paid: false };
      const next = { matches: cur.matches + 1, paid: cur.paid };
      if (!cur.paid && next.matches >= ev.minMatches) {
        next.paid = true;
        grants.push({ key: `e:${ev.id}`, kind: "event", coins: ev.reward.coins, gems: ev.reward.gems, label: ev.label });
      }
      state = { ...state, events: { ...state.events, [ev.id]: next } };
    }
  }

  /* quests (also beyond the coin cap) */
  const newDay = state.lastPlayDay !== state.day;
  const weekDays = newDay && !state.weekDays.includes(state.day) ? [...state.weekDays, state.day] : state.weekDays;
  state = { ...state, lastPlayDay: state.day, weekDays };
  const progress = (slots: QuestSlot[], period: "daily" | "weekly", periodKey: number) =>
    slots.map((slot, i) => {
      if (slot.done) return slot;
      const def = questById(slot.id)!;
      const p = Math.min(def.count, slot.progress + questGain(def, { win, card: input.card, newDay }));
      const done = p >= def.count;
      if (done) {
        const c = period === "daily" ? ECONOMY.quests.dailyCoins[i] : ECONOMY.quests.weeklyCoins[i];
        const g = period === "daily" ? ECONOMY.quests.dailyGems[i] : ECONOMY.quests.weeklyGems[i];
        grants.push({ key: `q:${period}:${periodKey}:${slot.id}`, kind: "quest", coins: c, gems: g, label: `${period === "daily" ? "일일" : "주간"} 퀘스트 · ${def.label}` });
      }
      return { ...slot, progress: p, done };
    });
  state = { ...state, daily: progress(state.daily, "daily", state.day), weekly: progress(state.weekly, "weekly", state.week) };
  let dailyQuestCompleted = false;
  if (!state.dailyAll && state.daily.every((q) => q.done)) {
    state = { ...state, dailyAll: true };
    dailyQuestCompleted = true;
    grants.push({ key: `qb:daily:${state.day}`, kind: "quest-bonus", ...ECONOMY.quests.dailyAllBonus, label: "일일 퀘스트 모두 완료" });
  }
  if (!state.weeklyAll && state.weekly.every((q) => q.done)) {
    state = { ...state, weeklyAll: true };
    grants.push({ key: `qb:weekly:${state.week}`, kind: "quest-bonus", ...ECONOMY.quests.weeklyAllBonus, label: "주간 퀘스트 모두 완료" });
  }

  /* achievement counters (≤ 40 matches a day; play days and daily quests are always counted) */
  const c = { ...state.counters };
  let mask = state.yachtFaceMask;
  if (newDay) c.days = (c.days ?? 0) + 1;
  if (dailyQuestCompleted) c.dailyQuests = (c.dailyQuests ?? 0) + 1;
  let streak = state.streak;
  if (input.kind === "random") streak = win ? streak + 1 : 0;
  c.streak = Math.max(c.streak ?? 0, streak);
  if (state.achMatches < ECONOMY.daily.achievementMatches) {
    const add = (k: string, n = 1) => (c[k] = (c[k] ?? 0) + n);
    add("match");
    if (win) add("win");
    for (const cat of ["yacht", "large", "full"] as const) if ((input.card[cat] ?? 0) > 0) add(cat);
    c.best = Math.max(c.best ?? 0, input.score);
    if (input.score >= 200) add("t200");
    if (completed && categories.every((cat) => (input.card[cat] ?? 0) > 0)) add("noZero");
    if (input.card.sixes === 30) add("sixes30");
    const st = input.stats;
    if (st) {
      if (st.comeback30 && win) add("comeback30");
      if (st.firstRollYachts > 0) add("firstRollYacht", st.firstRollYachts);
      if (st.firstRollYachts >= 2) add("firstRollYacht2");
      if (st.firstRollLarge > 0) add("firstRollLarge", st.firstRollLarge);
      if (st.finalRoundYacht) add("finalRoundYacht");
      for (const f of st.yachtFaces) if (f >= 1 && f <= 6) mask |= 1 << (f - 1);
    }
    c.yachtFaces = popcount(mask);
    state = { ...state, achMatches: state.achMatches + 1 };
  }
  state = { ...state, counters: c, yachtFaceMask: mask, streak };
  const unlocked = unlockAchievements(state);
  return { state: unlocked.state, grants: [...grants, ...unlocked.grants], countable: true, rewarded: rewarded && position !== null && position <= ECONOMY.daily.reducedUntil, position, reason };
}

const popcount = (n: number) => {
  let c = 0;
  for (let x = n; x; x &= x - 1) c++;
  return c;
};

/** Unlock every achievement whose counter reached its threshold (each once, by id). */
export function unlockAchievements(state: EconState): { state: EconState; grants: Grant[] } {
  const grants: Grant[] = [];
  const have = new Set(state.achievements);
  for (const a of ACHIEVEMENTS) {
    if (have.has(a.id) || (state.counters[a.key] ?? 0) < a.count) continue;
    have.add(a.id);
    grants.push({ key: `a:${a.id}`, kind: "achievement", coins: a.coins, gems: a.gems, label: `업적 · ${a.label}`, ...(a.item ? { item: a.item } : {}) });
  }
  return grants.length ? { state: { ...state, achievements: [...have] }, grants } : { state, grants };
}

/** Sanity check of a stored state (corrupt JSON must never crash the account): fall back to a fresh one. */
export function loadEconState(raw: string | null | undefined, userId: string, now: number): EconState {
  if (!raw) return newEconState(userId, now);
  try {
    const s = JSON.parse(raw) as EconState;
    if (s?.v !== 1 || !Array.isArray(s.daily) || !Array.isArray(s.weekly) || typeof s.counters !== "object") return newEconState(userId, now);
    return rollover(s, userId, now);
  } catch {
    return newEconState(userId, now);
  }
}

/* ----------------------------------------------------------- match statistics ----------------------------------------------------------- */

type LogEvent =
  | { type: "turnStarted"; playerId: string; round: number }
  | { type: "diceRolled"; playerId: string; dice: number[]; roll: number }
  | { type: "categoryScored"; playerId: string; category: Category; points: number; dice: number[] }
  | { type: string; [k: string]: unknown };

const isYacht = (d: number[]) => d.length === 5 && d.every((v) => v === d[0]);
const isLarge = (d: number[]) => {
  const s = [...d].sort().join("");
  return s === "12345" || s === "23456";
};

/**
 * Roll-level facts of a finished match for one player, computed by the room from its own authoritative
 * event log at the end of the match (no per-roll storage, nothing taken from the client).
 */
export function matchStats(log: readonly LogEvent[], playerId: string, opponentId: string | null, winners: readonly string[]): MatchStats {
  const out: MatchStats = { firstRollYachts: 0, firstRollLarge: 0, finalRoundYacht: false, yachtFaces: [], comeback30: false };
  let round = 0;
  const totals: Record<string, number> = {};
  const counts: Record<string, number> = {};
  let checked = false;
  for (const e of log) {
    if (e.type === "turnStarted" && (e as { playerId: string }).playerId === playerId) round = (e as { round: number }).round;
    if (e.type === "diceRolled" && (e as { playerId: string }).playerId === playerId && (e as { roll: number }).roll === 1) {
      const dice = (e as { dice: number[] }).dice;
      if (isYacht(dice)) out.firstRollYachts++;
      if (isLarge(dice)) out.firstRollLarge++;
    }
    if (e.type === "categoryScored") {
      const ev = e as { playerId: string; category: Category; points: number; dice: number[] };
      totals[ev.playerId] = (totals[ev.playerId] ?? 0) + ev.points;
      counts[ev.playerId] = (counts[ev.playerId] ?? 0) + 1;
      if (ev.playerId === playerId && ev.category === "yacht" && ev.points === 50) {
        out.yachtFaces.push(ev.dice[0]);
        if (round === 12) out.finalRoundYacht = true;
      }
      // After round 9 of both players (upper bonus not included — same as the research definition).
      if (!checked && opponentId && counts[playerId] === 9 && counts[opponentId] === 9) {
        checked = true;
        if ((totals[opponentId] ?? 0) - (totals[playerId] ?? 0) >= 30) out.comeback30 = winners.length === 1 && winners[0] === playerId;
      }
    }
  }
  return out;
}
