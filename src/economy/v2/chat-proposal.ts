import { SOCIAL_ITEMS } from "../../social/catalog";
import type { PricedTier } from "./params";

export const PROPOSED_CHAT_TEXT: Record<PricedTier, string[]> = {
  common: ["수고했어요!", "잠시만요", "축하해요!", "재밌네요!", "그러네요", "그렇군요", "아깝네요", "아쉽네요", "좋은 선택이에요!"],
  rare: ["와!", "대단해요!", "아...", "어렵네요", "멋지네요!", "잘하시네요!", "나이스!", "고민되네요."],
  epic: ["?", "!", "어라?", "정말요?", "설마요?", "훌륭해요!", "안타깝네요.", "저런…", "이런…"],
  legendary: ["놀랍네요!", "대박!", "안 돼요!", "한 번만!", "아니…", "쉽지 않죠?", "고민 중…"],
  mythic: ["이럴 수가!", "말도 안 돼요!", "이게 무슨…", "요트!", "요트 한 번만!"],
};
export const PROPOSED_FREE_CHAT = ["안녕하세요!", "화이팅!", "좋아요!", "감사합니다!", "좋은 경기였어요!", "잘 부탁해요!"];

const existing = new Map(SOCIAL_ITEMS.filter((item) => item.kind === "chat" && !item.retired && !item.season)
  .map((item) => [item.text, item.id]));
export const PROPOSED_CHAT = Object.entries(PROPOSED_CHAT_TEXT).flatMap(([tier, lines]) =>
  lines.map((text, index) => ({ text, tier: tier as PricedTier, id: existing.get(text) ?? `research.chat.${tier}.${index + 1}` })),
);
export const PROPOSED_DEFAULTS = PROPOSED_FREE_CHAT.map((text, index) => ({
  text, id: existing.get(text) ?? `research.chat.free.${index + 1}`,
}));
/** Existing default entitlement survives moving the line out of the default equipped set. */
export const LEGACY_FREE_CHAT = "chat.great";
