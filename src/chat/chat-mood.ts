/**
 * How a chat line MOVES (A2). Separate from the equipped speech bubble (surface, border, sparkle):
 * the bubble is the sender's cosmetic, the motion belongs to the line itself and follows its meaning.
 * Derived from the text so it works for the live catalog and the fixture alike; no catalog change.
 */
export type ChatMood = "calm" | "cheer" | "ask" | "sigh" | "plead" | "shout";

const PLEAD = /한 번만|부탁|도와/;
const SHOUT = /^(요트!|대박!|이럴 수가!|말도 안 돼요!|안 돼요!|놀랍네요!|!)$/;

export function chatMoodOf(text: string): ChatMood {
  const t = text.trim();
  if (PLEAD.test(t)) return "plead";
  if (SHOUT.test(t)) return "shout";
  if (/(…|\.\.\.|\.)$/.test(t)) return "sigh";
  if (/\?$/.test(t)) return "ask";
  if (/!$/.test(t)) return "cheer";
  if (/(아쉽|아깝|안타깝)/.test(t)) return "sigh";
  return "calm";
}

/** Motion strength by tier (0.5 plain … 1.5 mythic). Never changes timing, only amplitude. */
export const CHAT_AMP: Record<string, number> = { basic: 0.5, common: 0.7, rare: 0.9, epic: 1.1, legendary: 1.3, mythic: 1.5 };
