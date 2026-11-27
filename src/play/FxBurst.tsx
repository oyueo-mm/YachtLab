import { useEffect, useMemo } from "react";
import type { FxLook } from "../economy/live/content-items";
import { playSfx, type Sfx } from "../sound";
import { fxBudget, useSettings } from "../settings";
import { fxTierParams } from "../fx-quality";

const SOUND: Record<NonNullable<FxLook["sound"]>, Sfx> = { sparkle: "fxSparkle", coin: "fxCoin", bell: "fxBell", whoosh: "fxWhoosh", fanfare: "fxFanfare" };
/** Glyph shapes are plain Unicode symbols drawn by the system font; the others are CSS shapes. */
export const GLYPH: Partial<Record<FxLook["shape"], string>> = { heart: "♥", star: "★", note: "♪", snow: "❄" };

/**
 * Where the burst plays (A2). Same item, three stagings:
 *  win    falls over the result card (each shape moves in its own way: petals sway, coins flip, ...)
 *  yacht  bursts outward from one point above the dice row
 *  large  lights up along the dice row from the 1st die to the 5th (a sweep, like the faces lighting up)
 *  bonus  a fountain from the "BONUS!" label (upper-section bonus), the same shapes as the item
 */
export type FxKind = "win" | "yacht" | "large" | "bonus";
const COUNT: Record<FxKind, number> = { win: 26, yacht: 20, large: 15, bonus: 18 };

/**
 * A special-effect burst of a `fx` item: DOM particles (≤26, ~1.8 s, pointer-events none — it never
 * blocks a button). Lv.3 adds the item's sound. Presentation only. "효과 줄이기" or reduced motion: no
 * particles. The count follows the effect budget and the adaptive tier (A1.1); nothing is drawn when
 * the budget is 0. `seed` keys the burst: the same seed never replays.
 */
export function FxBurst({ fx, level, seed, sound = true, kind = "win" }: { fx: FxLook; level: number; seed: string | number; sound?: boolean; kind?: FxKind }) {
  const { reducedEffects } = useSettings();
  const budget = fxBudget() * fxTierParams().particles;
  const total = Math.max(6, Math.round(COUNT[kind] * Math.min(1, budget)));
  const parts = useMemo(() => {
    let s = String(seed).split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) || 1;
    const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    return Array.from({ length: total }, (_, i) => {
      const ang = r() * Math.PI * 2;
      // "large": evenly along the row so each die position lights in order.
      const x = kind === "large" ? 8 + (i / Math.max(1, total - 1)) * 84 : r() * 100;
      return {
        x,
        delay: kind === "large" ? (x / 100) * 0.55 : kind === "yacht" ? r() * 0.12 : r() * 0.7,
        dur: kind === "large" ? 0.7 + r() * 0.3 : 1.2 + r() * 0.8,
        rot: r() * 360,
        size: 0.7 + r() * 0.7,
        color: fx.colors[i % fx.colors.length],
        drift: (r() - 0.5) * 60,
        cx: Math.cos(ang).toFixed(3),
        cy: Math.sin(ang).toFixed(3),
        reach: 70 + r() * 110,
        lift: 14 + r() * 40,
      };
    });
  }, [seed, fx, total, kind]);
  useEffect(() => {
    if (sound && level >= 3 && fx.sound) playSfx(SOUND[fx.sound]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);
  if (reducedEffects || budget <= 0) return null;
  return (
    <div key={String(seed)} className={`fx-burst fx-kind-${kind} fx-shape-${fx.shape}`} aria-hidden="true" style={{ ["--fx-c0" as string]: fx.colors[0], ["--fx-c1" as string]: fx.colors[1] ?? fx.colors[0] }}>
      {parts.map((p, i) => (
        <i
          key={i}
          style={{
            left: `${p.x}%`, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, color: p.color,
            background: GLYPH[fx.shape] ? undefined : p.color,
            ["--rot" as string]: `${p.rot}deg`, ["--drift" as string]: `${p.drift}px`, ["--s" as string]: p.size,
            ["--cx" as string]: p.cx, ["--cy" as string]: p.cy, ["--reach" as string]: `${p.reach}px`, ["--lift" as string]: `${p.lift}px`,
          }}
        >
          {GLYPH[fx.shape] ?? ""}
        </i>
      ))}
    </div>
  );
}
