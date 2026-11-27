/**
 * Economy v2 research parameters (C1, 2026-11-27) — RESEARCH ONLY.
 *
 * Nothing in the game reads this file: the live server still uses src/economy/live/config.ts
 * (`M3i-W30@2`). A `V2Params` object is a complete, versioned description of one candidate economy so
 * that every candidate is simulated by the same code path. `baselineParams()` is derived from the live
 * config at import time, and tests/economy-v2.test.ts checks that the research engine reproduces the
 * live `applyMatch` grant-for-grant with it.
 */
import { ECONOMY, type MatchKind, type TierId } from "../live/config";
import { DRAW_COST, DRAW_DAILY_LIMIT, DUPLICATE_COINS } from "../live/draw";

export type PricedTier = Exclude<TierId, "special" | "basic">;
export const PRICED_TIERS: readonly PricedTier[] = ["common", "rare", "epic", "legendary", "mythic"];

/**
 * Booster models under study. None of them is approved (handoff §3); multipliers are candidates.
 *  - time:     a booster that lasts `minutes` of wall-clock time after the player activates it. Benefit is
 *              decided by the server-side match START time (a match started inside the window is boosted
 *              even if it ends later).
 *  - matches:  the next `matches` rewarded full-reward matches are boosted.
 *  - extra:    boosted until the booster has paid `extraCoins` extra coins.
 *  - auto:     the first `matches` full-reward matches of each economy day are boosted automatically.
 *  - event:    a server-wide window (`startHour`..`endHour` KST, on `weekdays`) boosts every full-reward match.
 *  - coupon:   no multiplier — a daily discount coupon / free draw ticket instead (see `coupon`).
 * Boosters only ever multiply the *full-reward* match coins (never the reduced 3-coin band, quests,
 * achievements or gems) and are capped by `dailyExtraCap` per player per economy day.
 */
export type BoosterModel =
  | { kind: "none" }
  | { kind: "time"; minutes: number; mult: number; perDay: number; dailyExtraCap: number }
  | { kind: "matches"; matches: number; mult: number; perDay: number; dailyExtraCap: number }
  | { kind: "extra"; extraCoins: number; mult: number; perDay: number; dailyExtraCap: number }
  | { kind: "auto"; matches: number; mult: number; dailyExtraCap: number }
  | { kind: "event"; startHour: number; endHour: number; weekdays: number[]; mult: number; dailyExtraCap: number }
  | { kind: "coupon"; freeDrawsPerDay: number; discountPct: number; discountPerWeek: number };

export type V2Params = {
  id: string;
  label: string;
  group: string;
  match: Record<MatchKind, { complete: number; win: number; draw: number }>;
  daily: { fullMatches: number; reducedUntil: number; reducedCoins: number; friendRewarded: number; sameOpponentRewarded: number; achievementMatches: number; aiStarts: number };
  forfeitCompletionMinCategories: number;
  newUser: { coins: number; gems: number; boostDays: number; boostPerMatch: number };
  quests: {
    dailyCoins: readonly [number, number, number];
    dailyGems: readonly [number, number, number];
    dailyAllBonus: { coins: number; gems: number };
    weeklyCoins: readonly [number, number, number];
    weeklyGems: readonly [number, number, number];
    weeklyAllBonus: { coins: number; gems: number };
    dailyRerolls: number;
  };
  /** Multiplier on non-hidden achievement coins and gems (rounded). */
  achievementMult: number;
  /** Price multiplier per tier on the live list price (coins rounded down to 5, gems to 1, min 1 unit). */
  priceMult: Record<PricedTier, number>;
  /** Upgrade-cost multiplier per tier on the live upgrade cost. */
  upgradeMult: Record<PricedTier, number>;
  secondUpgradeMult?: Record<PricedTier, number>;
  draw: { cost: number; duplicateCoins: number; dailyLimit: number };
  /** Weekly best random-queue streak reward (STREAK-REVIEW option D). */
  streakWeekly: null | { thresholds: number[]; coins: number[] };
  /** One-time coins/gems when every item of a collection is owned (COLLECTIONS-2026-11-27 §2). */
  collectionReward: null | { coins: number; gems: number };
  /** Early purchase experience: a one-time discount on the first shop purchase, and free starter draws. */
  starter: null | { firstPurchaseDiscountPct: number; maxTier: PricedTier; freeDraws: number };
  booster: BoosterModel;
  /** Catalog tier mapping applied before pricing / draws (ownership and ids are never changed). */
  tierMap: "live" | "confirmed" | "confirmed+proposed";
};

export function baselineParams(): V2Params {
  return {
    id: "BASE",
    label: "현행 M3i-W30@2",
    group: "기준선",
    match: structuredClone(ECONOMY.match) as V2Params["match"],
    daily: { ...ECONOMY.daily },
    forfeitCompletionMinCategories: ECONOMY.forfeitCompletionMinCategories,
    newUser: { ...ECONOMY.newUser },
    quests: {
      dailyCoins: [...ECONOMY.quests.dailyCoins] as unknown as V2Params["quests"]["dailyCoins"],
      dailyGems: [...ECONOMY.quests.dailyGems] as unknown as V2Params["quests"]["dailyGems"],
      dailyAllBonus: { ...ECONOMY.quests.dailyAllBonus },
      weeklyCoins: [...ECONOMY.quests.weeklyCoins] as unknown as V2Params["quests"]["weeklyCoins"],
      weeklyGems: [...ECONOMY.quests.weeklyGems] as unknown as V2Params["quests"]["weeklyGems"],
      weeklyAllBonus: { ...ECONOMY.quests.weeklyAllBonus },
      dailyRerolls: ECONOMY.quests.dailyRerolls,
    },
    achievementMult: 1,
    priceMult: { common: 1, rare: 1, epic: 1, legendary: 1, mythic: 1 },
    upgradeMult: { common: 1, rare: 1, epic: 1, legendary: 1, mythic: 1 },
    draw: { cost: DRAW_COST, duplicateCoins: DUPLICATE_COINS, dailyLimit: DRAW_DAILY_LIMIT },
    streakWeekly: null,
    collectionReward: null,
    starter: null,
    booster: { kind: "none" },
    tierMap: "live",
  };
}

/** Scale every per-match coin amount (complete / win / draw of every mode) and round to integers. */
export function scaleMatch(p: V2Params, mult: number): V2Params["match"] {
  const s = (n: number) => Math.round(n * mult);
  return Object.fromEntries(Object.entries(p.match).map(([k, v]) => [k, { complete: s(v.complete), win: s(v.win), draw: s(v.draw) }])) as V2Params["match"];
}

export const uniformTiers = (x: number): Record<PricedTier, number> => ({ common: x, rare: x, epic: x, legendary: x, mythic: x });
