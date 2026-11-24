/**
 * Economy study — rarities, catalog generation, upgrade cost curves and price back-calculation.
 * Nothing here is a final product catalog: items are anonymous placeholders (rarity × type × currency).
 */
import { mulberry32, type Rng } from "./rng";

export const RARITIES = ["common", "advanced", "hero", "legendary", "mythic"] as const; // 일반..신화 (기본=무료, 특수=업적 전용)
export type Rarity = (typeof RARITIES)[number];
export const RARITY_LABEL: Record<Rarity | "basic" | "special", string> = { basic: "기본", common: "일반", advanced: "고급", hero: "영웅", legendary: "전설", mythic: "신화", special: "특수(업적 전용)" };
/** Product families (user list 2026-11-24). Titles are mostly achievement-only; shop titles are optional. */
export type ItemType = "dice" | "board" | "emote" | "chat" | "bubble" | "profile" | "nickname_fx" | "effect" | "title";
export const ITEM_TYPE_LABEL: Record<ItemType, string> = { dice: "주사위", board: "보드판", emote: "이모티콘", chat: "채팅 프리셋", bubble: "말풍선", profile: "프로필", nickname_fx: "닉네임 효과", effect: "특수 연출", title: "칭호" };
export type Currency = "coin" | "gem" | "either";
export type CatalogItem = { id: number; rarity: number; type: ItemType; currency: Currency; coinPrice: number; gemPrice: number; releaseDay: number };

export type PriceTable = {
  coin: [number, number, number, number, number];
  gem: [number, number, number, number, number];
  /** Share of [coin-only, gem-only, either] per rarity. */
  currencyMix: [number, number, number][];
};
export type CatalogConfig = {
  initial: [number, number, number, number, number];
  perMonth: [number, number, number, number, number];
  typeMix: Record<ItemType, number>;
};
export const DEFAULT_CATALOG: CatalogConfig = {
  initial: [20, 15, 10, 6, 3],
  perMonth: [3, 2, 1, 0.5, 0.17],
  typeMix: { dice: 0.18, board: 0.1, emote: 0.15, chat: 0.1, bubble: 0.1, profile: 0.12, nickname_fx: 0.08, effect: 0.1, title: 0.07 },
};
export const DEFAULT_CURRENCY_MIX: [number, number, number][] = [
  [0.8, 0, 0.2], // common: mostly coins
  [0.5, 0.2, 0.3],
  [0.3, 0.3, 0.4],
  [0.2, 0.3, 0.5],
  [0, 0.4, 0.6], // mythic: gems or either (coin path always exists for "either")
];

export function niceRound(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return 0;
  const mag = 10 ** Math.floor(Math.log10(x));
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  let best = mag;
  for (const s of steps) if (Math.abs(s * mag - x) < Math.abs(best - x)) best = s * mag;
  return Math.round(best);
}

export function buildCatalog(cfg: CatalogConfig, prices: PriceTable, days: number, seed = 1): CatalogItem[] {
  const r: Rng = mulberry32(seed);
  const items: CatalogItem[] = [];
  const types = Object.entries(cfg.typeMix) as [ItemType, number][];
  const pickType = () => { let x = r(); for (const [t, w] of types) { x -= w; if (x <= 0) return t; } return types[0][0]; };
  const add = (rarity: number, releaseDay: number) => {
    const mix = prices.currencyMix[rarity];
    const x = r();
    const currency: Currency = x < mix[0] ? "coin" : x < mix[0] + mix[1] ? "gem" : "either";
    items.push({ id: items.length, rarity, type: pickType(), currency, coinPrice: prices.coin[rarity], gemPrice: prices.gem[rarity], releaseDay });
  };
  cfg.initial.forEach((n, rarity) => { for (let i = 0; i < n; i++) add(rarity, 0); });
  // At launch every rarity offers each payment path its mix allows (so a coin-only or gem-only player always has a target).
  cfg.initial.forEach((_n, rarity) => {
    const launch = items.filter((it) => it.rarity === rarity && it.releaseDay === 0);
    (["coin", "gem", "either"] as Currency[]).forEach((cur, k) => {
      if (prices.currencyMix[rarity][k] > 0 && !launch.some((it) => it.currency === cur)) {
        const victim = launch.find((it) => launch.filter((x) => x.currency === it.currency).length > 1);
        if (victim) victim.currency = cur;
      }
    });
  });
  const acc = [0, 0, 0, 0, 0];
  for (let month = 1; month * 30 < days; month++) cfg.perMonth.forEach((n, rarity) => { acc[rarity] += n; while (acc[rarity] >= 1) { acc[rarity]--; add(rarity, month * 30); } });
  return items;
}

// ---------------- upgrade curves ----------------
export type CurveKind = "linear" | "exponential" | "power" | "piecewise";
/** `steps` (optional) overrides the curve: cost of step k = price × steps[k] (e.g. 1:0.5:1.5 → [0.5, 1.5]). */
export type UpgradeConfig = { curve: CurveKind; baseFraction: number; maxLevel: number; param: number; steps?: number[] };
export const CURVE_LABEL: Record<CurveKind, string> = { linear: "선형", exponential: "기하급수", power: "멱함수", piecewise: "구간별" };
/** Multiplier of the base cost for the step Lv k → Lv k+1 (k ≥ 1). */
export function curveMultiplier(curve: CurveKind, k: number, param: number): number {
  switch (curve) {
    case "linear": return k; // 1,2,3,4
    case "exponential": return param ** (k - 1); // param=3: 1,3,9,27
    case "power": return k ** param; // param=2.5: 1,5.7,15.6,32
    case "piecewise": return [1, 3, 8, 20, 50][k - 1] ?? 50 * 2 ** (k - 5);
  }
}
/** Coin cost of each upgrade step for an item whose coin-equivalent price is `price`. */
export function upgradeCosts(price: number, cfg: UpgradeConfig): number[] {
  if (cfg.steps) return cfg.steps.slice(0, cfg.maxLevel - 1).map((k) => niceRound(price * k));
  return Array.from({ length: cfg.maxLevel - 1 }, (_, i) => niceRound(price * cfg.baseFraction * curveMultiplier(cfg.curve, i + 1, cfg.param)));
}
export const CURVE_PRESETS: UpgradeConfig[] = [
  { curve: "linear", baseFraction: 0.5, maxLevel: 3, param: 1 },
  { curve: "exponential", baseFraction: 0.5, maxLevel: 3, param: 3 },
  { curve: "power", baseFraction: 0.5, maxLevel: 3, param: 2.5 },
  { curve: "piecewise", baseFraction: 0.5, maxLevel: 3, param: 0 },
];

// ---------------- slots ----------------
export type SlotConfig = { emoteBase: number; emoteMax: number; chatBase: number; chatMax: number; costs: number[]; currency: Currency; gemCosts: number[] };
export const SLOT_LIMITS = { emoteBase: 4, emoteMax: 8, chatBase: 6, chatMax: 10 } as const;

// ---------------- price back-calculation ----------------
/** Design targets: days of a reference (일반 유저, 무과금) median income per rarity. Assumptions, varied in sensitivity. */
export const TARGET_DAYS = { coin: [2, 7, 21, 60, 150] as number[], gem: [10, 28, 70, 150, 300] as number[] };
export function derivePrices(dailyCoins: number, dailyGems: number, targets = TARGET_DAYS, currencyMix = DEFAULT_CURRENCY_MIX): PriceTable {
  return {
    coin: targets.coin.map((d) => niceRound(d * dailyCoins)) as PriceTable["coin"],
    gem: targets.gem.map((d) => niceRound(d * dailyGems)) as PriceTable["gem"],
    currencyMix,
  };
}
export function deriveSlots(dailyCoins: number, dailyGems: number, targetDays = [3, 6, 10, 15]): SlotConfig {
  return { ...SLOT_LIMITS, costs: targetDays.map((d) => niceRound(d * dailyCoins)), gemCosts: targetDays.map((d) => niceRound(d * 2 * dailyGems)), currency: "either" };
}

/** Price : (Lv1→2) : (Lv2→3) ratios compared in the follow-up study. 1:0.5:1.5 is the phase-1 recommendation. */
export const STEP_RATIOS: { label: string; steps: [number, number] }[] = [
  { label: "1:0.25:0.75", steps: [0.25, 0.75] },
  { label: "1:0.5:1", steps: [0.5, 1] },
  { label: "1:0.5:1.5", steps: [0.5, 1.5] },
  { label: "1:1:2", steps: [1, 2] },
  { label: "1:1:3", steps: [1, 3] },
  { label: "1:2:4", steps: [2, 4] },
];
