import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { playSfx } from "./sound";
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
export function YachtFlash({ dice, rolls, rollEvent }: { dice: readonly { value: number }[]; rolls: number; rollEvent: number }) {
  const busy = useDiceBusy();
  const shownFor = useRef(rollEvent); // a screen opened on an existing yacht does not flash
  const [active, setActive] = useState<Shown | null>(null);
  const yacht = isYachtDice(dice, rolls);
  useEffect(() => {
    if (!yacht || busy || rollEvent === shownFor.current) return;
    shownFor.current = rollEvent;
    const entry = { key: rollEvent, value: dice[0].value };
    log(entry);
    setActive(entry);
    playSfx("yachtHit");
    const timer = window.setTimeout(() => setActive(null), 1700);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yacht, busy, rollEvent]);
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
