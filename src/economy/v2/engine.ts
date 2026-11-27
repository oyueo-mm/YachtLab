/**
 * Economy v2 research settlement engine — RESEARCH ONLY (never imported by the Worker or the UI).
 *
 * `applyMatchV2` is the live `applyMatch` (src/economy/live/rewards.ts) with every constant read from a
 * `V2Params` object, plus optional research hooks (booster, weekly streak). With `baselineParams()` and
 * no hooks it must return exactly the live grants and state — tests/economy-v2.test.ts checks this on
 * thousands of random matches and on every boundary (k = 10/11/30/31, friend 10, same opponent 3,
 * forfeit 5/6 categories, new-user boost end, KST midnight).
 *
 * Quest assignment, rollover, re-rolls and achievement unlocking are reused from the live module, so the
 * deterministic quest picks are identical.
 */
import { categories, type Card } from "../../engine";
import { ACHIEVEMENTS, economyWeek, questById } from "../live/config";
import { rollover, unlockAchievements, type EconState, type Grant, type QuestSlot, type RewardInput } from "../live/rewards";
import type { V2Params } from "./params";

/** Research-only state next to the live EconState (weekly streak tiers, booster bookkeeping). */
export type V2Ext = { streakWeek: number; streakCur: number; streakBest: number; streakPaid: number; boostDay: number; boostExtraToday: number };
export const newExt = (): V2Ext => ({ streakWeek: -1, streakCur: 0, streakBest: 0, streakPaid: 0, boostDay: -1, boostExtraToday: 0 });

export type BoostCtx = { mult: number; dailyExtraCap: number; day: number; budgetLeft?: number } | null;
export type V2Grant = Grant | { key: string; kind: "booster" | "streak" | "collection"; coins: number; gems: number; label: string };
export type V2Outcome = {
  state: EconState;
  ext: V2Ext;
  grants: V2Grant[];
  countable: boolean;
  rewarded: boolean;
  position: number | null;
  reason: string;
  boostCoins: number;
};

const filled = (card: Card) => categories.filter((c) => card[c] !== undefined).length;
const hiddenIds = new Set(ACHIEVEMENTS.filter((a) => a.hidden).map((a) => a.id));

function questGain(metric: string, m: { win: boolean; card: Card; newDay: boolean }): number {
  if (metric === "play") return 1;
  if (metric === "win") return m.win ? 1 : 0;
  if (metric === "days") return m.newDay ? 1 : 0;
  return ((m.card as Record<string, number | undefined>)[metric] ?? 0) > 0 ? 1 : 0;
}

export function applyMatchV2(prev: EconState, prevExt: V2Ext, input: RewardInput, account: { userId: string; createdAt: number }, p: V2Params, boost: BoostCtx = null): V2Outcome {
  let state = rollover(prev, account.userId, input.endedAt);
  let ext = prevExt;
  const grants: V2Grant[] = [];
  const completed = input.endReason === "completed";
  const ownForfeit = !completed && input.outcome === "loss";
  const oppForfeit = !completed && input.outcome === "win";
  const countable = completed || (oppForfeit && filled(input.card) >= p.forfeitCompletionMinCategories);
  if (input.kind === "random" && (ownForfeit || !countable)) state = { ...state, streak: 0 };
  if (p.streakWeekly && input.kind === "random" && (ownForfeit || !countable)) ext = { ...ext, streakCur: 0 };
  if (!countable) return { state, ext, grants, countable: false, rewarded: false, position: null, reason: ownForfeit ? "own-forfeit" : "too-short", boostCoins: 0 };

  const win = input.outcome === "win";
  let rewarded = true;
  let reason = "ok";
  let boostCoins = 0;
  if (input.kind === "friend" && state.friend >= p.daily.friendRewarded) [rewarded, reason] = [false, "friend-cap"];
  const opp = input.kind === "random" ? input.opponentUserId : undefined;
  if (rewarded && opp && (state.opp[opp] ?? 0) >= p.daily.sameOpponentRewarded) [rewarded, reason] = [false, "same-opponent-cap"];
  let position: number | null = null;
  if (rewarded) {
    position = state.rewarded + 1;
    state = { ...state, rewarded: position, friend: state.friend + (input.kind === "friend" ? 1 : 0), opp: opp ? { ...state.opp, [opp]: (state.opp[opp] ?? 0) + 1 } : state.opp };
    const mode = p.match[input.kind];
    let coins = 0;
    if (position <= p.daily.fullMatches) {
      const base = mode.complete + (completed ? (win ? mode.win : input.outcome === "draw" ? mode.draw : 0) : 0);
      coins = base;
      if (input.endedAt < account.createdAt + p.newUser.boostDays * 86_400_000) coins += p.newUser.boostPerMatch;
      if (boost && boost.mult > 1) {
        if (ext.boostDay !== boost.day) ext = { ...ext, boostDay: boost.day, boostExtraToday: 0 };
        let extra = Math.round(base * (boost.mult - 1));
        extra = Math.max(0, Math.min(extra, boost.dailyExtraCap - ext.boostExtraToday, boost.budgetLeft ?? Infinity));
        if (extra > 0) {
          boostCoins = extra;
          ext = { ...ext, boostExtraToday: ext.boostExtraToday + extra };
        }
      }
    } else if (position <= p.daily.reducedUntil) coins = p.daily.reducedCoins;
    else reason = "daily-cap";
    if (coins > 0) grants.push({ key: `m:${input.matchId}`, kind: "match", coins, gems: 0, label: input.kind === "ai" ? "AI 대전 완료" : input.kind === "friend" ? "친구 대전 완료" : "무작위 대전 완료" });
    if (boostCoins > 0) grants.push({ key: `b:${input.matchId}`, kind: "booster", coins: boostCoins, gems: 0, label: "부스터(연구)" });
  }

  const newDay = state.lastPlayDay !== state.day;
  const weekDays = newDay && !state.weekDays.includes(state.day) ? [...state.weekDays, state.day] : state.weekDays;
  state = { ...state, lastPlayDay: state.day, weekDays };
  const progress = (slots: QuestSlot[], period: "daily" | "weekly", periodKey: number) =>
    slots.map((slot, i) => {
      if (slot.done) return slot;
      const def = questById(slot.id)!;
      const pr = Math.min(def.count, slot.progress + questGain(def.metric, { win, card: input.card, newDay }));
      const done = pr >= def.count;
      if (done) {
        const c = period === "daily" ? p.quests.dailyCoins[i] : p.quests.weeklyCoins[i];
        const g = period === "daily" ? p.quests.dailyGems[i] : p.quests.weeklyGems[i];
        grants.push({ key: `q:${period}:${periodKey}:${slot.id}`, kind: "quest", coins: c, gems: g, label: `${period === "daily" ? "일일" : "주간"} 퀘스트 · ${def.label}` });
      }
      return { ...slot, progress: pr, done };
    });
  state = { ...state, daily: progress(state.daily, "daily", state.day), weekly: progress(state.weekly, "weekly", state.week) };
  let dailyQuestCompleted = false;
  if (!state.dailyAll && state.daily.every((q) => q.done)) {
    state = { ...state, dailyAll: true };
    dailyQuestCompleted = true;
    grants.push({ key: `qb:daily:${state.day}`, kind: "quest-bonus", ...p.quests.dailyAllBonus, label: "일일 퀘스트 모두 완료" });
  }
  if (!state.weeklyAll && state.weekly.every((q) => q.done)) {
    state = { ...state, weeklyAll: true };
    grants.push({ key: `qb:weekly:${state.week}`, kind: "quest-bonus", ...p.quests.weeklyAllBonus, label: "주간 퀘스트 모두 완료" });
  }

  const c = { ...state.counters };
  let mask = state.yachtFaceMask;
  if (newDay) c.days = (c.days ?? 0) + 1;
  if (dailyQuestCompleted) c.dailyQuests = (c.dailyQuests ?? 0) + 1;
  let streak = state.streak;
  if (input.kind === "random") streak = win ? streak + 1 : 0;
  c.streak = Math.max(c.streak ?? 0, streak);
  if (state.achMatches < p.daily.achievementMatches) {
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
    let pc = 0;
    for (let x = mask; x; x &= x - 1) pc++;
    c.yachtFaces = pc;
    state = { ...state, achMatches: state.achMatches + 1 };
  }
  state = { ...state, counters: c, yachtFaceMask: mask, streak };

  /* research hook: weekly best-streak tiers (random queue only, each tier paid once per week).
     The weekly streak starts at 0 every Monday; wins by an opponent's forfeit keep it without adding
     (STREAK-REVIEW §1), draws and losses reset it. */
  if (p.streakWeekly && input.kind === "random") {
    const wk = economyWeek(input.endedAt);
    if (ext.streakWeek !== wk) ext = { ...ext, streakWeek: wk, streakCur: 0, streakBest: 0, streakPaid: 0 };
    const cur = win ? (completed ? ext.streakCur + 1 : ext.streakCur) : 0;
    const best = Math.max(ext.streakBest, cur);
    let paid = ext.streakPaid;
    p.streakWeekly.thresholds.forEach((t, i) => {
      if (i >= paid && best >= t) {
        grants.push({ key: `st:${wk}:${t}`, kind: "streak", coins: p.streakWeekly!.coins[i], gems: 0, label: `주간 ${t}연승` });
        paid = i + 1;
      }
    });
    ext = { ...ext, streakCur: cur, streakBest: best, streakPaid: paid };
  }

  const unlocked = unlockAchievements(state);
  const ach = unlocked.grants.map((g) =>
    p.achievementMult === 1 || hiddenIds.has(g.key.slice(2)) ? g : { ...g, coins: Math.round(g.coins * p.achievementMult), gems: Math.round(g.gems * p.achievementMult) },
  );
  return { state: unlocked.state, ext, grants: [...grants, ...ach], countable: true, rewarded: rewarded && position !== null && position <= p.daily.reducedUntil, position, reason, boostCoins };
}

/** Welcome grant (once per account) under a candidate. */
export const welcomeGrant = (p: V2Params): V2Grant => ({ key: "welcome", kind: "welcome", coins: p.newUser.coins, gems: p.newUser.gems, label: "신규 회원 보상" });
