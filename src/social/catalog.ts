import type { SeasonId } from "../economy/live/seasons";
/**
 * Preset chat lines and emotes (Phase 3, online social). Free text is never sent: a client may only
 * send one of these ids, and the server checks it against this table before relaying it.
 *
 * Ids are stable forever (they are referenced by inventories, loadouts and purchases): never rename or
 * reuse an id; retire an item with `retired: true` instead.
 *
 * Phase 6 (shop): the free default set is 4 emotes + 6 lines (`acquisition: "default"`). The other
 * Phase 3 items keep their ids and meaning and became shop items (common tier). Prices and upgrade
 * levels live in src/economy/live/catalog.ts; this file only holds the texts.
 */
export type SocialKind = "chat" | "emote";
export type SocialTier = "basic" | "common" | "rare" | "epic" | "legendary" | "mythic";
export type SocialItem = {
  id: string;
  kind: SocialKind;
  /** Text shown in the bubble (chat), or the emoji (emote). */
  text: string;
  /** Accessible label / button label. */
  label: string;
  tier: SocialTier;
  /** "default": everyone owns it. "shop": needs an inventory entry. */
  acquisition: "default" | "shop";
  style: "default" | "spark" | "impact";
  season?: SeasonId;
  retired?: boolean;
};

const chat = (id: string, text: string, tier: SocialTier = "basic"): SocialItem => ({ id: "chat." + id, kind: "chat", text, label: text, tier, acquisition: tier === "basic" ? "default" : "shop", style: "default" });
const emote = (id: string, text: string, label: string, tier: SocialTier = "basic"): SocialItem => ({ id: "emote." + id, kind: "emote", text, label, tier, acquisition: tier === "basic" ? "default" : "shop", style: "default" });

export const SOCIAL_ITEMS: readonly SocialItem[] = [
  // default chat (6), in the default equip order
  chat("hello", "안녕하세요!"),
  chat("fighting", "화이팅!"),
  chat("great", "대단해요!"),
  chat("thanks", "감사합니다!"),
  chat("gg", "좋은 경기였어요!"),
  chat("good_luck", "잘 부탁해요!"),
  // Phase 3 lines that are now shop items (same ids, same text)
  chat("nice", "잘했어요!", "common"),
  chat("congrats", "축하해요!", "common"),
  chat("so_close", "아쉽네요!", "common"),
  chat("wait", "잠시만요!", "common"),
  chat("rematch", "한 판 더?", "common"),
  chat("lucky", "운이 좋았어요!", "rare"),
  // default emotes (4)
  emote("smile", "🙂", "미소"),
  emote("party", "🎉", "축하"),
  emote("clap", "👏", "박수"),
  emote("thumbs_up", "👍", "좋아요"),
  // Phase 3 emotes that are now shop items
  emote("laugh", "😂", "웃음", "common"),
  emote("wow", "😮", "놀람", "common"),
  emote("cry", "😭", "아쉬움", "common"),
  emote("handshake", "🤝", "좋은 경기", "common"),
  emote("fire", "🔥", "대단해요", "common"),
  emote("dice", "🎲", "주사위", "rare"),
  emote("sparkles", "✨", "반짝", "epic"),
  emote("crown", "👑", "왕관", "legendary"),
  // 2026-11-25 content (H): standard Unicode emoji only (no characters or artwork of unclear rights)
  emote("cool", "😎", "멋짐", "common"),
  emote("think", "🤔", "고민", "common"),
  emote("sweat", "😅", "머쓱", "common"),
  emote("please", "🙏", "부탁", "common"),
  emote("sleepy", "😴", "졸림", "common"),
  emote("yay", "🥳", "신남", "common"),
  emote("fired_up", "😤", "의욕", "common"),
  emote("clover", "🍀", "행운", "rare"),
  emote("target", "🎯", "명중", "rare"),
  emote("hundred", "💯", "백점", "rare"),
  emote("rocket", "🚀", "로켓", "rare"),
  emote("rainbow", "🌈", "무지개", "rare"),
  emote("whale", "🐳", "고래", "epic"),
  emote("bolt", "⚡", "번개", "epic"),
  emote("cake", "🍰", "케이크", "epic"),
  emote("gem", "💎", "보석", "legendary"),
  emote("trophy", "🏆", "트로피", "legendary"),
  emote("starlight", "🌟", "별빛", "mythic"),
  // chat presets (H)
  chat("learn", "한 수 배웁니다!", "common"),
  chat("nervous", "긴장되네요…", "common"),
  chat("good_pick", "좋은 선택이에요!", "common"),
  chat("almost", "아깝다!", "common"),
  chat("still_chance", "아직 기회 있어요!", "common"),
  chat("fun_game", "재밌는 판이네요!", "common"),
  chat("dice_help", "주사위님 도와주세요!", "common"),
  chat("comeback", "역전 가자!", "common"),
  chat("this_time", "이번엔 진짜다!", "common"),
  chat("nice_roll", "멋진 굴림이었어요!", "common"),
  chat("yacht_chance", "요트 각이다!", "rare"),
  chat("bonus_get", "보너스 확보!", "rare"),
  chat("go_straight", "스트레이트 노려볼게요!", "rare"),
  chat("calm", "침착하게 갑시다.", "rare"),
  chat("not_over", "끝날 때까지 몰라요!", "rare"),
  chat("lucky_day", "오늘 주사위가 저를 좋아하네요!", "epic"),
  chat("legend_game", "전설의 한 판!", "rare"),
  chat("see_you", "모두 즐거웠어요, 또 만나요!", "common"),
  { ...chat("best_try", "그게 최선이야?", "epic"), style: "impact" },
  { ...chat("brace", "긴장해.", "epic"), style: "impact" },
  { ...chat("too_easy", "너무 쉬운데?", "legendary"), style: "impact" },
  { ...chat("try_again", "이걸 못 이겨?", "legendary"), style: "impact" },
  { ...chat("not_yet", "벌써 포기했어?", "epic"), style: "impact" },
  { ...chat("lucky_skill", "운도 실력이야.", "epic"), style: "spark" },
  { ...chat("planned", "계획대로.", "legendary"), style: "spark" },
  chat("keep_playing", "아직 안 끝났어.", "rare"),
  chat("turnaround", "역전 간다.", "rare"),
  chat("it_worked", "이게 되네?", "rare"),
  { ...chat("my_dice", "주사위도 내 편이네.", "epic"), style: "spark" },
  { ...chat("the_yacht", "요트가 뭔지 보여줄게.", "legendary"), style: "spark" },
  { ...emote("angry", "😠", "화남", "rare"), style: "impact" },
  { ...emote("rage", "😡", "분노", "epic"), style: "impact" },
  emote("question", "❔", "물음표 한 개", "rare"),
  emote("double_question", "❔❔", "물음표 두 개", "epic"),
  emote("exclaim", "❕", "느낌표 한 개", "rare"),
  emote("double_exclaim", "‼️", "느낌표 두 개", "epic"),
  emote("interrobang", "⁉️", "물음표와 느낌표", "epic"),
  { ...emote("smirk", "😏", "비웃음", "legendary"), style: "spark" },
  { ...emote("confident", "😼", "자신감", "epic"), style: "spark" },
  emote("gasp", "😲", "깜짝 놀람", "rare"),
  { ...chat("christmas_greetings", "메리 크리스마스!", "common"), season: "christmas-2026" },
  { ...emote("christmas_gift", "🎁", "선물 상자", "rare"), season: "christmas-2026", style: "spark" },

];

const byId = new Map(SOCIAL_ITEMS.map((item) => [item.id, item]));
export const socialItem = (id: unknown): SocialItem | null => (typeof id === "string" ? byId.get(id) ?? null : null);

/** The free default set (owned and equipped by every player, guests included). */
export const DEFAULT_EMOTES = SOCIAL_ITEMS.filter((i) => i.kind === "emote" && i.acquisition === "default" && !i.retired).map((i) => i.id);
export const DEFAULT_CHATS = SOCIAL_ITEMS.filter((i) => i.kind === "chat" && i.acquisition === "default" && !i.retired).map((i) => i.id);
/** What a player without an account (or without a saved loadout) may send. */
export const ownedSocialIds = (): ReadonlySet<string> => new Set([...DEFAULT_EMOTES, ...DEFAULT_CHATS]);
/** Server check: the id exists, is not retired, and is in the sender's equipped set. */
export function canSend(id: unknown, equipped: ReadonlySet<string> = ownedSocialIds()): id is string {
  const item = socialItem(id);
  return !!item && !item.retired && equipped.has(item.id);
}
/** Most items one equipped set may hold (8 emotes + 10 lines). */
export const MAX_LOADOUT = 18;

/**
 * Sending limits (per connection, kept in memory / socket attachment — never stored):
 * a burst of 3, then one every 2 s (≤ ~30 per minute), and the same item not twice within 1.5 s.
 * The same for every player: upgrade levels and slot counts never change the pace.
 */
export const SOCIAL_LIMITS = { burst: 3, refillPerSecond: 0.5, sameItemGapMs: 1500 } as const;
export type SocialBucket = { tokens: number; at: number; lastId?: string; lastAt?: number };
export function allowSocial(bucket: SocialBucket, id: string, now: number): boolean {
  bucket.tokens = Math.min(SOCIAL_LIMITS.burst, bucket.tokens + ((now - bucket.at) / 1000) * SOCIAL_LIMITS.refillPerSecond);
  bucket.at = now;
  if (bucket.lastId === id && bucket.lastAt !== undefined && now - bucket.lastAt < SOCIAL_LIMITS.sameItemGapMs) return false;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  bucket.lastId = id;
  bucket.lastAt = now;
  return true;
}
export const newSocialBucket = (now: number): SocialBucket => ({ tokens: SOCIAL_LIMITS.burst, at: now });

/** ms until `id` may be sent again from this bucket (the same rules as `allowSocial`). */
export function socialRetryMs(b: SocialBucket, id: string, now: number): number {
  const tokens = Math.min(SOCIAL_LIMITS.burst, b.tokens + ((now - b.at) / 1000) * SOCIAL_LIMITS.refillPerSecond);
  const forToken = tokens >= 1 ? 0 : ((1 - tokens) / SOCIAL_LIMITS.refillPerSecond) * 1000;
  const forSame = b.lastId === id && b.lastAt !== undefined ? Math.max(0, SOCIAL_LIMITS.sameItemGapMs - (now - b.lastAt)) : 0;
  return Math.ceil(Math.max(forToken, forSame));
}
