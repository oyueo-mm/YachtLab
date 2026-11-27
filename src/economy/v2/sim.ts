/**
 * Economy v2 agent simulator — RESEARCH ONLY (grants nothing in the game).
 *
 * One simulated player = minute-level play sessions on the KST economy calendar. Every finished match
 * is settled by `applyMatchV2` (the live rule set with candidate parameters), every purchase / upgrade /
 * draw is priced by the candidate's priced catalog (real 243-item live catalog). Deterministic per seed.
 *
 * What is an assumption (no production per-user data was accessible — see ECONOMY-V2-RESEARCH §2.3):
 * play minutes per day, match length, queue wait / patience, mode mix, win rate, forfeit rates, the
 * opponent pool size, spending style and wish lists. The runner varies them (sensitivity analysis).
 * Per-match scoring events (yacht / large / full / small / scores / roll facts) come from the measured
 * engine data in src/economy/data/match-events.json (`eventProbability`), drawn independently per match.
 */
import { categories, type Card, type Category } from "../../engine";
import { eventProbability, type TierId as SkillTier } from "../content";
import matchEvents from "../data/match-events.json";
import { economyDay, questById, type MatchKind, type TierId } from "../live/config";
import { newEconState, replaceQuests, type EconState, type MatchStats, type RewardInput } from "../live/rewards";
import { hashSeed, mulberry32, normal, poisson, type Rng } from "../rng";
import { COLLECTION_ITEMS, DRAW_TIER_P, drawPools, pricedCatalog, type PricedItem } from "./catalog";
import { applyMatchV2, newExt, welcomeGrant, type BoostCtx, type V2Ext, type V2Grant } from "./engine";
import { PRICED_TIERS, type PricedTier, type V2Params } from "./params";

export type PlayMode = MatchKind | "offline" | "solo";
export type SpendStyle = "spender" | "saver" | "upgrader" | "drawer" | "collector";
export type Persona = {
  id: string;
  /** Play minutes on an active day (session budget, including queue waits). */
  minutesPerDay: number;
  /** Probability of playing on a given day. */
  activeProb: number;
  /** Local hour (KST) the daily session starts (± 1 h jitter). */
  startHour: number;
  skill: SkillTier;
  winRate: { random: number; friend: number; ai: number };
  /** Mean minutes per match by mode (lognormal, σ = 0.25). */
  matchMinutes: Record<PlayMode, number>;
  modeMix: Partial<Record<PlayMode, number>>;
  /** Random queue: mean wait (s) and patience (s); after patience the player plays `fallback` instead. */
  queue: { meanWaitSec: number; patienceSec: number; fallback: PlayMode };
  /** Distinct signed-in opponents met in the random queue (small = same-opponent cap binds). */
  opponentPool: number;
  ownForfeit: number;
  oppForfeit: number;
  /** 0..1: re-rolls the slowest daily quest (yacht / win2) and plays a couple of extra matches to finish quests. */
  questFocus: number;
  spend: SpendStyle;
  /** Probability to want an item of each tier (wish list drawn once per player). */
  want: Record<PricedTier, number>;
  /** Uses daily draws when affordable (probability per session). */
  drawAppetite: number;
};

export type SimOptions = {
  days: number;
  /** Days of baseline play before day 0 (0 = brand-new account created at day 0). */
  warmupDays: number;
  /** Params used during warm-up (normally the baseline). */
  warmupParams?: V2Params;
  snapshots: number[];
  /** Include rev-2 items (needs the latest Worker; unconfirmed in production). */
  includeRev2: boolean;
  /** Day 0 (UTC ms of KST midnight). */
  t0: number;
};

export type Snapshot = {
  day: number;
  minutes: number;
  matches: number;
  paidMatches: number;
  coinsEarned: number;
  gemsEarned: number;
  bySource: Record<string, number>;
  spent: { item: number; upgrade: number; draw: number; gemsItem: number };
  coins: number;
  gems: number;
  owned: number;
  ownedByTier: Record<string, number>;
  ownedValue: number;
  lv3: number;
  collectionsComplete: number;
  synergyReady: number;
  daysReduced: number;
  daysCapped: number;
  activeDays: number;
  boostCoins: number;
  boosterMinutesGranted: number;
  boosterMinutesUsed: number;
  draws: number;
  duplicates: number;
  /** Unowned catalog items (any tier, not only the wish list) buyable right now with coins. */
  affordableUnowned: number;
  /** Cheapest unowned coin price in the catalog (null = owns everything buyable with coins). */
  cheapestUnowned: number | null;
  wishLeft: number;
};
export type UserResult = {
  firstObtainMin: number | null;
  firstObtainDay: number | null;
  firstBuyMin: number | null;
  firstBuyDay: number | null;
  firstTierMin: Record<PricedTier, number | null>;
  firstTierDay: Record<PricedTier, number | null>;
  firstLv3Min: number | null;
  firstLv3Day: number | null;
  maxCoinsDay: number;
  snapshots: Snapshot[];
};

const SIGMA = 0.25;
const lognormal = (r: Rng, mean: number) => mean * Math.exp(SIGMA * normal(r) - (SIGMA * SIGMA) / 2);
type Mirror = { meanTotal: number; sdTotal: number };
const mirror = (matchEvents as unknown as { mirror: Record<string, Mirror> }).mirror;

function pickMode(r: Rng, mix: Partial<Record<PlayMode, number>>): PlayMode {
  const entries = Object.entries(mix) as [PlayMode, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [m, w] of entries) if ((x -= w) <= 0) return m;
  return entries[entries.length - 1][0];
}

/** A synthetic score card with the measured per-match event probabilities of a skill tier. */
function synthCard(r: Rng, skill: SkillTier, winRate: number, filledCount = 12): { card: Card; score: number; stats: MatchStats } {
  const P = (k: Parameters<typeof eventProbability>[1]) => eventProbability(skill, k, winRate);
  const noZero = r() < P("noZero");
  const yacht = noZero || r() < P("yachtScored");
  const card: Card = {};
  const vals: Record<Category, number> = {
    aces: 3, deuces: 6, threes: 9, fours: 12, fives: 15, sixes: r() < P("sixesMax") ? 30 : 18, choice: 22,
    four: noZero || r() < P("fourScored") ? 16 : 0, full: noZero || r() < P("fullScored") ? 20 : 0,
    small: noZero || r() < P("smallScored") ? 15 : 0, large: noZero || r() < P("largeScored") ? 30 : 0, yacht: yacht ? 50 : 0,
  };
  categories.slice(0, filledCount).forEach((c) => (card[c] = vals[c]));
  const m = mirror[skill];
  const score = Math.max(30, Math.min(323, Math.round(m.meanTotal + m.sdTotal * normal(r))));
  const fry = P("firstRollYacht");
  const stats: MatchStats = {
    firstRollYachts: r() < fry ? (r() < 0.02 ? 2 : 1) : 0,
    firstRollLarge: poisson(r, P("largeFirstRoll")),
    finalRoundYacht: yacht && r() < P("finalRoundYacht") / Math.max(1e-9, P("yachtScored")),
    yachtFaces: yacht ? [1 + Math.floor(r() * 6)] : [],
    comeback30: r() < P("comeback30"),
  };
  return { card, score, stats };
}

type Wallet = { coins: number; gems: number };

class Player {
  econ: EconState;
  ext: V2Ext = newExt();
  wallet: Wallet = { coins: 0, gems: 0 };
  owned = new Map<string, number>();
  wish: PricedItem[] = [];
  cat!: PricedItem[];
  byId!: Map<string, PricedItem>;
  pools!: Record<PricedTier, PricedItem[]>;
  p!: V2Params;
  minutes = 0;
  matches = 0;
  paidMatches = 0;
  earned = { coins: 0, gems: 0 };
  bySource: Record<string, number> = {};
  spent = { item: 0, upgrade: 0, draw: 0, gemsItem: 0 };
  daysReduced = 0;
  daysCapped = 0;
  activeDays = 0;
  boostCoins = 0;
  boosterGranted = 0;
  boosterUsed = 0;
  drawsTotal = 0;
  duplicates = 0;
  drawsToday = { day: -1, n: 0 };
  couponWeek = { week: -1, n: 0 };
  firstBuyDone = false;
  freeDrawsLeft = 0;
  collectionsPaid = new Set<string>();
  goal: PricedItem | null = null;
  res: UserResult = { firstObtainMin: null, firstObtainDay: null, firstBuyMin: null, firstBuyDay: null, firstTierMin: { common: null, rare: null, epic: null, legendary: null, mythic: null }, firstTierDay: { common: null, rare: null, epic: null, legendary: null, mythic: null }, firstLv3Min: null, firstLv3Day: null, maxCoinsDay: 0, snapshots: [] };
  measuring = false;
  measureStartMin = 0;
  day = 0;
  coinsToday = 0;

  constructor(readonly userId: string, readonly persona: Persona, readonly createdAt: number, readonly r: Rng, readonly opts: SimOptions) {
    this.econ = newEconState(userId, createdAt);
  }

  setParams(p: V2Params, rollWish: boolean) {
    this.p = p;
    this.cat = pricedCatalog(p).filter((i) => !i.season && (this.opts.includeRev2 || i.rev <= 1) && i.tier !== "basic" && i.tier !== "special");
    this.byId = new Map(this.cat.map((i) => [i.id, i]));
    this.pools = drawPools(this.cat);
    if (rollWish) {
      // wish list drawn once per player and kept across a policy switch (same items, new prices)
      const want = this.persona.spend === "collector" ? { common: 1, rare: 1, epic: 1, legendary: 1, mythic: 1 } : this.persona.want;
      this.wishIds = this.cat.filter((i) => this.r() < want[i.liveTier as PricedTier] && (i.coins !== null || i.gems !== null)).map((i) => i.id);
    }
    this.wish = this.wishIds.map((id) => this.byId.get(id)).filter((i): i is PricedItem => !!i);
    this.goal = null;
  }
  wishIds: string[] = [];

  grant(gs: V2Grant[]) {
    for (const g of gs) {
      if (!g.coins && !g.gems) continue;
      this.wallet.coins += g.coins;
      this.wallet.gems += g.gems;
      if (this.measuring) {
        this.earned.coins += g.coins;
        this.earned.gems += g.gems;
        this.bySource[g.kind] = (this.bySource[g.kind] ?? 0) + g.coins;
      }
      this.coinsToday += g.coins;
    }
  }

  playMin() {
    return this.minutes - this.measureStartMin;
  }
  markObtained(item: PricedItem, viaBuy: boolean) {
    if (!this.measuring) return;
    const m = this.playMin();
    if (this.res.firstObtainMin === null) [this.res.firstObtainMin, this.res.firstObtainDay] = [m, this.day];
    if (viaBuy && this.res.firstBuyMin === null) [this.res.firstBuyMin, this.res.firstBuyDay] = [m, this.day];
    const t = item.tier as PricedTier;
    if (PRICED_TIERS.includes(t) && this.res.firstTierMin[t] === null) {
      this.res.firstTierMin[t] = m;
      this.res.firstTierDay[t] = this.day;
    }
  }
  addItem(item: PricedItem, viaBuy: boolean) {
    this.owned.set(item.id, 1);
    this.markObtained(item, viaBuy);
    if (this.p.collectionReward)
      for (const c of COLLECTION_ITEMS)
        if (!this.collectionsPaid.has(c.id) && c.items.every((id) => this.owned.has(id))) {
          this.collectionsPaid.add(c.id);
          this.grant([{ key: `col:${c.id}`, kind: "collection", coins: this.p.collectionReward.coins, gems: this.p.collectionReward.gems, label: "컬렉션 완성" }]);
        }
  }

  /* ------------------------------------------------------------ spending ------------------------------------------------------------ */
  priceFor(item: PricedItem, cur: "coins" | "gems") {
    const base = cur === "coins" ? item.coins : item.gems;
    if (base === null) return null;
    const st = this.p.starter;
    if (!this.firstBuyDone && st && PRICED_TIERS.indexOf(item.tier as PricedTier) <= PRICED_TIERS.indexOf(st.maxTier)) return Math.max(1, Math.floor((base * (100 - st.firstPurchaseDiscountPct)) / 100));
    const b = this.p.booster;
    if (b.kind === "coupon" && b.discountPct > 0 && this.couponWeek.n < b.discountPerWeek) return Math.max(1, Math.floor((base * (100 - b.discountPct)) / 100));
    return base;
  }
  buy(item: PricedItem, cur: "coins" | "gems"): boolean {
    const price = this.priceFor(item, cur);
    if (price === null || this.owned.has(item.id) || this.wallet[cur] < price) return false;
    const full = cur === "coins" ? item.coins! : item.gems!;
    const b = this.p.booster;
    if (this.firstBuyDone && b.kind === "coupon" && price < full) this.couponWeek.n++;
    this.wallet[cur] -= price;
    if (this.measuring) cur === "coins" ? (this.spent.item += price) : (this.spent.gemsItem += price);
    this.firstBuyDone = true;
    this.addItem(item, true);
    return true;
  }
  upgrade(item: PricedItem): boolean {
    const lv = this.owned.get(item.id);
    if (!lv || !item.up || lv >= 3) return false;
    const cost = item.up[lv - 1];
    if (this.wallet.coins < cost) return false;
    this.wallet.coins -= cost;
    if (this.measuring) this.spent.upgrade += cost;
    this.owned.set(item.id, lv + 1);
    if (lv + 1 === 3 && this.measuring && this.res.firstLv3Min === null) {
      this.res.firstLv3Min = this.playMin();
      this.res.firstLv3Day = this.day;
    }
    return true;
  }
  drawOnce(free: boolean): boolean {
    if (!free) {
      if (this.drawsToday.n >= this.p.draw.dailyLimit || this.wallet.coins < this.p.draw.cost) return false;
      this.drawsToday.n++;
      this.wallet.coins -= this.p.draw.cost;
      if (this.measuring) this.spent.draw += this.p.draw.cost;
    }
    let x = this.r();
    let tier: PricedTier = "common";
    for (const t of PRICED_TIERS) if ((x -= DRAW_TIER_P[t]) <= 0) { tier = t; break; }
    const pool = this.pools[tier];
    if (!pool.length) return true;
    const item = pool[Math.floor(this.r() * pool.length)];
    if (this.measuring) this.drawsTotal++;
    if (this.owned.has(item.id)) {
      if (this.measuring) this.duplicates++;
      this.grant([{ key: "dup", kind: "draw-duplicate" as never, coins: this.p.draw.duplicateCoins, gems: 0, label: "" }]);
    } else this.addItem(item, false);
    return true;
  }

  wantedUnowned() {
    return this.wish.filter((i) => !this.owned.has(i.id));
  }
  spend(sessionDrawRoll: boolean) {
    const day = this.day;
    if (this.drawsToday.day !== day) this.drawsToday = { day, n: 0 };
    const week = Math.floor((day + 3) / 7);
    if (this.couponWeek.week !== week) this.couponWeek = { week, n: 0 };
    while (this.freeDrawsLeft > 0) {
      this.freeDrawsLeft--;
      this.drawOnce(true);
    }
    const style = this.persona.spend;
    if (style === "drawer" || (sessionDrawRoll && style !== "saver")) while (this.drawOnce(false));
    const coinsFirst = (list: PricedItem[]) => [...list].sort((a, z) => (a.coins ?? Infinity) - (z.coins ?? Infinity));
    if (style === "saver") {
      if (!this.goal || this.owned.has(this.goal.id) && (this.owned.get(this.goal.id)! >= 3 || !this.goal.up)) {
        const cands = this.wantedUnowned().filter((i) => i.coins !== null && (i.category === "dice" || i.category === "board"));
        this.goal = cands.sort((a, z) => (z.coins ?? 0) - (a.coins ?? 0))[0] ?? null;
      }
      if (this.goal) {
        if (!this.owned.has(this.goal.id)) this.buy(this.goal, "coins");
        while (this.owned.has(this.goal.id) && this.upgrade(this.goal));
      }
    } else if (style === "upgrader") {
      // finish upgrades of what is owned first (cheapest next level), then buy the cheapest wanted upgradable item
      for (;;) {
        const up = [...this.owned.entries()].map(([id, lv]) => ({ it: this.byId.get(id), lv })).filter((x) => x.it?.up && x.lv < 3).sort((a, z) => a.it!.up![a.lv - 1] - z.it!.up![z.lv - 1]);
        if (up.length) {
          if (!this.upgrade(up[0].it!)) break;
          continue;
        }
        const next = coinsFirst(this.wantedUnowned().filter((i) => i.up && i.coins !== null))[0];
        if (!next || !this.buy(next, "coins")) break;
      }
    } else {
      // spender / drawer / collector: whichever is cheaper — the next wanted item, or the next level of the
      // favourite (first die or board bought; collectors never upgrade)
      for (;;) {
        const next = coinsFirst(this.wantedUnowned().filter((i) => i.coins !== null))[0];
        const fav = style === "collector" ? undefined : [...this.owned.keys()].map((id) => this.byId.get(id)).find((i) => i && i.up && (i.category === "dice" || i.category === "board"));
        const favLv = fav ? this.owned.get(fav.id)! : 3;
        const upCost = fav && favLv < 3 ? fav.up![favLv - 1] : Infinity;
        if (upCost <= (next?.coins ?? Infinity)) {
          if (!this.upgrade(fav!)) break;
        } else if (!next || !this.buy(next, "coins")) break;
      }
    }
    // gems: cheapest wanted gem-purchasable item
    for (;;) {
      const g = this.wantedUnowned().filter((i) => i.gems !== null).sort((a, z) => a.gems! - z.gems!)[0];
      if (!g || !this.buy(g, "gems")) break;
    }
  }

  /* ------------------------------------------------------------- play ------------------------------------------------------------- */
  boosterState = { day: -1, windowEnd: -1, matchesLeft: 0, extraLeft: 0 };
  boostFor(startMs: number, day: number, fullBand: boolean): BoostCtx {
    const b = this.p.booster;
    if (!fullBand) return null;
    if (b.kind === "time") return startMs < this.boosterState.windowEnd ? { mult: b.mult, dailyExtraCap: b.dailyExtraCap, day } : null;
    if (b.kind === "matches") return this.boosterState.matchesLeft > 0 ? { mult: b.mult, dailyExtraCap: b.dailyExtraCap, day } : null;
    if (b.kind === "extra") return this.boosterState.extraLeft > 0 ? { mult: b.mult, dailyExtraCap: b.dailyExtraCap, day, budgetLeft: this.boosterState.extraLeft } : null;
    if (b.kind === "auto") return this.econ.day === day && this.econ.rewarded < b.matches ? { mult: b.mult, dailyExtraCap: b.dailyExtraCap, day } : null;
    if (b.kind === "event") {
      const local = new Date(startMs + 9 * 3600_000);
      const h = local.getUTCHours();
      return b.weekdays.includes(local.getUTCDay()) && h >= b.startHour && h < b.endHour ? { mult: b.mult, dailyExtraCap: b.dailyExtraCap, day } : null;
    }
    return null;
  }

  playDay(day: number) {
    this.day = day;
    const P = this.persona;
    const dayStart = this.opts.t0 + day * 86_400_000; // KST midnight
    this.coinsToday = 0;
    if (this.r() >= P.activeProb) return;
    this.activeDays += this.measuring ? 1 : 0;
    let t = dayStart + (P.startHour + (this.r() * 2 - 1)) * 3600_000;
    const budgetMs = P.minutesPerDay * 60_000;
    const end = t + budgetMs;
    const b = this.p.booster;
    // a booster (if any) is granted per economy day and activated when the session starts
    if (b.kind === "time" || b.kind === "matches" || b.kind === "extra") {
      this.boosterState = { day, windowEnd: b.kind === "time" ? t + b.minutes * 60_000 : -1, matchesLeft: b.kind === "matches" ? b.matches : 0, extraLeft: b.kind === "extra" ? b.extraCoins : 0 };
      if (b.kind === "time" && this.measuring) {
        this.boosterGranted += b.minutes;
        this.boosterUsed += Math.min(b.minutes, P.minutesPerDay);
      }
    }
    if (b.kind === "coupon") this.freeDrawsLeft += b.freeDrawsPerDay;
    if (this.r() < P.questFocus) this.rerollSlowQuest();
    const drawRoll = this.r() < P.drawAppetite;
    let extraForQuests = P.questFocus > 0.5 ? 2 : 0;
    let aiStarts = 0;
    let reducedHit = false;
    let cappedHit = false;
    for (;;) {
      if (t >= end) {
        if (extraForQuests > 0 && this.econ.daily.some((q) => !q.done)) extraForQuests--;
        else break;
      }
      const tBefore = t;
      let mode = pickMode(this.r, P.modeMix);
      if (mode === "random") {
        const wait = -Math.log(1 - this.r()) * P.queue.meanWaitSec;
        if (wait > P.queue.patienceSec) {
          t += P.queue.patienceSec * 1000;
          mode = P.queue.fallback;
        } else t += wait * 1000;
      }
      if (mode === "ai") {
        if (aiStarts >= this.p.daily.aiStarts) mode = "offline";
        else aiStarts++;
      }
      const startMs = t;
      const dur = lognormal(this.r, P.matchMinutes[mode]) * 60_000;
      const ownForfeit = mode !== "solo" && mode !== "offline" && this.r() < P.ownForfeit;
      const oppForfeit = !ownForfeit && (mode === "random" || mode === "friend") && this.r() < P.oppForfeit;
      const frac = ownForfeit || oppForfeit ? 0.2 + this.r() * 0.7 : 1;
      t += dur * frac;
      if (this.measuring) {
        this.minutes += (t - tBefore) / 60_000; // queue wait + match
        this.matches++;
      }
      if (mode === "offline" || mode === "solo") continue; // local play: no official currency (trust boundary)
      const kind = mode as MatchKind;
      const wr = P.winRate[kind];
      const filledCount = oppForfeit ? 1 + Math.floor(this.r() * 11) : 12;
      const { card, score, stats } = synthCard(this.r, P.skill, wr, filledCount);
      const x = this.r();
      const outcome: RewardInput["outcome"] = ownForfeit ? "loss" : oppForfeit ? "win" : x < 0.008 ? "draw" : x < 0.008 + wr * 0.992 ? "win" : "loss";
      const input: RewardInput = {
        matchId: `${this.userId}:${day}:${this.matches}:${t}`,
        kind,
        outcome,
        endReason: ownForfeit ? "resign" : oppForfeit ? "left" : "completed",
        score,
        card,
        opponentUserId: kind === "random" ? `o${Math.floor(this.r() * P.opponentPool)}` : undefined,
        stats,
        endedAt: Math.floor(t),
      };
      const curDay = economyDay(input.endedAt);
      const fullBand = (this.econ.day === curDay ? this.econ.rewarded : 0) < this.p.daily.fullMatches;
      const boost = this.boostFor(startMs, curDay, fullBand);
      const out = applyMatchV2(this.econ, this.ext, input, { userId: this.userId, createdAt: this.createdAt }, this.p, boost);
      this.econ = out.state;
      this.ext = out.ext;
      if (out.boostCoins > 0) {
        if (b.kind === "matches") this.boosterState.matchesLeft--;
        if (b.kind === "extra") this.boosterState.extraLeft -= out.boostCoins;
        if (this.measuring) this.boostCoins += out.boostCoins;
      }
      if (out.position !== null && this.measuring) this.paidMatches += out.position <= this.p.daily.reducedUntil ? 1 : 0;
      if (out.position !== null && out.position > this.p.daily.fullMatches) reducedHit = true;
      if (out.position !== null && out.position >= this.p.daily.reducedUntil) cappedHit = true;
      this.grant(out.grants);
      this.spend(drawRoll);
    }
    // (fixed after the 2026-11-27 full run: this used to compare the absolute economy day with the
    // relative sim day, so reducedDayShare / cappedDayShare / everCapped were always 0 in that run)
    if (this.measuring && reducedHit) this.daysReduced++;
    if (this.measuring && cappedHit) this.daysCapped++;
    this.spend(drawRoll);
    if (this.measuring) this.res.maxCoinsDay = Math.max(this.res.maxCoinsDay, this.coinsToday);
  }

  rerollSlowQuest() {
    const idx = this.econ.daily.findIndex((q) => !q.done && ["d.yacht1", "d.win2"].includes(q.id));
    if (idx < 0) return;
    const r = replaceQuests(this.econ, this.userId, "daily", this.econ.day, idx);
    if (r.ok) this.econ = r.state;
  }

  snapshot(day: number): Snapshot {
    const ownedByTier: Record<string, number> = {};
    let value = 0;
    let lv3 = 0;
    for (const [id, lv] of this.owned) {
      const it = this.byId.get(id);
      if (!it) continue;
      ownedByTier[it.tier] = (ownedByTier[it.tier] ?? 0) + 1;
      value += it.coins ?? (it.gems ?? 0) * 20;
      if (lv >= 3) lv3++;
    }
    let complete = 0;
    let synergy = 0;
    for (const c of COLLECTION_ITEMS) {
      if (c.items.every((id) => this.owned.has(id))) complete++;
      if (c.dice.some((d) => this.owned.has(d)) && c.boards.some((b) => this.owned.has(b))) synergy++;
    }
    return {
      day, minutes: this.minutes, matches: this.matches, paidMatches: this.paidMatches, coinsEarned: this.earned.coins, gemsEarned: this.earned.gems, bySource: { ...this.bySource }, spent: { ...this.spent },
      coins: this.wallet.coins, gems: this.wallet.gems, owned: this.owned.size, ownedByTier, ownedValue: value, lv3, collectionsComplete: complete, synergyReady: synergy,
      daysReduced: this.daysReduced, daysCapped: this.daysCapped, activeDays: this.activeDays, boostCoins: this.boostCoins, boosterMinutesGranted: this.boosterGranted, boosterMinutesUsed: this.boosterUsed,
      draws: this.drawsTotal, duplicates: this.duplicates,
      affordableUnowned: this.cat.filter((i) => i.coins !== null && !this.owned.has(i.id) && i.coins <= this.wallet.coins).length,
      cheapestUnowned: this.cat.filter((i) => i.coins !== null && !this.owned.has(i.id)).reduce<number | null>((m, i) => (m === null || i.coins! < m ? i.coins! : m), null),
      wishLeft: this.wantedUnowned().length,
    };
  }
}

/** Simulate one player under candidate `p` (after optional warm-up under the baseline). */
export function simulateUser(persona: Persona, p: V2Params, seed: number, index: number, opts: SimOptions): UserResult {
  const r = mulberry32(hashSeed("econ-v2", seed, persona.id, index));
  const userId = `u${seed}-${index}`;
  const createdAt = opts.t0 - opts.warmupDays * 86_400_000 + 3600_000 * 12;
  const pl = new Player(userId, persona, createdAt, r, opts);
  const warm = opts.warmupParams ?? p;
  pl.setParams(opts.warmupDays > 0 ? warm : p, true);
  pl.grant([welcomeGrant(opts.warmupDays > 0 ? warm : p)]);
  if (opts.warmupDays === 0 && p.starter) pl.freeDrawsLeft += p.starter.freeDraws;
  for (let d = -opts.warmupDays; d < 0; d++) pl.playDay(d);
  if (opts.warmupDays > 0) pl.setParams(p, false);
  pl.measuring = true;
  pl.measureStartMin = 0;
  pl.minutes = 0;
  // the new-user grant is part of what a new player earns; for warm-up users it was earned before day 0
  if (opts.warmupDays === 0) {
    pl.earned.coins += p.newUser.coins;
    pl.earned.gems += p.newUser.gems;
    pl.bySource.welcome = p.newUser.coins;
  }
  const snaps = new Set(opts.snapshots);
  for (let d = 0; d < opts.days; d++) {
    pl.playDay(d);
    if (snaps.has(d + 1)) pl.res.snapshots.push(pl.snapshot(d + 1));
  }
  return pl.res;
}

export const questLabel = (id: string) => questById(id)?.label ?? id;
export type { TierId };
