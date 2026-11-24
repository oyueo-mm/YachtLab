import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { SOCIAL_ITEMS, socialItem } from "../social/catalog";
import { useSettings } from "../settings";

const HIDE_KEY = "yachtlab.social.hideOpponent";
export const BUBBLE_MS = 2600;

const readHidden = () => {
  try {
    return localStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
};

/** Per-player bubble currently shown (latest wins). Messages are live-only: nothing is replayed on reconnect. */
export function useBubbles() {
  const [bubbles, setBubbles] = useState<Record<string, { id: string; key: number }>>({});
  const [hideOpponent, setHideOpponentState] = useState(readHidden);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const seq = useRef(0);
  const show = useCallback((from: string, id: string) => {
    if (!socialItem(id)) return;
    const key = ++seq.current;
    setBubbles((b) => ({ ...b, [from]: { id, key } }));
    clearTimeout(timers.current.get(from));
    timers.current.set(
      from,
      setTimeout(() => setBubbles((b) => (b[from]?.key === key ? Object.fromEntries(Object.entries(b).filter(([k]) => k !== from)) : b)), BUBBLE_MS),
    );
  }, []);
  const clear = useCallback(() => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current.clear();
    setBubbles({});
  }, []);
  useEffect(() => clear, [clear]);
  const setHideOpponent = (v: boolean) => {
    setHideOpponentState(v);
    try {
      localStorage.setItem(HIDE_KEY, v ? "1" : "0");
    } catch {
      /* private mode */
    }
  };
  return { bubbles, show, clear, hideOpponent, setHideOpponent };
}

/** The bubble inside a score chip: covers only that chip, never the dice or the scoreboard. */
export function ChipBubble({ bubble }: { bubble?: { id: string; key: number } }) {
  const { reducedEffects } = useSettings();
  const item = bubble ? socialItem(bubble.id) : null;
  if (!item) return null;
  return (
    <span key={bubble!.key} className={"chip-bubble " + item.kind + (reducedEffects ? " static" : "")} role="status" aria-label={item.kind === "emote" ? item.label : item.text}>
      {item.text}
    </span>
  );
}

/**
 * Preset chat + emotes in one small panel (a button in the tool row opens it). Only catalog items can
 * be sent; the server checks the id again and limits the rate.
 */
export function SocialPanel({ onSend, hideOpponent, setHideOpponent, disabled }: { onSend: (id: string) => boolean; hideOpponent: boolean; setHideOpponent: (v: boolean) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [cooling, setCooling] = useState(false);
  const panel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const send = (id: string) => {
    if (cooling) return;
    if (onSend(id)) {
      setOpen(false);
      // Matches the server's pace (burst 3, then one per 2 s): a short local pause avoids rejected taps.
      setCooling(true);
      setTimeout(() => setCooling(false), 700);
    }
  };
  const emotes = SOCIAL_ITEMS.filter((i) => i.kind === "emote" && !i.retired);
  const lines = SOCIAL_ITEMS.filter((i) => i.kind === "chat" && !i.retired);
  return (
    <div className="social" ref={panel}>
      <button type="button" className="text-button social-toggle" aria-expanded={open} aria-label="채팅·이모티콘" disabled={disabled} onClick={() => setOpen((v) => !v)}>
        <MessageCircle size={16} />
        <span className="social-toggle-label">채팅</span>
      </button>
      {open && (
        <div className="social-panel" role="dialog" aria-label="채팅·이모티콘">
          <div className="social-panel-head">
            <strong>보내기</strong>
            <button type="button" className="icon-button" aria-label="닫기" onClick={() => setOpen(false)}>
              <X size={16} />
            </button>
          </div>
          <div className="social-emotes" role="group" aria-label="이모티콘">
            {emotes.map((i) => (
              <button key={i.id} type="button" aria-label={i.label} title={i.label} disabled={cooling} onClick={() => send(i.id)}>
                {i.text}
              </button>
            ))}
          </div>
          <div className="social-lines" role="group" aria-label="프리셋 채팅">
            {lines.map((i) => (
              <button key={i.id} type="button" disabled={cooling} onClick={() => send(i.id)}>
                {i.text}
              </button>
            ))}
          </div>
          <label className="social-hide">
            <input type="checkbox" checked={hideOpponent} onChange={(e) => setHideOpponent(e.target.checked)} />
            상대 메시지 숨기기
          </label>
        </div>
      )}
    </div>
  );
}
