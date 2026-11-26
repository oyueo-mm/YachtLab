import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { STRAIGHT_STEP_S, playSfx } from "./sound";
import { emitFx } from "./fx-bus";
import { useSettings } from "./settings";
import { DieIcon } from "./Dice";
import { isDiceBusy } from "./dice-motion";
import { useDiceBusy } from "./useDiceBusy";

/** Five dice showing the same face after at least one roll (presentation only; nothing is scored). */
export const isYachtDice = (dice: readonly { value: number }[], rolls: number) => rolls > 0 && dice.length === 5 && dice.every((d) => d.value === dice[0].value);

type Shown = { key: number; value: number };
/** Test / diagnostics: every yacht moment shown on this screen. */
const log = (entry: Shown) => {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __yachtlabYacht?: Shown[] };
  (w.__yachtlabYacht ??= []).push(entry);
};

/**
 * The moment a throw lands as a yacht: a short flash on the table and a sparkle sound, once per throw
 * (keyed by the roll event, so a refresh, a reconnect or a re-render never replays it). It waits until
 * the dice have visibly stopped, never intercepts input, and never records a score.
 */
export function YachtFlash({ dice, rolls, rollEvent, soundEnabled = true }: { soundEnabled?: boolean; dice: readonly { value: number }[]; rolls: number; rollEvent: number }) {
  const busy = useDiceBusy();
  const shownFor = useRef(rollEvent); // a screen opened on an existing yacht does not flash
  const [active, setActive] = useState<Shown | null>(null);
  const yacht = isYachtDice(dice, rolls);
  useEffect(() => {
    // The renderer starts motion in a layout effect, after this render read the store.
    if (!yacht || isDiceBusy() || rollEvent === shownFor.current) return;
    shownFor.current = rollEvent;
    const entry = { key: rollEvent, value: dice[0].value };
    log(entry);
    setActive(entry);
    emitFx({ type: "yacht" });
    if (soundEnabled) playSfx("yachtHit");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yacht, busy, rollEvent]);
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setActive(null), 1700);
    return () => window.clearTimeout(timer);
  }, [active]);
  if (!active) return null;
  return (
    <div key={active.key} className="yacht-flash" role="status" aria-live="polite">
      <span>
        <Sparkles size={18} aria-hidden="true" /> 요트!
      </span>
    </div>
  );
}

/** Whether the yacht row should be highlighted for this player (dice landed, row still open). */
export function useYachtReady(dice: readonly { value: number }[], rolls: number, open: boolean) {
  const busy = useDiceBusy();
  return open && !busy && isYachtDice(dice, rolls);
}

/** Five dice forming 1–5 or 2–6 after at least one roll (presentation only). */
export function largeStraightOf(dice: readonly { value: number }[], rolls: number): number[] | null {
  if (rolls === 0 || dice.length !== 5) return null;
  const values = [...dice.map((d) => d.value)].sort((a, b) => a - b);
  const ok = values.every((v, i) => i === 0 || v === values[i - 1] + 1);
  return ok ? values : null;
}
type StraightShown = { key: number; values: number[] };

/**
 * Large straight moment (D, 2026-11-25): the faces light up one by one in order (1→5 or 2→6) with five
 * rising notes on the same beat — lighter and shorter than the yacht moment (1.1 s vs 1.7 s, no chord
 * tail, no shake). Once per throw (keyed by the roll event: a refresh, reconnect or re-render never
 * replays it), after the dice have stopped; never intercepts input; shown on every screen that shows
 * these dice (both players and spectators). "효과 줄이기" keeps only a still label.
 */
export function StraightFlash({ dice, rolls, rollEvent, soundEnabled = true }: { soundEnabled?: boolean; dice: readonly { value: number }[]; rolls: number; rollEvent: number }) {
  const busy = useDiceBusy();
  const { reducedEffects } = useSettings();
  const shownFor = useRef(rollEvent);
  const [active, setActive] = useState<StraightShown | null>(null);
  const values = largeStraightOf(dice, rolls);
  useEffect(() => {
    if (!values || isDiceBusy() || rollEvent === shownFor.current) return;
    shownFor.current = rollEvent;
    const entry = { key: rollEvent, values };
    if (typeof window !== "undefined") ((window as unknown as { __yachtlabStraight?: StraightShown[] }).__yachtlabStraight ??= []).push(entry);
    setActive(entry);
    emitFx({ type: "straight" });
    if (soundEnabled) playSfx("straightHit");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!values, busy, rollEvent]);
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setActive(null), STRAIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [active]);
  if (!active) return null;
  return (
    <div key={active.key} className={"straight-flash" + (reducedEffects ? " static" : "")} role="status" aria-live="polite">
      <div className="straight-row" aria-hidden="true">
        {active.values.map((v, i) => (
          <span key={v} className="straight-die" style={{ animationDelay: `${i * STRAIGHT_STEP_S}s` }}>
            <DieIcon value={v} />
          </span>
        ))}
      </div>
      <span className="straight-label">라지 스트레이트</span>
    </div>
  );
}
export const STRAIGHT_MS = 1100;
