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
export type DrawStatus = { now: number; remaining: number; history: DrawReceipt[] };
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
  return ITEMS.filter((item) => item.tier === tier && !item.retired &&
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
