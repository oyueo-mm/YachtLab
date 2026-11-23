/**
 * Preset chat lines and emotes (Phase 3, online social). Free text is never sent: a client may only
 * send one of these ids, and the server checks it against this table before relaying it.
 *
 * Ids are stable forever (they will be referenced by inventories, quests and purchases later):
 * never rename or reuse an id; retire an item with `retired: true` instead.
 *
 * Extension points (not implemented now — see docs/online/SOCIAL-AND-ACCOUNTS.md):
 *  - `tier`: "free" today; later "shop" (coins), "quest", "achievement", "limited".
 *  - `acquisition`: "default" items are owned by everyone; other items will need an inventory entry.
 *  - `style`: bubble look ("default"; later "silver", "gold", ...).
 *  - A player's equipped set ("loadout") is a list of ids, capped by MAX_LOADOUT.
 */
export type SocialKind = "chat" | "emote";
export type SocialTier = "free";
export type SocialItem = {
  id: string;
  kind: SocialKind;
  /** Text shown in the bubble (chat), or the emoji (emote). */
  text: string;
  /** Accessible label / button label. */
  label: string;
  tier: SocialTier;
  acquisition: "default";
  style: "default";
  retired?: boolean;
};

const chat = (id: string, text: string): SocialItem => ({ id: "chat." + id, kind: "chat", text, label: text, tier: "free", acquisition: "default", style: "default" });
const emote = (id: string, text: string, label: string): SocialItem => ({ id: "emote." + id, kind: "emote", text, label, tier: "free", acquisition: "default", style: "default" });

export const SOCIAL_ITEMS: readonly SocialItem[] = [
  chat("hello", "안녕하세요!"),
  chat("good_luck", "잘 부탁해요!"),
  chat("nice", "잘했어요!"),
  chat("great", "대단해요!"),
  chat("congrats", "축하해요!"),
  chat("so_close", "아쉽네요!"),
  chat("wait", "잠시만요!"),
  chat("thanks", "감사합니다!"),
  chat("gg", "좋은 경기였어요!"),
  chat("rematch", "한 판 더?"),
  emote("clap", "👏", "박수"),
  emote("laugh", "😂", "웃음"),
  emote("wow", "😮", "놀람"),
  emote("party", "🎉", "축하"),
  emote("cry", "😭", "아쉬움"),
  emote("thumbs_up", "👍", "좋아요"),
  emote("handshake", "🤝", "좋은 경기"),
  emote("fire", "🔥", "대단해요"),
];

const byId = new Map(SOCIAL_ITEMS.map((item) => [item.id, item]));
export const socialItem = (id: unknown): SocialItem | null => (typeof id === "string" ? byId.get(id) ?? null : null);

/** Everything a player owns today: the free default set. (Later: default ∪ inventory.) */
export const ownedSocialIds = (): ReadonlySet<string> => new Set(SOCIAL_ITEMS.filter((i) => i.acquisition === "default" && !i.retired).map((i) => i.id));
/** Server check: the id exists, is not retired, and the sender owns it. */
export function canSend(id: unknown, owned: ReadonlySet<string> = ownedSocialIds()): id is string {
  const item = socialItem(id);
  return !!item && !item.retired && owned.has(item.id);
}
export const MAX_LOADOUT = 12;

/**
 * Sending limits (per connection, kept in memory / socket attachment — never stored):
 * a burst of 3, then one every 2 s (≤ ~30 per minute), and the same item not twice within 1.5 s.
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
