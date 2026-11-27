/**
 * Economy v2 research catalog view — RESEARCH ONLY.
 *
 * Builds a priced snapshot of the live catalog (src/economy/live/catalog.ts, 243 items) under a
 * candidate: optional tier re-mapping (confirmed dice/emote changes and the proposed board mapping
 * from the 2026-11-27 handoff §2.A), price / upgrade multipliers, draw pools. Item ids, categories and
 * acquisition modes are never changed. With `baselineParams()` every price equals live `priceOf` /
 * `upgradeCost` (tested).
 */
import { ITEMS, priceOf, upgradeCost, type ItemDef } from "../live/catalog";
import { SOCIAL_ITEMS } from "../../social/catalog";
import { PROPOSED_CHAT, PROPOSED_DEFAULTS } from "./chat-proposal";
import { COLLECTIONS } from "../live/collections";
import { TIER_PRICES, UPGRADE_COINS, type TierId } from "../live/config";
import { HANDS, drawHand, type DrawTier } from "../live/draw";
import { PRICED_TIERS, type PricedTier, type V2Params } from "./params";

/** Confirmed by the owner (handoff §2.A): dice and emotes. Ids are kept; only the tier changes. */
export const CONFIRMED_TIER_MAP: Record<string, PricedTier> = {
  "dice.gold": "legendary", "dice.royal": "legendary", "dice.hologram": "legendary",
  "dice.thunder": "mythic", "dice.sakura": "mythic", "dice.galaxy": "mythic", "dice.lava": "mythic",
  // emotes — common (10)
  "emote.dice": "common", "emote.clover": "common", "emote.target": "common", "emote.hundred": "common", "emote.rocket": "common",
  "emote.rainbow": "common", "emote.sparkles": "common", "emote.whale": "common", "emote.bolt": "common", "emote.cake": "common",
  // rare (7)
  "emote.laugh": "rare", "emote.wow": "rare", "emote.cry": "rare", "emote.cool": "rare", "emote.think": "rare", "emote.fired_up": "rare", "emote.please": "rare",
  // epic (2) / legendary (1)
  "emote.question": "epic", "emote.exclaim": "epic",
  "emote.sleepy": "legendary",
};
/** Proposed (not confirmed) board mapping, handoff §2.A. */
export const PROPOSED_BOARD_MAP: Record<string, PricedTier> = {
  "board.gold_table": "legendary",
  "board.storm": "mythic", "board.sakura": "mythic", "board.space": "mythic", "board.volcano": "mythic",
};
/** Proposed chat distribution (handoff §2.B: 38 paid lines, 9/8/9/7/5). Text and ids are not decided. */
export const PROPOSED_CHAT_TIERS: Record<PricedTier, number> = { common: 9, rare: 8, epic: 9, legendary: 7, mythic: 5 };

export type PricedItem = {
  id: string;
  category: ItemDef["category"];
  liveTier: TierId;
  tier: TierId;
  coins: number | null;
  gems: number | null;
  /** Coins for Lv.1→2 and Lv.2→3 (null when not upgradable). */
  up: [number, number | null] | null;
  drawable: boolean;
  season?: string;
  rev: number;
  maxLevel: number;
  defaultOwned?: true;
};

const roundDown = (amount: number, unit: number) => Math.max(unit, Math.floor(amount / unit) * unit);

export function tierOf(item: ItemDef, map: V2Params["tierMap"]): TierId {
  if (map === "live") return item.tier;
  return CONFIRMED_TIER_MAP[item.id] ?? (map === "confirmed+proposed" ? PROPOSED_BOARD_MAP[item.id] : undefined) ?? item.tier;
}

/**
 * Live price of an item if it had tier `tier` — the live category ratio (price / tier list price) is
 * kept, so a re-tiered die costs the new tier's dice price, a re-tiered emote the new tier's emote price.
 */
function retieredPrice(item: ItemDef, tier: PricedTier, currency: "coins" | "gems"): number | null {
  const live = priceOf(item, currency);
  if (live === null) return null;
  if (item.tier === tier || item.tier === "basic" || item.tier === "special") return live;
  const ratio = live / TIER_PRICES[item.tier as PricedTier][currency];
  return roundDown(TIER_PRICES[tier][currency] * ratio, currency === "coins" ? 5 : 1);
}
// Transcribed from upgradeCost in 54c1367. Other Rev.1 economic fields were checked against that source.
const REV1_LEVEL_ONE_BOARDS = new Set([
  "board.christmas", "board.felt_red", "board.felt_blue", "board.felt_purple", "board.felt_sand",
  "board.wood_oak", "board.wood_walnut", "board.leather_brown", "board.leather_black",
]);
const liveSocial = new Map(SOCIAL_ITEMS.map((item) => [item.id, item]));
function tierPercent(item: ItemDef) {
  if (item.category === "dice") return 100;
  if (item.category === "board") return 90;
  const social = liveSocial.get(item.id);
  if (!social || social.style !== "default") return 100;
  return item.category === "chat" ? 55 : 75;
}
const scaled = (amount: number, percent: number, unit: number) => Math.max(unit, Math.floor(amount * percent / (100 * unit)) * unit);
type CatalogOptions = { revision?: 1 | 2; proposedChat?: boolean; audited?: boolean };
function retieredUpgrade(item: ItemDef, tier: PricedTier, audited: boolean): PricedItem["up"] {
  const a = upgradeCost(item, 1);
  const b = upgradeCost(item, 2);
  if (a === null || (!audited && b === null)) return null;
  if (item.tier === tier) return [a, b];
  if (audited) return [
    scaled(UPGRADE_COINS[tier][0], tierPercent(item), 5),
    b === null ? null : scaled(UPGRADE_COINS[tier][1], tierPercent(item), 5),
  ];
  const ratio = a / UPGRADE_COINS[item.tier as PricedTier][0];
  return [roundDown(UPGRADE_COINS[tier][0] * ratio, 5), roundDown(UPGRADE_COINS[tier][1] * ratio, 5)];
}

export function pricedCatalog(p: V2Params, options: CatalogOptions = {}): PricedItem[] {
  const audited = options.audited ?? false;
  const items = ITEMS.filter((i) => !i.retired && (i.rev ?? 1) <= (options.revision ?? 2)).map((i) => {
    const item = options.revision === 1 && REV1_LEVEL_ONE_BOARDS.has(i.id) ? { ...i, maxLevel: 1 } : i;
    const tier = tierOf(item, p.tierMap);
    const priced = tier !== "basic" && tier !== "special";
    const pm = priced ? p.priceMult[tier] : 1;
    const um = priced ? p.upgradeMult[tier] : 1;
    const um2 = priced ? p.secondUpgradeMult?.[tier] ?? um : 1;
    const base = (cur: "coins" | "gems") => {
      if (!priced) return null;
      const price = priceOf(item, cur);
      if (audited && price !== null && tier !== item.tier) return scaled(TIER_PRICES[tier][cur], tierPercent(item), cur === "coins" ? 5 : 1);
      return retieredPrice(item, tier, cur);
    };
    const c = base("coins");
    const g = base("gems");
    const up = priced ? retieredUpgrade(item, tier, audited) : null;
    const price: PricedItem = {
      id: item.id, category: item.category, liveTier: item.tier, tier,
      coins: c === null ? null : pm === 1 ? c : roundDown(c * pm, 5),
      gems: g === null ? null : pm === 1 ? g : roundDown(g * pm, 1),
      up: up === null ? null : [um === 1 ? up[0] : roundDown(up[0] * um, 5), up[1] === null || um2 === 1 ? up[1] : roundDown(up[1] * um2, 5)],
      drawable: priced && !item.drawExcluded && (item.acquisition === "either" || item.acquisition === "coins"),
      ...(item.season ? { season: item.season } : {}),
      ...(item.acquisition === "default" ? { defaultOwned: true } : {}),
      maxLevel: item.maxLevel, rev: item.rev ?? 1,
    };
    return price;
  });
  if (!options.proposedChat) return items;
  const byId = new Map(items.map((item) => [item.id, item]));
  // Keep legacy entries addressable for existing instances and loadouts; close new sale and draws.
  for (const item of items) if (item.category === "chat" && !item.season && !item.defaultOwned) {
    Object.assign(item, { coins: null, gems: null, drawable: false });
  }
  for (const { id, tier } of PROPOSED_CHAT) {
    const prev = byId.get(id);
    const coins = roundDown(scaled(TIER_PRICES[tier].coins, 55, 5) * p.priceMult[tier], 5);
    const gems = roundDown(scaled(TIER_PRICES[tier].gems, 55, 1) * p.priceMult[tier], 1);
    const price: PricedItem = {
      id, category: "chat", liveTier: prev?.liveTier ?? tier, tier, coins, gems,
      up: null, drawable: true, rev: 2, maxLevel: 1,
    };
    if (prev) Object.assign(prev, price);
    else items.push(price);
  }
  for (const { id } of PROPOSED_DEFAULTS) if (!byId.has(id)) {
    items.push({ id, category: "chat", liveTier: "basic", tier: "basic", coins: null, gems: null, up: null, drawable: false, rev: 2, maxLevel: 1, defaultOwned: true });
  }
  return items;
}

/** Probability of each draw tier: exact enumeration of the 7,776 ordered dice (live `drawHand`). */
export const DRAW_TIER_P: Record<DrawTier, number> = (() => {
  const out: Record<string, number> = { common: 0, rare: 0, epic: 0, legendary: 0, mythic: 0 };
  for (let i = 0; i < 7776; i++) {
    const dice = Array.from({ length: 5 }, (_, k) => (Math.floor(i / 6 ** k) % 6) + 1);
    out[HANDS[drawHand(dice)].tier] += 1 / 7776;
  }
  return out as Record<DrawTier, number>;
})();

/** Standard pool (no season items) per tier for a priced catalog. */
export function drawPools(cat: PricedItem[]): Record<PricedTier, PricedItem[]> {
  const pools = Object.fromEntries(PRICED_TIERS.map((t) => [t, [] as PricedItem[]])) as Record<PricedTier, PricedItem[]>;
  for (const i of cat) if (i.drawable && !i.season && i.tier !== "basic" && i.tier !== "special") pools[i.tier as PricedTier].push(i);
  return pools;
}

/** Collections as id lists (for completion metrics / the optional completion reward). */
export const COLLECTION_ITEMS: { id: string; items: string[]; dice: string[]; boards: string[] }[] = COLLECTIONS.map((c) => ({ id: c.id, items: [...c.dice, ...c.boards, ...c.extras], dice: c.dice, boards: c.boards }));
