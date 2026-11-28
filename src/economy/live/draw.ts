import { score } from "../../engine";
import { ITEMS } from "./catalog";
import { SEASONS, seasonActive, type SeasonId } from "./seasons";

export const DRAW_COST = 250;
export const DUPLICATE_COINS = 25;
export const DRAW_DAILY_LIMIT = 5;
export const DRAW_COMBINATIONS = 6 ** 5;

export const HANDS = {
  none: { title: "노 페어", tier: "common" },
  pair: { title: "원 페어", tier: "common" },
  twoPair: { title: "투 페어", tier: "rare" },
  triple: { title: "트리플", tier: "rare" },
  small: { title: "스몰 스트레이트", tier: "epic" },
  full: { title: "풀 하우스", tier: "epic" },
  four: { title: "포카드", tier: "legendary" },
  large: { title: "라지 스트레이트", tier: "legendary" },
  yacht: { title: "요트", tier: "mythic" },
} as const;
export type DrawHand = keyof typeof HANDS;
export type DrawTier = (typeof HANDS)[DrawHand]["tier"];
export type DrawPool = "standard" | SeasonId;
export type DrawReceipt = {
  requestId: string;
  at: number;
  pool: DrawPool;
  dice: number[];
  hand: DrawHand;
  itemId: string;
  cost: number;
  duplicateCoins: number;
};
/** `odds` is the version of the server's own draw tables (absent on Workers before SEC-10). */
export type DrawStatus = { now: number; remaining: number; history: DrawReceipt[]; odds?: Partial<Record<DrawPool, string>> };
export const DRAW_TIERS: readonly DrawTier[] = ["common", "rare", "epic", "legendary", "mythic"];

export function drawHand(dice: number[]): DrawHand {
  if (score(dice, "yacht")) return "yacht";
  if (score(dice, "large")) return "large";
  if (score(dice, "four")) return "four";
  if (score(dice, "full")) return "full";
  if (score(dice, "small")) return "small";
  const counts = Array<number>(7).fill(0);
  for (const value of dice) counts[value]++;
  if (counts.includes(3)) return "triple";
  const pairs = counts.filter((count) => count === 2).length;
  return pairs === 2 ? "twoPair" : pairs === 1 ? "pair" : "none";
}

export function drawPool(input: unknown): DrawPool | null {
  if (input === "standard") return input;
  return typeof input === "string" && Object.hasOwn(SEASONS, input) ? input as SeasonId : null;
}

export function drawAvailable(pool: DrawPool, now: number) {
  return pool === "standard" || seasonActive(pool, now);
}

export function drawItems(pool: DrawPool, tier: DrawTier) {
  return ITEMS.filter((item) => item.tier === tier && !item.retired && !item.drawExcluded &&
    (item.acquisition === "either" || item.acquisition === "coins") &&
    (pool === "standard" ? !item.season : item.season === pool));
}

export function enumerateDrawHands() {
  const counts = Object.fromEntries(Object.keys(HANDS).map((hand) => [hand, 0])) as Record<DrawHand, number>;
  for (let i = 0; i < DRAW_COMBINATIONS; i++) {
    const dice = Array.from({ length: 5 }, (_, position) => Math.floor(i / 6 ** position) % 6 + 1);
    counts[drawHand(dice)]++;
  }
  return counts;
}

/**
 * The draw table a pool actually uses, as one versioned object (SEC-10 / B-22). The Worker computes it
 * from its own catalog and reports it with the draw status. The page computes the same thing from its
 * bundle, shows those odds, and sends the version with a draw. A Worker whose pool differs (Pages and
 * Worker built from different catalogs) refuses the draw with ODDS_CHANGED, so a player never draws
 * on odds that differ from the ones shown. Nothing here changes the odds themselves.
 */
export type DrawOdds = {
  version: string;
  pool: DrawPool;
  cost: number;
  duplicateCoins: number;
  dailyLimit: number;
  combinations: number;
  tiers: { tier: DrawTier; combos: number; items: string[] }[];
};
const oddsCache = new Map<DrawPool, DrawOdds>();
let handCounts: Record<DrawHand, number> | null = null;
function fnvHex(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
export function drawOdds(pool: DrawPool): DrawOdds {
  const cached = oddsCache.get(pool);
  if (cached) return cached;
  handCounts ??= enumerateDrawHands();
  const counts = handCounts;
  const tiers = DRAW_TIERS.map((tier) => ({
    tier,
    combos: (Object.keys(HANDS) as DrawHand[]).filter((hand) => HANDS[hand].tier === tier).reduce((sum, hand) => sum + counts[hand], 0),
    items: drawItems(pool, tier).map((item) => item.id).sort(),
  }));
  const body = { pool, cost: DRAW_COST, duplicateCoins: DUPLICATE_COINS, dailyLimit: DRAW_DAILY_LIMIT, combinations: DRAW_COMBINATIONS, tiers };
  const odds: DrawOdds = { version: `odds1-${fnvHex(JSON.stringify({ ...body, hands: Object.entries(HANDS).map(([hand, h]) => [hand, h.tier, counts[hand as DrawHand]]) }))}`, ...body };
  oddsCache.set(pool, odds);
  return odds;
}
