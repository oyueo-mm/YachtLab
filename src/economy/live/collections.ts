import { itemById, type ItemDef } from "./catalog";

/**
 * Theme collections (2026-11-27). A collection links items that share one theme — at least a die and a
 * board — across new and existing items (existing ids, prices and tiers are untouched). Data only: the
 * server and the client read the same table.
 *
 *  - Browsing: the shop can show every item of a theme together.
 *  - Synergy: a die and a board of the same collection equipped together add a presentation-only effect
 *    (src/play/board-synergy.ts). Dice values, physics, scores and the AI never read it.
 *  - Completion: owned / total per collection on the profile. Completion rewards are NOT active (an
 *    economy decision for the owner, see docs/context/COLLECTIONS-2026-11-27.md).
 */
export type SynergyKind = "lightning" | "meadow" | "bloom" | "sakura" | "forest" | "abyss" | "lava" | "frost" | "cosmos" | "aurora";
export type Collection = {
  id: string;
  name: string;
  /** One line on the synergy, shown in the shop and the inventory. */
  synergy: string;
  kind: SynergyKind;
  dice: string[];
  boards: string[];
  /** Other items of the theme (emotes, bubbles, profiles, effects…). */
  extras: string[];
  /** Theme colour for chips and headers. */
  color: string;
};

export const COLLECTIONS: readonly Collection[] = [
  { id: "lightning", name: "번개", kind: "lightning", color: "#8fb4ff", dice: ["dice.thunder"], boards: ["board.storm"], extras: ["emote.bolt"],
    synergy: "구르는 길이 전선처럼 지지직 빛나고, 멈춘 주사위 사이로 연쇄 번개가 튀어요" },
  { id: "meadow", name: "초원", kind: "meadow", color: "#8cc152", dice: ["dice.meadow"], boards: ["board.meadow"], extras: ["emote.clover", "profile.clover"],
    synergy: "주사위가 지나간 길로 풀이 빗질되고, 멈춘 주사위들을 풀잎 줄기가 이어요" },
  { id: "bloom", name: "꽃밭", kind: "bloom", color: "#ff8fb0", dice: ["dice.flower", "dice.pastel_peach"], boards: ["board.flower_field"], extras: [],
    synergy: "구르는 길을 따라 작은 꽃이 줄지어 피고, 멈춘 주사위들이 꽃줄로 이어져요" },
  { id: "sakura", name: "벚꽃", kind: "sakura", color: "#ffb7c9", dice: ["dice.sakura"], boards: ["board.sakura"], extras: ["profile.blossom"],
    synergy: "주사위 뒤로 꽃잎이 따라 날리고, 멈춘 주사위들을 꽃가지가 이어요" },
  { id: "forest", name: "숲", kind: "forest", color: "#6fae6a", dice: ["dice.wood_oak", "dice.wood_walnut"], boards: ["board.forest", "board.wood_oak"], extras: [],
    synergy: "지나간 길에 덩굴과 잎이 자라고, 멈춘 주사위들을 뿌리가 이어요" },
  { id: "abyss", name: "심해", kind: "abyss", color: "#3fe0d0", dice: ["dice.abyss", "dice.sapphire"], boards: ["board.deep_sea", "board.ocean"], extras: ["emote.whale", "profile.wave"],
    synergy: "지나간 자리에 빛나는 물길과 기포가 남고, 멈춘 주사위들을 빛의 물결이 이어요" },
  { id: "lava", name: "용암", kind: "lava", color: "#ff6a1a", dice: ["dice.lava"], boards: ["board.volcano"], extras: ["emote.fire"],
    synergy: "지나간 길이 용암 자국으로 달아올랐다 식고, 멈춘 주사위 사이로 용암이 흘러요" },
  { id: "frost", name: "얼음", kind: "frost", color: "#bfe9ff", dice: ["dice.frost", "dice.glass_blue"], boards: ["board.ice"], extras: ["bubble.frost"],
    synergy: "지나간 길이 얼어붙어 결정이 돋고, 멈춘 주사위들을 얼음 다리가 이어요" },
  { id: "cosmos", name: "우주", kind: "cosmos", color: "#c6a3ff", dice: ["dice.galaxy"], boards: ["board.space"], extras: ["profile.planet"],
    synergy: "주사위가 혜성처럼 꼬리를 남기고, 멈춘 주사위들을 별자리가 이어요" },
  { id: "aurora", name: "오로라", kind: "aurora", color: "#7dffcb", dice: ["dice.aurora"], boards: ["board.aurora"], extras: ["bubble.aurora"],
    synergy: "구르는 길을 따라 오로라 띠가 흐르고, 멈춘 주사위 위로 빛의 아치가 걸려요" },
];

export const collectionById = (id: string) => COLLECTIONS.find((c) => c.id === id) ?? null;
/** Every collection an item belongs to (an item may belong to more than one theme). */
export const collectionsOf = (itemId: string) => COLLECTIONS.filter((c) => c.dice.includes(itemId) || c.boards.includes(itemId) || c.extras.includes(itemId));
export const collectionItems = (c: Collection): ItemDef[] => [...c.dice, ...c.boards, ...c.extras].map((id) => itemById(id)).filter((i): i is ItemDef => !!i);
/** The synergy of an equipped die and board, if both belong to one collection. */
export function synergyOf(diceId: string | undefined, boardId: string | undefined): Collection | null {
  if (!diceId || !boardId) return null;
  return COLLECTIONS.find((c) => c.dice.includes(diceId) && c.boards.includes(boardId)) ?? null;
}
export function collectionProgress(c: Collection, owned: ReadonlySet<string>) {
  const all = collectionItems(c);
  return { have: all.filter((i) => owned.has(i.id)).length, total: all.length, synergyReady: c.dice.some((d) => owned.has(d)) && c.boards.some((b) => owned.has(b)) };
}
