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
    synergy: "주사위가 부딪힌 자리에서 전류가 보드 위로 갈라져 퍼져요" },
  { id: "meadow", name: "초원", kind: "meadow", color: "#8cc152", dice: ["dice.meadow"], boards: ["board.meadow"], extras: ["emote.clover", "profile.clover"],
    synergy: "주사위가 지나가는 방향으로 풀이 눕고 다시 일어나요" },
  { id: "bloom", name: "꽃밭", kind: "bloom", color: "#ff8fb0", dice: ["dice.flower", "dice.pastel_peach"], boards: ["board.flower_field"], extras: [],
    synergy: "주사위가 멈춘 자리마다 꽃이 피어났다가 천천히 져요" },
  { id: "sakura", name: "벚꽃", kind: "sakura", color: "#ffb7c9", dice: ["dice.sakura"], boards: ["board.sakura"], extras: ["profile.blossom"],
    synergy: "굴릴 때 꽃바람이 일고, 착지하면 꽃잎이 바닥에 소복이 쌓여요" },
  { id: "forest", name: "숲", kind: "forest", color: "#6fae6a", dice: ["dice.wood_oak", "dice.wood_walnut"], boards: ["board.forest", "board.wood_oak"], extras: [],
    synergy: "착지한 자리 위로 나뭇잎이 내려앉고 새싹이 돋아요" },
  { id: "abyss", name: "심해", kind: "abyss", color: "#3fe0d0", dice: ["dice.abyss", "dice.sapphire"], boards: ["board.deep_sea", "board.ocean"], extras: ["emote.whale", "profile.wave"],
    synergy: "착지점마다 기포가 오르고, 멈춘 주사위들을 빛의 물결이 이어요" },
  { id: "lava", name: "용암", kind: "lava", color: "#ff6a1a", dice: ["dice.lava"], boards: ["board.volcano"], extras: ["emote.fire"],
    synergy: "착지점에서 용암 균열이 번지고 천천히 식어 검게 굳어요" },
  { id: "frost", name: "얼음", kind: "frost", color: "#bfe9ff", dice: ["dice.frost", "dice.glass_blue"], boards: ["board.ice"], extras: ["bubble.frost"],
    synergy: "착지점에서 서리 결정이 자라나 보드 위로 번져요" },
  { id: "cosmos", name: "우주", kind: "cosmos", color: "#c6a3ff", dice: ["dice.galaxy"], boards: ["board.space"], extras: ["profile.planet"],
    synergy: "착지점에 별가루가 흩어지고, 주사위들을 잇는 별자리가 그려져요" },
  { id: "aurora", name: "오로라", kind: "aurora", color: "#7dffcb", dice: ["dice.aurora"], boards: ["board.aurora"], extras: ["bubble.aurora"],
    synergy: "착지할 때마다 오로라 커튼이 보드를 가로질러 물결쳐요" },
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
