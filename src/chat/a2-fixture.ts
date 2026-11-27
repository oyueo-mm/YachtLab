import type { SocialItem, SocialTier } from "../social/catalog";

/**
 * A2 (2026-11-27): the confirmed 38 preset lines as a TEST FIXTURE. The tier split is a proposal; it is
 * not the live catalog and is never sent to the server. The live catalog (src/social/catalog.ts, owned
 * by C5) is unchanged. Ids carry the `fixture.` prefix so they can never collide with a permanent id.
 * Used by the preview page (연구실 > 꾸미기 미리보기) and by tests.
 */
export type FixtureLine = SocialItem & { proposedTier: SocialTier };

const T = { common: "common", rare: "rare", epic: "epic", legendary: "legendary", mythic: "mythic" } as const;
const GROUPS: [SocialTier, string[]][] = [
  [T.common, ["수고했어요!", "잠시만요", "축하해요!", "재밌네요!", "그러네요", "그렇군요", "아깝네요", "아쉽네요", "좋은 선택이에요!"]],
  [T.rare, ["와!", "대단해요!", "아...", "어렵네요", "멋지네요!", "잘하시네요!", "나이스!", "고민되네요."]],
  [T.epic, ["?", "!", "어라?", "정말요?", "설마요?", "훌륭해요!", "안타깝네요.", "저런…", "이런…"]],
  [T.legendary, ["놀랍네요!", "대박!", "안 돼요!", "한 번만!", "아니…", "쉽지 않죠?", "고민 중…"]],
  [T.mythic, ["이럴 수가!", "말도 안 돼요!", "이게 무슨…", "요트!", "요트 한 번만!"]],
];
/** Proposed free default set (6). "대단해요!" moves to the paid list, so it is not duplicated. */
export const FIXTURE_FREE = ["안녕하세요!", "화이팅!", "좋아요!", "감사합니다!", "좋은 경기였어요!", "잘 부탁해요!"] as const;

const make = (text: string, tier: SocialTier, free: boolean, n: number): FixtureLine => ({
  id: `fixture.chat.${free ? "free" : tier}.${String(n).padStart(2, "0")}`,
  kind: "chat",
  text,
  label: text,
  tier: free ? "basic" : tier,
  proposedTier: free ? "basic" : tier,
  acquisition: free ? "default" : "shop",
  style: "default",
});

export const FIXTURE_CHATS: readonly FixtureLine[] = [
  ...FIXTURE_FREE.map((t, i) => make(t, "basic", true, i + 1)),
  ...GROUPS.flatMap(([tier, lines]) => lines.map((t, i) => make(t, tier, false, i + 1))),
];
/** Only the 38 paid-candidate lines. */
export const FIXTURE_PAID = FIXTURE_CHATS.filter((l) => l.acquisition === "shop");
export const fixtureLine = (id: string) => FIXTURE_CHATS.find((l) => l.id === id) ?? null;
