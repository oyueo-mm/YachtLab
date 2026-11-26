import { useEffect, useRef } from "react";
import { FxCanvas } from "../dice3d/fx-canvas";
import { emoteFx } from "../emote-fx";
import { fxBudget } from "../settings";
import "../emote-fx.css";

/**
 * One emote as shown in a chat bubble or a preview: its own motion at Lv.2+, particles at Lv.3. The
 * particle canvas exists only while the burst plays (≈1.6 s) and is removed afterwards.
 */
export function EmoteGlyph({ id, text, level, effects = true }: { id: string; text: string; level: number; effects?: boolean }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const fx = emoteFx(id);
  const lv = effects ? Math.max(1, Math.min(3, level)) : 1;
  useEffect(() => {
    const host = ref.current;
    const budget = fxBudget();
    if (!host || lv < 3 || !fx?.burst || budget <= 0) return;
    const layer = new FxCanvas(host, "emote-fx-canvas");
    layer.budget = budget;
    layer.layout(140, 140);
    for (const b of fx.burst) layer.emit(b, 70, 70);
    const second = window.setTimeout(() => fx.burst?.forEach((b) => layer.emit(b, 70, 70, 0.5)), 650);
    let raf = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const alive = layer.frame(now);
      if (alive || now - started < 800) raf = requestAnimationFrame(tick);
      else layer.dispose();
    };
    raf = requestAnimationFrame(tick);
    return () => {
      window.clearTimeout(second);
      cancelAnimationFrame(raf);
      layer.dispose();
    };
  }, [id, lv, fx]);
  return (
    <span ref={ref} className={"emote-glyph lv" + lv} data-anim={lv >= 2 ? fx?.anim : undefined}>
      {text}
    </span>
  );
}
