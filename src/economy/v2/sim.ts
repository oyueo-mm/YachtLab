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
import { economyDay, economyWeek, questById, type MatchKind, type TierId } from "../live/config";
import { newEconState, replaceQuests, rollover, type EconState, type MatchStats, type RewardInput } from "../live/rewards";
import { hashSeed, mulberry32, normal, poisson, type Rng } from "../rng";
import { COLLECTION_ITEMS, DRAW_TIER_P, drawPools, pricedCatalog, type PricedItem } from "./catalog";
import { applyMatchV2, newExt, unlockV2Achievements, welcomeGrant, type BoostCtx, type V2Ext, type V2Grant } from "./engine";
import { PRICED_TIERS, type PricedTier, type V2Params } from "./params";

export type PlayMode = MatchKind | "offline" | "solo";
export type SpendStyle = "spender" | "saver" | "upgrader" | "drawer" | "collector" | "reserve" | "indifferent";
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
  interest?: "all" | "looks" | "social";
  preference?: "tier" | "stable";
  favorite?: "first" | "cheapest";
  reserveCoins?: number;
  weekendOnly?: boolean;
  queueSuccess?: number;
  /** UTC hour when exogenous demand has exhausted the global AI-room allocation. */
  aiClosesAt?: number;
};

export type ResearchTransaction = {
  kind: "buy" | "upgrade" | "draw"; itemId: string; currency: "coins" | "gems"; amount: number; day: number; level?: number;
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
  audited?: boolean;
  proposedChat?: boolean;
  initialCoins?: number;
  initialGems?: number;
  /** Synthetic pre-existing paid ownership. */
  initialItems?: Readonly<Record<string, number>>;
  suppressWelcome?: boolean;
  recordTransaction?: (transaction: ResearchTransaction) => void;
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
  audit?: {
    ownedValueFixed: number;
    ownedByTier: Record<string, number>;
    buyable: number;
    affordableWithGems: number;
    netCoins: number;
    netGems: number;
    aiDenied: number;
    waitMin: number;
    modes: Partial<Record<PlayMode, number>>;
    boostedSessions: number;
    boosterSessions: number;
    purchases: number;
    potentialAiStarts: number;
    eligibleAiStarts: number;
    firstLevel2Day: number | null;
    desiredTime: number | null;
    desiredDay: number | null;
    purchaseTimes: number[];
    purchaseDays: number[];
    grantsByGems: Record<string, number>;
    forbids: Record<string, number>;
  };
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

const DAY = 86_400_000;
const HOUR = 3_600_000;
const SIGMA = 0.25;
const lognormal = (r: Rng, mean: number) => mean * Math.exp(SIGMA * normal(r) - (SIGMA * SIGMA) / 2);
type Mirror = { meanTotal: number; sdTotal: number };
const mirror = (matchEvents as unknown as { mirror: Record<string, Mirror> }).mirror;

function pickMode(r: Rng, entries: [PlayMode, number][], total: number): PlayMode {
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
  coinWish: PricedItem[] = [];
  gemWish: PricedItem[] = [];
  looksWish: PricedItem[] = [];
  upgradeWish: PricedItem[] = [];
  favoriteItem?: PricedItem;
  lastSpend: { coins: number; gems: number; draws: number; drawRoll: boolean } | null = null;
  priority = new Map<string, number>();
  desired = new Set<string>();
  achievementItems = new Set<string>();
  refById = new Map<string, PricedItem>();
  giftIds = new Set<string>();
  lastTransaction = -Infinity;
  lastSessionEnd = -Infinity;
  reducedDays = new Set<number>();
  cappedDays = new Set<number>();
  settlementDays = new Set<number>();
  aiAttempts = 0;
  aiAccepted = 0;
  aiDenied = 0;
  waitMin = 0;
  modeCounts: Partial<Record<PlayMode, number>> = {};
  boostedSessions = 0;
  boosterSessions = 0;
  firstLevel2Day: number | null = null;
  desiredTime: number | null = null;
  desiredDay: number | null = null;
  purchaseTimes: number[] = [];
  purchaseDays: number[] = [];
  gemSource: Record<string, number> = {};
  forbids: Record<string, number> = {};
  coinsByDay = new Map<number, number>();
  drawR: Rng;
  playR: Rng;
  modeWeights: [PlayMode, number][];
  modeWeightTotal: number;
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

  constructor(readonly userId: string, readonly persona: Persona, readonly createdAt: number, readonly r: Rng, readonly opts: SimOptions, readonly userSeed: number) {
    this.econ = newEconState(userId, createdAt);
    this.drawR = opts.audited ? mulberry32(hashSeed(userSeed, "draw")) : r;
    this.playR = r;
    this.modeWeights = Object.entries(persona.modeMix) as [PlayMode, number][];
    this.modeWeightTotal = this.modeWeights.reduce((sum, [, weight]) => sum + weight, 0);
  }

  setParams(p: V2Params, rollWish: boolean) {
    this.p = p;
    const audited = this.opts.audited;
    const catalogOptions = { audited, revision: (this.opts.includeRev2 ? 2 : 1) as 1 | 2,
      proposedChat: this.opts.proposedChat && (!rollWish || this.opts.warmupDays === 0) };
    const all = pricedCatalog(p, audited ? catalogOptions : {});
    this.cat = all.filter((i) => !i.season && (this.opts.includeRev2 || i.rev <= 1) && i.tier !== "basic" && i.tier !== "special");
    this.byId = new Map((audited ? all : this.cat).map((i) => [i.id, i]));
    this.pools = drawPools(this.cat);
    if (audited) {
      for (const i of all) if (i.defaultOwned) this.giftIds.add(i.id);
      const base = this.opts.warmupParams ?? p;
      this.refById = new Map(pricedCatalog(base, { ...catalogOptions, proposedChat: this.opts.proposedChat }).map((i) => [i.id, i]));
      for (const i of pricedCatalog(base, { ...catalogOptions, proposedChat: false })) if (i.category === "chat") this.refById.set(i.id, i);
    }
    if (audited) this.setWishes();
    else if (rollWish) {
      // The historical run used the live-tier probabilities and one shared RNG.
      const want = this.persona.spend === "collector" ? { common: 1, rare: 1, epic: 1, legendary: 1, mythic: 1 } : this.persona.want;
      this.wishIds = this.cat.filter((i) => this.r() < want[i.liveTier as PricedTier] && (i.coins !== null || i.gems !== null)).map((i) => i.id);
    }
    this.wish = this.wishIds.map((id) => this.byId.get(id)).filter((i): i is PricedItem => !!i);
    this.coinWish = this.wish.filter((i) => i.coins !== null).sort((a, b) => a.coins! - b.coins!);
    this.gemWish = this.wish.filter((i) => i.gems !== null).sort((a, b) => a.gems! - b.gems!);
    this.looksWish = this.coinWish.filter((i) => i.category === "dice" || i.category === "board")
      .sort((a, b) => audited ? this.priority.get(a.id)! - this.priority.get(b.id)! : b.coins! - a.coins! || this.wish.indexOf(a) - this.wish.indexOf(b));
    this.upgradeWish = this.coinWish.filter((i) => i.up);
    this.lastSpend = null;
    this.goal = null;
    this.favoriteItem = undefined;
    for (const id of this.owned.keys()) {
      const item = this.byId.get(id);
      if (item) this.considerFavorite(item);
    }
  }
  wishIds: string[] = [];

  setWishes() {
    const reference = this.refById;
    const interest = this.persona.interest ?? "all";
    const matchesInterest = (i: PricedItem) => interest === "all" ||
      (interest === "looks" ? i.category === "dice" || i.category === "board" : i.category === "chat" || i.category === "emote");
    const candidates = this.cat.filter((i) => (i.coins !== null || i.gems !== null) && !this.giftIds.has(i.id) && matchesInterest(i));
    this.wishIds = candidates.filter((i) => {
      const price = reference.get(i.id)?.coins ?? i.coins ?? Infinity;
      const draw = mulberry32(hashSeed(this.userSeed, "want", i.id))();
      this.priority.set(i.id, this.persona.spend === "saver" ? -price : mulberry32(hashSeed(this.userSeed, "priority", i.id))());
      return this.persona.spend === "collector" || draw < (this.persona.preference === "tier" ? this.persona.want[i.liveTier as PricedTier] ?? 0.55 : 0.55);
    }).map((i) => i.id);
    if (!this.wishIds.length && candidates.length) this.wishIds.push(candidates[0].id);
  }

  setDesired() {
    this.desired = new Set(this.wishIds.filter((id) => !this.owned.has(id))
      .sort((a, b) => (this.priority.get(a) ?? 0) - (this.priority.get(b) ?? 0)).slice(0, 1));
  }

  grant(gs: V2Grant[]) {
    for (const g of gs) {
      if (this.opts.audited && "item" in g && g.item) this.achievementItems.add(g.item);
      if (!g.coins && !g.gems) continue;
      this.wallet.coins += g.coins;
      this.wallet.gems += g.gems;
      if (this.measuring) {
        this.earned.coins += g.coins;
        this.earned.gems += g.gems;
        this.bySource[g.kind] = (this.bySource[g.kind] ?? 0) + g.coins;
        if (this.opts.audited) {
          this.gemSource[g.kind] = (this.gemSource[g.kind] ?? 0) + g.gems;
          const total = (this.coinsByDay.get(this.day) ?? 0) + g.coins;
          this.coinsByDay.set(this.day, total);
          this.res.maxCoinsDay = Math.max(this.res.maxCoinsDay, total);
        }
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
    if (this.opts.audited) {
      if (this.desired.has(item.id) && this.desiredTime === null) [this.desiredTime, this.desiredDay] = [m, this.day];
      if (viaBuy) {
        this.purchaseTimes.push(m);
        this.purchaseDays.push(this.day);
      }
    }
    if (viaBuy && this.res.firstBuyMin === null) [this.res.firstBuyMin, this.res.firstBuyDay] = [m, this.day];
    const t = item.tier as PricedTier;
    if (PRICED_TIERS.includes(t) && this.res.firstTierMin[t] === null) {
      this.res.firstTierMin[t] = m;
      this.res.firstTierDay[t] = this.day;
    }
  }
  considerFavorite(item: PricedItem) {
    if (!item.up || (item.category !== "dice" && item.category !== "board")) return;
    const old = this.favoriteItem;
    if (!old || (this.opts.audited && this.persona.favorite !== "first" &&
      item.up[0] + (item.up[1] ?? 0) < old.up![0] + (old.up![1] ?? 0))) this.favoriteItem = item;
  }
  addItem(item: PricedItem, viaBuy: boolean) {
    this.owned.set(item.id, 1);
    this.considerFavorite(item);
    this.markObtained(item, viaBuy);
    if (this.opts.audited) {
      const out = unlockV2Achievements({ ...this.econ, counters: { ...this.econ.counters, items: this.owned.size } }, this.p);
      this.econ = out.state;
      this.grant(out.grants);
    }
    if (this.p.collectionReward)
      for (const c of COLLECTION_ITEMS)
        if (!this.collectionsPaid.has(c.id) && c.items.every((id) => this.owned.has(id) || this.giftIds.has(id))) {
          this.collectionsPaid.add(c.id);
          this.grant([{ key: `col:${c.id}`, kind: "collection", coins: this.p.collectionReward.coins, gems: this.p.collectionReward.gems, label: "컬렉션 완성" }]);
        }
  }

  /* ------------------------------------------------------------ spending ------------------------------------------------------------ */
  priceFor(item: PricedItem, cur: "coins" | "gems") {
    const base = cur === "coins" ? item.coins : item.gems;
    if (base === null) return null;
    const st = this.p.starter;
    if ((!this.opts.audited || this.opts.warmupDays === 0) && !this.firstBuyDone && st && PRICED_TIERS.indexOf(item.tier as PricedTier) <= PRICED_TIERS.indexOf(st.maxTier)) return Math.max(1, Math.floor((base * (100 - st.firstPurchaseDiscountPct)) / 100));
    const b = this.p.booster;
    if (b.kind === "coupon" && b.discountPct > 0 && this.couponWeek.n < b.discountPerWeek) return Math.max(1, Math.floor((base * (100 - b.discountPct)) / 100));
    return base;
  }
  buy(item: PricedItem, cur: "coins" | "gems"): boolean {
    const price = this.priceFor(item, cur);
    if (price === null || this.owned.has(item.id) || this.wallet[cur] - (cur === "coins" ? this.persona.reserveCoins ?? 0 : 0) < price) return false;
    const full = cur === "coins" ? item.coins! : item.gems!;
    const b = this.p.booster;
    const st = this.p.starter;
    const starterUsed = this.opts.warmupDays === 0 && !this.firstBuyDone && st &&
      PRICED_TIERS.indexOf(item.tier as PricedTier) <= PRICED_TIERS.indexOf(st.maxTier);
    if ((this.opts.audited ? !starterUsed : this.firstBuyDone) && b.kind === "coupon" && price < full) this.couponWeek.n++;
    this.wallet[cur] -= price;
    this.opts.recordTransaction?.({ kind: "buy", currency: cur, amount: price, itemId: item.id, day: this.day });
    if (this.measuring) cur === "coins" ? (this.spent.item += price) : (this.spent.gemsItem += price);
    this.firstBuyDone = true;
    this.addItem(item, true);
    return true;
  }
  upgrade(item: PricedItem): boolean {
    const lv = this.owned.get(item.id);
    if (!lv || !item.up || lv >= item.maxLevel) return false;
    const cost = item.up[lv - 1];
    if (cost == null || this.wallet.coins - (this.persona.reserveCoins ?? 0) < cost) return false;
    this.wallet.coins -= cost;
    this.opts.recordTransaction?.({ kind: "upgrade", currency: "coins", amount: cost, itemId: item.id, day: this.day, level: lv });
    if (this.measuring) this.spent.upgrade += cost;
    this.owned.set(item.id, lv + 1);
    if (this.opts.audited && lv === 1 && this.measuring && this.firstLevel2Day === null) this.firstLevel2Day = this.day;
    if (lv + 1 === 3 && this.measuring && this.res.firstLv3Min === null) {
      this.res.firstLv3Min = this.playMin();
      this.res.firstLv3Day = this.day;
    }
    return true;
  }
  drawOnce(free: boolean): boolean {
    if (!free) {
      if (this.drawsToday.n >= this.p.draw.dailyLimit || this.wallet.coins - (this.persona.reserveCoins ?? 0) < this.p.draw.cost) return false;
      this.drawsToday.n++;
      this.wallet.coins -= this.p.draw.cost;
      if (this.measuring) this.spent.draw += this.p.draw.cost;
    }
    let x = this.drawR();
    let tier: PricedTier = "common";
    for (const t of PRICED_TIERS) if ((x -= DRAW_TIER_P[t]) <= 0) { tier = t; break; }
    const pool = this.pools[tier];
    if (!pool.length) throw new Error(`Empty standard draw tier: ${tier}`);
    const item = pool[Math.floor(this.drawR() * pool.length)];
    this.opts.recordTransaction?.({ kind: "draw", currency: "coins", amount: free ? 0 : this.p.draw.cost, itemId: item.id, day: this.day });
    if (this.measuring) this.drawsTotal++;
    if (this.owned.has(item.id) || this.giftIds.has(item.id)) {
      if (this.measuring) this.duplicates++;
      this.grant([{ key: "dup", kind: "draw-duplicate", coins: this.p.draw.duplicateCoins, gems: 0, label: "" }]);
    } else this.addItem(item, false);
    return true;
  }

  wantedUnowned() {
    return this.wish.filter((i) => !this.owned.has(i.id) && !this.giftIds.has(i.id));
  }
  spend(sessionDrawRoll: boolean, at: number) {
    if (this.opts.audited) {
      if (at < this.lastTransaction) throw new Error("Out-of-order purchase");
      this.lastTransaction = at;
      this.econ = rollover(this.econ, this.userId, at);
    }
    const day = this.opts.audited ? economyDay(at) : this.day;
    if (this.drawsToday.day !== day) this.drawsToday = { day, n: 0 };
    const week = this.opts.audited ? economyWeek(at) : Math.floor((day + 3) / 7);
    if (this.couponWeek.week !== week) this.couponWeek = { week, n: 0 };
    const last = this.lastSpend;
    if (this.opts.audited && this.p.booster.kind !== "coupon" && this.freeDrawsLeft === 0 && last?.coins === this.wallet.coins &&
      last.gems === this.wallet.gems && last.draws === this.drawsToday.n && last.drawRoll === sessionDrawRoll) return;
    const spendBefore = this.opts.audited ? { ...this.wallet, draws: this.drawsToday.n, owned: this.owned.size } : null;
    while (this.freeDrawsLeft > 0) {
      if (this.opts.audited && this.drawsToday.n >= this.p.draw.dailyLimit) break;
      if (this.opts.audited) this.drawsToday.n++;
      this.freeDrawsLeft--;
      this.drawOnce(true);
    }
    const style = this.persona.spend;
    if (style === "indifferent") return;
    if (style === "drawer" || (sessionDrawRoll && style !== "saver")) while (this.drawOnce(false));
    const unowned = (i: PricedItem) => !this.owned.has(i.id) && !this.giftIds.has(i.id);
    const nextItem = (list: PricedItem[]) => {
      const b = this.p.booster;
      const st = this.p.starter;
      const specialPrice = this.opts.audited && ((!this.firstBuyDone && st) || (b.kind === "coupon" && this.couponWeek.n < b.discountPerWeek));
      if (!specialPrice) return list.find(unowned);
      let next: PricedItem | undefined, best = Infinity;
      for (const i of list) {
        if (!unowned(i)) continue;
        const price = this.priceFor(i, "coins")!;
        if (price < best) [best, next] = [price, i];
      }
      return next;
    };
    if (style === "saver") {
      if (!this.goal || this.owned.has(this.goal.id) && (this.owned.get(this.goal.id)! >= this.goal.maxLevel || !this.goal.up)) {
        this.goal = this.looksWish.find(unowned) ?? null;
      }
      if (this.goal) {
        if (!this.owned.has(this.goal.id)) this.buy(this.goal, "coins");
        while (this.owned.has(this.goal.id) && this.upgrade(this.goal));
      }
    } else if (style === "upgrader") {
      // finish upgrades of what is owned first (cheapest next level), then buy the cheapest wanted upgradable item
      for (;;) {
        const up = [...this.owned.entries()].map(([id, lv]) => ({ it: this.byId.get(id), lv })).filter((x) => x.it?.up && x.lv < x.it.maxLevel).sort((a, z) => a.it!.up![a.lv - 1]! - z.it!.up![z.lv - 1]!);
        if (up.length) {
          if (!this.upgrade(up[0].it!)) break;
          continue;
        }
        const next = nextItem(this.upgradeWish);
        if (!next || !this.buy(next, "coins")) break;
      }
    } else {
      // spender / drawer / collector: whichever is cheaper — the next wanted item, or the next level of the
      // favourite (first die or board bought; collectors never upgrade)
      for (;;) {
        const next = nextItem(this.coinWish);
        const fav = style === "collector" ? undefined : this.favoriteItem;
        const favLv = fav ? this.owned.get(fav.id)! : 3;
        const upCost = fav && favLv < fav.maxLevel ? fav.up![favLv - 1] ?? Infinity : Infinity;
        if (Number.isFinite(upCost) && upCost <= (this.opts.audited && next ? this.priceFor(next, "coins")! : next?.coins ?? Infinity)) {
          if (!this.upgrade(fav!)) break;
        } else if (!next || !this.buy(next, "coins")) break;
      }
    }
    // gems: cheapest wanted gem-purchasable item
    for (;;) {
      const g = this.gemWish.find(unowned);
      if (!g || !this.buy(g, "gems")) break;
    }
    this.lastSpend = spendBefore && spendBefore.coins === this.wallet.coins && spendBefore.gems === this.wallet.gems &&
      spendBefore.draws === this.drawsToday.n && spendBefore.owned === this.owned.size
      ? { coins: this.wallet.coins, gems: this.wallet.gems, draws: this.drawsToday.n, drawRoll: sessionDrawRoll } : null;
  }

  /* ------------------------------------------------------------- play ------------------------------------------------------------- */
  boosterState = { day: -1, windowEnd: -1, matchesLeft: 0, extraLeft: 0 };
  boostFor(startMs: number, day: number, fullBand: boolean): BoostCtx {
    const b = this.p.booster;
    if (!fullBand) return null;
    if (b.kind === "time") return startMs < this.boosterState.windowEnd ? { mult: b.mult, dailyExtraCap: b.dailyExtraCap, day } : null;
    if (b.kind === "matches") return this.boosterState.matchesLeft > 0 ? { mult: b.mult, dailyExtraCap: b.dailyExtraCap, day } : null;
    if (b.kind === "extra") return this.boosterState.extraLeft > 0 ? { mult: b.mult, dailyExtraCap: b.dailyExtraCap, day, budgetLeft: this.boosterState.extraLeft } : null;
    if (b.kind === "auto") return (this.econ.day === day ? this.econ.rewarded : this.opts.audited ? 0 : Infinity) < b.matches ? { mult: b.mult, dailyExtraCap: b.dailyExtraCap, day } : null;
    if (b.kind === "event") {
      const local = new Date(startMs + 9 * 3600_000);
      const h = local.getUTCHours();
      return b.weekdays.includes(local.getUTCDay()) && h >= b.startHour && h < b.endHour ? { mult: b.mult, dailyExtraCap: b.dailyExtraCap, day } : null;
    }
    return null;
  }

  playDay(day: number) {
    this.day = day;
    const audited = this.opts.audited;
    if (audited) this.playR = mulberry32(hashSeed(this.userSeed, "play", day));
    const r = () => this.playR();
    const P = this.persona;
    const dayStart = this.opts.t0 + day * 86_400_000; // KST midnight
    this.coinsToday = 0;
    const weekday = new Date(dayStart + 12 * HOUR).getUTCDay();
    if (r() >= P.activeProb || (P.weekendOnly && weekday !== 0 && weekday !== 6)) return;
    this.activeDays += this.measuring ? 1 : 0;
    let t = dayStart + (P.startHour + (r() * 2 - 1)) * HOUR;
    if (audited) t = Math.max(this.lastSessionEnd, Math.min(dayStart + DAY - 1, Math.max(dayStart, t)));
    const sessionDay = audited ? economyDay(t) : day;
    if (audited) {
      this.day = sessionDay - economyDay(this.opts.t0);
      if (this.measuring) this.settlementDays.add(sessionDay);
    }
    const budgetMs = P.minutesPerDay * 60_000;
    const end = t + budgetMs;
    const b = this.p.booster;
    // a booster (if any) is granted per economy day and activated when the session starts
    if (b.kind === "time" || b.kind === "matches" || b.kind === "extra") {
      this.boosterState = { day, windowEnd: b.kind === "time" ? t + b.minutes * 60_000 : -1, matchesLeft: b.kind === "matches" ? b.matches : 0, extraLeft: b.kind === "extra" ? b.extraCoins : 0 };
      if (b.kind === "time" && this.measuring) {
        this.boosterGranted += b.minutes;
        if (!audited) this.boosterUsed += Math.min(b.minutes, P.minutesPerDay);
      }
    }
    if (b.kind === "coupon") this.freeDrawsLeft += b.freeDrawsPerDay;
    if (audited) this.econ = rollover(this.econ, this.userId, t);
    if (r() < P.questFocus) this.rerollSlowQuest();
    const drawRoll = r() < P.drawAppetite;
    if (audited) this.spend(drawRoll, t);
    let sessionBoost = 0;
    let sessionBenefit = false;
    if (audited && this.measuring && b.kind !== "none") this.boosterSessions++;
    let extraForQuests = P.questFocus > 0.5 ? 2 : 0;
    let aiStarts = 0;
    let matchIndex = 0;
    let reducedHit = false;
    let cappedHit = false;
    for (;;) {
      if (t >= end) {
        if (extraForQuests > 0 && this.econ.daily.some((q) => !q.done)) extraForQuests--;
        else break;
      }
      const tBefore = t;
      if (audited) this.playR = mulberry32(hashSeed(this.userSeed, "match", day, matchIndex++));
      let mode = pickMode(r, this.modeWeights, this.modeWeightTotal);
      if (mode === "random") {
        const unsuccessful = P.queueSuccess !== undefined && r() >= P.queueSuccess;
        const wait = unsuccessful ? Infinity : -Math.log(1 - r()) * P.queue.meanWaitSec;
        if (audited && this.measuring) this.waitMin += Math.min(wait, P.queue.patienceSec) / 60;
        if (wait > P.queue.patienceSec) {
          t += P.queue.patienceSec * 1000;
          mode = P.queue.fallback;
        } else t += wait * 1000;
      }
      if (mode === "ai") {
        if (!audited) {
          if (aiStarts >= this.p.daily.aiStarts) mode = "offline";
          else aiStarts++;
        } else {
          this.econ = rollover(this.econ, this.userId, t);
          const utcHour = t % DAY / HOUR;
          const denied = this.econ.aiStarts >= this.p.daily.aiStarts || (P.aiClosesAt !== undefined && utcHour >= P.aiClosesAt);
          if (this.measuring) this.aiAttempts++;
          if (denied) {
            if (this.measuring) this.aiDenied++;
            mode = "offline";
          } else {
            if (this.measuring) this.aiAccepted++;
            this.econ = { ...this.econ, aiStarts: this.econ.aiStarts + 1 };
          }
        }
      }
      const startMs = t;
      const dur = lognormal(r, P.matchMinutes[mode]) * 60_000;
      const ownForfeit = mode !== "solo" && mode !== "offline" && r() < P.ownForfeit;
      const oppForfeit = !ownForfeit && (mode === "random" || mode === "friend") && r() < P.oppForfeit;
      const frac = ownForfeit || oppForfeit ? 0.2 + r() * 0.7 : 1;
      t += dur * frac;
      if (this.measuring) {
        this.minutes += (t - tBefore) / 60_000; // queue wait + match
        this.matches++;
        if (audited) this.modeCounts[mode] = (this.modeCounts[mode] ?? 0) + 1;
      }
      if (audited) {
        this.day = economyDay(t) - economyDay(this.opts.t0);
        if (this.measuring) this.settlementDays.add(economyDay(t));
      }
      if (mode === "offline" || mode === "solo") continue; // local play: no official currency (trust boundary)
      const kind = mode as MatchKind;
      const wr = P.winRate[kind];
      const filledCount = oppForfeit ? 1 + Math.floor(r() * 11) : 12;
      const { card, score, stats } = synthCard(r, P.skill, wr, filledCount);
      const x = r();
      const outcome: RewardInput["outcome"] = ownForfeit ? "loss" : oppForfeit ? "win" : x < 0.008 ? "draw" : x < 0.008 + wr * 0.992 ? "win" : "loss";
      const input: RewardInput = {
        matchId: `${this.userId}:${day}:${this.matches}:${t}`,
        kind,
        outcome,
        endReason: ownForfeit ? "resign" : oppForfeit ? "left" : "completed",
        score,
        card,
        opponentUserId: kind === "random" ? `o${Math.floor(r() * P.opponentPool)}` : undefined,
        stats,
        endedAt: Math.floor(t),
      };
      const curDay = economyDay(input.endedAt);
      const fullBand = (this.econ.day === curDay ? this.econ.rewarded : 0) < this.p.daily.fullMatches;
      const boost = this.boostFor(startMs, curDay, fullBand);
      const out = applyMatchV2(this.econ, this.ext, input, { userId: this.userId, createdAt: this.createdAt }, this.p, boost);
      this.econ = out.state;
      this.ext = out.ext;
      if (audited && this.measuring) {
        if (out.reason !== "ok") this.forbids[out.reason] = (this.forbids[out.reason] ?? 0) + 1;
        if (out.position !== null && out.position > this.p.daily.fullMatches && out.position <= this.p.daily.reducedUntil) this.reducedDays.add(curDay);
        if (out.position !== null && out.position >= this.p.daily.reducedUntil) this.cappedDays.add(curDay);
      }
      if (out.boostCoins > 0) {
        sessionBenefit = true;
        if (audited && b.kind === "time") sessionBoost += Math.max(0, Math.min(t, this.boosterState.windowEnd) - startMs) / 60_000;
        if (b.kind === "matches") this.boosterState.matchesLeft--;
        if (b.kind === "extra") this.boosterState.extraLeft -= out.boostCoins;
        if (this.measuring) this.boostCoins += out.boostCoins;
      }
      if (out.position !== null && this.measuring) this.paidMatches += out.position <= this.p.daily.reducedUntil ? 1 : 0;
      if (out.position !== null && out.position > this.p.daily.fullMatches) reducedHit = true;
      if (out.position !== null && out.position >= this.p.daily.reducedUntil) cappedHit = true;
      this.grant(out.grants);
      this.spend(drawRoll, t);
    }
    // (fixed after the 2026-11-27 full run: this used to compare the absolute economy day with the
    // relative sim day, so reducedDayShare / cappedDayShare / everCapped were always 0 in that run)
    if (this.measuring && reducedHit) this.daysReduced++;
    if (this.measuring && cappedHit) this.daysCapped++;
    this.spend(drawRoll, t);
    if (audited) {
      this.lastSessionEnd = t;
      if (this.measuring) {
        if (sessionBenefit) this.boostedSessions++;
        if (b.kind === "time") this.boosterUsed += sessionBoost;
      }
    } else if (this.measuring) this.res.maxCoinsDay = Math.max(this.res.maxCoinsDay, this.coinsToday);
  }

  rerollSlowQuest() {
    const idx = this.econ.daily.findIndex((q) => !q.done && ["d.yacht1", "d.win2"].includes(q.id));
    if (idx < 0) return;
    const r = replaceQuests(this.econ, this.userId, "daily", this.econ.day, idx);
    if (r.ok) this.econ = r.state;
  }

  snapshot(day: number): Snapshot {
    const audited = this.opts.audited;
    const priceValue = (i: PricedItem | undefined) => i?.coins ?? (i?.gems ?? 0) * 20;
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
      if (c.items.every((id) => this.owned.has(id) || this.giftIds.has(id))) complete++;
      if (c.dice.some((d) => this.owned.has(d) || this.giftIds.has(d)) && c.boards.some((b) => this.owned.has(b) || this.giftIds.has(b))) synergy++;
    }
    return {
      day, minutes: this.minutes, matches: this.matches, paidMatches: this.paidMatches, coinsEarned: this.earned.coins, gemsEarned: this.earned.gems, bySource: { ...this.bySource }, spent: { ...this.spent },
      coins: this.wallet.coins, gems: this.wallet.gems, owned: this.owned.size, ownedByTier, ownedValue: value, lv3, collectionsComplete: complete, synergyReady: synergy,
      daysReduced: audited ? this.reducedDays.size : this.daysReduced, daysCapped: audited ? this.cappedDays.size : this.daysCapped, activeDays: audited ? this.settlementDays.size : this.activeDays, boostCoins: this.boostCoins, boosterMinutesGranted: this.boosterGranted, boosterMinutesUsed: this.boosterUsed,
      draws: this.drawsTotal, duplicates: this.duplicates,
      affordableUnowned: this.cat.filter((i) => i.coins !== null && !this.owned.has(i.id) && !this.giftIds.has(i.id) && i.coins <= this.wallet.coins).length,
      cheapestUnowned: this.cat.filter((i) => i.coins !== null && !this.owned.has(i.id) && !this.giftIds.has(i.id)).reduce<number | null>((m, i) => (m === null || i.coins! < m ? i.coins! : m), null),
      wishLeft: this.wantedUnowned().length,
      ...(audited ? { audit: {
        ownedValueFixed: [...this.owned.keys()].reduce((sum, id) => sum + priceValue(this.refById.get(id)), 0),
        ownedByTier, buyable: this.cat.filter((i) => i.coins !== null && !this.giftIds.has(i.id)).length,
        affordableWithGems: this.cat.filter((i) => i.gems !== null && !this.owned.has(i.id) && !this.giftIds.has(i.id) && i.gems <= this.wallet.gems).length,
        netCoins: this.earned.coins - this.spent.item - this.spent.upgrade - this.spent.draw,
        netGems: this.earned.gems - this.spent.gemsItem,
        aiDenied: this.aiDenied, waitMin: this.waitMin, modes: { ...this.modeCounts },
        boostedSessions: this.boostedSessions, boosterSessions: this.boosterSessions,
        potentialAiStarts: this.aiAttempts, eligibleAiStarts: this.aiAccepted,
        firstLevel2Day: this.firstLevel2Day, desiredTime: this.desiredTime, desiredDay: this.desiredDay,
        purchases: this.purchaseTimes.length, purchaseTimes: [...this.purchaseTimes], purchaseDays: [...this.purchaseDays],
        grantsByGems: { ...this.gemSource }, forbids: { ...this.forbids },
      } } : {}),
    };
  }
}

type WarmupState = Pick<Player, "econ" | "ext" | "firstBuyDone" | "coinsToday" | "drawsToday" | "couponWeek"> & {
  coins: number; gems: number; owned: [string, number][]; wishIds: string[];
  rngDraws: number;
};
export type LegacyWarmups = WarmupState[];

/** Simulate one player under candidate `p` (after optional warm-up under the baseline). */
export function simulateUser(persona: Persona, p: V2Params, seed: number, index: number, opts: SimOptions, warmups?: LegacyWarmups): UserResult {
  const userSeed = hashSeed("econ-v2", seed, persona.id, index);
  if (warmups && (opts.audited || !opts.warmupDays || opts.warmupParams?.id !== "BASE" || opts.suppressWelcome)) {
    throw new Error("Warm-up cache requires the legacy BASE warm-up");
  }
  const cached = warmups?.[index];
  // Mulberry32 adds this constant once per draw. Start at the exact cached RNG state.
  const rng = mulberry32(userSeed + Math.imul(0x6d2b79f5, cached?.rngDraws ?? 0));
  let rngDraws = 0;
  const r = warmups && !cached ? () => { rngDraws++; return rng(); } : rng;
  const userId = `u${seed}-${index}`;
  const createdAt = opts.t0 - opts.warmupDays * DAY + (opts.audited ? 0 : 12 * HOUR);
  const pl = new Player(userId, persona, createdAt, r, opts, userSeed);
  const warm = opts.warmupParams ?? p;
  if (cached) {
    pl.econ = cached.econ;
    pl.ext = cached.ext;
    pl.wallet = { coins: cached.coins, gems: cached.gems };
    pl.owned = new Map(cached.owned);
    pl.wishIds = cached.wishIds;
    pl.firstBuyDone = cached.firstBuyDone;
    pl.coinsToday = cached.coinsToday;
    pl.drawsToday = { ...cached.drawsToday };
    pl.couponWeek = { ...cached.couponWeek };
  } else {
    pl.setParams(opts.warmupDays > 0 ? warm : p, true);
    if (!opts.suppressWelcome) pl.grant([welcomeGrant(opts.warmupDays > 0 ? warm : p)]);
    if (opts.audited) {
      pl.wallet.coins += opts.initialCoins ?? 0;
      pl.wallet.gems += opts.initialGems ?? 0;
      for (const [id, level] of Object.entries(opts.initialItems ?? {})) {
        const item = pl.byId.get(id);
        if (item && !item.defaultOwned) pl.owned.set(id, Math.min(level, item.maxLevel));
      }
    }
    if (opts.warmupDays === 0 && p.starter) pl.freeDrawsLeft += p.starter.freeDraws;
    for (let d = -opts.warmupDays; d < 0; d++) pl.playDay(d);
    if (warmups) {
      warmups[index] = {
        econ: pl.econ, ext: pl.ext, coins: pl.wallet.coins, gems: pl.wallet.gems, owned: [...pl.owned],
        wishIds: pl.wishIds, firstBuyDone: pl.firstBuyDone, coinsToday: pl.coinsToday, rngDraws,
        drawsToday: { ...pl.drawsToday }, couponWeek: { ...pl.couponWeek },
      };
    }
  }
  if (opts.warmupDays > 0) pl.setParams(p, false);
  if (opts.audited) {
    pl.setDesired();
    if (opts.warmupDays > 0) for (const c of COLLECTION_ITEMS) {
      if (c.items.every((id) => pl.owned.has(id) || pl.giftIds.has(id))) pl.collectionsPaid.add(c.id);
    }
  }
  pl.measuring = true;
  pl.measureStartMin = 0;
  pl.minutes = 0;
  // The new-user grant is recorded only when it falls in the measurement period.
  if (opts.warmupDays === 0 && !opts.suppressWelcome) {
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
