/**
 * YachtLab economy simulator (research only — grants nothing in the game).
 *
 * Agent-based, day-step, fully deterministic for a given seed. Each user is simulated independently
 * (no trading/gifting exists by policy, so users do not interact economically). Match outcomes use
 * per-match event probabilities measured from real engine games (src/economy/data/match-events.json).
 *
 * Trust boundary: only server-verified modes can grant official currency (MODE_TRUST). The counterfactual
 * model M0 ignores this on purpose to measure what client-record trust would cost.
 */
import { ACHIEVEMENTS, QUESTS, SIM_EVENT_KEYS, eventProbability, type EventKey, type TierId, type QuestDef } from "./content";
import { MODES, MODE_TRUST, type EconomyModel, type Mode } from "./models";
import type { Persona } from "./personas";
import { upgradeCosts, type CatalogItem, type SlotConfig, type UpgradeConfig } from "./pricing";
import { binomial, hashSeed, mulberry32, negBinomial, pickWeighted, type Rng } from "./rng";

export const SOURCES = ["match", "quest_daily", "quest_weekly", "quest_monthly", "achievement", "event", "new_user", "purchase"] as const;
export type Source = (typeof SOURCES)[number];
export const SOURCE_LABEL: Record<Source, string> = { match: "경기", quest_daily: "일일 퀘스트", quest_weekly: "주간 퀘스트", quest_monthly: "월간 도전", achievement: "업적", event: "특별 이벤트", new_user: "신규 사용자", purchase: "현금 구매" };
export const SINKS = ["item", "upgrade", "slot"] as const;
export type Sink = (typeof SINKS)[number];

export type SimContext = {
  model: EconomyModel;
  catalog: CatalogItem[];
  upgrade: UpgradeConfig;
  slots: SlotConfig;
  /** Coin value of one gem for "either" choices and purchasing-power metrics. */
  gemValueInCoins: number;
  /** Win rate per mode (assumption; skill-matched random queue ≈ 0.5). */
  winRate: Record<Mode, number>;
  /** Reference achievement gem reward per achievement id. */
  achievementGems: Record<string, number>;
  spending: boolean;
  /** Daily quest pool reroll: one hard quest may be swapped for a medium one. */
  forceF2P?: boolean;
  forceLoggedIn?: boolean;
  /** Multiplier on activity (sensitivity). */
  activityMultiplier?: number;
};
export const DEFAULT_WIN_RATE: Record<Mode, number> = { online_random: 0.5, online_friend: 0.5, server_ai: 0.55, local_ai: 0.6, local_pvp: 0.5 };

export type UserResult = {
  persona: string;
  tier: TierId;
  loggedIn: boolean;
  payer: boolean;
  lifetime: number;
  activeDays: number;
  /** Days with at least one reward-eligible (server-verified, logged-in) match. */
  verifiedDays: number;
  matches: number;
  matchesByMode: Record<Mode, number>;
  rewardedMatches: number;
  coinsBySource: Record<Source, number>;
  gemsBySource: Record<Source, number>;
  coinsSpent: Record<Sink, number>;
  gemsSpent: Record<Sink, number>;
  coins: number;
  gems: number;
  /** Day of first purchase of each rarity (−1 if never) and the cumulative matches at that point. */
  firstRarityDay: number[];
  firstRarityMatches: number[];
  ownedByRarity: number[];
  maxedItems: number;
  firstMaxUpgradeDay: number;
  firstMythicMaxDay: number;
  achievements: string[];
  achievementDay: Record<string, number>;
  dailyQuestsDone: number;
  emoteSlots: number;
  chatSlots: number;
  checkpoints: Record<number, { coins: number; gems: number; earnedCoins: number; earnedGems: number; owned: number }>;
  daily?: { coinsEarned: Float32Array; gemsEarned: Float32Array; coinsSpent: Float32Array; gemsSpent: Float32Array; matches: Uint16Array; rewarded: Uint16Array; purchases: Uint8Array; byMode: Uint16Array[] };
};

const zeroRec = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
const DAILY_BY_DIFF = [0, 1, 2].map((d) => QUESTS.filter((q) => q.period === "daily" && q.difficulty === d));
const WEEKLY_BY_DIFF = [0, 1, 2].map((d) => QUESTS.filter((q) => q.period === "weekly" && q.difficulty === d));
const EXTRA_KEYS: EventKey[] = ["t300", "t310", "perfect323", "firstRollYacht2", "firstRollYacht3"];
const KEYS: EventKey[] = [...SIM_EVENT_KEYS, ...EXTRA_KEYS];
const KEY_INDEX = new Map(KEYS.map((k, i) => [k, i]));

function pickTier(r: Rng, persona: Persona): TierId {
  return pickWeighted(r, persona.tier) as TierId;
}

export function simulateUser(ctx: SimContext, persona: Persona, userIndex: number, days: number, seed: number, opts: { lifetime?: number; recordDaily?: boolean; checkpoints?: number[] } = {}): UserResult {
  const r = mulberry32(hashSeed(seed, persona.id, userIndex));
  const { model } = ctx;
  const tier = pickTier(r, persona);
  const loggedIn = ctx.forceLoggedIn ?? r() < persona.loggedInShare;
  const payer = !ctx.forceF2P && persona.payer !== null;
  const lifetime = Math.min(days, opts.lifetime ?? days);
  const pByKey = KEYS.map((k) => (k === "win" ? 0 : eventProbability(tier, k, 0.5)));
  const res: UserResult = {
    persona: persona.id, tier, loggedIn, payer, lifetime, activeDays: 0, verifiedDays: 0, matches: 0, matchesByMode: zeroRec(MODES), rewardedMatches: 0,
    coinsBySource: zeroRec(SOURCES), gemsBySource: zeroRec(SOURCES), coinsSpent: zeroRec(SINKS), gemsSpent: zeroRec(SINKS), coins: 0, gems: 0,
    firstRarityDay: [-1, -1, -1, -1, -1], firstRarityMatches: [-1, -1, -1, -1, -1], ownedByRarity: [0, 0, 0, 0, 0], maxedItems: 0, firstMaxUpgradeDay: -1, firstMythicMaxDay: -1,
    achievements: [], achievementDay: {}, dailyQuestsDone: 0, emoteSlots: ctx.slots.emoteBase, chatSlots: ctx.slots.chatBase, checkpoints: {},
  };
  if (opts.recordDaily) {
    res.daily = { coinsEarned: new Float32Array(lifetime), gemsEarned: new Float32Array(lifetime), coinsSpent: new Float32Array(lifetime), gemsSpent: new Float32Array(lifetime), matches: new Uint16Array(lifetime), rewarded: new Uint16Array(lifetime), purchases: new Uint8Array(lifetime), byMode: MODES.map(() => new Uint16Array(lifetime)) };
  }
  const counters = new Float64Array(KEYS.length);
  let cWins = 0, cMatches = 0, streak = 0, bestStreak = 0;
  const unlocked = new Set<string>();
  // Items: wanted flags, ownership, level
  const want = ctx.catalog.map((it) => r() < persona.wantByRarity[it.rarity]);
  const level = new Int8Array(ctx.catalog.length); // 0 = not owned, else level
  let ownedEmotes = 8, ownedChats = 10; // current free default set (src/social/catalog.ts)
  let saverTarget = -1;
  const pending: number[] = [], ownedList: number[] = [];
  let nextRelease = 0;
  const price = (it: CatalogItem) => (it.currency === "gem" ? it.gemPrice * ctx.gemValueInCoins : it.coinPrice);
  const checkpoints = new Set(opts.checkpoints ?? []);
  let today = 0;
  let goalCoins = 0, goalGems = 0, goalItem = -1;
  const earn = (coins: number, gems: number, src: Source) => {
    goalCoins += coins * persona.goalShare; goalGems += gems * persona.goalShare;
    if (coins) { res.coins += coins; res.coinsBySource[src] += coins; if (res.daily) res.daily.coinsEarned[today] += coins; }
    if (gems) { res.gems += gems; res.gemsBySource[src] += gems; if (res.daily) res.daily.gemsEarned[today] += gems; }
  };
  const spend = (coins: number, gems: number, sink: Sink) => {
    res.coins -= coins; res.gems -= gems; res.coinsSpent[sink] += coins; res.gemsSpent[sink] += gems;
    if (res.daily) { res.daily.coinsSpent[today] += coins; res.daily.gemsSpent[today] += gems; res.daily.purchases[today]++; }
  };
  const canEarn = (mode: Mode) => loggedIn && (model.counterfactual || MODE_TRUST[mode] === "server-verified");
  if (loggedIn) earn(model.newUser.coins, model.newUser.gems, "new_user");
  // Quests state
  let dailyQ: QuestDef[] = [], weeklyQ: QuestDef[] = [], weeklyDone = [false, false, false], weeklyBonus = false;
  const weekCount = new Float64Array(KEYS.length + 2); // + match, + win
  let weekMatches = 0, weekWins = 0, monthDailyDays = 0, monthAwarded = false;
  let eventMatches = 0, eventAwarded = false;
  const act = ctx.activityMultiplier ?? 1;
  const questCount = (q: QuestDef, matches: number, wins: number, counts: Float64Array) => (q.key === "match" ? matches : q.key === "win" ? wins : counts[KEY_INDEX.get(q.key)!]);

  for (let d = 0; d < lifetime; d++) {
    today = d;
    if (d % 7 === 0) {
      weeklyQ = WEEKLY_BY_DIFF.map((pool) => pool[Math.floor(r() * pool.length)]);
      weeklyDone = [false, false, false]; weeklyBonus = false; weekCount.fill(0); weekMatches = 0; weekWins = 0;
    }
    if (d % 30 === 0) { monthDailyDays = 0; monthAwarded = false; }
    const inEvent = d >= model.events.everyDays && d % model.events.everyDays < model.events.lengthDays;
    if (inEvent && d % model.events.everyDays === 0) { eventMatches = 0; eventAwarded = false; }
    // Payment (monthly decision)
    if (payer && persona.payer && d % 30 === 0 && r() < persona.payer.monthlyPurchaseProb) earn(persona.payer.coinsPerPurchase, persona.payer.gemsPerPurchase, "purchase");

    const active = d === 0 || r() < Math.min(1, persona.activeDayProb * act);
    if (active) {
      res.activeDays++;
      const maxMatches = Math.floor((24 * 60) / persona.minutesPerMatch);
      let n = Math.min(maxMatches, Math.max(1, negBinomial(r, persona.matchesMean * (d === 0 ? 1 : act), persona.matchesShape)));
      dailyQ = DAILY_BY_DIFF.map((pool) => pool[Math.floor(r() * pool.length)]);
      const dayCount = new Float64Array(KEYS.length);
      let dayEligible = 0, dayWins = 0, matchCoinsBase = 0, friendUsed = 0, rewardedToday = 0;
      const playBatch = (count: number, forcedMode?: Mode) => {
        const byMode = zeroRec(MODES);
        for (let i = 0; i < count; i++) byMode[forcedMode ?? (pickWeighted(r, persona.modeMix) as Mode)]++;
        for (const mode of MODES) {
          const k = byMode[mode];
          if (!k) continue;
          res.matches += k; res.matchesByMode[mode] += k;
          if (res.daily) { res.daily.matches[d] += k; res.daily.byMode[MODES.indexOf(mode)][d] += k; }
          if (!canEarn(mode)) continue;
          let eligible = k;
          if (mode === "online_friend") { eligible = Math.min(k, Math.max(0, model.friendDailyLimit - friendUsed)); friendUsed += eligible; }
          if (!eligible) continue;
          const forged = persona.abuse === "forge_local" && mode === "local_ai";
          const wr = forged ? 1 : ctx.winRate[mode];
          let wins = 0;
          if (mode === "online_random" && eligible <= 400) {
            for (let i = 0; i < eligible; i++) { if (r() < wr) { wins++; streak++; if (streak > bestStreak) bestStreak = streak; } else streak = 0; }
          } else wins = binomial(r, eligible, wr);
          const draws = binomial(r, eligible - wins, 0.008);
          rewardedToday += eligible;
          const rw = model.match[mode];
          matchCoinsBase += rw.complete * eligible + rw.win * wins + rw.draw * draws;
          if (rw.quests || rw.achievements) {
            dayEligible += eligible; dayWins += wins;
            for (let j = 0; j < KEYS.length; j++) {
              const p = forged ? Math.max(pByKey[j], 0.5) : KEYS[j] === "comeback30" || KEYS[j] === "tightWin" || KEYS[j] === "winBy100" ? eventProbability(tier, KEYS[j], wr) : pByKey[j];
              if (p > 0) dayCount[j] += binomial(r, eligible, p);
            }
          }
        }
      };
      playBatch(n);
      // Quest chasers play up to 3 extra online matches to finish daily quests (only if they can earn)
      const dailyDone = () => dailyQ.map((q) => questCount(q, dayEligible, dayWins, dayCount) >= q.count);
      if (persona.questChaser && loggedIn) for (let extra = 0; extra < 3 && dailyDone().some((x) => !x); extra++) { playBatch(1, "online_random"); n++; }
      res.rewardedMatches += rewardedToday;
      if (res.daily) res.daily.rewarded[d] = rewardedToday;
      // Match coins with soft cap / hard cap / multipliers
      if (rewardedToday > 0) {
        const S = model.softCapMatches;
        const R = rewardedToday, lim = Math.max(S, model.dailyRewardedMatchLimit);
        const equivalent = Math.min(R, S) + Math.max(0, Math.min(R, lim) - S) * model.afterSoftCap;
        let coins = (matchCoinsBase / R) * equivalent;
        if (d < model.newUser.boostDays) coins *= model.newUser.boostMultiplier;
        if (inEvent) coins *= model.events.coinMultiplier;
        if (model.dailyMatchCoinCap !== null) coins = Math.min(coins, model.dailyMatchCoinCap);
        earn(Math.round(coins), 0, "match");
      }
      // Daily quests (auto-claim, server-side)
      if (loggedIn && dayEligible > 0) {
        const done = dailyDone();
        done.forEach((ok, i) => { if (ok) earn(model.quests.dailyCoins[i], model.quests.dailyGems[i], "quest_daily"); });
        if (done.every(Boolean)) { earn(model.quests.dailyAllBonus.coins, model.quests.dailyAllBonus.gems, "quest_daily"); res.dailyQuestsDone++; monthDailyDays++; }
      }
      // Weekly quests
      weekMatches += dayEligible; weekWins += dayWins;
      for (let j = 0; j < KEYS.length; j++) weekCount[j] += dayCount[j];
      if (loggedIn) {
        weeklyQ.forEach((q, i) => { if (!weeklyDone[i] && questCount(q, weekMatches, weekWins, weekCount) >= q.count) { weeklyDone[i] = true; earn(model.quests.weeklyCoins[i], model.quests.weeklyGems[i], "quest_weekly"); } });
        if (!weeklyBonus && weeklyDone.every(Boolean)) { weeklyBonus = true; earn(model.quests.weeklyAllBonus.coins, model.quests.weeklyAllBonus.gems, "quest_weekly"); }
        const mq = model.quests.monthly;
        if (mq && !monthAwarded && monthDailyDays >= mq.needDailyDays) { monthAwarded = true; earn(mq.coins, mq.gems, "quest_monthly"); }
        if (inEvent) { eventMatches += dayEligible; if (!eventAwarded && eventMatches >= model.events.minMatches) { eventAwarded = true; earn(model.events.rewardCoins, model.events.rewardGems, "event"); } }
      }
      if (dayEligible > 0) res.verifiedDays++;
      // Achievements
      const achFrac = dayEligible > model.achievementDailyMatchLimit ? model.achievementDailyMatchLimit / dayEligible : 1;
      for (let j = 0; j < KEYS.length; j++) counters[j] += dayCount[j] * achFrac;
      cMatches += dayEligible * achFrac; cWins += dayWins * achFrac;
      if (loggedIn) for (const a of ACHIEVEMENTS) {
        if (unlocked.has(a.id) || a.group === "ranked") continue;
        let v: number;
        if (a.key === "match") v = cMatches;
        else if (a.key === "win") v = cWins;
        else if (a.key === "streak") v = bestStreak;
        else if (a.key === "activeDays") v = res.verifiedDays;
        else if (a.key === "dailyQuests") v = res.dailyQuestsDone;
        else if (a.key === "yachtFaces") v = [1, 2, 3, 4, 5, 6].filter((f) => counters[KEY_INDEX.get(`yachtFace${f}` as EventKey)!] > 0).length;
        else v = counters[KEY_INDEX.get(a.key)!];
        if (v >= a.count) {
          unlocked.add(a.id); res.achievements.push(a.id); res.achievementDay[a.id] = d;
          const g = Math.round((ctx.achievementGems[a.id] ?? 0) * model.achievementGemScale);
          earn(Math.round(g * model.achievementCoinPerGem), g, "achievement");
        }
      }
    }
    // Spending
    if (ctx.spending && loggedIn) {
      // add newly released wanted items to the pending list (catalog is in release order)
      let added = false;
      while (nextRelease < ctx.catalog.length && ctx.catalog[nextRelease].releaseDay <= d) { if (want[nextRelease]) { pending.push(nextRelease); added = true; } nextRelease++; }
      if (added) { pending.sort((a, b) => price(ctx.catalog[a]) - price(ctx.catalog[b])); if (persona.spend === "saver") saverTarget = -1; }
      const tryBuy = (i: number): boolean => {
        const it = ctx.catalog[i];
        const payCoins = (it.currency === "coin" || it.currency === "either") && res.coins >= it.coinPrice;
        const payGems = (it.currency === "gem" || it.currency === "either") && res.gems >= it.gemPrice;
        if (!payCoins && !payGems) return false;
        if (payGems && (payer || !payCoins)) spend(0, it.gemPrice, "item"); else spend(it.coinPrice, 0, "item");
        level[i] = 1;
        ownedList.push(i);
        res.ownedByRarity[it.rarity]++;
        if (res.firstRarityDay[it.rarity] < 0) { res.firstRarityDay[it.rarity] = d; res.firstRarityMatches[it.rarity] = res.matches; }
        if (it.type === "emote") ownedEmotes++;
        if (it.type === "chat") ownedChats++;
        pending.splice(pending.indexOf(i), 1);
        return true;
      };
      if (persona.spend === "saver") {
        if (saverTarget < 0 || level[saverTarget] > 0) saverTarget = pending.length ? pending[pending.length - 1] : -1;
        if (saverTarget >= 0 && tryBuy(saverTarget)) { saverTarget = -1; goalCoins = 0; goalGems = 0; }
      } else if (persona.spend !== "none") {
        // Goal fund: part of every earning is reserved for the most expensive wanted legendary/mythic item.
        if (persona.goalShare > 0) {
          if (goalItem < 0 || level[goalItem] > 0) {
            goalItem = -1;
            for (let j = pending.length - 1; j >= 0; j--) if (ctx.catalog[pending[j]].rarity >= 3) { goalItem = pending[j]; break; }
            if (goalItem < 0) { goalCoins = 0; goalGems = 0; }
          }
          if (goalItem >= 0 && tryBuy(goalItem)) { goalItem = -1; goalCoins = 0; goalGems = 0; }
        }
        const reserveC = goalItem >= 0 ? Math.min(res.coins, goalCoins) : 0, reserveG = goalItem >= 0 ? Math.min(res.gems, goalGems) : 0;
        const limit = persona.spend === "collector" ? 50 : 2;
        let bought = 0;
        for (let j = 0; j < pending.length && bought < limit; ) {
          const i = pending[j], it = ctx.catalog[i];
          if (i === goalItem) { j++; continue; }
          if (price(it) > res.coins - reserveC + (res.gems - reserveG) * ctx.gemValueInCoins) break;
          const okC = (it.currency !== "gem") && res.coins - reserveC >= it.coinPrice, okG = (it.currency !== "coin") && res.gems - reserveG >= it.gemPrice;
          if ((okC || okG) && tryBuy(i)) bought++; else j++;
        }
      }
      // Upgrades (coins only): highest rarity, then highest level, not yet maxed
      if (ownedList.length && r() < persona.upgradeAppetite) {
        let target = -1;
        for (const i of ownedList) if (level[i] < ctx.upgrade.maxLevel && (target < 0 || ctx.catalog[i].rarity > ctx.catalog[target].rarity || (ctx.catalog[i].rarity === ctx.catalog[target].rarity && level[i] > level[target]))) target = i;
        if (target >= 0) {
          const it = ctx.catalog[target];
          const cost = upgradeCosts(price(it), ctx.upgrade)[level[target] - 1];
          if (res.coins - (goalItem >= 0 ? goalCoins : 0) >= cost) {
            spend(cost, 0, "upgrade");
            level[target]++;
            if (level[target] === ctx.upgrade.maxLevel) {
              res.maxedItems++;
              if (res.firstMaxUpgradeDay < 0) res.firstMaxUpgradeDay = d;
              if (it.rarity === 4 && res.firstMythicMaxDay < 0) res.firstMythicMaxDay = d;
            }
          }
        }
      }
      // Slots (permanent): buy when more items owned than slots
      const slotBuy = (have: number, slots: number, max: number, base: number): boolean => {
        if (have <= slots || slots >= max || r() > 0.3) return false;
        const k = slots - base;
        const cost = ctx.slots.costs[k], gemCost = ctx.slots.gemCosts[k];
        if (res.coins >= cost && !payer) { spend(cost, 0, "slot"); return true; }
        if (res.gems >= gemCost && payer) { spend(0, gemCost, "slot"); return true; }
        if (res.coins >= cost) { spend(cost, 0, "slot"); return true; }
        return false;
      };
      if (slotBuy(ownedEmotes, res.emoteSlots, ctx.slots.emoteMax, ctx.slots.emoteBase)) res.emoteSlots++;
      if (slotBuy(ownedChats, res.chatSlots, ctx.slots.chatMax, ctx.slots.chatBase)) res.chatSlots++;
    }
    if (checkpoints.has(d + 1)) {
      const earnedCoins = Object.values(res.coinsBySource).reduce((a, b) => a + b, 0), earnedGems = Object.values(res.gemsBySource).reduce((a, b) => a + b, 0);
      res.checkpoints[d + 1] = { coins: res.coins, gems: res.gems, earnedCoins, earnedGems, owned: res.ownedByRarity.reduce((a, b) => a + b, 0) };
    }
  }
  return res;
}

export function simulateCohort(ctx: SimContext, persona: Persona, users: number, days: number, seed: number, checkpoints: number[] = []): UserResult[] {
  return Array.from({ length: users }, (_, i) => simulateUser(ctx, persona, i, days, seed, { checkpoints }));
}

/** Population: daily arrivals, persona mix, lognormal lifetimes. Returns daily service series. */
export function simulatePopulation(ctx: SimContext, personas: Persona[], arrivalsPerDay: number, days: number, seed: number) {
  const r = mulberry32(hashSeed(seed, "population"));
  const series = {
    dau: new Float64Array(days), matches: new Float64Array(days), rewardedMatches: new Float64Array(days), serverMatches: new Float64Array(days),
    byMode: MODES.map(() => new Float64Array(days)),
    coinsIssued: new Float64Array(days), gemsIssued: new Float64Array(days), coinsSpent: new Float64Array(days), gemsSpent: new Float64Array(days), purchases: new Float64Array(days),
    alive: new Float64Array(days),
  };
  const users: UserResult[] = [];
  const bySource = { coins: zeroRec(SOURCES), gems: zeroRec(SOURCES) };
  let idx = 0;
  const shareSum = personas.reduce((a, p) => a + p.arrivalShare, 0);
  for (let day = 0; day < days; day++) {
    const arrivals = Math.round(arrivalsPerDay);
    for (let a = 0; a < arrivals; a++) {
      let x = r() * shareSum, persona = personas[0];
      for (const p of personas) { x -= p.arrivalShare; if (x <= 0) { persona = p; break; } }
      const lifetime = Math.max(1, Math.round(Math.exp(Math.log(persona.lifetimeMedianDays) + persona.lifetimeSigma * Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))) * Math.cos(2 * Math.PI * r()))));
      const u = simulateUser(ctx, persona, idx++, days - day, seed, { lifetime, recordDaily: true });
      const dly = u.daily!;
      for (let t = 0; t < dly.matches.length; t++) {
        const D = day + t;
        series.alive[D]++;
        if (dly.matches[t] > 0) series.dau[D]++;
        series.matches[D] += dly.matches[t];
        series.rewardedMatches[D] += dly.rewarded[t];
        MODES.forEach((m, mi) => { series.byMode[mi][D] += dly.byMode[mi][t]; if (MODE_TRUST[m] === "server-verified") series.serverMatches[D] += dly.byMode[mi][t]; });
        series.coinsIssued[D] += dly.coinsEarned[t]; series.gemsIssued[D] += dly.gemsEarned[t];
        series.coinsSpent[D] += dly.coinsSpent[t]; series.gemsSpent[D] += dly.gemsSpent[t]; series.purchases[D] += dly.purchases[t];
      }
      for (const s of SOURCES) { bySource.coins[s] += u.coinsBySource[s]; bySource.gems[s] += u.gemsBySource[s]; }
      delete u.daily;
      users.push(u);
    }
  }
  return { series, users, bySource };
}
