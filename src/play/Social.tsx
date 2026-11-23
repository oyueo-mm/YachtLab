import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Eye, MessageCircle, X } from "lucide-react";
import { SOCIAL_ITEMS, socialItem } from "../social/catalog";
import { useSettings } from "../settings";
import type { SpectateState } from "../online/wire";

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

/**
 * Players: allow spectators. A watch link exists only while every player allows it; anyone turning it
 * off revokes the link at once (watchers are disconnected, the old link stops working).
 */
export function SpectateControl({ state, me, onToggle, linkFor, disabled }: { state: SpectateState | null; me: string; onToggle: (allow: boolean) => void; linkFor: (key: string) => string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  /** Shown until the server answers (a switch must move when tapped). */
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  useEffect(() => setOptimistic(null), [state]);
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [open]);
  if (!state) return null;
  const mine = optimistic ?? state.allow[me] === true;
  const link = state.active && state.key ? linkFor(state.key) : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* the field below can be selected instead */
    }
  };
  return (
    <div className="social spectate-control" ref={box}>
      <button type="button" className="text-button social-toggle" aria-expanded={open} aria-label="관전 설정" disabled={disabled} onClick={() => setOpen((v) => !v)}>
        <Eye size={16} />
        <span className="social-toggle-label">{state.active ? `관전 ${state.spectators}` : "관전"}</span>
      </button>
      {open && (
        <div className="social-panel" role="dialog" aria-label="관전 설정">
          <label className="spectate-switch">
            <input type="checkbox" role="switch" checked={mine} onChange={(e) => {
                setOptimistic(e.target.checked);
                onToggle(e.target.checked);
              }}
            />
            관전 허용
          </label>
          {state.active ? (
            <>
              <p className="spectate-note">
                관전 링크가 있는 사람은 이 경기를 볼 수만 있어요 ({state.spectators}/{state.max}명). 끄면 링크가 바로 막혀요.
              </p>
              <div className="spectate-link">
                <input aria-label="관전 링크" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className="secondary" onClick={() => void copy()}>
                  <Copy size={14} /> {copied ? "복사됨" : "복사"}
                </button>
              </div>
            </>
          ) : (
            <p className="spectate-note">{mine ? "상대도 관전을 허용하면 관전 링크가 만들어져요." : "모든 플레이어가 허용해야 관전할 수 있어요."}</p>
          )}
        </div>
      )}
    </div>
  );
}
