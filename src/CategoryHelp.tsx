import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleHelp } from "lucide-react";
import { names, score, type Category } from "./engine";
import { DieIcon } from "./Dice";

export type HelpTopic = Category | "bonus";

type Entry = { title: string; text: string; example?: number[]; note?: string };
/** Short rule explanations. Example points are computed by the real engine (`score`), never typed by hand. */
export const helpEntries: Record<HelpTopic, Entry> = {
  aces: { title: names.aces, text: "1이 나온 주사위의 눈을 모두 더해요.", example: [1, 1, 3, 1, 5] },
  deuces: { title: names.deuces, text: "2가 나온 주사위의 눈을 모두 더해요.", example: [2, 2, 2, 5, 6] },
  threes: { title: names.threes, text: "3이 나온 주사위의 눈을 모두 더해요.", example: [3, 3, 1, 3, 6] },
  fours: { title: names.fours, text: "4가 나온 주사위의 눈을 모두 더해요.", example: [4, 4, 4, 4, 2] },
  fives: { title: names.fives, text: "5가 나온 주사위의 눈을 모두 더해요.", example: [5, 5, 1, 2, 3] },
  sixes: { title: names.sixes, text: "6이 나온 주사위의 눈을 모두 더해요.", example: [6, 6, 6, 2, 1] },
  choice: { title: names.choice, text: "조건 없이 주사위 5개의 합계를 기록해요.", example: [6, 5, 4, 3, 6] },
  four: { title: names.four, text: "같은 눈이 4개 이상이면 주사위 5개의 합계, 아니면 0점이에요.", example: [5, 5, 5, 5, 2] },
  full: { title: names.full, text: "같은 눈 3개 + 같은 눈 2개면 주사위 5개의 합계, 아니면 0점이에요.", example: [3, 3, 3, 6, 6], note: "다섯 개가 모두 같은 눈은 풀 하우스가 아니에요." },
  small: { title: names.small, text: "연속된 눈 4개(1-2-3-4, 2-3-4-5, 3-4-5-6)가 있으면 15점이에요.", example: [1, 2, 3, 4, 6] },
  large: { title: names.large, text: "연속된 눈 5개(1-2-3-4-5, 2-3-4-5-6)면 30점이에요.", example: [2, 3, 4, 5, 6] },
  yacht: { title: names.yacht, text: "주사위 5개가 모두 같은 눈이면 50점이에요.", example: [4, 4, 4, 4, 4] },
  bonus: {
    title: "상단 보너스",
    text: "에이스~헥사(상단 6칸) 합계가 63점 이상이면 35점을 더 받아요.",
    note: "예: 각 눈을 3개씩 기록하면 3+6+9+12+15+18 = 63점으로 딱 달성해요.",
  },
};

const HOVER_DELAY = 500;

/**
 * Info button + tooltip for a score category. Works the same in every score sheet:
 * - mouse: hover the category cell for ~500 ms
 * - touch: tap the (?) button; tap outside to close
 * - keyboard: focus the (?) button; Esc closes
 * The tooltip is placed in the nearest open <dialog> (top layer) or <body>, and is clamped to the viewport.
 */
export function CategoryHelp({ topic }: { topic: HelpTopic }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const id = useId();
  const entry = helpEntries[topic];

  // Hover anywhere on the owning cell/row, mouse only.
  useEffect(() => {
    const host = button.current?.closest("th, .mobile-quick-row, .mobile-quick-bonus") ?? button.current?.parentElement;
    if (!host) return;
    const enter = (e: Event) => {
      if ((e as PointerEvent).pointerType !== "mouse") return;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setOpen(true), HOVER_DELAY);
    };
    const leave = (e: Event) => {
      if ((e as PointerEvent).pointerType !== "mouse") return;
      window.clearTimeout(timer.current);
      if (document.activeElement !== button.current) setOpen(false);
    };
    host.addEventListener("pointerenter", enter);
    host.addEventListener("pointerleave", leave);
    return () => {
      host.removeEventListener("pointerenter", enter);
      host.removeEventListener("pointerleave", leave);
      window.clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation(); // do not also close a surrounding dialog
        setOpen(false);
      }
    };
    const outside = (e: Event) => {
      const t = e.target as Node;
      if (!button.current?.contains(t) && !tip.current?.contains(t)) setOpen(false);
    };
    const away = () => setOpen(false);
    document.addEventListener("keydown", key, true);
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", away);
    window.addEventListener("scroll", away, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", away);
      window.removeEventListener("scroll", away, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    const t = tip.current, b = button.current;
    if (!open || !t || !b) return;
    const anchor = (b.closest("th, .mobile-quick-row, .mobile-quick-bonus") ?? b).getBoundingClientRect();
    const box = t.getBoundingClientRect();
    const margin = 8;
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    let left = Math.min(Math.max(margin, anchor.left), vw - box.width - margin);
    left = Math.max(margin, left);
    const above = anchor.top - box.height - 8;
    const below = anchor.bottom + 8;
    const top = above >= margin && (below + box.height > vh - margin || anchor.top > vh / 2) ? above : Math.min(below, Math.max(margin, vh - box.height - margin));
    t.style.left = `${Math.round(left)}px`;
    t.style.top = `${Math.round(top)}px`;
    t.dataset.placement = top === above ? "top" : "bottom";
  }, [open]);

  const points = entry.example ? score(entry.example, topic as Category) : null;
  const container = open ? (button.current?.closest("dialog") ?? document.body) : null;
  return (
    <>
      <button
        ref={button}
        type="button"
        className="category-help"
        aria-label={`${entry.title} 설명`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onFocus={(e) => {
          if (e.currentTarget.matches(":focus-visible")) setOpen(true);
        }}
        onBlur={() => setOpen(false)}
      >
        <CircleHelp size={13} aria-hidden="true" />
      </button>
      {open &&
        container &&
        createPortal(
          <div ref={tip} id={id} role="tooltip" className="category-tooltip" data-topic={topic}>
            <strong>{entry.title}</strong>
            <p>{entry.text}</p>
            {entry.example && (
              <div className="category-tooltip-example">
                <span className="category-tooltip-dice" aria-label={`예시 주사위 ${entry.example.join(", ")}`}>
                  {entry.example.map((v, i) => (
                    <DieIcon key={i} value={v} aria-hidden="true" />
                  ))}
                </span>
                <span>
                  → <b>{points}점</b>
                </span>
              </div>
            )}
            {entry.note && <small>{entry.note}</small>}
          </div>,
          container,
        )}
    </>
  );
}
