import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import "./coach.css";

/**
 * Short guided tours that point at the real UI (2026-11-27): shop and draw. One sentence or two per
 * step, skippable at any time (Esc, 건너뛰기), keyboard ←/→, re-runnable from the page's 사용법 button.
 * The tour only looks: it never buys, upgrades or draws, and never moves currency.
 * First visit is remembered on this device (`yachtlab.coach.v1`).
 */
export type CoachStep = { target?: string; title: string; body: string };
const KEY = "yachtlab.coach.v1";
const seen = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
};
export function markCoachSeen(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...seen(), [id]: Date.now() }));
  } catch {
    /* ignore */
  }
}
/** Opens once on the first visit (after `ready`), and on demand with `start()`. */
export function useCoach(id: string, ready: boolean) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!ready || seen()[id]) return;
    // A first-visit tour never starts on top of an open modal (e.g. an item detail): it would take the
    // Escape meant for that dialog. It waits until no modal is open.
    const t = window.setInterval(() => {
      if (document.querySelector("dialog[open]")) return;
      window.clearInterval(t);
      setOpen(true);
    }, 500);
    return () => window.clearInterval(t);
  }, [id, ready]);
  const close = useCallback(() => {
    markCoachSeen(id);
    setOpen(false);
  }, [id]);
  return { open, start: () => setOpen(true), close };
}

type Box = { x: number; y: number; w: number; h: number } | null;
function rectOf(selector?: string): Box {
  if (!selector) return null;
  const el = [...document.querySelectorAll<HTMLElement>(selector)].find((e) => e.offsetParent !== null || e.getClientRects().length);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width || r.height ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
}

export function Coach({ steps, open, onClose, label }: { steps: CoachStep[]; open: boolean; onClose: () => void; label: string }) {
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box>(null);
  const [cardH, setCardH] = useState(180);
  const card = useRef<HTMLDivElement>(null);
  const step = steps[index];
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);
  // point at the target: scroll it into view, then follow layout changes
  useLayoutEffect(() => {
    if (!open || !step) return;
    const el = step.target ? document.querySelector<HTMLElement>(step.target) : null;
    if (el) {
      // vertical only: scrollIntoView would also scroll horizontal rails and the page sideways
      const r = el.getBoundingClientRect();
      const want = window.innerWidth < 560 ? 90 : window.innerHeight / 2 - r.height / 2;
      if (r.top < 70 || r.bottom > window.innerHeight - (window.innerWidth < 560 ? 230 : 40)) window.scrollTo({ top: Math.max(0, window.scrollY + r.top - want), behavior: "auto" });
    }
    const update = () => {
      setBox(rectOf(step.target));
      if (card.current) setCardH(card.current.offsetHeight);
    };
    update();
    const id = window.setInterval(update, 250);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    card.current?.focus();
    return () => {
      window.clearInterval(id);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, step]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      // A modal opened after the tour (e.g. an item detail) sits on top: its keys are its own.
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight") setIndex((i) => Math.min(steps.length - 1, i + 1));
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [open, steps.length, onClose]);
  if (!open || !step) return null;
  const pad = 6;
  const vw = window.innerWidth, vh = window.innerHeight;
  const cardW = Math.min(340, vw - 24);
  // below the target if there is room, otherwise above; centred when there is no target
  const narrow = vw < 560;
  let top = vh / 2 - cardH / 2, left = vw / 2 - cardW / 2;
  if (box && !narrow) {
    const below = box.y + box.h + pad + 10;
    top = below + cardH + 12 < vh ? below : Math.max(12, box.y - pad - 10 - cardH);
    left = Math.min(vw - cardW - 12, Math.max(12, box.x + box.w / 2 - cardW / 2));
  }
  top = Math.min(Math.max(12, top), vh - cardH - 12);
  const last = index === steps.length - 1;
  return (
    <div className="coach" data-coach={label}>
      {box ? <div className="coach-spot" style={{ left: box.x - pad, top: box.y - pad, width: box.w + pad * 2, height: box.h + pad * 2 }} /> : <div className="coach-dim" />}
      <div ref={card} className={"coach-card" + (narrow ? " coach-sheet" : "")} role="dialog" aria-modal="false" aria-label={`${label} 안내 ${index + 1}/${steps.length}`} tabIndex={-1} style={narrow ? undefined : { top, left, width: cardW }}>
        <div className="coach-head">
          <span className="coach-count">{index + 1} / {steps.length}</span>
          <button type="button" className="icon-button coach-skip" aria-label="안내 건너뛰기" onClick={onClose}><X size={16} /></button>
        </div>
        <strong>{step.title}</strong>
        <p>{step.body}</p>
        <div className="coach-actions">
          <button type="button" className="text-button" onClick={onClose}>건너뛰기</button>
          <span>
            {index > 0 && <button type="button" className="secondary" onClick={() => setIndex(index - 1)} aria-label="이전 안내"><ChevronLeft size={16} /></button>}
            <button type="button" className="primary" onClick={() => (last ? onClose() : setIndex(index + 1))}>{last ? "확인" : <>다음 <ChevronRight size={16} /></>}</button>
          </span>
        </div>
      </div>
    </div>
  );
}
