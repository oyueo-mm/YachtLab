/**
 * Shop curation, search, filters and sorting (UI-2, 2026-11-28). Pure functions over the existing catalog:
 * nothing here changes an id, price, tier, acquisition rule, draw odds or upgrade step.
 *
 * Curation is editorial (hand-picked lists in this file). The service does not collect usage, so there is no
 * "popular" ranking and no personalised recommendation: "추천순" means the order an editor chose, and every
 * screen that shows it says so.
 */
import { CATEGORIES, ITEMS, priceOf, type ItemCategory, type ItemDef } from "../../economy/live/catalog";
import { COLLECTIONS, collectionsOf, type Collection } from "../../economy/live/collections";
import { TIERS, type TierId } from "../../economy/live/config";

/** Editor's picks across product families — existing items only, a mix of price ranges. Order = display order. */
export const EDITOR_PICKS: readonly string[] = [
  "dice.hologram", "board.deep_sea", "fx.fireworks", "bubble.aurora", "nameFx.neon", "profile.crystal",
  "emote.starlight", "dice.lava", "board.space", "title.golden_hand", "chat.lucky_day", "dice.mint",
];

export type PromoSlide = {
  id: string;
  title: string;
  kicker: string;
  body: string;
  color: string;
  /** Items shown on the slide (thumbnails), first = the one "상품 보기" opens. */
  items: string[];
  /** Theme filter applied by "컬렉션 보기" (null = editor's picks). */
  collection: string | null;
};

/**
 * Promo carousel: one slide per existing theme collection plus the editor's picks. No discounts, bundles,
 * countdowns or unreleased products — a slide only points at items already in the catalog.
 */
export function promoSlides(): PromoSlide[] {
  const themed = COLLECTIONS.map((c) => ({
    id: "col-" + c.id,
    title: `${c.name} 컬렉션`,
    kicker: "테마 컬렉션",
    body: c.synergy,
    color: c.color,
    items: [...c.dice, ...c.boards, ...c.extras].filter((id) => ITEMS.some((i) => i.id === id && !i.retired)).slice(0, 4),
    collection: c.id,
  }));
  return [
    { id: "picks", title: "에디터 추천", kicker: "편집 큐레이션", body: "주사위·보드판·연출·말풍선까지, 상품군마다 한 번쯤 꼭 미리 볼 만한 상품을 골랐어요.", color: "#e03131", items: EDITOR_PICKS.slice(0, 4), collection: null },
    ...themed,
  ];
}

export type SortKey = "recommended" | "new" | "tier-desc" | "tier-asc" | "price-asc" | "price-desc" | "name";
export const SORTS: readonly { value: SortKey; label: string }[] = [
  { value: "recommended", label: "추천순" },
  { value: "new", label: "신상품순" },
  { value: "tier-desc", label: "등급 높은순" },
  { value: "tier-asc", label: "등급 낮은순" },
  { value: "price-asc", label: "가격 낮은순" },
  { value: "price-desc", label: "가격 높은순" },
  { value: "name", label: "이름순" },
];

export type PriceFilter = "all" | "coins" | "gems" | "afford";
export type PriceBand = "all" | "low" | "mid" | "high" | "top";
/** Coin bands (gem-only items use their coin-equivalent tier list price via the gem band). */
export const PRICE_BANDS: readonly { value: PriceBand; label: string; min: number; max: number }[] = [
  { value: "all", label: "모든 가격대", min: 0, max: Infinity },
  { value: "low", label: "1,000코인 미만", min: 0, max: 1000 },
  { value: "mid", label: "1,000~4,999코인", min: 1000, max: 5000 },
  { value: "high", label: "5,000~14,999코인", min: 5000, max: 15000 },
  { value: "top", label: "15,000코인 이상", min: 15000, max: Infinity },
];
export type OwnFilter = "all" | "owned" | "unowned";

export type ShopQuery = {
  category: ItemCategory | null;
  text: string;
  tier: TierId | "all";
  price: PriceFilter;
  band: PriceBand;
  collection: string;
  own: OwnFilter;
  sort: SortKey;
};
export const EMPTY_QUERY: ShopQuery = { category: null, text: "", tier: "all", price: "all", band: "all", collection: "all", own: "all", sort: "recommended" };
/** True when anything narrows the list (the browse page then shows results instead of the curated rails). */
export const isFiltered = (q: ShopQuery) => !!q.text.trim() || q.tier !== "all" || q.price !== "all" || q.band !== "all" || q.collection !== "all" || q.own !== "all";

const tierRank = (t: TierId) => TIERS.findIndex((x) => x.id === t);
/** One comparable price for ranking only: coins, or for gem-only items gems × 20 (roughly the upper-tier coin : gem ratio of the list prices). */
export const sortPrice = (i: ItemDef) => priceOf(i, "coins") ?? (priceOf(i, "gems") ?? Infinity) * 20;
const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/** Search text: item name, category label, design family and theme collection names. */
export function matchesText(item: ItemDef, text: string) {
  const q = normalize(text);
  if (!q) return true;
  const hay = [item.name, CATEGORIES.find((c) => c.id === item.category)?.label ?? "", item.family ?? "", item.look.text ?? "", ...collectionsOf(item.id).map((c) => c.name)];
  return hay.some((h) => normalize(h).includes(q));
}

type Ctx = { owned: ReadonlyMap<string, number>; wallet: { coins: number; gems: number } };
export function filterItems(items: readonly ItemDef[], q: ShopQuery, ctx: Ctx): ItemDef[] {
  const band = PRICE_BANDS.find((b) => b.value === q.band)!;
  return items.filter((i) => {
    if (q.category && i.category !== q.category) return false;
    if (q.tier !== "all" && i.tier !== q.tier) return false;
    if (q.collection !== "all" && !collectionsOf(i.id).some((c) => c.id === q.collection)) return false;
    if (!matchesText(i, q.text)) return false;
    const owned = i.acquisition === "default" || ctx.owned.has(i.id);
    if (q.own === "owned" && !owned) return false;
    if (q.own === "unowned" && owned) return false;
    const c = priceOf(i, "coins"),
      g = priceOf(i, "gems");
    if (q.price === "coins" && c === null) return false;
    if (q.price === "gems" && g === null) return false;
    if (q.price === "afford" && (owned || !((c !== null && c <= ctx.wallet.coins) || (g !== null && g <= ctx.wallet.gems)))) return false;
    if (q.band !== "all") {
      const p = sortPrice(i);
      if (!(p >= band.min && p < band.max)) return false;
    }
    return true;
  });
}

const pickRank = (id: string) => {
  const n = EDITOR_PICKS.indexOf(id);
  return n < 0 ? Infinity : n;
};
export function sortItems(items: readonly ItemDef[], sort: SortKey): ItemDef[] {
  const order = new Map(ITEMS.map((i, n) => [i.id, n]));
  const base = (a: ItemDef, b: ItemDef) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
  const cmp: Record<SortKey, (a: ItemDef, b: ItemDef) => number> = {
    // Editorial: picks first, then by tier (low → high, the long-standing shop order), then catalog order.
    recommended: (a, b) => pickRank(a.id) - pickRank(b.id) || tierRank(a.tier) - tierRank(b.tier) || base(a, b),
    // "New" = newest catalog revision first (the 2026-11-27 collection is revision 2), then catalog order.
    new: (a, b) => (b.rev ?? 1) - (a.rev ?? 1) || base(b, a),
    "tier-desc": (a, b) => tierRank(b.tier) - tierRank(a.tier) || base(a, b),
    "tier-asc": (a, b) => tierRank(a.tier) - tierRank(b.tier) || base(a, b),
    "price-asc": (a, b) => sortPrice(a) - sortPrice(b) || base(a, b),
    "price-desc": (a, b) => (sortPrice(b) === Infinity ? -1 : sortPrice(a) === Infinity ? 1 : sortPrice(b) - sortPrice(a)) || base(a, b),
    name: (a, b) => a.name.localeCompare(b.name, "ko") || base(a, b),
  };
  return [...items].sort((a, b) => {
    const r = cmp[sort](a, b);
    return Number.isNaN(r) ? 0 : r;
  });
}

/** Existing new items: the newest catalog revision (no fake "new" labels). */
export const newestRev = (items: readonly ItemDef[]) => Math.max(1, ...items.map((i) => i.rev ?? 1));
export const newItems = (items: readonly ItemDef[]) => {
  const rev = newestRev(items);
  return rev > 1 ? items.filter((i) => (i.rev ?? 1) === rev) : [];
};

/** Collection progress over owned ids (default items never belong to a collection). */
export function themeProgress(owned: ReadonlySet<string>): { collection: Collection; have: number; total: number }[] {
  return COLLECTIONS.map((c) => {
    const ids = [...c.dice, ...c.boards, ...c.extras];
    return { collection: c, have: ids.filter((id) => owned.has(id)).length, total: ids.length };
  });
}
