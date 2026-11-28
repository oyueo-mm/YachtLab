import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { itemById } from "../../economy/live/catalog";
import { ItemThumb } from "../ItemViews";
import type { PromoSlide } from "./curation";

const INTERVAL = 6500;
const reducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Shop promo carousel (UI-2). Curated slides only (existing collections / editor's picks; no discounts,
 * countdowns or unreleased products). Auto-advances every 6.5 s and pauses on hover, keyboard focus, a hidden
 * tab, an explicit pause, or reduced motion (then it never auto-advances). Arrows, dots, ←/→ keys and touch
 * swipe move it by hand. Slides are static thumbnails — no renderer runs here.
 */
export function PromoCarousel({ slides, onCollection, onItem, unavailable }: {
  slides: PromoSlide[];
  onCollection: (collection: string | null) => void;
  onItem: (id: string) => void;
  /** Items the server cannot sell yet: the slide says so instead of pretending they are on sale. */
  unavailable: (id: string) => boolean;
}) {
  const [index, setIndex] = useState(0);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [paused, setPaused] = useState(reducedMotion);
  const [hidden, setHidden] = useState(false);
  const swipe = useRef<{ x: number; y: number; dx: number } | null>(null);
  const [drag, setDrag] = useState(0);
  const count = slides.length;
  const go = useCallback((n: number) => setIndex(((n % count) + count) % count), [count]);
  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  const running = !paused && !hover && !focus && !hidden && count > 1;
  useEffect(() => {
    if (!running) return;
    const t = window.setTimeout(() => go(index + 1), INTERVAL);
    return () => window.clearTimeout(t);
  }, [running, index, go]);
  if (!count) return null;
  return (
    <section className="promo" aria-roledescription="carousel" aria-label="추천 컬렉션"
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocus(false); }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") { e.preventDefault(); go(index + 1); }
        if (e.key === "ArrowLeft") { e.preventDefault(); go(index - 1); }
      }}>
      <div className="promo-viewport"
        onPointerDown={(e) => { if (e.pointerType !== "mouse") swipe.current = { x: e.clientX, y: e.clientY, dx: 0 }; }}
        onPointerMove={(e) => {
          const s = swipe.current;
          if (!s) return;
          s.dx = e.clientX - s.x;
          if (Math.abs(s.dx) > Math.abs(e.clientY - s.y)) setDrag(s.dx);
        }}
        onPointerUp={() => {
          const s = swipe.current;
          swipe.current = null;
          setDrag(0);
          if (s && Math.abs(s.dx) > 48) go(index + (s.dx < 0 ? 1 : -1));
        }}
        onPointerCancel={() => { swipe.current = null; setDrag(0); }}>
        <div className={"promo-track" + (drag ? " dragging" : "")} style={{ transform: `translateX(calc(${-index * 100}% + ${drag}px))` }} aria-live={running ? "off" : "polite"}>
          {slides.map((slide, n) => {
            const lead = slide.items[0];
            const preparing = slide.items.every(unavailable);
            return (
              <div key={slide.id} className="promo-slide" role="group" aria-roledescription="slide" aria-label={`${n + 1} / ${count}: ${slide.title}`}
                aria-hidden={n !== index} inert={n !== index ? true : undefined} style={{ "--col": slide.color } as React.CSSProperties}>
                <div className="promo-copy">
                  <span className="promo-kicker">{slide.kicker}{preparing ? " · 판매 준비 중" : ""}</span>
                  <h2>{slide.title}</h2>
                  <p>{slide.body}</p>
                  <div className="promo-actions">
                    <button type="button" className="primary" onClick={() => onCollection(slide.collection)}>{slide.collection ? "컬렉션 보기" : "추천 상품 보기"}</button>
                    {lead && <button type="button" className="secondary" onClick={() => onItem(lead)}>{itemById(lead)?.name} 미리보기</button>}
                  </div>
                </div>
                <div className="promo-art" aria-hidden="true">
                  {slide.items.map((id, k) => {
                    const item = itemById(id);
                    return item ? <span key={id} className={"promo-piece promo-piece-" + k}><ItemThumb item={item} level={item.maxLevel} size={k === 0 ? 96 : 64} /></span> : null;
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="promo-controls">
        <button type="button" className="icon-button" aria-label="이전 슬라이드" onClick={() => go(index - 1)}><ChevronLeft size={18} aria-hidden="true" /></button>
        <div className="promo-dots">
          {slides.map((s, n) => (
            <button key={s.id} type="button" aria-label={`${n + 1}번째 슬라이드: ${s.title}`} aria-current={n === index ? "true" : undefined} onClick={() => go(n)} style={{ "--col": s.color } as React.CSSProperties} />
          ))}
        </div>
        <button type="button" className="icon-button" aria-label="다음 슬라이드" onClick={() => go(index + 1)}><ChevronRight size={18} aria-hidden="true" /></button>
        <button type="button" className="icon-button" aria-label={paused ? "자동 넘김 켜기" : "자동 넘김 멈추기"} aria-pressed={paused} onClick={() => setPaused((p) => !p)}>
          {paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
        </button>
      </div>
    </section>
  );
}
