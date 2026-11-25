import { useEffect, useRef, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function ShopRail({ label, children }: { label: string; children: ReactNode }) {
  const rail = useRef<HTMLUListElement>(null);
  const drag = useRef<{ x: number; scroll: number; active: boolean } | null>(null);
  useEffect(() => {
    const list = rail.current;
    if (!list) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || Math.abs(event.deltaX) > 0 || !event.deltaY) return;
      const remaining = list.scrollWidth - list.clientWidth - list.scrollLeft;
      if (event.deltaY < 0 ? list.scrollLeft <= 1 : remaining <= 1) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? list.clientWidth : 1;
      const pixels = Math.sign(event.deltaY) * Math.min(100, Math.abs(event.deltaY * unit));
      list.scrollLeft += pixels;
      if (event.cancelable) event.preventDefault();
    };
    list.addEventListener("wheel", onWheel, { passive: false });
    return () => list.removeEventListener("wheel", onWheel);
  }, []);
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
