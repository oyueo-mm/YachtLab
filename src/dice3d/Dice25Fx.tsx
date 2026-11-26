import { useEffect, useRef } from "react";
import { DICE_FX } from "./dice-fx";
import { FxCanvas } from "./fx-canvas";
import { onFx } from "../fx-bus";
import { fxBudget, useSettings } from "../settings";
import { playSfx } from "../sound";
import { attachToTray } from "../play/tray-attach";

/**
 * Lv.3 dice effects for the 2.5D fallback (2026-11-27): when WebGL is unavailable or the lighter motion
 * is chosen, the same per-item collision and landing effects (dice-fx.ts) are drawn on a canvas over the
 * dice row, from the presentation events the 2.5D throw now emits. Trails need the 3D paths, so the
 * fallback has collisions and landings only. Presentation only.
 */
export default function Dice25Fx({ itemId, soundEnabled }: { itemId: string; soundEnabled: boolean }) {
  const settings = useSettings();
  const budget = fxBudget(settings);
  const anchor = useRef<HTMLSpanElement>(null);
  const profile = DICE_FX[itemId];
  useEffect(() => {
    const section = anchor.current?.closest<HTMLElement>(".throw-tray, .game-board") ?? anchor.current?.parentElement;
    if (!profile || budget <= 0 || !section) return;
    return attachToTray(section, (row) => {
      const fx = new FxCanvas(row, "dice-fx-25");
      fx.budget = budget;
      const layout = () => {
        const r = row.getBoundingClientRect();
        fx.layout(r.width, r.height);
      };
      layout();
      const ro = new ResizeObserver(layout);
      ro.observe(row);
      let raf = 0;
      let lastSound = 0;
      const tick = (now: number) => {
        fx.frame(now);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      const off = onFx((e) => {
        if ((e.type !== "land" && e.type !== "impact") || e.x === undefined || e.y === undefined) return;
        const r = row.getBoundingClientRect();
        const x = e.x - r.left, y = e.y - r.top;
        const spec = e.type === "land" ? profile.land : profile.impact;
        spec.burst.forEach((b) => fx.emit(b, x, y));
        spec.ring?.forEach((ring) => fx.ring(ring, x, y));
        spec.lines?.forEach((l) => fx.line(l, x, y));
        if (e.type === "land" && soundEnabled && performance.now() - lastSound > 600) {
          lastSound = performance.now();
          playSfx("diceFx", { land: profile.sound, delay: 0.03 });
        }
      });
      return {
        dispose() {
          off();
          cancelAnimationFrame(raf);
          ro.disconnect();
          fx.dispose();
        },
      };
    }, ".dice-row");
  }, [profile, budget, soundEnabled]);
  return <span ref={anchor} hidden />;
}
