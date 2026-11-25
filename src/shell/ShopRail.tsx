import { useRef, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function ShopRail({ label, children }: { label: string; children: ReactNode }) {
  const rail = useRef<HTMLUListElement>(null);
  const drag = useRef<{ x: number; scroll: number; active: boolean } | null>(null);
  const slide = (direction: number) => {
    const list = rail.current;
    if (list) list.scrollBy({ left: direction * Math.max(120, list.clientWidth * .85), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };
  return (
    <>
      <div className="shop-rail-nav">
        <button type="button" className="icon-button" aria-label={label + " 이전 상품"} onClick={() => slide(-1)}><ChevronLeft aria-hidden="true" size={18} /></button>
        <button type="button" className="icon-button" aria-label={label + " 다음 상품"} onClick={() => slide(1)}><ChevronRight aria-hidden="true" size={18} /></button>
      </div>
      <ul className="item-grid shop-rail" ref={rail} aria-label={label + " 상품"}
        onPointerDown={(e) => {
          drag.current = e.pointerType === "mouse" && e.button === 0 ? { x: e.clientX, scroll: e.currentTarget.scrollLeft, active: false } : null;
        }}
        onPointerMove={(e) => {
          const start = drag.current;
          if (!start || !(e.buttons & 1)) return;
          const dx = e.clientX - start.x;
          if (!start.active && Math.abs(dx) < 8) return;
          if (!start.active) {
            start.active = true;
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          e.currentTarget.scrollLeft = start.scroll - dx;
        }}
        onClickCapture={(e) => {
          if (drag.current?.active && e.detail) {
            e.preventDefault();
            e.stopPropagation();
          }
          drag.current = null;
        }}
      >{children}</ul>
    </>
  );
}
