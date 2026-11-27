import type { ReactNode } from "react";
import type { SocialItem } from "../social/catalog";
import { chatMoodOf, CHAT_AMP } from "../chat/chat-mood";
import { EmoteGlyph } from "./EmoteGlyph";

/**
 * One chat message or emote as drawn in the game feed, the shop preview and the preview page — the
 * single renderer, so what the shop shows is what the table shows.
 * Layers (kept apart on purpose):
 *   bubble  the sender's equipped speech bubble: surface, border, sparkle (`bubbleCss`)
 *   motion  the line's own entrance, by meaning (`chat-m-*`) and tier strength (`--chat-amp`)
 * `effects` false (reduced effects / opponent effects off) draws the plain bubble with no motion.
 */
export function ChatMessage({ item, from, bubbleCss = "", level = 1, mine = false, effects = true, className = "", staticMode = false }: {
  item: Pick<SocialItem, "id" | "kind" | "text" | "label" | "tier" | "style">;
  from?: ReactNode;
  bubbleCss?: string;
  level?: number;
  mine?: boolean;
  effects?: boolean;
  className?: string;
  staticMode?: boolean;
}) {
  const emote = item.kind === "emote";
  const mood = emote ? null : chatMoodOf(item.text);
  const cls = [
    "feed-msg",
    item.kind,
    mine ? "mine" : "",
    staticMode ? bubbleCss.replace(/\bbubble-lv3\b/, "").trim() : bubbleCss,
    effects && emote ? `emote-lv${level}` : "",
    effects && item.style !== "default" ? `social-${item.style}` : "",
    effects && mood ? `chat-m-${mood} chat-t-${item.tier}` : "",
    staticMode ? "static" : "",
    className,
  ].filter(Boolean).join(" ");
  return (
    <span className={cls} style={mood ? ({ "--chat-amp": CHAT_AMP[item.tier] ?? 0.7 } as React.CSSProperties) : undefined} role="status" data-chat-id={item.id}>
      {from != null && <b className="feed-from">{from}</b>}
      <span className="feed-text" aria-label={emote ? item.label : undefined}>
        {emote ? <EmoteGlyph id={item.id} text={item.text} level={level} effects={effects} /> : item.text}
      </span>
    </span>
  );
}
