import { useCallback, useEffect, useRef, useState } from "react";
import { EyeOff, LoaderCircle, MessageCircle, X } from "lucide-react";
import { allowSocial, newSocialBucket, socialItem, socialRetryMs, type SocialBucket, type SocialItem } from "../social/catalog";
import { GUEST_LOOK, type PublicLook } from "../economy/live/catalog";
import { PlayerTag, bubbleCssOf } from "./Looks";
import { getSettings, useSettings } from "../settings";
import { playEmoteSfx } from "../sound";
import { ChatMessage } from "./ChatMessage";
import { chatMoodOf } from "../chat/chat-mood";

/**
 * Preset chat and emotes (C, 2026-11-25). Root causes of "sent but nobody saw it" that this fixes:
 *  1. The server's anti-spam bucket (burst 3, then one per 2 s, the same item not twice in 1.5 s)
 *     refused about one message in five at a natural tapping pace, while the page closed the panel and
 *     started a 0.7 s cooldown as if it had been sent; the refusal only appeared as a far-away error
 *     line. Now the page runs the very same bucket (`allowSocial`) before sending, shows how long to
 *     wait right on the buttons, and a message counts as sent only when the server echoes it back.
 *  2. A tap while the connection was down silently did nothing. Now it says so.
 *  3. "상대 메시지 숨기기" could be left on without any sign. Now the dock shows that it is on.
 * The limits and the ownership check (equipped items only) are unchanged on the server.
 */
export type Sent = { id: string; key: number };
type Feedback = { text: string; tone: "info" | "error" } | null;
export const ECHO_TIMEOUT_MS = 4000;


const TIER_ORDER = ["basic", "common", "rare", "epic", "legendary", "mythic"] as const;
export const TIER_NAME: Record<string, string> = { basic: "기본", common: "일반", rare: "고급", epic: "영웅", legendary: "전설", mythic: "신화" };
/** Lines grouped by tier in a fixed order (free first), keeping the equipped order inside a group. */
export function groupByTier<T extends { tier: string }>(items: readonly T[]): [string, T[]][] {
  return TIER_ORDER.map((t) => [t, items.filter((i) => i.tier === t)] as [string, T[]]).filter(([, g]) => g.length > 0);
}

/** Messages shown under the board (latest first), from the server's `said` relay. */
export type FeedEntry = { key: number; from: string; id: string; at: number };
export const FEED_MS = 4200;
export const FEED_MAX = 2;

const HIDE_KEY = "yachtlab.social.hideOpponent";
const readHidden = () => {
  try {
    return localStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * Everything about one table's chat: the feed of received messages, the sender with its own copy of
 * the server's rate limit, and the "hide other players' messages" switch.
 */
export type ResolveItem = (id: unknown) => SocialItem | null;
export function useTableChat(me: string | null, resolve: ResolveItem = socialItem) {
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [history, setHistory] = useState<FeedEntry[]>([]);
  const [hideOthers, setHideState] = useState(readHidden);
  const [pending, setPending] = useState<Sent | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [waitUntil, setWaitUntil] = useState(0);
  const bucket = useRef<SocialBucket>(newSocialBucket(Date.now()));
  const seq = useRef(0);
  const heard = useRef(new Map<string, number>());
  const hideRef = useRef(hideOthers);
  hideRef.current = hideOthers;
  /** Sender's emote level (set by the screen from the server-validated looks) for the Lv.3 sound. */
  const levelRef = useRef<(from: string, id: string) => number>(() => 1);
  const meRef = useRef(me);
  meRef.current = me;
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;
  const pendingRef = useRef<Sent | null>(null);
  pendingRef.current = pending;
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const noticeId = useRef(0);
  const say = useCallback((text: string, tone: "info" | "error" = "info") => {
    setFeedback({ text, tone });
    const key = ++noticeId.current;
    // Cleared after a moment unless a newer notice replaced it (incoming messages do not matter).
    later(() => noticeId.current === key && setFeedback(null), 2600);
  }, []);

  /** A relayed message (`said`): mine confirms my send; others' respect the hide switch. */
  const received = useCallback((from: string, id: string) => {
    const item = resolveRef.current(id);
    if (!item) return;
    const mine = from === meRef.current;
    if (mine && pendingRef.current?.id === id) setPending(null);
    if (!mine && hideRef.current) return;
    const now = Date.now();
    const key = ++seq.current;
    if ((item.kind === "emote" || item.style !== "default") && (mine || getSettings().opponentFx)) {
      const messageKey = from + "/" + id;
      for (const [key, time] of heard.current) if (now - time > 1000) heard.current.delete(key);
      if (!heard.current.has(messageKey)) playEmoteSfx(id, levelRef.current(from, id));
      heard.current.set(messageKey, now);
    }
    const entry = { key, from, id, at: now };
    setFeed((f) => [entry, ...f.filter((e) => e.from !== from)].slice(0, FEED_MAX));
    setHistory((entries) => [entry, ...entries].slice(0, 20));
    later(() => setFeed((f) => f.filter((e) => e.key !== key)), FEED_MS);
  }, []);

  /** The server refused (rate limit / not equipped): never shown as sent. */
  const refused = useCallback(
    (code: string, message: string, retryMs?: number) => {
      setPending(null);
      if (code === "SOCIAL_RATE_LIMITED") {
        // Re-align the local copy of the bucket with the server's verdict.
        bucket.current = { tokens: 0, at: Date.now() };
        const wait = Math.max(500, retryMs ?? 2000);
        setWaitUntil(Date.now() + wait);
        say(`너무 빨라요. ${Math.ceil(wait / 1000)}초 뒤에 다시 보내 주세요.`, "error");
      } else say(message || "보낼 수 없는 메시지예요.", "error");
    },
    [say],
  );

  /** Try to send; returns false (with a visible reason) when it was not sent. */
  const send = useCallback(
    (id: string, transport: (id: string) => boolean) => {
      const now = Date.now();
      if (pendingRef.current) return false;
      const trial = { ...bucket.current };
      if (!allowSocial(trial, id, now)) {
        const wait = Math.max(300, socialRetryMs(bucket.current, id, now));
        setWaitUntil(now + wait);
        say(`${Math.ceil(wait / 1000)}초 뒤에 보낼 수 있어요.`);
        return false;
      }
      if (!transport(id)) {
        say("연결이 끊겨 보내지 못했어요. 다시 연결되면 보내 주세요.", "error");
        return false;
      }
      bucket.current = trial;
      const sent = { id, key: ++seq.current };
      setPending(sent);
      later(() => {
        if (pendingRef.current?.key !== sent.key) return;
        setPending(null);
        say("보내지 못했어요. 연결을 확인하고 다시 보내 주세요.", "error");
      }, ECHO_TIMEOUT_MS);
      return true;
    },
    [say],
  );

  /** A new socket starts with a fresh server bucket. */
  const reset = useCallback(() => {
    bucket.current = newSocialBucket(Date.now());
    setPending(null);
    setWaitUntil(0);
  }, []);
  const clearFeed = useCallback(() => { setFeed([]); setHistory([]); }, []);

  const setHideOthers = (v: boolean) => {
    setHideState(v);
    try {
      localStorage.setItem(HIDE_KEY, v ? "1" : "0");
    } catch {
      /* private mode */
    }
  };
  return { feed, history, received, refused, send, reset, clearFeed, pending, feedback, waitUntil, hideOthers, setHideOthers, levelRef };
}
export type TableChat = ReturnType<typeof useTableChat>;

/**
 * Messages under the board: a fixed-height strip (the page never moves when one arrives), never over
 * the dice or the roll button. Multi-player tables show who sent it. Bubble styles and emote levels
 * come from the sender's server-validated look; other players' effects follow "상대 아이템 효과".
 */
export function TableFeed({ chat, names, looks, me, from, avatars = false, resolve = socialItem }: {
  chat: TableChat; names: Record<string, string>; looks: Record<string, PublicLook>; me: string | null; from?: string; avatars?: boolean; resolve?: ResolveItem;
}) {
  const { reducedEffects, opponentFx } = useSettings();
  return (
    <div className={from ? "table-feed anchored-feed" : "table-feed"} aria-live="polite" aria-label="채팅 메시지">
      {chat.feed.filter((entry) => (!from || entry.from === from) && (!chat.hideOthers || entry.from === me)).map((e) => {
        const item = resolve(e.id);
        if (!item) return null;
        const mine = e.from === me;
        const fxOn = mine || opponentFx;
        const look = looks[e.from];
        const lv = item.kind === "emote" ? (look?.emotes.find((x) => x.id === e.id)?.lv ?? 1) : 1;
        const css = fxOn ? bubbleCssOf(look) : "";
        return (
          <ChatMessage
            key={e.key}
            item={item}
            mine={mine}
            level={lv}
            bubbleCss={css}
            effects={fxOn && !reducedEffects}
            staticMode={reducedEffects}
            from={avatars ? <PlayerTag name={mine ? "나" : (names[e.from] ?? "")} look={look} me={mine} compact /> : (mine ? "나" : (names[e.from] ?? ""))}
          />
        );
      })}
      {!from && chat.hideOthers && (
        <span className="feed-hidden">
          <EyeOff size={13} /> 다른 사람 메시지 숨김
        </span>
      )}
    </div>
  );
}

/**
 * The send bar under the board: every equipped emote one tap away, preset chat in a sheet. Only
 * equipped items are offered (the server refuses anything else); disabled while offline.
 */
export function SocialDock({ chat, look = GUEST_LOOK, online, transport, names = {}, me, resolve = socialItem }: {
  chat: TableChat; look?: PublicLook; online: boolean; transport: (id: string) => boolean;
  names?: Record<string, string>; me?: string; /** Preview page only: resolves fixture ids. The game always uses the live catalog. */ resolve?: ResolveItem;
}) {
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [now, setNow] = useState(Date.now);
  const box = useRef<HTMLDivElement | null>(null);
  const waiting = chat.waitUntil > now;
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [waiting]);
  useEffect(() => setNow(Date.now()), [chat.waitUntil]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const items = (ids: string[]) => ids.map((id) => resolve(id)).filter((i): i is SocialItem => !!i && !i.retired);
  const emotes = items(look.emotes.map((e) => e.id));
  const lines = items(look.chats);
  const fire = (id: string, closeAfter = false) => {
    if (chat.send(id, transport) && closeAfter) setOpen(false);
  };
  const disabled = !online;
  const state = !online ? "연결 중…" : chat.pending ? "보내는 중…" : waiting ? `${Math.ceil((chat.waitUntil - now) / 1000)}초 뒤 가능` : "";
  return (
    <div className="social-dock" ref={box}>
      <div className="dock-row" role="group" aria-label="이모티콘 보내기">
        {emotes.map((i) => (
          <button key={i.id} type="button" className={"dock-emote" + (chat.pending?.id === i.id ? " sending" : "")} aria-label={i.label} title={i.label} disabled={disabled} onClick={() => fire(i.id)}>
            {chat.pending?.id === i.id ? <LoaderCircle size={16} className="spin" /> : i.text}
          </button>
        ))}
        <button type="button" className="dock-chat" aria-expanded={open} aria-label="채팅·이모티콘" disabled={disabled} onClick={() => setOpen((v) => !v)}>
          <MessageCircle size={17} />
          <span>채팅</span>
        </button>
      </div>
      <p className={"dock-state" + (chat.feedback?.tone === "error" ? " error" : "")} role="status">
        {chat.feedback?.text ?? (state || (chat.hideOthers && <span className="feed-hidden"><EyeOff size={13} /> 다른 사람 메시지 숨김</span>))}
      </p>
      {open && (
        <div className="social-panel dock-sheet" role="dialog" aria-label="채팅·이모티콘">
          <div className="social-panel-head">
            <strong>보내기</strong>
            <button type="button" className="icon-button" aria-label="닫기" onClick={() => setOpen(false)}>
              <X size={16} />
            </button>
          </div>
          <div className="social-emotes" role="group" aria-label="이모티콘">
            {emotes.map((i) => (
              <button key={i.id} type="button" aria-label={i.label} title={i.label} disabled={disabled} onClick={() => fire(i.id, true)}>
                {i.text}
              </button>
            ))}
          </div>
          <div className="social-lines" role="group" aria-label="프리셋 채팅">
            {groupByTier(lines).map(([tier, group]) => (
              <section key={tier} className="social-tier" data-tier={tier} aria-label={TIER_NAME[tier] + " 채팅"}>
                {groupByTier(lines).length > 1 && <h4>{TIER_NAME[tier]}</h4>}
                <div className="social-tier-lines">
                  {group.map((i) => (
                    <button key={i.id} type="button" data-tier={i.tier} data-mood={chatMoodOf(i.text)} disabled={disabled} onClick={() => fire(i.id, true)}>
                      {i.text}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <p className="dock-sheet-state" role="status">
            {chat.feedback?.text ?? state}
          </p>
          <button type="button" className="text-button" aria-expanded={historyOpen} onClick={() => setHistoryOpen(!historyOpen)}>채팅 기록</button>
          {historyOpen && <ol className="chat-history" aria-label="채팅 기록">
            {chat.history.filter((entry) => !chat.hideOthers || entry.from === me).map((entry) => <li key={entry.key}>
              <strong>{entry.from === me ? "나" : names[entry.from]}</strong> {resolve(entry.id)?.text}
            </li>)}
          </ol>}
          <label className="social-hide">
            <input type="checkbox" checked={chat.hideOthers} onChange={(e) => chat.setHideOthers(e.target.checked)} />
            다른 사람 메시지 숨기기
          </label>
        </div>
      )}
    </div>
  );
}
