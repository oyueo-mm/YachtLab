import { useEffect, useMemo } from "react";
import type { FxLook } from "../economy/live/content-items";
import { playSfx, type Sfx } from "../sound";
import { useSettings } from "../settings";

const SOUND: Record<NonNullable<FxLook["sound"]>, Sfx> = { sparkle: "fxSparkle", coin: "fxCoin", bell: "fxBell", whoosh: "fxWhoosh", fanfare: "fxFanfare" };
/** Glyph shapes are plain Unicode symbols drawn by the system font; the others are CSS shapes. */
export const GLYPH: Partial<Record<FxLook["shape"], string>> = { heart: "♥", star: "★", note: "♪", snow: "❄" };

/**
 * A special-effect burst (win / yacht moment) of a `fx` item: DOM particles falling over the result card
 * (at most 26, ~1.8 s, pointer-events none — it never blocks a button). Lv.3 adds the item's sound.
 * Presentation only. "효과 줄이기" or reduced motion: no particles (the result card keeps a still frame).
 * `seed` keys the burst: the same seed never replays (a reconnect re-render does not repeat it).
 */
export function FxBurst({ fx, level, seed, sound = true }: { fx: FxLook; level: number; seed: string | number; sound?: boolean }) {
  const { reducedEffects } = useSettings();
  const parts = useMemo(() => {
    let s = String(seed).split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) || 1;
    const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    return Array.from({ length: 26 }, (_, i) => ({ x: r() * 100, delay: r() * 0.7, dur: 1.2 + r() * 0.8, rot: r() * 360, size: 0.7 + r() * 0.7, color: fx.colors[i % fx.colors.length], drift: (r() - 0.5) * 60 }));
  }, [seed, fx]);
  useEffect(() => {
    if (sound && level >= 3 && fx.sound) playSfx(SOUND[fx.sound]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);
  if (reducedEffects) return null;
  return (
    <div key={String(seed)} className={"fx-burst fx-shape-" + fx.shape} aria-hidden="true">
      {parts.map((p, i) => (
        <i
          key={i}
          style={{ left: `${p.x}%`, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, color: p.color, background: GLYPH[fx.shape] ? undefined : p.color, ["--rot" as string]: `${p.rot}deg`, ["--drift" as string]: `${p.drift}px`, ["--s" as string]: p.size }}
        >
          {GLYPH[fx.shape] ?? ""}
        </i>
      ))}
    </div>
  );
}
