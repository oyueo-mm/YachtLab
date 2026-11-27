import { useEffect, useRef, useState } from "react";
import { Copy, Eye } from "lucide-react";
import type { SpectateState } from "../online/wire";

const RANGE_LABEL = { private: "비공개", invite: "링크 관전", public: "공개" } as const;

/**
 * Spectating control. Friend rooms (D-095, `hostControl`): the host picks private / link / public and
 * everyone else sees the range in force; a change during the room is announced to every player. Quick
 * matches are public by rule. Older servers (no `hostControl`): the previous per-player switch.
 */
export function SpectateControl({ state, me, onToggle, onVisibility, linkFor, disabled }: { state: SpectateState | null; me: string; onToggle: (allow: boolean) => void; onVisibility?: (visibility: "private" | "invite" | "public") => void; linkFor: (key: string, sid?: string) => string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  /** Shown until the server answers (a switch must move when tapped). */
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  useEffect(() => setOptimistic(null), [state]);
  const [notice, setNotice] = useState("");
  const seen = useRef<string | null>(null);
  const range = state?.hostControl ? (state.visibility ?? "private") : null;
  useEffect(() => {
    if (!range) return;
    const before = seen.current;
    seen.current = range;
    if (before === null || before === range) return;
    setNotice(`${state?.host === me ? "관전 범위를" : "방장이 관전 범위를"} '${RANGE_LABEL[range]}'(으)로 바꿨어요.`);
    const t = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(t);
  }, [range, state?.host, me]);
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
  const isHost = state.hostControl === true && state.host === me;
  const link = state.active && state.key ? linkFor(state.key, state.sid) : "";
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
      {notice && <p className="spectate-change" role="status">{notice}</p>}
      {open && (
        <div className="social-panel" role="dialog" aria-label="관전 설정">
          {/* Quick matches are always public (D-045): no switch, only the link and the count. */}
          {state.hostControl ? (
            isHost && onVisibility ? (
              <>
              <label className="spectate-switch">
                관전 범위
                <select aria-label="관전 범위" value={state.visibility ?? "private"} onChange={(event) => {
                  const value = event.target.value;
                  if (value === "private" || value === "invite" || value === "public") onVisibility(value);
                }}>
                  <option value="private">비공개</option>
                  <option value="invite">링크 관전</option>
                  <option value="public">공개</option>
                </select>
              </label>
              <p className="spectate-note">방장만 바꿀 수 있어요. 비공개: 외부 관전 불가 · 링크 관전: 링크를 받은 사람만 · 공개: 관전방 목록에서 누구나.</p>
              </>
            ) : (
              <p className="spectate-note" aria-label="현재 관전 범위">현재 관전 범위: <strong>{RANGE_LABEL[state.visibility ?? "private"]}</strong> · 방장이 정해요.</p>
            )
          ) : !state.public && (
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
                  : state.visibility === "public" ? `관전방 목록에 공개된 경기예요. 관전자는 보기만 할 수 있어요 (${state.spectators}/${state.max}명).`
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
            <p className="spectate-note">{state.hostControl ? "외부 사람은 이 경기를 볼 수 없어요." : mine ? "상대도 관전을 허용하면 관전 링크가 만들어져요." : "모든 플레이어가 허용해야 관전할 수 있어요."}</p>
          )}
        </div>
      )}
    </div>
  );
}
