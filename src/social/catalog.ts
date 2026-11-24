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
export type SocialTier = "basic" | "common" | "rare" | "epic" | "legendary";
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
  style: "default";
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
