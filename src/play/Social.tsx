import { useEffect, useRef, useState } from "react";
import { Copy, Eye } from "lucide-react";
import type { SpectateState } from "../online/wire";

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
  // Until the server answers (or an older server that never sends it), the button is shown disabled
  // rather than hidden, so the tool row keeps its shape on every screen.
  if (!state)
    return (
      <div className="social spectate-control">
        <button type="button" className="text-button social-toggle" aria-label="관전 설정" disabled>
          <Eye size={16} />
          <span className="social-toggle-label">관전</span>
        </button>
      </div>
    );
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
          {/* Quick matches are always public (D-045): no switch, only the link and the count. */}
          {!state.public && (
            <label className="spectate-switch">
              <input type="checkbox" role="switch" checked={mine} onChange={(e) => {
                  setOptimistic(e.target.checked);
                  onToggle(e.target.checked);
                }}
              />
              관전 허용
            </label>
          )}
          {state.active ? (
            <>
              <p className="spectate-note">
                {state.public
                  ? `빠른 대전은 관전방에 공개돼요. 관전자는 보기만 할 수 있어요 (${state.spectators}/${state.max}명).`
                  : `관전 링크가 있는 사람은 이 경기를 볼 수만 있어요 (${state.spectators}/${state.max}명). 끄면 링크가 바로 막혀요.`}
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
