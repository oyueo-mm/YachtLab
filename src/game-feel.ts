import { emitFx } from "./fx-bus";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { bonus, categories, type Card } from "./engine";
import { setThrowDirection } from "./dice-motion";
import { playSfx } from "./sound";

/**
 * Flick-to-throw on the dice tray.
 *
 * Designed not to collide with existing controls: gestures that start on a die (tap = hold,
 * drag = reorder), a button or a form control are ignored. On touch screens only a mostly
 * horizontal flick throws, so vertical swipes keep scrolling the page (`touch-action: pan-y`).
 * A mouse may also flick upward. The roll button stays the primary, accessible way to roll.
 */
export function useThrowGesture(enabled: boolean, roll: () => void) {
  const start = useRef<{ x: number; y: number; t: number; id: number; type: string } | null>(null);
  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      start.current = null;
      if (!enabled || event.button > 0) return;
      const target = event.target as Element;
      if (target.closest(".die-wrap, button, a, input, select, textarea, label, details, [role=dialog], [role=tooltip]")) return;
      start.current = { x: event.clientX, y: event.clientY, t: event.timeStamp, id: event.pointerId, type: event.pointerType };
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const s = start.current;
      start.current = null;
      if (!s || !enabled || s.id !== event.pointerId) return;
      const dx = event.clientX - s.x;
      const dy = event.clientY - s.y;
      const fast = event.timeStamp - s.t <= 700;
      const far = Math.hypot(dx, dy) >= 48;
      const sideways = Math.abs(dx) >= Math.abs(dy) * 1.2;
      const upward = s.type !== "touch" && dy < -48 && Math.abs(dy) > Math.abs(dx);
      if (!fast || !far || !(sideways || upward)) return;
      setThrowDirection(dx >= 0 ? 1 : -1);
      roll();
    },
    onPointerCancel() {
      start.current = null;
    },
  };
}

export type Celebration = { kind: "yacht" | "bonus"; key: number } | null;

/**
 * Sounds (and a short visual cue) for scoring events, derived from card changes so that human
 * and AI moves are treated identically. `outcome` is the result from the local viewer's side.
 */
export function useGameSounds(cards: readonly Card[], done: boolean, outcome: "win" | "winShared" | "lose" | "draw" | null, sync = 0): Celebration {
  const previous = useRef<{ cards: readonly Card[]; done: boolean; sync: number }>({ cards, done, sync });
  const [celebration, setCelebration] = useState<Celebration>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = { cards, done, sync };
    // A catch-up sync (first load, reconnect, refresh) adopts the state silently: scores made while
    // this screen was away are not replayed as a burst of sounds.
    if (sync !== before.sync) return;
    const filled = (list: readonly Card[]) => list.reduce((n, card) => n + Object.keys(card).length, 0);
    if (cards.length !== before.cards.length || filled(cards) < filled(before.cards)) return; // new game
    let cue: Celebration = null;
    cards.forEach((card, player) => {
      const old = before.cards[player] ?? {};
      for (const category of categories) {
        if (old[category] !== undefined || card[category] === undefined) continue;
        const points = card[category]!;
        if (category === "yacht" && points === 50) {
          playSfx("yacht");
          cue = { kind: "yacht", key: Date.now() };
        } else playSfx(points === 0 ? "scoreZero" : "score");
      }
      if (bonus(card) > 0 && bonus(old) === 0) {
        playSfx("bonus", { delay: 0.28 });
        cue ??= { kind: "bonus", key: Date.now() };
      }
    });
    if (done && !before.done && outcome) {
      playSfx(outcome, { delay: 0.45 });
      if (outcome === "win" || outcome === "winShared") window.setTimeout(() => emitFx({ type: "win" }), 450);
    }
    if (cue) setCelebration(cue);
  }, [cards, done, outcome, sync]);
  useEffect(() => {
    if (!celebration) return;
    const timer = window.setTimeout(() => setCelebration(null), 1600);
    return () => window.clearTimeout(timer);
  }, [celebration]);
  return celebration;
}
