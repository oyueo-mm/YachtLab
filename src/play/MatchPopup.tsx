import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GripHorizontal, Minus, Search, X } from "lucide-react";
import { savedSeat } from "../online/client";
import type { MatchController } from "../online/useBackgroundMatch";
import { anchorPoint, clampPoint, defaultPoint, loadAnchor, saveAnchor, type Point } from "../ui/floating";
import "../ui/match-popup.css";

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/**
 * Quick-match status (UI-1, 2026-11-28): a global floating panel rendered through a portal into
 * <body>, so it never pushes the page content or changes its scroll. It appears as soon as a quick
 * match starts, can be dragged with a mouse or a finger (kept inside the screen, position remembered
 * on this device), minimised to a small pill with the elapsed time and restored. Matching itself
 * (queue, pairing, entry) stays in `useBackgroundMatch` / the server — this only shows its state.
 */
export function MatchPopup({ match, onAi, onRoom, offerAfterMs, practicePaused = false }: {
  match: MatchController;
  onAi: () => void;
  onRoom: (code: string) => void;
  offerAfterMs?: number;
  /** SOC-1 #143: a local AI game is kept aside while the online match starts. */
  practicePaused?: boolean;
}) {
  const { state, display, setDisplay } = match;
  const since = "since" in state ? state.since : null;
  // SOC-1 #143 extends the controller (docs/online/SOC-1-SOCIAL.md): "matched" carries `until` (automatic entry
  // countdown) with enterNow(), and "elsewhere" means another tab owns the wait (cancelOther()). Read structurally
  // so this file works before and after that PR merges.
  const ext = match as MatchController & { enterNow?: () => void; cancelOther?: () => void };
  const phase = state.phase as string;
  const until = phase === "matched" && typeof (state as unknown as { until?: unknown }).until === "number" ? (state as unknown as { until: number }).until : null;
  const [now, tick] = useState(Date.now);
  const [offer, setOffer] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const [point, setPoint] = useState<Point | null>(null);
  const drag = useRef<{ id: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const visible = display !== "hidden" && state.phase !== "idle";

  useEffect(() => {
    setOffer(false);
    if (since === null || offerAfterMs === undefined) return;
    const timer = setTimeout(() => setOffer(true), Math.max(0, since + offerAfterMs - Date.now()));
    return () => clearTimeout(timer);
  }, [since, offerAfterMs]);

  useEffect(() => {
    if ((since === null && until === null) || !visible) return;
    tick(Date.now());
    const timer = setInterval(() => tick(Date.now()), until !== null ? 250 : 1000);
    return () => clearInterval(timer);
  }, [since, until, visible]);

  // Place the panel (saved spot or bottom-right) whenever it appears or changes size, and keep it on screen on resize.
  useLayoutEffect(() => {
    if (!visible) return;
    const node = panel.current;
    if (!node) return;
    const place = () => {
      const box = { width: node.offsetWidth, height: node.offsetHeight };
      const anchor = loadAnchor();
      setPoint((prev) => (prev ? clampPoint(prev, box, viewport()) : anchor ? anchorPoint(anchor, box, viewport()) : defaultPoint(box, viewport())));
    };
    place();
    const resize = () => {
      const box = { width: node.offsetWidth, height: node.offsetHeight };
      setPoint((prev) => (prev ? clampPoint(prev, box, viewport()) : defaultPoint(box, viewport())));
    };
    window.addEventListener("resize", resize);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(node);
    return () => {
      window.removeEventListener("resize", resize);
      observer?.disconnect();
    };
  }, [visible, display]);

  if (!visible || typeof document === "undefined") return null;
  const elapsed = since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
  const room = state.phase === "error" ? state.room : undefined;
  const labels = {
    connecting: "빠른 대전에 연결 중이에요.",
    reconnecting: "매칭에 다시 연결 중이에요.",
    waiting: "상대를 찾는 중이에요",
    cancelling: "매칭 취소를 확인 중이에요.",
    pairing: "두 플레이어의 연결을 확인하고 있어요.",
    matched: "상대를 찾았어요.",
    entering: "경기에 입장 중이에요.",
    elsewhere: "다른 탭에서 이미 매칭 중이에요.",
    error: "",
  } as Record<string, string>;
  const message = state.phase === "error" ? state.message : labels[phase] ?? "";
  const left = until !== null ? Math.max(0, Math.ceil((until - now) / 1000)) : null;
  const opponent = "match" in state ? (state.match as { opponent?: string }).opponent : undefined;
  const busy = state.phase === "waiting" || state.phase === "connecting" || state.phase === "reconnecting" || state.phase === "pairing" || left !== null;

  // Drag: listeners on window (not pointer capture) so a fast drag that leaves the panel keeps going and a plain
  // tap still clicks the button under it. A move of < 4px is a tap.
  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 || !panel.current || !point) return;
    suppressClick.current = false;
    if ((event.target as HTMLElement).closest("button:not([data-drag-handle])")) return;
    const d = { id: event.pointerId, dx: event.clientX - point.x, dy: event.clientY - point.y, moved: false, sx: event.clientX, sy: event.clientY, last: point };
    drag.current = d;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== d.id || !panel.current) return;
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
      d.moved = true;
      e.preventDefault();
      const box = { width: panel.current.offsetWidth, height: panel.current.offsetHeight };
      d.last = clampPoint({ x: e.clientX - d.dx, y: e.clientY - d.dy }, box, viewport());
      setPoint(d.last);
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== d.id) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      drag.current = null;
      if (d.moved && panel.current) {
        suppressClick.current = true;
        saveAnchor(d.last, { width: panel.current.offsetWidth, height: panel.current.offsetHeight }, viewport());
      }
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };
  // Arrow keys move the focused panel (keyboard alternative to dragging).
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!point || !panel.current || (event.target as HTMLElement) !== event.currentTarget.querySelector("[data-drag-handle]")) return;
    const step = event.shiftKey ? 48 : 16;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!delta) return;
    event.preventDefault();
    const box = { width: panel.current.offsetWidth, height: panel.current.offsetHeight };
    const next = clampPoint({ x: point.x + delta[0], y: point.y + delta[1] }, box, viewport());
    setPoint(next);
    saveAnchor(next, box, viewport());
  };
  const style = point ? { transform: `translate3d(${point.x}px, ${point.y}px, 0)` } : { visibility: "hidden" as const };
  const handlers = { onPointerDown, onKeyDown };

  if (display === "minimized") {
    return createPortal(
      <aside ref={panel} className="ui1-match-popup minimized" aria-label="빠른 대전 상태" style={style} {...handlers} data-phase={state.phase}>
        <button type="button" className="ui1-match-pill" aria-label="빠른 대전 상태 보기" data-drag-handle
          onClick={() => {
            if (suppressClick.current) { suppressClick.current = false; return; }
            setDisplay("expanded");
          }}>
          <span className={"ui1-match-dot" + (busy ? " live" : "")} aria-hidden="true" />
          <span className="ui1-match-pill-text">{left !== null ? "상대를 찾았어요" : state.phase === "error" ? "매칭 확인 필요" : state.phase === "waiting" ? "매칭 중" : message.replace(/[.요]+$/, "")}</span>
          {left !== null ? <span className="ui1-match-pill-time" aria-hidden="true">{left}초</span> : since !== null && <span className="ui1-match-pill-time" aria-hidden="true">{clock(elapsed)}</span>}
        </button>
      </aside>,
      document.body,
    );
  }

  return createPortal(
    <aside ref={panel} className="ui1-match-popup" aria-label="빠른 대전 상태" style={style} {...handlers} data-phase={state.phase} data-match-found={left !== null ? "" : undefined}>
      <div className="ui1-match-head">
        <span className="ui1-match-grip" data-drag-handle tabIndex={0} role="button" aria-label="빠른 대전 창 이동 (방향키)" title="끌어서 옮기기">
          <GripHorizontal size={16} aria-hidden="true" />
        </span>
        <strong>빠른 대전</strong>
        <button type="button" className="icon-button ui1-match-min" aria-label="최소화" title="최소화" onClick={() => setDisplay("minimized")}>
          <Minus size={17} aria-hidden="true" />
        </button>
      </div>
      <div className="ui1-match-body">
        <span className={"ui1-match-icon" + (busy ? " live" : "")} aria-hidden="true"><Search size={18} /></span>
        <div className="ui1-match-text">
          {left !== null
            ? <span role="alert">상대를 찾았어요!{opponent && <> <strong>{opponent}</strong> 님과의 경기</>}</span>
            : <span role="status">{message}</span>}
          {state.phase === "waiting" && <span role="timer" aria-label="매칭 경과 시간" className="ui1-match-time">{clock(elapsed)}</span>}
          {left !== null && <span role="timer" aria-label="입장까지 남은 시간" className="ui1-match-time">{left}초</span>}
        </div>
      </div>
      {left !== null && <p className="ui1-match-note">{practicePaused ? "진행 중인 오프라인 AI 대전은 그대로 저장돼요. " : ""}경기는 이미 시작됐어요. 들어가지 않으면 시간 초과로 기권 처리될 수 있어요.</p>}
      <div className="ui1-match-actions">
        {left !== null && ext.enterNow && (
          <button type="button" className="primary" onClick={ext.enterNow}>지금 입장</button>
        )}
        {phase === "elsewhere" && ext.cancelOther && (
          <button type="button" className="secondary" onClick={ext.cancelOther}>다른 탭의 매칭 취소</button>
        )}
        {phase === "elsewhere" && (
          <button type="button" className="secondary" onClick={match.cancel}>닫기</button>
        )}
        {since !== null && state.phase !== "cancelling" && phase !== "elsewhere" && (
          <button type="button" className="secondary ui1-match-cancel" onClick={match.cancel}><X size={15} aria-hidden="true" /> 매칭 취소</button>
        )}
        {state.phase === "waiting" && offer && (
          <button type="button" className="secondary" onClick={onAi}>기다리는 동안 오프라인 AI와 대전하기 (매칭은 계속돼요)</button>
        )}
        {state.phase === "error" && state.code === "NETWORK" && (
          <button type="button" className="secondary" onClick={match.reconnect}>매칭 다시 확인</button>
        )}
        {room && savedSeat(room) && (
          <button type="button" className="secondary" onClick={() => onRoom(room)}>진행 중인 경기로 돌아가기</button>
        )}
        {state.phase === "error" && !(state.code === "NETWORK") && !(room && savedSeat(room)) && (
          <button type="button" className="secondary" onClick={() => setDisplay("hidden")}>닫기</button>
        )}
      </div>
    </aside>,
    document.body,
  );
}
