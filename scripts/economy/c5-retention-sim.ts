/**
 * C5 retention economy simulation (research only, nothing here grants anything).
 *
 *   npx tsx scripts/economy/c5-retention-sim.ts [--users 150] [--seeds 3] [--out docs/economy/c5/retention-sim.json]
 *
 * What is real and what is assumed:
 *  - Match coins, quests, quest bonuses, achievements, the new-member grant and boost come from the live
 *    `applyMatch` (src/economy/live/rewards.ts, M3i-W30@2), not from a re-implementation.
 *  - Retention rewards come from the candidate functions in src/economy/retention/policy.ts.
 *  - Prices, upgrade costs, the draw odds and the draw pool come from the live catalog and draw tables.
 *    The C1-PRICE variant scales common/rare/epic list prices to 55/70/90% (PR #113).
 *  - Players, activity, mode mix, win rates and spending are ASSUMPTIONS (no live play data was used).
 *    Behaviour is held fixed across policies (no engagement response), except in the `lift` sensitivity
 *    run. Per-match category rates come from engine games (src/economy/data/match-events.json).
 *
 * Seeds: development seeds 5101..510N. Every result here is a development result, not a holdout.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { categories, type Card, type Category } from "../../src/engine";
import matchEvents from "../../src/economy/data/match-events.json";
import { hashSeed, mulberry32, normal, type Rng } from "../../src/economy/rng";
import { ITEMS, priceOf, upgradeCost, type ItemDef } from "../../src/economy/live/catalog";
import { ACHIEVEMENTS, ECONOMY, TIER_PRICES, economyDay, type MatchKind } from "../../src/economy/live/config";
import { DRAW_COST, DUPLICATE_COINS, HANDS, drawHand, drawItems, type DrawTier } from "../../src/economy/live/draw";
import { applyMatch, newEconState, replaceQuests, type RewardInput } from "../../src/economy/live/rewards";
import {
  ACTIVITY, ATTENDANCE, DAILY_PLAY, PACKAGES, RETURN, WEEKLY_STREAK,
  applyDailyPlay, applyReturn, applyWeeklyStreak, claimAttendance, dailyPlayEligible, markActiveDay, newRetentionState,
  type RetentionPolicy, type RetentionState,
} from "../../src/economy/retention/policy";

const arg = (name: string, d: string) => {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : d;
};
const USERS = Number(arg("users", "150"));
const SEEDS = Number(arg("seeds", "3"));
const OUT = arg("out", "docs/economy/c5/retention-sim.json");
const DAY = 86_400_000;
const START = Date.parse("2027-01-04T00:00:00+09:00"); // a Monday, period day 0
const PERIOD = 365;
const CHECKPOINTS = [30, 90, 365] as const;
const MATCH_MINUTES = 9; // ~8 min match + ~1 min queue

/* --------------------------------------------------------------- personas --------------------------------------------------------------- */
type Tier = "beginner" | "casual" | "intermediate";
type Persona = {
  id: string; label: string; existing: boolean; warmup: number; tier: Tier;
  pActive: (d: number) => number; meanMatches: number; mix: Partial<Record<MatchKind, number>>;
  friends: number; randomPool: number;
  /** Optional habit model: P(active | active yesterday), P(active | inactive yesterday). Replaces pActive in the period. */
  markov?: { stay: number; back: number };
};
const PERSONAS: Persona[] = [
  { id: "occasional", label: "가끔 접속", existing: true, warmup: 60, tier: "casual", pActive: () => 0.3, meanMatches: 2, mix: { random: 0.7, ai: 0.3 }, friends: 2, randomPool: 2000 },
  { id: "daily", label: "일반 일일", existing: true, warmup: 60, tier: "intermediate", pActive: () => 0.85, meanMatches: 5, mix: { random: 0.75, friend: 0.1, ai: 0.15 }, friends: 3, randomPool: 2000 },
  { id: "friend", label: "친구 대전 중심", existing: true, warmup: 60, tier: "intermediate", pActive: () => 0.6, meanMatches: 6, mix: { friend: 0.8, random: 0.2 }, friends: 3, randomPool: 2000 },
  { id: "quick", label: "빠른 대전 중심", existing: true, warmup: 60, tier: "intermediate", pActive: () => 0.8, meanMatches: 8, mix: { random: 1 }, friends: 2, randomPool: 2000 },
  { id: "heavy", label: "높은 활동량", existing: true, warmup: 60, tier: "intermediate", pActive: () => 0.95, meanMatches: 22, mix: { random: 0.7, ai: 0.3 }, friends: 3, randomPool: 2000 },
  { id: "new", label: "신규", existing: false, warmup: 0, tier: "beginner", pActive: (d) => (d < 7 ? 0.9 : d < 30 ? 0.6 : 0.45), meanMatches: 4, mix: { random: 0.6, ai: 0.4 }, friends: 1, randomPool: 2000 },
  // sensitivity: the same volume as "daily" but habitual (correlated days) — streaks depend on it
  { id: "habit", label: "습관형 일일(민감도)", existing: true, warmup: 60, tier: "intermediate", pActive: () => 0.85, markov: { stay: 0.93, back: 0.45 }, meanMatches: 5, mix: { random: 0.75, friend: 0.1, ai: 0.15 }, friends: 3, randomPool: 2000 },
  // played 60 days, then away for 45 days before the period; returns on day 0
  { id: "returning", label: "재방문", existing: true, warmup: 105, tier: "intermediate", pActive: (d) => (d < -45 ? 0.8 : d < 0 ? 0 : d < 14 ? 0.85 : 0.5), meanMatches: 4, mix: { random: 0.75, ai: 0.25 }, friends: 2, randomPool: 2000 },
];
/** Population weights for the money-supply view (assumption). */
const MIX: Record<string, number> = { habit: 0, occasional: 0.35, daily: 0.2, friend: 0.1, quick: 0.1, heavy: 0.05, new: 0.15, returning: 0.05 };

/* --------------------------------------------------------------- matches --------------------------------------------------------------- */
type Mirror = { meanTotal: number; sdTotal: number; events: Record<string, { p: number }>; counts: Record<string, { mean: number }>; yachtFacePerMatch: number[] };
const mirror = (matchEvents as unknown as { mirror: Record<Tier, Mirror> }).mirror;

function sampleMatch(r: Rng, tier: Tier, winRate: number): { card: Card; score: number; outcome: RewardInput["outcome"]; stats: RewardInput["stats"] } {
  const m = mirror[tier];
  const p = (k: string) => m.events[k]?.p ?? 0;
  const card: Card = {};
  for (const c of categories) card[c] = 1; // placeholder: present, non-zero (upper section values do not matter for rewards)
  const hit = (c: Category, key: string, pts: number) => (card[c] = r() < p(key) ? pts : 0);
  hit("full", "fullScored", 25);
  hit("small", "smallScored", 15);
  hit("large", "largeScored", 30);
  hit("four", "fourScored", 24);
  hit("yacht", "yachtScored", 50);
  card.sixes = r() < p("sixesMax") ? 30 : 18;
  // "no zero category": only possible when every combination hit; scaled so the per-match rate matches the engine
  const allHit = !!(card.full && card.small && card.large && card.four && card.yacht);
  const pAll = p("fullScored") * p("smallScored") * p("largeScored") * p("fourScored") * p("yachtScored");
  card.ones = allHit && r() < Math.min(1, p("noZero") / Math.max(1e-9, pAll)) ? 1 : 0;
  const score = Math.max(40, Math.min(323, Math.round(m.meanTotal + m.sdTotal * normal(r))));
  const u = r();
  const drawP = p("draw");
  const outcome = u < drawP ? "draw" : u < drawP + (1 - drawP) * winRate ? "win" : "loss";
  const yachtFaces = card.yacht ? [1 + Math.floor(r() * 6)] : [];
  const stats = {
    firstRollYachts: r() < m.counts.firstRollYacht.mean ? 1 : 0,
    firstRollLarge: r() < m.counts.largeFirstRoll.mean ? 1 : 0,
    finalRoundYacht: card.yacht ? r() < p("finalRoundYacht") / Math.max(1e-9, p("yachtScored")) : false,
    yachtFaces,
    comeback30: outcome === "win" && r() < p("comeback30") / 0.5,
  };
  return { card, score, outcome, stats };
}

/* ------------------------------------------------------------- catalog / prices ------------------------------------------------------------- */
const SELL = ITEMS.filter((i) => !i.retired && i.tier !== "basic" && i.tier !== "special" && !i.season);
const C1_PCT: Record<string, number> = { common: 55, rare: 70, epic: 90, legendary: 100, mythic: 100 };
type Pricing = "BASE" | "C1-PRICE";
const scale = (p: number, unit: number, pct: number) => Math.max(unit, Math.floor((p * pct) / (100 * unit)) * unit);
function price(i: ItemDef, cur: "coins" | "gems", pricing: Pricing) {
  const p = priceOf(i, cur);
  if (p === null || pricing === "BASE") return p;
  return scale(p, cur === "coins" ? 5 : 1, C1_PCT[i.tier]);
}
const POOL: Record<DrawTier, ItemDef[]> = Object.fromEntries((["common", "rare", "epic", "legendary", "mythic"] as const).map((t) => [t, drawItems("standard", t)])) as Record<DrawTier, ItemDef[]>;
const TIER_W: Record<string, number> = { common: 4, rare: 3, epic: 2, legendary: 1, mythic: 0.5 };
const ITEM_ACH = ACHIEVEMENTS.filter((a) => a.key === "items");

/* ------------------------------------------------------------- base path (live) ------------------------------------------------------------- */
type DayLog = {
  active: boolean;
  /** Live grants of the day, by source. */
  coins: Record<string, number>;
  gems: number;
  matches: { input: RewardInput; countable: boolean; reason: string }[];
};
function basePath(persona: Persona, seed: number, idx: number, lift: number): DayLog[] {
  const r = mulberry32(hashSeed(seed, persona.id, idx, "path"));
  const userId = `sim-${persona.id}-${idx}`;
  const winRate = Math.max(0.38, Math.min(0.62, 0.5 + 0.05 * normal(r) + (persona.tier === "beginner" ? -0.06 : 0)));
  const createdAt = START - persona.warmup * DAY - (persona.existing ? 30 * DAY : 0);
  const days = persona.warmup + PERIOD;
  let state = newEconState(userId, START - persona.warmup * DAY);
  const out: DayLog[] = [];
  const kinds = Object.entries(persona.mix) as [MatchKind, number][];
  for (let d = 0; d < days; d++) {
    const rel = d - persona.warmup;
    const prevActive = out.length ? out[out.length - 1].active : true;
    const base = persona.markov ? (prevActive ? persona.markov.stay : persona.markov.back) : persona.pActive(rel);
    const pA = Math.min(1, base * (rel >= 0 ? lift : 1));
    const log: DayLog = { active: false, coins: {}, gems: 0, matches: [] };
    out.push(log);
    if (r() >= pA) continue;
    log.active = true;
    const n = Math.max(1, Math.round(persona.meanMatches * Math.exp(0.45 * normal(r) - 0.1)));
    const dayStart = START + rel * DAY + 10 * 3600_000;
    for (let k = 0; k < n; k++) {
      const endedAt = dayStart + k * MATCH_MINUTES * 60_000;
      if (k === 0) {
        const hard = state.daily[2];
        if (hard && hard.id === "d.yacht1" && !hard.done && economyDay(endedAt) === state.day) {
          const rr = replaceQuests(state, userId, "daily", state.day, 2);
          if (rr.ok) state = rr.state;
        }
      }
      let u = r();
      let kind: MatchKind = kinds[kinds.length - 1][0];
      for (const [k2, w] of kinds) if ((u -= w) < 0) { kind = k2; break; }
      const s = sampleMatch(r, persona.tier, kind === "ai" ? winRate + 0.05 : winRate);
      const f = r();
      let endReason: RewardInput["endReason"] = "completed";
      let outcome = s.outcome;
      let card = s.card;
      if (f < 0.03) [endReason, outcome] = ["resign", "loss"];
      else if (f < 0.06 && kind !== "ai") {
        [endReason, outcome] = ["left", "win"];
        const keep = 1 + Math.floor(r() * 11);
        card = Object.fromEntries(categories.slice(0, keep).map((c) => [c, s.card[c] ?? 0])) as Card;
      }
      const opponentUserId = kind === "ai" ? undefined : kind === "friend" ? `f${Math.floor(r() * persona.friends)}` : `o${Math.floor(r() * persona.randomPool)}`;
      const input: RewardInput = { matchId: `${d}-${k}`, kind, outcome, endReason, score: s.score, card, opponentUserId, stats: s.stats, endedAt };
      const res = applyMatch(state, input, { userId, createdAt });
      state = res.state;
      for (const g of res.grants) {
        log.coins[g.kind] = (log.coins[g.kind] ?? 0) + g.coins;
        log.gems += g.gems;
      }
      log.matches.push({ input, countable: res.countable, reason: res.reason });
    }
  }
  // welcome: new members on their first day; existing members got it before the warm-up window
  const first = out.findIndex((l) => l.active);
  if (first >= 0 && !persona.existing) {
    out[first].coins.welcome = ECONOMY.newUser.coins;
    out[first].gems += ECONOMY.newUser.gems;
  }
  return out;
}

/* ------------------------------------------------------------- retention overlay ------------------------------------------------------------- */
type Overlay = { coins: number[]; gems: number[]; bySource: Record<string, number> };
function overlay(path: DayLog[], warmup: number, pol: RetentionPolicy & { monthly?: { claims: number; coins: number; gems: number } | null }): Overlay {
  const coins = new Array(path.length).fill(0);
  const gems = new Array(path.length).fill(0);
  const bySource: Record<string, number> = {};
  let s: RetentionState = newRetentionState();
  let lastActive = -1;
  for (let d = 0; d < warmup; d++) if (path[d].active) lastActive = economyDay(START + (d - warmup) * DAY);
  const monthClaims = new Map<string, number>();
  const add = (d: number, src: string, g: { coins: number; gems: number }[]) => {
    for (const x of g) {
      coins[d] += x.coins;
      gems[d] += x.gems;
      bySource[src] = (bySource[src] ?? 0) + x.coins;
    }
  };
  for (let d = warmup; d < path.length; d++) {
    const log = path[d];
    if (!log.active) continue;
    const now = START + (d - warmup) * DAY + 10 * 3600_000 - 60_000;
    if (pol.returnBonus) {
      const r = applyReturn(s, pol.returnBonus, lastActive, now);
      s = r.state;
      add(d, "return", r.grants);
    }
    lastActive = economyDay(now);
    if (pol.attendance) {
      const r = claimAttendance(s, pol.attendance, now);
      s = r.state;
      add(d, "attendance", r.grants);
    }
    if (pol.monthly) {
      const key = new Date(now + 9 * 3600_000).toISOString().slice(0, 7);
      const n = (monthClaims.get(key) ?? 0) + 1;
      monthClaims.set(key, n);
      if (n === pol.monthly.claims) add(d, "monthly", [{ coins: pol.monthly.coins, gems: pol.monthly.gems }]);
    }
    for (const m of log.matches) {
      const eligible = dailyPlayEligible(m.input, m);
      if (pol.dailyPlay) {
        const r = applyDailyPlay(s, pol.dailyPlay, eligible, m.input.endedAt);
        s = r.state;
        add(d, "dailyPlay", r.grants);
      }
      if (pol.activity && eligible) {
        const r = markActiveDay(s, pol.activity, m.input.endedAt);
        s = r.state;
        add(d, "activity", r.grants);
      }
      if (pol.weeklyStreak) {
        const r = applyWeeklyStreak(s, pol.weeklyStreak, m.input);
        s = r.state;
        add(d, "weeklyStreak", r.grants);
      }
    }
  }
  return { coins, gems, bySource };
}

/* ------------------------------------------------------------- spending ------------------------------------------------------------- */
type Spend = {
  coins: number; gems: number; items: number; firstBuy: number | null; tierFirst: Record<string, number | null>;
  spentBuy: number; spentDraw: number; spentUpgrade: number; draws: number; upgrades: number; dupRefund: number; itemAch: number; wishDone: number; value: number;
};
function wishlist(seed: number, idx: number, persona: string): ItemDef[] {
  const r = mulberry32(hashSeed(seed, persona, idx, "wish"));
  const left = [...SELL];
  const out: ItemDef[] = [];
  while (out.length < 20) {
    const tot = left.reduce((a, i) => a + TIER_W[i.tier], 0);
    let u = r() * tot;
    let k = 0;
    while ((u -= TIER_W[left[k].tier]) > 0) k++;
    out.push(left.splice(k, 1)[0]);
  }
  return out;
}
const blankSpend = (): Spend => ({ coins: 0, gems: 0, items: 0, firstBuy: null, tierFirst: { common: null, rare: null, epic: null, legendary: null, mythic: null }, spentBuy: 0, spentDraw: 0, spentUpgrade: 0, draws: 0, upgrades: 0, dupRefund: 0, itemAch: 0, wishDone: 0, value: 0 });

/**
 * Daily spending: buy the next wished item when affordable (gems first when that price is affordable);
 * "drawer" users also draw once a day above a 600-coin buffer; "upgrader" users upgrade one owned item a
 * day above a 200-coin buffer. Returns snapshots at the period checkpoints.
 */
function spend(path: DayLog[], ov: Overlay | null, warmup: number, pricing: Pricing, wish: ItemDef[], type: "buyer" | "drawer" | "upgrader", seed: number, idx: number) {
  const r = mulberry32(hashSeed(seed, idx, "draw"));
  const s = blankSpend();
  const owned = new Map<string, number>();
  const snaps: Record<number, Spend & { issuedCoins: number; issuedGems: number; activeDays: number; matches: number }> = {};
  let issuedCoins = 0, issuedGems = 0, activeDays = 0, matches = 0;
  let paidAch = 0;
  for (let d = 0; d < path.length; d++) {
    const inPeriod = d >= warmup;
    const pr: Pricing = inPeriod ? pricing : "BASE";
    const log = path[d];
    const c = Object.values(log.coins).reduce((a, x) => a + x, 0) + (inPeriod && ov ? ov.coins[d] : 0);
    const g = log.gems + (inPeriod && ov ? ov.gems[d] : 0);
    s.coins += c;
    s.gems += g;
    if (inPeriod) {
      issuedCoins += c;
      issuedGems += g;
      if (log.active) activeDays++;
      matches += log.matches.length;
    }
    if (log.active) {
      const pd = d - warmup;
      for (;;) {
        const t = wish.find((i) => !owned.has(i.id));
        if (!t) break;
        const pg = price(t, "gems", pr);
        const pc = price(t, "coins", pr);
        let paid = false;
        if (pg !== null && s.gems >= pg) [s.gems, paid] = [s.gems - pg, true];
        else if (pc !== null && s.coins >= pc) {
          s.coins -= pc;
          if (inPeriod) s.spentBuy += pc;
          paid = true;
        }
        if (!paid) break;
        owned.set(t.id, 1);
        if (inPeriod) {
          s.items++;
          s.wishDone++;
          if (s.firstBuy === null) s.firstBuy = pd;
          if (s.tierFirst[t.tier] === null) s.tierFirst[t.tier] = pd;
        }
      }
      if (type === "drawer" && s.coins >= 600) {
        const hand = drawHand(Array.from({ length: 5 }, () => 1 + Math.floor(r() * 6)));
        const pool = POOL[HANDS[hand].tier];
        const it = pool[Math.floor(r() * pool.length)];
        s.coins -= DRAW_COST;
        if (inPeriod) [s.spentDraw, s.draws] = [s.spentDraw + DRAW_COST, s.draws + 1];
        if (owned.has(it.id)) {
          s.coins += DUPLICATE_COINS;
          if (inPeriod) s.dupRefund += DUPLICATE_COINS;
        } else {
          owned.set(it.id, 1);
          if (inPeriod) s.items++;
        }
      }
      if (type === "upgrader") {
        for (const [id, lv] of owned) {
          const it = SELL.find((i) => i.id === id)!;
          const cost = upgradeCost(it, lv);
          if (cost !== null && s.coins >= cost + 200) {
            s.coins -= cost;
            owned.set(id, lv + 1);
            if (inPeriod) [s.spentUpgrade, s.upgrades] = [s.spentUpgrade + cost, s.upgrades + 1];
            break;
          }
        }
      }
      // ownership achievements (c.items.3 / c.items.10) are granted by the live store on purchase
      for (const [k, a] of ITEM_ACH.entries()) {
        if (!(paidAch & (1 << k)) && owned.size >= a.count) {
          paidAch |= 1 << k;
          s.coins += a.coins;
          s.gems += a.gems;
          if (inPeriod) [issuedCoins, issuedGems, s.itemAch] = [issuedCoins + a.coins, issuedGems + a.gems, s.itemAch + a.coins];
        }
      }
    }
    const pd = d - warmup + 1;
    if (inPeriod && (CHECKPOINTS as readonly number[]).includes(pd)) {
      let value = 0;
      for (const id of owned.keys()) value += priceOf(SELL.find((i) => i.id === id)!, "coins") ?? (priceOf(SELL.find((i) => i.id === id)!, "gems") ?? 0) * 20;
      snaps[pd] = { ...s, tierFirst: { ...s.tierFirst }, value, issuedCoins, issuedGems, activeDays, matches };
    }
  }
  return snaps;
}

/* ------------------------------------------------------------- policies ------------------------------------------------------------- */
type Pol = RetentionPolicy & { monthly?: { claims: number; coins: number; gems: number } | null };
const none: Pol = { ...PACKAGES.BASE };
const POLICIES: Record<string, Pol> = {
  BASE: none,
  ...Object.fromEntries(Object.keys(ATTENDANCE).map((k) => [k, { ...none, version: k, attendance: ATTENDANCE[k] }])),
  ...Object.fromEntries(Object.keys(DAILY_PLAY).map((k) => [k, { ...none, version: k, dailyPlay: DAILY_PLAY[k] }])),
  ...Object.fromEntries(Object.keys(ACTIVITY).map((k) => [k, { ...none, version: k, activity: ACTIVITY[k] }])),
  ...Object.fromEntries(Object.keys(WEEKLY_STREAK).map((k) => [k, { ...none, version: k, weeklyStreak: WEEKLY_STREAK[k] }])),
  "RET-14": { ...none, version: "RET-14", returnBonus: RETURN["RET-14"] },
  "MON-20": { ...none, version: "MON-20", monthly: { claims: 20, coins: 150, gems: 5 } },
  LITE: PACKAGES.LITE,
  "C5-CORE": PACKAGES["C5-CORE"],
  "C5-FULL": PACKAGES["C5-FULL"],
  "PROPOSAL-ALL": PACKAGES["PROPOSAL-ALL"],
};
/** (policy, pricing) pairs to simulate. */
const RUNS: [string, Pricing][] = [...Object.keys(POLICIES).map((k) => [k, "BASE"] as [string, Pricing]), ["BASE", "C1-PRICE"], ["C5-CORE", "C1-PRICE"], ["C5-FULL", "C1-PRICE"], ["PROPOSAL-ALL", "C1-PRICE"]];
const runKey = (p: string, pr: Pricing) => (pr === "BASE" ? p : `${p}+C1`);

/* ------------------------------------------------------------- run ------------------------------------------------------------- */
type Acc = Record<string, Record<string, Record<number, number[][]>>>; // run → metric → checkpoint → per-seed values
const t0 = Date.now();
const metricNames = ["issuedCoins", "issuedGems", "extraCoins", "extraGems", "balanceCoins", "balanceGems", "items", "wishDone", "spentBuy", "spentDraw", "spentUpgrade", "draws", "upgrades", "firstBuy", "firstEpic", "firstLegendary", "value", "activeDays", "matches"] as const;
const results: Record<string, Acc> = {};
const sourceTotals: Record<string, Record<string, Record<string, number>>> = {};
const liftRuns: Record<string, Record<string, number>> = {};

for (const persona of PERSONAS) {
  const acc: Acc = {};
  results[persona.id] = acc;
  sourceTotals[persona.id] = {};
  for (const [p, pr] of RUNS) acc[runKey(p, pr)] = Object.fromEntries(metricNames.map((m) => [m, Object.fromEntries(CHECKPOINTS.map((c) => [c, Array.from({ length: SEEDS }, () => [] as number[])]))]));
  for (let seedIx = 0; seedIx < SEEDS; seedIx++) {
    const seed = 5101 + seedIx;
    for (let i = 0; i < USERS; i++) {
      const path = basePath(persona, seed, i, 1);
      const wish = wishlist(seed, i, persona.id);
      const type = (["buyer", "buyer", "drawer", "upgrader"] as const)[i % 4];
      // live sources (period only, BASE behaviour)
      for (let d = persona.warmup; d < path.length; d++) for (const [k, v] of Object.entries(path[d].coins)) {
        const st = (sourceTotals[persona.id]["live"] ??= {});
        st[k] = (st[k] ?? 0) + v / (USERS * SEEDS);
      }
      const base = spend(path, null, persona.warmup, "BASE", wish, type, seed, i);
      for (const [p, pr] of RUNS) {
        const ov = p === "BASE" ? null : overlay(path, persona.warmup, POLICIES[p]);
        if (ov && pr === "BASE") {
          const st = (sourceTotals[persona.id][p] ??= {});
          for (const [k, v] of Object.entries(ov.bySource)) st[k] = (st[k] ?? 0) + v / (USERS * SEEDS);
        }
        const snaps = p === "BASE" && pr === "BASE" ? base : spend(path, ov, persona.warmup, pr, wish, type, seed, i);
        for (const c of CHECKPOINTS) {
          const x = snaps[c];
          const b = base[c];
          const v: Record<(typeof metricNames)[number], number> = {
            issuedCoins: x.issuedCoins, issuedGems: x.issuedGems, extraCoins: x.issuedCoins - b.issuedCoins, extraGems: x.issuedGems - b.issuedGems,
            balanceCoins: x.coins, balanceGems: x.gems, items: x.items, wishDone: x.wishDone, spentBuy: x.spentBuy, spentDraw: x.spentDraw, spentUpgrade: x.spentUpgrade,
            draws: x.draws, upgrades: x.upgrades, firstBuy: x.firstBuy ?? 9999, firstEpic: x.tierFirst.epic ?? 9999, firstLegendary: x.tierFirst.legendary ?? 9999, value: x.value,
            activeDays: x.activeDays, matches: x.matches,
          };
          for (const m of metricNames) acc[runKey(p, pr)][m][c][seedIx].push(v[m]);
        }
      }
    }
  }
  // behavioural sensitivity: +10% active-day probability under C5-CORE
  const lifted: Record<string, number> = { base: 0, rec: 0, recLift: 0 };
  for (let i = 0; i < Math.min(USERS, 60); i++) {
    const path = basePath(persona, 5101, i, 1);
    const pathL = basePath(persona, 5101, i, 1.1);
    const tot = (pa: DayLog[], ov: Overlay | null) => pa.slice(persona.warmup, persona.warmup + 90).reduce((a, l, d) => a + Object.values(l.coins).reduce((x, y) => x + y, 0) + (ov ? ov.coins[d + persona.warmup] : 0), 0);
    lifted.base += tot(path, null);
    lifted.rec += tot(path, overlay(path, persona.warmup, POLICIES["C5-CORE"]));
    lifted.recLift += tot(pathL, overlay(pathL, persona.warmup, POLICIES["C5-CORE"]));
  }
  liftRuns[persona.id] = { baseCoins90: Math.round(lifted.base / Math.min(USERS, 60)), coreCoins90: Math.round(lifted.rec / Math.min(USERS, 60)), coreLift10Coins90: Math.round(lifted.recLift / Math.min(USERS, 60)) };
  console.error(`${persona.id} done ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

/* ------------------------------------------------------------- summarise ------------------------------------------------------------- */
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};
const q = (a: number[], p: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
};
const r1 = (x: number) => Math.round(x * 10) / 10;
/** Mean with an approximate 95% interval from seed-block means (t, df = seeds − 1). */
function seedCI(perSeed: number[][]) {
  const ms = perSeed.map(mean);
  const m = mean(ms);
  const sd = Math.sqrt(ms.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, ms.length - 1));
  const t = ({ 1: 12.71, 2: 4.3, 3: 3.18, 4: 2.78, 5: 2.57 } as Record<number, number>)[ms.length - 1] ?? 2;
  return { mean: r1(m), lo: r1(m - (t * sd) / Math.sqrt(ms.length)), hi: r1(m + (t * sd) / Math.sqrt(ms.length)) };
}
const summary: Record<string, unknown> = {};
for (const persona of PERSONAS) {
  const per: Record<string, unknown> = {};
  for (const [run, metrics] of Object.entries(results[persona.id])) {
    const cps: Record<string, unknown> = {};
    for (const c of CHECKPOINTS) {
      const flat = (m: (typeof metricNames)[number]) => metrics[m][c].flat();
      const reached = (m: "firstBuy" | "firstEpic" | "firstLegendary") => flat(m).filter((x) => x < 9999);
      cps[c] = {
        issuedCoins: seedCI(metrics.issuedCoins[c]), issuedGems: r1(mean(flat("issuedGems"))),
        extraCoins: seedCI(metrics.extraCoins[c]), extraGems: r1(mean(flat("extraGems"))),
        balanceCoins: { mean: r1(mean(flat("balanceCoins"))), p50: median(flat("balanceCoins")), p90: q(flat("balanceCoins"), 0.9) },
        balanceGems: r1(mean(flat("balanceGems"))),
        items: r1(mean(flat("items"))), wishDone: r1(mean(flat("wishDone"))),
        spent: { buy: r1(mean(flat("spentBuy"))), draw: r1(mean(flat("spentDraw"))), upgrade: r1(mean(flat("spentUpgrade"))) },
        draws: r1(mean(flat("draws"))), upgrades: r1(mean(flat("upgrades"))),
        firstBuyMedianDay: median(flat("firstBuy")) >= 9999 ? null : median(flat("firstBuy")), firstBuyReached: r1((100 * reached("firstBuy").length) / flat("firstBuy").length),
        epicReached: r1((100 * reached("firstEpic").length) / flat("firstEpic").length), legendaryReached: r1((100 * reached("firstLegendary").length) / flat("firstLegendary").length),
        ownedValue: r1(mean(flat("value"))), activeDays: r1(mean(flat("activeDays"))), matches: r1(mean(flat("matches"))),
      };
    }
    per[run] = cps;
  }
  summary[persona.id] = per;
}

/* analytic: days of earnings per tier price and theoretical maxima */
const dailyIssue = (pid: string, run: string) => ((summary[pid] as Record<string, Record<number, { issuedCoins: { mean: number } }>>)[run][90].issuedCoins.mean) / 90;
const daysToBuy: Record<string, Record<string, Record<string, number>>> = {};
for (const persona of PERSONAS) {
  daysToBuy[persona.id] = {};
  for (const run of ["BASE", "C5-CORE", "C5-FULL", "PROPOSAL-ALL", "BASE+C1", "C5-CORE+C1"]) {
    const pricing: Pricing = run.endsWith("+C1") ? "C1-PRICE" : "BASE";
    const perDay = dailyIssue(persona.id, run);
    daysToBuy[persona.id][run] = Object.fromEntries((["common", "rare", "epic", "legendary", "mythic"] as const).map((t) => [t, r1(scale(TIER_PRICES[t].coins, 5, pricing === "BASE" ? 100 : C1_PCT[t]) / perDay)]));
  }
}
const maxDaily = (pol: Pol) => {
  const att = pol.attendance ? pol.attendance.rewards.reduce((a, x) => a + x.coins, 0) / pol.attendance.rewards.length : 0;
  const dp = pol.dailyPlay ? pol.dailyPlay.matches * pol.dailyPlay.perMatch + pol.dailyPlay.completion.coins : 0;
  const ws = pol.weeklyStreak ? Math.max(...pol.weeklyStreak.tiers.map((t) => t.coins)) / 7 : 0;
  const act = pol.activity ? pol.activity.milestones.reduce((a, m) => a + m.coins, 0) / 365 + (pol.activity.repeat ? pol.activity.repeat.coins / pol.activity.repeat.every : 0) : 0;
  return { attendance: r1(att), dailyPlay: dp, weeklyStreak: r1(ws), activityAmortised365: r1(act), total: r1(att + dp + ws + act) };
};
const liveMax = {
  matchCoins: ECONOMY.daily.fullMatches * (ECONOMY.match.random.complete + ECONOMY.match.random.win) + (ECONOMY.daily.reducedUntil - ECONOMY.daily.fullMatches) * ECONOMY.daily.reducedCoins,
  newUserBoost: ECONOMY.daily.fullMatches * ECONOMY.newUser.boostPerMatch,
  dailyQuests: ECONOMY.quests.dailyCoins.reduce((a, x) => a + x, 0) + ECONOMY.quests.dailyAllBonus.coins,
  weeklyQuestsPerDay: r1((ECONOMY.quests.weeklyCoins.reduce((a, x) => a + x, 0) + ECONOMY.quests.weeklyAllBonus.coins) / 7),
};
// money supply: population-weighted mean balance and cumulative issuance per account
const supply: Record<string, Record<number, { issued: number; balance: number }>> = {};
for (const run of ["BASE", "LITE", "C5-CORE", "C5-FULL", "PROPOSAL-ALL", "BASE+C1", "C5-CORE+C1"]) {
  supply[run] = {};
  for (const c of CHECKPOINTS) {
    let issued = 0, balance = 0;
    for (const persona of PERSONAS) {
      const s = (summary[persona.id] as Record<string, Record<number, { issuedCoins: { mean: number }; balanceCoins: { mean: number } }>>)[run][c];
      issued += MIX[persona.id] * s.issuedCoins.mean;
      balance += MIX[persona.id] * s.balanceCoins.mean;
    }
    supply[run][c] = { issued: Math.round(issued), balance: Math.round(balance) };
  }
}

const out = {
  generatedBy: "scripts/economy/c5-retention-sim.ts",
  economyVersion: ECONOMY.version,
  seeds: Array.from({ length: SEEDS }, (_, i) => 5101 + i),
  seedNote: "development seeds; not a holdout",
  usersPerPersonaPerSeed: USERS,
  start: new Date(START).toISOString(),
  checkpoints: CHECKPOINTS,
  assumptions: {
    matchMinutes: MATCH_MINUTES, forfeit: "own resign 3%, opponent leaves 3% (not AI), opponent-forfeit card keeps 1–11 categories",
    winRate: "N(0.5, 0.05) clipped 0.38–0.62, beginners −0.06, AI +0.05", draws: "engine draw rate per tier",
    spending: "20-item wishlist weighted common 4 : rare 3 : epic 2 : legendary 1 : mythic 0.5; gems first when affordable; 1/4 drawers (1 draw/day above 600), 1/4 upgraders (1/day above 200)",
    behaviour: "identical activity under every policy (no engagement response) except liftSensitivity",
    personas: PERSONAS.map((p) => ({ id: p.id, label: p.label, existing: p.existing, warmupDays: p.warmup, tier: p.tier, meanMatches: p.meanMatches, mix: p.mix, pActiveDay0: p.pActive(0), pActiveDay60: p.pActive(60), markov: p.markov ?? null })),
    populationMix: MIX,
  },
  liveMaxPerDay: liveMax,
  retentionMaxPerDay: Object.fromEntries(Object.entries(POLICIES).map(([k, p]) => [k, maxDaily(p)])),
  liveSources: Object.fromEntries(PERSONAS.map((p) => [p.id, Object.fromEntries(Object.entries(sourceTotals[p.id].live ?? {}).map(([k, v]) => [k, Math.round(v)]))])),
  retentionSources365: Object.fromEntries(PERSONAS.map((p) => [p.id, Object.fromEntries(Object.entries(sourceTotals[p.id]).filter(([k]) => k !== "live").map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([s, x]) => [s, Math.round(x)]))]))])),
  daysToBuyTierAt90: daysToBuy,
  moneySupplyPerAccount: supply,
  liftSensitivity: liftRuns,
  summary,
  runtimeSeconds: r1((Date.now() - t0) / 1000),
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
console.error(`wrote ${OUT} in ${out.runtimeSeconds}s`);
