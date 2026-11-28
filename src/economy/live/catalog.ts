/**
 * Item catalog (Phase 6) — nine product families, a small representative set for launch.
 * Tier, acquisition, price and upgradability are independent per item. Ids are permanent.
 *
 * Presentation only: no item changes dice results, physics, strategy or the outcome of a match
 * (same principle as D-014/D-017). Dice themes keep pips high-contrast (readability check in tests).
 */
import { SOCIAL_ITEMS, socialItem } from "../../social/catalog";
import { MAX_LEVEL, SLOTS, TIER_PRICES, UPGRADE_COINS, type TierId } from "./config";
import { CONTENT_ITEMS, type FxLook } from "./content-items";
import type { SeasonId } from "./seasons";
import type { DiceLook as PaintedDice } from "../../dice3d/dice-look";
import { BOARD_FX_TEXT, DICE_FX_TEXT } from "../../fx-texts";
import { EMOTE_LEVEL_TEXT } from "../../emote-fx";

export type ItemCategory = "dice" | "board" | "emote" | "chat" | "bubble" | "profile" | "nameFx" | "fx" | "title";
export const CATEGORIES: readonly { id: ItemCategory; label: string }[] = [
  { id: "dice", label: "주사위" },
  { id: "board", label: "보드판" },
  { id: "emote", label: "이모티콘" },
  { id: "chat", label: "채팅" },
  { id: "bubble", label: "말풍선" },
  { id: "profile", label: "프로필" },
  { id: "nameFx", label: "닉네임 효과" },
  { id: "fx", label: "특수 연출" },
  { id: "title", label: "칭호" },
];
/**
 * How an item is obtained.
 *  default      everyone owns it (basic tier)
 *  coins/gems   bought with that currency only
 *  either       bought with coins or gems (buyer's choice) — default for mythic
 *  achievement  granted by an achievement only; never purchasable with money or currency
 *  symbolic     special symbolic purchase (coins only) — reserved, none on sale yet
 */
export type Acquisition = "default" | "coins" | "gems" | "either" | "achievement" | "symbolic";
export type DiceLook = PaintedDice;
export type ItemLook = {
  dice?: DiceLook;
  /** Board (tray) colour. */
  board?: string;
  /** Emoji / text (emote, chat, profile icon, title). */
  text?: string;
  /** CSS modifier for boards, bubbles, profile frames, nickname effects, titles and special effects. */
  css?: string;
  /** Special effect particles (fx items). */
  fx?: FxLook;
};
export type ItemDef = {
  id: string;
  category: ItemCategory;
  tier: TierId;
  name: string;
  acquisition: Acquisition;
  /** Overrides the tier list price. */
  price?: { coins?: number; gems?: number };
  /** 1 = not upgradable. Upgrades unlock looks; earlier levels stay selectable. */
  maxLevel: 1 | 2 | 3;
  /** What each level adds (index 0 = Lv.1). */
  levels?: string[];
  look: ItemLook;
  /** Look overrides for Lv.2 and Lv.3 (merged over `look`; earlier levels stay selectable). */
  levelLooks?: Partial<ItemLook>[];
  /** Design family for browsing (파스텔, 보석, 금속…). */
  family?: string;
  /** Special tier sub-kind (structure only; names and final items are not decided). */
  specialKind?: "achievement" | "symbolic-purchase";
  retired?: boolean;
  season?: SeasonId;
  /** Catalog revision that introduced the item (absent = 1, the launch catalog). */
  rev?: number;
  /** Revision that added upgrade support to an existing item. */
  upgradeRev?: number;
  /** Shop only: never in a random draw pool. */
  drawExcluded?: true;
};
/** The newest catalog revision in this build (a server snapshot reports the one it sells). */
export const CATALOG_REV = 3;
/** Can this server sell the item yet? Older servers report no revision (= 1). */
export const sellableOn = (item: ItemDef, serverRev: number | undefined) => (item.rev ?? 1) <= (serverRev ?? 1);
export const upgradeSupportedOn = (item: ItemDef, serverRev: number | undefined) =>
  sellableOn(item, serverRev) && (item.upgradeRev ?? 1) <= (serverRev ?? 1);

const EMOTE_LEVELS = ["정적인 이모티콘", "애니메이션", "특수 효과·전용 사운드"];
const social: ItemDef[] = SOCIAL_ITEMS.map((s) => ({
  id: s.id,
  category: s.kind,
  tier: s.tier,
  name: s.label,
  acquisition: s.acquisition === "default" ? "default" : "either",
  // Emotes bought in the shop can be upgraded (Lv.2 animation, Lv.3 effect + sound); chat lines and
  // default items have no meaningful levels.
  maxLevel: s.kind === "emote" && s.acquisition !== "default" ? 3 : 1,
  ...(s.kind === "emote" && s.acquisition !== "default" ? { levels: EMOTE_LEVEL_TEXT[s.id] ? ["기본 이모티콘", ...EMOTE_LEVEL_TEXT[s.id]] : EMOTE_LEVELS } : {}),
  look: { text: s.text },
  ...(s.retired ? { retired: true } : {}),
  ...(s.season ? { season: s.season, family: "크리스마스" } : {}),
}));

const item = (def: Omit<ItemDef, "maxLevel"> & { maxLevel?: ItemDef["maxLevel"] }): ItemDef => ({ maxLevel: 1, ...def });

const items: ItemDef[] = [
  // dice themes — the look of the dice while it is the owner's turn (both screens)
  item({ id: "dice.classic", category: "dice", tier: "basic", name: "클래식", acquisition: "default", look: { dice: { face: "#ffffff", pip: "#202020", edge: "#d4d4d4" } } }),
  item({ id: "dice.mint", category: "dice", tier: "common", name: "민트", acquisition: "either", look: { dice: { face: "#dff5ec", pip: "#123d31", edge: "#a9d9c5" } } }),
  item({ id: "dice.ink", category: "dice", tier: "rare", name: "먹색", acquisition: "coins", look: { dice: { face: "#2b2b2e", pip: "#f6f6f6", edge: "#141416" } } }),
  item({ id: "dice.sunset", category: "dice", tier: "epic", name: "노을", acquisition: "either", look: { dice: { face: "#ffe2c8", pip: "#7a2310", edge: "#f0b48a" } } }),
  item({ id: "dice.royal", category: "dice", tier: "mythic", name: "로열", acquisition: "either", look: { dice: { face: "#1d2a5c", pip: "#f3d36b", edge: "#0f1738" } } }),
  // boards — each player sees their own board
  item({ id: "board.charcoal", category: "board", tier: "basic", name: "차콜", acquisition: "default", look: { board: "" } }),
  item({ id: "board.felt", category: "board", tier: "rare", name: "그린 펠트", acquisition: "either", look: { board: "#1f4a36" } }),
  item({ id: "board.navy", category: "board", tier: "epic", name: "네이비", acquisition: "coins", look: { board: "#1c2740" } }),
  ...social,
  // chat / emote bubbles
  item({ id: "bubble.basic", category: "bubble", tier: "basic", name: "기본", acquisition: "default", look: { css: "" } }),
  item({ id: "bubble.mint", category: "bubble", tier: "common", name: "민트", acquisition: "either", look: { css: "bubble-mint" } }),
  item({ id: "bubble.gold", category: "bubble", tier: "epic", name: "골드", acquisition: "either", look: { css: "bubble-gold" } }),
  // profile icons
  // The default profile is a neutral person silhouette (rendered by ProfileAvatar), not a die: a die read as a dice skin.
  item({ id: "profile.die", category: "profile", tier: "basic", name: "기본 프로필", acquisition: "default", look: {} }),
  item({ id: "profile.star", category: "profile", tier: "common", name: "별", acquisition: "either", look: { text: "⭐" } }),
  item({ id: "profile.whale", category: "profile", tier: "rare", name: "고래", acquisition: "gems", look: { text: "🐳" } }),
  item({ id: "profile.crown", category: "profile", tier: "epic", name: "왕관", acquisition: "either", look: { text: "👑" } }),
  // nickname effects (readable: colour only, never replaces the name)
  item({ id: "nameFx.none", category: "nameFx", tier: "basic", name: "없음", acquisition: "default", look: { css: "" } }),
  item({ id: "nameFx.glow", category: "nameFx", tier: "epic", name: "은은한 빛", acquisition: "either", maxLevel: 3, levels: ["단색 강조", "그라데이션", "반짝임 애니메이션"], look: { css: "namefx-glow" } }),
  item({ id: "nameFx.rainbow", category: "nameFx", tier: "mythic", name: "무지개", acquisition: "either", maxLevel: 3, levels: ["무지개 색", "흐르는 색", "흐르는 색 + 반짝임"], look: { css: "namefx-rainbow" } }),
  // special presentation (yacht / win moments) — never touches the result
  item({ id: "fx.none", category: "fx", tier: "basic", name: "기본 연출", acquisition: "default", look: { css: "" } }),
  item({ id: "fx.confetti", category: "fx", tier: "legendary", name: "황금 꽃가루", acquisition: "either", maxLevel: 3, levels: ["승리 꽃가루", "요트 꽃가루 추가", "전용 효과음"], look: { css: "fx-confetti", fx: { shape: "confetti", colors: ["#f3d36b", "#f28c28", "#ffe9a8"], sound: "fanfare" } } }),
  // titles
  item({ id: "title.none", category: "title", tier: "basic", name: "칭호 없음", acquisition: "default", look: { text: "" } }),
  item({ id: "title.rookie", category: "title", tier: "common", name: "새내기 요트러", acquisition: "coins", look: { text: "새내기 요트러" } }),
  item({ id: "title.dicer", category: "title", tier: "rare", name: "주사위 장인", acquisition: "either", look: { text: "주사위 장인" } }),
  // special tier, achievement only (structure for symbolic achievements; final names are not decided)
  item({ id: "title.lucky_star", category: "title", tier: "special", specialKind: "achievement", name: "행운의 별", acquisition: "achievement", look: { text: "행운의 별" } }),
  // C5 activity-streak titles (rev 3, approved C5-CORE): granted once by the activity-streak milestones
  // 30 / 100 / 365 days (src/economy/retention/policy.ts ACT-REST1). Never sold, never in a draw pool.
  // Names are proposals for owner review (docs/economy/C5-RETENTION-RESEARCH.md §11).
  item({ id: "title.streak30", category: "title", tier: "special", specialKind: "achievement", name: "한 달 항해사", acquisition: "achievement", rev: 3, drawExcluded: true, look: { text: "한 달 항해사" } }),
  item({ id: "title.streak100", category: "title", tier: "special", specialKind: "achievement", name: "백일 선장", acquisition: "achievement", rev: 3, drawExcluded: true, look: { text: "백일 선장" } }),
  item({ id: "title.streak365", category: "title", tier: "special", specialKind: "achievement", name: "사계절 제독", acquisition: "achievement", rev: 3, drawExcluded: true, look: { text: "사계절 제독" } }),
  item({ id: "title.300", category: "title", tier: "special", specialKind: "achievement", name: "300클럽", acquisition: "achievement", look: { text: "300클럽" } }),
  item({ id: "title.310", category: "title", tier: "special", specialKind: "achievement", name: "310클럽", acquisition: "achievement", look: { text: "310클럽" } }),
  item({ id: "title.perfect", category: "title", tier: "special", specialKind: "achievement", name: "완벽한 경기", acquisition: "achievement", look: { text: "완벽한 경기" } }),
  item({ id: "profile.santa_penguin", category: "profile", tier: "legendary", name: "산타 펭귄", acquisition: "either", season: "christmas-2026", look: { text: "🐧", css: "pf-santa" } }),
  item({ id: "profile.rudolph", category: "profile", tier: "epic", name: "루돌프 사슴", acquisition: "either", season: "christmas-2026", look: { text: "🦌", css: "pf-reindeer" } }),
  item({ id: "profile.snowman", category: "profile", tier: "common", name: "눈사람", acquisition: "either", season: "christmas-2026", look: { text: "☃️", css: "pf-snow" } }),
  item({ id: "dice.christmas", category: "dice", tier: "mythic", name: "홀리 주사위", acquisition: "either", season: "christmas-2026", maxLevel: 3,
    levels: ["금색 눈과 녹색 보석 소재", "굴림 중 금빛 결정", "착지 시 결정이 퍼져요"],
    look: { dice: { face: "#12503b", edge: "#08271d", pip: "#ffe6a0", accent: "#ac2741", pattern: "gem", finish: "gloss" } },
    levelLooks: [{ dice: { glow: "#ffc452" } as DiceLook }, { dice: { anim: "sparkle" } as DiceLook }] }),
  item({ id: "board.christmas", category: "board", tier: "epic", name: "눈 내리는 선착장", acquisition: "either", season: "christmas-2026", look: { board: "#163339", css: "bd-christmas" } }),
  item({ id: "bubble.christmas", category: "bubble", tier: "rare", name: "캔디케인 말풍선", acquisition: "either", season: "christmas-2026", look: { css: "bubble-christmas" } }),
  item({ id: "title.christmas", category: "title", tier: "common", name: "겨울 항해자", acquisition: "either", season: "christmas-2026", look: { text: "겨울 항해자", css: "title-frost" } }),
  item({ id: "fx.christmas", category: "fx", tier: "legendary", name: "눈꽃 요트", acquisition: "either", season: "christmas-2026", maxLevel: 3,
    levels: ["승리 직후 눈꽃", "요트 달성에도 눈꽃", "눈꽃과 종소리"], look: { fx: { shape: "snow", colors: ["#afddf9", "#fff8d8", "#8eb6cc"], sound: "bell" } } }),
  // 2026-11-25 collection (H): 149 more items across the families (data in content-items.ts)
  ...CONTENT_ITEMS.map((c) => item({ ...c, maxLevel: c.maxLevel ?? 1 } as ItemDef)),
];

/**
 * Dice upgrades (2026-11-26): every non-basic die has its own Lv.2 (rolling / sliding effect) and Lv.3
 * (collisions, landing, shockwave, landing sound) profile in src/dice3d/dice-fx.ts. Lv.2/Lv.3 never
 * repaint the die body: an upgraded die keeps its Lv.1 colours (neon stays black with a coloured rim);
 * where the item had a glow, only the pips and rim light up.
 */
/**
 * Boards (2026-11-26): every non-basic board has Lv.2 (living surface) and Lv.3 (reactions to rolls,
 * landings, holds, combinations and wins) from src/board-fx.ts. Boards that were Lv.1-only gain the two
 * levels (owned copies start at Lv.1; nothing about price, tier or acquisition changes).
 */
function withBoardLevels(entry: ItemDef): ItemDef {
  const text = BOARD_FX_TEXT[entry.id];
  if (!text) return entry;
  const base = entry.look.css || (entry.id === "board.navy" ? "bd-navy" : entry.id === "board.felt" ? "bd-felt" : "bd-charcoal");
  return { ...entry, ...(entry.maxLevel === 1 ? { upgradeRev: 2 } : {}), maxLevel: 3, levels: ["기본 보드", ...text], levelLooks: [{ css: base + " bd-lv2" }, { css: base + " bd-lv3" }] };
}

export const ITEMS: readonly ItemDef[] = items.map((entry) => {
  if (entry.category === "board" && entry.tier !== "basic") return withBoardLevels(entry);
  if (entry.category !== "dice" || entry.tier === "basic" || !entry.look.dice) return entry;
  const text = DICE_FX_TEXT[entry.id];
  if (!text) return entry;
  const levelLooks = [0, 1].map((index) => ({
    ...entry.levelLooks?.[index],
    dice: { ...entry.look.dice!, ...entry.levelLooks?.[index]?.dice, fx: entry.id, fxLevel: index + 2 },
  }));
  return { ...entry, maxLevel: 3, levelLooks, levels: ["기본 외형과 소재 소리", ...text] };
});

/** The look of an item at a level (Lv.2 / Lv.3 overrides merged over Lv.1; nested dice look merged too). */
export function lookAt(item: ItemDef | null | undefined, level = 1): ItemLook {
  if (!item) return {};
  let look: ItemLook = { ...item.look };
  for (let lv = 2; lv <= Math.min(level, item.maxLevel); lv++) {
    const o = item.levelLooks?.[lv - 2];
    if (!o) continue;
    look = { ...look, ...o, ...(o.dice && look.dice ? { dice: { ...look.dice, ...o.dice } } : {}) };
  }
  return look;
}

const byId = new Map(ITEMS.map((i) => [i.id, i]));
export const itemById = (id: unknown): ItemDef | null => (typeof id === "string" ? byId.get(id) ?? null : null);
export const isDefaultItem = (i: ItemDef) => i.acquisition === "default";
export const DEFAULT_ITEM_IDS = ITEMS.filter((i) => isDefaultItem(i) && !i.retired).map((i) => i.id);

/** Category pricing is capped at the previous list price so cached clients never overpay. */
function categoryPrice(item: ItemDef) {
  if (item.category === "dice") return 100;
  if (item.category === "chat" || item.category === "emote") {
    if (socialItem(item.id)?.style !== "default") return 100;
    return item.category === "chat" ? 55 : 75;
  }
  return { board: 90, profile: 75, title: 55, bubble: 70, nameFx: 80, fx: 95 }[item.category];
}

function scalePrice(amount: number, currency: "coins" | "gems", percent: number) {
  const unit = currency === "coins" ? 5 : 1;
  return Math.max(unit, Math.floor(amount * percent / (100 * unit)) * unit);
}

/** Price of an item in a currency, or null when it cannot be bought with it. */
export function priceOf(i: ItemDef, currency: "coins" | "gems"): number | null {
  if (i.retired || i.tier === "special" || i.tier === "basic") return null;
  const ok = i.acquisition === "either" || i.acquisition === currency;
  if (!ok) return null;
  const list = TIER_PRICES[i.tier];
  const p = i.price?.[currency] ?? scalePrice(list[currency], currency, categoryPrice(i));
  return Number.isInteger(p) && p > 0 ? p : null;
}
/** Coins to go from `level` to `level + 1`, or null. */
export function upgradeCost(i: ItemDef, level: number): number | null {
  if (i.maxLevel <= 1 || level >= i.maxLevel || level < 1 || level >= MAX_LEVEL) return null;
  if (i.tier === "special" || i.tier === "basic") return null;
  const amount = UPGRADE_COINS[i.tier][level - 1];
  return amount === undefined ? null : scalePrice(amount, "coins", categoryPrice(i));
}
export function slotPrice(kind: "emote" | "chat", owned: number, currency: "coins" | "gems"): number | null {
  const n = owned - SLOTS[kind].base; // extra slots already bought
  if (n < 0 || owned >= SLOTS[kind].max) return null;
  return SLOTS.prices[n]?.[currency] ?? null;
}

/* ----------------------------------------------------------------- loadout ----------------------------------------------------------------- */

/** What a player has equipped. Stored by the server; validated against inventory and slots. */
export type Loadout = {
  dice: string;
  board: string;
  bubble: string;
  profile: string;
  nameFx: string;
  fx: string;
  title: string;
  emotes: string[];
  chats: string[];
  /** Chosen look level per item (≤ unlocked level). Missing = highest unlocked. */
  levels: Record<string, number>;
};
export type Slots = { emote: number; chat: number };
export const DEFAULT_SLOTS: Slots = { emote: SLOTS.emote.base, chat: SLOTS.chat.base };
export const DEFAULT_LOADOUT: Loadout = {
  dice: "dice.classic",
  board: "board.charcoal",
  bubble: "bubble.basic",
  profile: "profile.die",
  nameFx: "nameFx.none",
  fx: "fx.none",
  title: "title.none",
  emotes: SOCIAL_ITEMS.filter((s) => s.kind === "emote" && s.acquisition === "default").map((s) => s.id),
  chats: SOCIAL_ITEMS.filter((s) => s.kind === "chat" && s.acquisition === "default").map((s) => s.id),
  levels: {},
};
export const SINGLE_SLOTS = ["dice", "board", "bubble", "profile", "nameFx", "fx", "title"] as const;

/** Owned item → unlocked level. Default items are always owned at Lv.1. */
export type Owned = ReadonlyMap<string, number>;

/**
 * Validate a requested loadout against what the player owns and the slots they have.
 * Returns the cleaned loadout or an error message. The server never trusts the client's copy.
 */
export function validateLoadout(raw: unknown, owned: Owned, slots: Slots): { ok: true; loadout: Loadout } | { ok: false; message: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, message: "장착 정보가 올바르지 않아요." };
  const r = raw as Record<string, unknown>;
  const has = (id: string) => {
    const i = itemById(id);
    return !!i && !i.retired && (isDefaultItem(i) || owned.has(id));
  };
  const out: Loadout = { ...DEFAULT_LOADOUT, emotes: [], chats: [], levels: {} };
  for (const slot of SINGLE_SLOTS) {
    const id = r[slot];
    if (typeof id !== "string") return { ok: false, message: "장착 정보가 올바르지 않아요." };
    const i = itemById(id);
    if (!i || i.category !== slot || !has(id)) return { ok: false, message: "보유하지 않은 아이템은 장착할 수 없어요." };
    out[slot] = id;
  }
  for (const [kind, key, cap] of [["emote", "emotes", slots.emote], ["chat", "chats", slots.chat]] as const) {
    const list = r[key];
    if (!Array.isArray(list) || list.length > cap) return { ok: false, message: "슬롯 수보다 많이 장착할 수 없어요." };
    if (new Set(list).size !== list.length) return { ok: false, message: "같은 아이템을 두 번 장착할 수 없어요." };
    for (const id of list) {
      const s = socialItem(id);
      if (typeof id !== "string" || !s || s.kind !== kind || !has(id)) return { ok: false, message: "보유하지 않은 아이템은 장착할 수 없어요." };
    }
    out[key] = [...(list as string[])];
  }
  if (out.emotes.length < 1 || out.chats.length < 1) return { ok: false, message: "이모티콘과 채팅은 하나 이상 장착해야 해요." };
  const levels = r.levels ?? {};
  if (typeof levels !== "object" || levels === null || Array.isArray(levels)) return { ok: false, message: "장착 정보가 올바르지 않아요." };
  for (const [id, lv] of Object.entries(levels as Record<string, unknown>)) {
    const max = owned.get(id) ?? 0;
    if (!Number.isInteger(lv) || (lv as number) < 1 || (lv as number) > max) return { ok: false, message: "해금하지 않은 단계는 선택할 수 없어요." };
    out.levels[id] = lv as number;
  }
  return { ok: true, loadout: out };
}

/** Re-check a stored loadout (items can be retired): anything no longer valid falls back to the default. */
export function sanitizeLoadout(raw: unknown, owned: Owned, slots: Slots): Loadout {
  const checked = validateLoadout(raw, owned, slots);
  if (checked.ok) return checked.loadout;
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<Loadout>;
  const out: Loadout = { ...DEFAULT_LOADOUT, levels: {} };
  for (const slot of SINGLE_SLOTS) {
    const id = r[slot];
    const i = itemById(id);
    if (typeof id === "string" && i && !i.retired && i.category === slot && (isDefaultItem(i) || owned.has(id))) out[slot] = id;
  }
  const keep = (list: unknown, kind: "emote" | "chat", cap: number, fallback: string[]) => {
    const ids = Array.isArray(list) ? [...new Set(list.filter((id): id is string => typeof id === "string" && socialItem(id)?.kind === kind && !socialItem(id)!.retired && (socialItem(id)!.acquisition === "default" || owned.has(id))))].slice(0, cap) : [];
    return ids.length ? ids : fallback;
  };
  out.emotes = keep(r.emotes, "emote", slots.emote, DEFAULT_LOADOUT.emotes);
  out.chats = keep(r.chats, "chat", slots.chat, DEFAULT_LOADOUT.chats);
  return out;
}

/**
 * What other players (and spectators) see. Built by the server from a validated loadout; the level
 * shown is the selected level (≤ unlocked). Guests use `GUEST_LOOK`.
 */
export type PublicLook = {
  dice: string;
  /** Shown levels of upgradable looks (absent in looks stored before 2026-11-25 → Lv.1). */
  diceLv?: number;
  board: string;
  boardLv?: number;
  bubble: string;
  bubbleLv?: number;
  profile: string;
  profileLv?: number;
  nameFx: string;
  nameFxLv: number;
  fx: string;
  fxLv: number;
  title: string;
  /** Equipped emotes with their shown level, and equipped lines (only these can be sent). */
  emotes: { id: string; lv: number }[];
  chats: string[];
};
export function publicLook(loadout: Loadout, owned: Owned): PublicLook {
  const lv = (id: string) => {
    const i = itemById(id);
    if (!i || i.maxLevel <= 1) return 1;
    const max = owned.get(id) ?? 1;
    return Math.max(1, Math.min(max, loadout.levels[id] ?? max));
  };
  return {
    dice: loadout.dice,
    diceLv: lv(loadout.dice),
    board: loadout.board,
    boardLv: lv(loadout.board),
    bubble: loadout.bubble,
    bubbleLv: lv(loadout.bubble),
    profile: loadout.profile,
    profileLv: lv(loadout.profile),
    nameFx: loadout.nameFx,
    nameFxLv: lv(loadout.nameFx),
    fx: loadout.fx,
    fxLv: lv(loadout.fx),
    title: loadout.title,
    emotes: loadout.emotes.map((id) => ({ id, lv: lv(id) })),
    chats: [...loadout.chats],
  };
}
export const GUEST_LOOK: PublicLook = publicLook(DEFAULT_LOADOUT, new Map());

/** Shape + catalog check of a look received from another server object (defence in depth). */
export function sanitizeLook(raw: unknown): PublicLook {
  if (typeof raw !== "object" || raw === null) return GUEST_LOOK;
  const r = raw as Record<string, unknown>;
  const pick = (key: keyof typeof DEFAULT_LOADOUT & string, cat: ItemCategory) => {
    const i = itemById(r[key]);
    return i && i.category === cat ? i.id : (DEFAULT_LOADOUT[key as "dice"] as string);
  };
  const level = (v: unknown) => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_LEVEL ? (v as number) : 1);
  const emotes = Array.isArray(r.emotes)
    ? r.emotes
        .filter((e): e is { id: string; lv: unknown } => typeof e === "object" && e !== null && socialItem((e as { id: unknown }).id)?.kind === "emote")
        .slice(0, SLOTS.emote.max)
        .map((e) => ({ id: e.id, lv: level(e.lv) }))
    : GUEST_LOOK.emotes;
  const chats = Array.isArray(r.chats) ? r.chats.filter((id): id is string => socialItem(id)?.kind === "chat").slice(0, SLOTS.chat.max) : GUEST_LOOK.chats;
  return {
    dice: pick("dice", "dice"),
    diceLv: level(r.diceLv),
    board: pick("board", "board"),
    boardLv: level(r.boardLv),
    bubble: pick("bubble", "bubble"),
    bubbleLv: level(r.bubbleLv),
    profile: pick("profile", "profile"),
    profileLv: level(r.profileLv),
    nameFx: pick("nameFx", "nameFx"),
    nameFxLv: level(r.nameFxLv),
    fx: pick("fx", "fx"),
    fxLv: level(r.fxLv),
    title: pick("title", "title"),
    emotes: emotes.length ? emotes : GUEST_LOOK.emotes,
    chats: chats.length ? chats : GUEST_LOOK.chats,
  };
}
/** Ids a player with this look may send (the server's `say` check). */
export const sendableIds = (look: PublicLook): ReadonlySet<string> => new Set([...look.emotes.map((e) => e.id), ...look.chats]);
