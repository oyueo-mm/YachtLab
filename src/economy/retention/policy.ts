/**
 * C5 retention rewards: attendance, daily play, activity streak, and the weekly best win streak.
 * Research prototype. It is not active, nothing imports it into the Worker, and it grants nothing.
 *
 * The functions are pure and deterministic. They read the server clock's economy day/week (KST,
 * `economyDay`/`economyWeek`) and return the new state plus `RetentionGrant`s. A grant only says
 * what to pay. The caller turns it into a `GrantRequest` for the reward grant engine
 * (worker/src/grants.ts), which writes the existing ledger. Grant transaction ids are deterministic,
 * so a retried or replayed call can never pay twice.
 *
 * Amounts are candidates (docs/economy/C5-RETENTION-RESEARCH.md). The owner approves them before
 * anything goes live (D-C5-1). `RETENTION_ACTIVE` stays false until that approval and a separate
 * high-risk release.
 */
import { economyDay, economyWeek } from "../live/config";
import type { MatchOutcome, RewardInput } from "../live/rewards";

export const RETENTION_ACTIVE = false as const;

export type Amount = { coins: number; gems: number };
export type AttendancePolicy = {
  id: string;
  /** Reward for the n-th claim of a cycle (index 0 = day 1). A cycle ends after the last entry. */
  rewards: readonly Amount[];
};
export type DailyPlayPolicy = {
  id: string;
  /** The first `matches` eligible matches of a KST day each pay `perMatch` coins. */
  matches: number;
  perMatch: number;
  /** Paid once when all `matches` are done. */
  completion: Amount;
};
export type Milestone = { days: number; coins: number; gems: number; /** Proposed non-sale title (new id, not in the catalog yet). */ title?: string };
export type ActivityPolicy = {
  id: string;
  /** Each milestone is paid once per account, ever. Breaking a streak and restarting pays nothing again. */
  milestones: readonly Milestone[];
  /** Missed days per Monday-based week that do not break the streak (they are not counted as active). */
  restDaysPerWeek: number;
  /** Optional repeating chest: every `every` active streak days, after the last lifetime milestone is not required. */
  repeat?: { every: number; coins: number; gems: number } | null;
};
export type WeeklyStreakPolicy = {
  id: string;
  /** Paid once per week for the best quick-match streak of that week, by tier. */
  tiers: readonly { streak: number; coins: number; gems: number }[];
};
export type ReturnPolicy = { id: string; minAbsentDays: number; reward: Amount; cooldownDays: number };
export type RetentionPolicy = {
  version: string;
  attendance: AttendancePolicy | null;
  dailyPlay: DailyPlayPolicy | null;
  activity: ActivityPolicy | null;
  weeklyStreak: WeeklyStreakPolicy | null;
  /** Future-update candidates, simulated only. */
  returnBonus?: ReturnPolicy | null;
};

const a = (coins: number, gems = 0): Amount => ({ coins, gems });

/* ------------------------------------------------------------- candidates ------------------------------------------------------------- */

export const ATTENDANCE: Record<string, AttendancePolicy> = {
  /** The owner's starting proposal: 200 coins and 3 gems per 7 claims. */
  "ATT-200": { id: "ATT-200", rewards: [a(10), a(15), a(20), a(25), a(30), a(40), a(60, 3)] },
  /** Lighter: 120 coins and 3 gems. */
  "ATT-120": { id: "ATT-120", rewards: [a(10), a(10), a(15), a(15), a(20), a(20), a(30, 3)] },
  /** Flat: 15 each day, the 7th 40 + 3 gems = 130 coins and 3 gems. */
  "ATT-FLAT": { id: "ATT-FLAT", rewards: [a(15), a(15), a(15), a(15), a(15), a(15), a(40, 3)] },
  /** Generous: 300 coins and 5 gems. */
  "ATT-300": { id: "ATT-300", rewards: [a(20), a(25), a(30), a(35), a(40), a(50), a(100, 5)] },
  /** Recommended (C5): 150 coins and 3 gems, weighted to the 7th claim. */
  "ATT-150": { id: "ATT-150", rewards: [a(10), a(10), a(15), a(15), a(20), a(20), a(60, 3)] },
};

export const DAILY_PLAY: Record<string, DailyPlayPolicy> = {
  "DP-2x5": { id: "DP-2x5", matches: 2, perMatch: 5, completion: a(5) },
  /** The owner's starting proposal: 3 × 5 + 10 = 25 coins a day. */
  "DP-3x5": { id: "DP-3x5", matches: 3, perMatch: 5, completion: a(10) },
  "DP-3x3": { id: "DP-3x3", matches: 3, perMatch: 3, completion: a(6) },
  "DP-5x4": { id: "DP-5x4", matches: 5, perMatch: 4, completion: a(10) },
  /** Recommended (C5): 3 matches, the reward only at completion (15 coins). Overlaps less with quests. */
  "DP-3c15": { id: "DP-3c15", matches: 3, perMatch: 0, completion: a(15) },
};

const MILESTONES_FULL: readonly Milestone[] = [
  { days: 3, coins: 30, gems: 0 },
  { days: 7, coins: 60, gems: 2 },
  { days: 14, coins: 100, gems: 3 },
  { days: 30, coins: 200, gems: 5, title: "title.streak30" },
  { days: 100, coins: 400, gems: 10, title: "title.streak100" },
  { days: 180, coins: 500, gems: 15 },
  { days: 365, coins: 1000, gems: 30, title: "title.streak365" },
];
export const ACTIVITY: Record<string, ActivityPolicy> = {
  /** Lifetime milestones, no rest day. */
  "ACT-STRICT": { id: "ACT-STRICT", milestones: MILESTONES_FULL, restDaysPerWeek: 0 },
  /** Lifetime milestones, one free rest day per week (recommended shape). */
  "ACT-REST1": { id: "ACT-REST1", milestones: MILESTONES_FULL, restDaysPerWeek: 1 },
  /** Two rest days per week. */
  "ACT-REST2": { id: "ACT-REST2", milestones: MILESTONES_FULL, restDaysPerWeek: 2 },
  /** Rest day + a repeating 7-day chest (keeps paying after the lifetime milestones). */
  "ACT-REPEAT": { id: "ACT-REPEAT", milestones: MILESTONES_FULL, restDaysPerWeek: 1, repeat: { every: 7, coins: 30, gems: 0 } },
};

export const WEEKLY_STREAK: Record<string, WeeklyStreakPolicy> = {
  /** STREAK-REVIEW-2026-11-27 option D. */
  "WS-15-30-50": { id: "WS-15-30-50", tiers: [{ streak: 3, coins: 15, gems: 0 }, { streak: 5, coins: 30, gems: 0 }, { streak: 8, coins: 50, gems: 0 }] },
  /** Smaller tiers: 3/5/8 wins → 10/20/30 coins a week. */
  "WS-10-20-30": { id: "WS-10-20-30", tiers: [{ streak: 3, coins: 10, gems: 0 }, { streak: 5, coins: 20, gems: 0 }, { streak: 8, coins: 30, gems: 0 }] },
};

export const RETURN: Record<string, ReturnPolicy> = {
  "RET-14": { id: "RET-14", minAbsentDays: 14, reward: a(150, 5), cooldownDays: 60 },
};

/* ---------------------------------------------------------------- state ---------------------------------------------------------------- */

export type RetentionState = {
  v: 1;
  /** Attendance: claims in the current cycle (0..length-1), cycle counter, last claimed KST day. */
  att: { cycle: number; claimed: number; lastDay: number; total: number };
  /** Daily play of `day`. */
  dp: { day: number; counted: number; paid: boolean };
  /** Activity streak. `rest` = rest days used in `restWeek`. */
  act: { current: number; best: number; lastDay: number; restWeek: number; rest: number; paid: number[]; repeatPaid: number };
  /** Weekly best quick-match streak (separate from the achievement counter `streak`). */
  ws: { week: number; current: number; best: number; paidCoins: number; paidTiers: number[]; opps: string[] };
  /** Return bonus: last paid day. */
  ret: { lastPaidDay: number };
};

export const newRetentionState = (): RetentionState => ({
  v: 1,
  att: { cycle: 0, claimed: 0, lastDay: -1, total: 0 },
  dp: { day: -1, counted: 0, paid: false },
  act: { current: 0, best: 0, lastDay: -1, restWeek: -1, rest: 0, paid: [], repeatPaid: 0 },
  ws: { week: -1, current: 0, best: 0, paidCoins: 0, paidTiers: [], opps: [] },
  ret: { lastPaidDay: -1 },
});

export type RetentionSource = "attendance" | "daily-play" | "activity-streak" | "weekly-streak" | "return";
export type RetentionGrant = { txId: string; source: RetentionSource; coins: number; gems: number; label: string; policy: string; title?: string };
export type Step = { state: RetentionState; grants: RetentionGrant[]; reason: string };

/* ------------------------------------------------------------- attendance ------------------------------------------------------------- */

/**
 * One claim per account per KST day. Missing days never resets progress. After the last reward of a
 * cycle, the next claim starts a new cycle at day 1. The tx id `att:<cycle>:<n>` is unique per claim,
 * and `att-day:<day>` (checked by the caller as an extra guard) blocks a second claim on the same day.
 */
export function claimAttendance(state: RetentionState, policy: AttendancePolicy, now: number): Step {
  const day = economyDay(now);
  if (state.att.lastDay === day) return { state, grants: [], reason: "already-claimed" };
  if (state.att.lastDay > day) return { state, grants: [], reason: "clock-behind" };
  const n = state.att.claimed;
  const r = policy.rewards[n];
  const last = n + 1 >= policy.rewards.length;
  const att = last ? { cycle: state.att.cycle + 1, claimed: 0, lastDay: day, total: state.att.total + 1 } : { ...state.att, claimed: n + 1, lastDay: day, total: state.att.total + 1 };
  return {
    state: { ...state, att },
    grants: [{ txId: `att:${state.att.cycle}:${n + 1}`, source: "attendance", coins: r.coins, gems: r.gems, label: `출석 ${n + 1}일차`, policy: policy.id }],
    reason: "ok",
  };
}

/* -------------------------------------------------------------- matches -------------------------------------------------------------- */

/**
 * A match counts for daily play only when the server verified it and it was played out (12 rounds),
 * it did not hit a mode cap (friend daily cap, same-opponent cap), and it was not my own forfeit.
 * Wins, losses and draws count the same. An opponent's forfeit does not count (a quick forfeit by a
 * second account must not complete my daily play).
 */
export function dailyPlayEligible(input: Pick<RewardInput, "endReason">, outcome: Pick<MatchOutcome, "countable" | "reason">) {
  return input.endReason === "completed" && outcome.countable && outcome.reason !== "friend-cap" && outcome.reason !== "same-opponent-cap";
}

export function applyDailyPlay(state: RetentionState, policy: DailyPlayPolicy, eligible: boolean, endedAt: number): Step {
  const day = economyDay(endedAt);
  let dp = state.dp.day === day ? state.dp : { day, counted: 0, paid: false };
  if (!eligible || dp.counted >= policy.matches) return { state: dp === state.dp ? state : { ...state, dp }, grants: [], reason: eligible ? "daily-play-done" : "not-eligible" };
  const k = dp.counted + 1;
  const grants: RetentionGrant[] = [];
  if (policy.perMatch > 0) grants.push({ txId: `dp:${day}:${k}`, source: "daily-play", coins: policy.perMatch, gems: 0, label: `오늘의 경기 ${k}/${policy.matches}`, policy: policy.id });
  dp = { ...dp, counted: k };
  if (k === policy.matches && !dp.paid) {
    dp = { ...dp, paid: true };
    if (policy.completion.coins || policy.completion.gems) grants.push({ txId: `dp:${day}:done`, source: "daily-play", ...policy.completion, label: `오늘의 경기 ${policy.matches}회 완료`, policy: policy.id });
  }
  return { state: { ...state, dp }, grants, reason: "ok" };
}

/**
 * Activity streak: a KST day is active when the account had an eligible match (or, later, a completed
 * daily content, reported by its owner through the same function). Call once per active day (repeat
 * calls on the same day are no-ops). A gap is bridged by unused rest days of the weeks it spans.
 */
export function markActiveDay(state: RetentionState, policy: ActivityPolicy, now: number): Step {
  const day = economyDay(now);
  const s = state.act;
  if (s.lastDay === day) return { state, grants: [], reason: "already-active" };
  if (s.lastDay > day) return { state, grants: [], reason: "clock-behind" };
  let current = 1;
  let restWeek = s.restWeek;
  let rest = s.rest;
  if (s.lastDay >= 0) {
    const missed = day - s.lastDay - 1;
    if (missed === 0) current = s.current + 1;
    else {
      // every missed day must fit into its own week's rest budget
      let ok = policy.restDaysPerWeek > 0;
      let w = restWeek;
      let used = rest;
      for (let d = s.lastDay + 1; ok && d < day; d++) {
        const wk = Math.floor((d + 3) / 7);
        if (wk !== w) [w, used] = [wk, 0];
        used++;
        if (used > policy.restDaysPerWeek) ok = false;
      }
      if (ok) [current, restWeek, rest] = [s.current + 1, w, used];
    }
  }
  const best = Math.max(s.best, current);
  const grants: RetentionGrant[] = [];
  const paid = [...s.paid];
  for (const m of policy.milestones) {
    if (current >= m.days && !paid.includes(m.days)) {
      paid.push(m.days);
      grants.push({ txId: `act:m${m.days}`, source: "activity-streak", coins: m.coins, gems: m.gems, label: `연속 활동 ${m.days}일`, policy: policy.id, ...(m.title ? { title: m.title } : {}) });
    }
  }
  let repeatPaid = s.repeatPaid;
  if (policy.repeat && current % policy.repeat.every === 0) {
    repeatPaid++;
    grants.push({ txId: `act:r:${day}`, source: "activity-streak", coins: policy.repeat.coins, gems: policy.repeat.gems, label: `연속 활동 ${current}일 상자`, policy: policy.id });
  }
  return { state: { ...state, act: { current, best, lastDay: day, restWeek, rest, paid, repeatPaid } }, grants, reason: "ok" };
}

/**
 * Weekly best quick-match streak (STREAK-REVIEW-2026-11-27 rules):
 *  - quick match (`random`) only; friend, AI, solo and multiplayer matches never touch it
 *  - a completed win against an opponent not yet beaten in this run: +1
 *  - a draw, a win by the opponent's forfeit, or a repeat win against the same opponent: no change
 *  - a loss or my own forfeit/timeout: reset to 0
 * Each week starts at 0. A week pays the amount of its highest tier (e.g. 50 for 8 wins), paid in
 * steps as tiers are reached (15, then +15, then +20) and kept even if the streak breaks later.
 */
export function applyWeeklyStreak(state: RetentionState, policy: WeeklyStreakPolicy, input: Pick<RewardInput, "kind" | "outcome" | "endReason" | "opponentUserId" | "endedAt">): Step {
  if (input.kind !== "random") return { state, grants: [], reason: "not-quick-match" };
  const week = economyWeek(input.endedAt);
  let ws = state.ws.week === week ? state.ws : { week, current: 0, best: 0, paidCoins: 0, paidTiers: [], opps: [] };
  const completed = input.endReason === "completed";
  if (input.outcome === "loss") ws = { ...ws, current: 0, opps: [] };
  else if (input.outcome === "win" && completed) {
    const opp = input.opponentUserId ?? `guest:${input.endedAt}`;
    if (!ws.opps.includes(opp)) ws = { ...ws, current: ws.current + 1, opps: [...ws.opps, opp] };
  }
  ws = { ...ws, best: Math.max(ws.best, ws.current) };
  const grants: RetentionGrant[] = [];
  const paidTiers = [...ws.paidTiers];
  let paidCoins = ws.paidCoins;
  for (const t of policy.tiers) {
    if (ws.best < t.streak || paidTiers.includes(t.streak)) continue;
    paidTiers.push(t.streak);
    const coins = Math.max(0, t.coins - paidCoins);
    paidCoins += coins;
    if (coins || t.gems) grants.push({ txId: `ws:${week}:${t.streak}`, source: "weekly-streak", coins, gems: t.gems, label: `이번 주 최고 ${t.streak}연승`, policy: policy.id });
  }
  return { state: { ...state, ws: { ...ws, paidTiers, paidCoins } }, grants, reason: "ok" };
}

/** Return bonus (future candidate): the first active day after `minAbsentDays` without one. */
export function applyReturn(state: RetentionState, policy: ReturnPolicy, previousActiveDay: number, now: number): Step {
  const day = economyDay(now);
  if (previousActiveDay < 0 || day - previousActiveDay <= policy.minAbsentDays) return { state, grants: [], reason: "not-returning" };
  if (state.ret.lastPaidDay >= 0 && day - state.ret.lastPaidDay < policy.cooldownDays) return { state, grants: [], reason: "cooldown" };
  return {
    state: { ...state, ret: { lastPaidDay: day } },
    grants: [{ txId: `ret:${day}`, source: "return", ...policy.reward, label: "다시 오신 것을 환영해요", policy: policy.id }],
    reason: "ok",
  };
}

/** Everything one finished match does to retention state (the caller passes the live reward outcome). */
export function applyRetentionMatch(state: RetentionState, policy: RetentionPolicy, input: RewardInput, outcome: Pick<MatchOutcome, "countable" | "reason">): Step {
  let s = state;
  const grants: RetentionGrant[] = [];
  const eligible = dailyPlayEligible(input, outcome);
  if (policy.dailyPlay) {
    const r = applyDailyPlay(s, policy.dailyPlay, eligible, input.endedAt);
    s = r.state;
    grants.push(...r.grants);
  }
  if (policy.activity && eligible) {
    const r = markActiveDay(s, policy.activity, input.endedAt);
    s = r.state;
    grants.push(...r.grants);
  }
  if (policy.weeklyStreak) {
    const r = applyWeeklyStreak(s, policy.weeklyStreak, input);
    s = r.state;
    grants.push(...r.grants);
  }
  return { state: s, grants, reason: "ok" };
}

/* ------------------------------------------------------------- packages ------------------------------------------------------------- */

export const PACKAGES: Record<string, RetentionPolicy> = {
  BASE: { version: "R0", attendance: null, dailyPlay: null, activity: null, weeklyStreak: null },
  /** Every starting proposal of the brief at once. */
  "PROPOSAL-ALL": { version: "R-PROP@0", attendance: ATTENDANCE["ATT-200"], dailyPlay: DAILY_PLAY["DP-3x5"], activity: ACTIVITY["ACT-REST1"], weeklyStreak: WEEKLY_STREAK["WS-15-30-50"] },
  /** Light package: attendance + activity streak only. */
  LITE: { version: "R-LITE@0", attendance: ATTENDANCE["ATT-120"], dailyPlay: null, activity: ACTIVITY["ACT-REST1"], weeklyStreak: null },
  /** C5 recommendation, step 1 (pending approval): attendance + activity streak + weekly best streak. */
  "C5-CORE": { version: "R-C5-CORE@0", attendance: ATTENDANCE["ATT-150"], dailyPlay: null, activity: ACTIVITY["ACT-REST1"], weeklyStreak: WEEKLY_STREAK["WS-15-30-50"] },
  /** C5 step 2 option: step 1 + daily play paid only at 3 completed matches (15 coins). */
  "C5-FULL": { version: "R-C5-FULL@0", attendance: ATTENDANCE["ATT-150"], dailyPlay: DAILY_PLAY["DP-3c15"], activity: ACTIVITY["ACT-REST1"], weeklyStreak: WEEKLY_STREAK["WS-15-30-50"] },
};
