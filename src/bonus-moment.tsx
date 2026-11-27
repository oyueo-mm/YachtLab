import { useEffect, useRef, useState } from "react";
import "./bonus-moment.css";
import { Award } from "lucide-react";
import { bonus, type Card } from "./engine";
import { playSfx } from "./sound";
import { useSettings } from "./settings";
import { FxBurst } from "./play/FxBurst";
import { itemById, type PublicLook } from "./economy/live/catalog";
import type { FxLook } from "./economy/live/content-items";

/** Same rule as the scoreboard: the upper section reaching 63 earns +35 (engine.bonus). */
export const BONUS_POINTS = 35;

/** The default burst for everyone (no item needed): golden stars. Equipped `fx` items take over at Lv.2+. */
export const BONUS_FX_DEFAULT: FxLook = { shape: "star", colors: ["#ffd43b", "#fff3bf", "#ffa94d", "#ffffff"], sound: "coin" };

export type BonusPlayer = {
  id: string;
  name: string;
  card: Card;
  /** The viewer's own bonus (louder, no name tag). Hot-seat games treat every seat as "mine". */
  mine: boolean;
  look?: PublicLook | null;
};

type Shown = { key: number; id: string; name: string; mine: boolean; fx: FxLook; level: number };
/** Test / diagnostics: every bonus moment shown on this screen. */
const log = (entry: { id: string; scope: string }) => {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __yachtlabBonus?: { id: string; scope: string }[] };
  (w.__yachtlabBonus ??= []).push(entry);
};
/** Fired this session (per match scope and player): a re-render, a reconnect or a remount never replays it. */
export const firedBonuses = new Set<string>();
const fired = firedBonuses;
const SHOW_MS = 2400;

/** The burst a player's equipped special effect gives their bonus (Lv.2+ like the yacht), else the default. */
export function bonusFxOf(look: PublicLook | null | undefined, showItem: boolean): { fx: FxLook; level: number } {
  const item = look && showItem && look.fx && look.fx !== "fx.none" ? itemById(look.fx) : null;
  const fx = item?.look.fx;
  return fx && (look?.fxLv ?? 1) >= 2 ? { fx, level: look?.fxLv ?? 1 } : { fx: BONUS_FX_DEFAULT, level: 1 };
}

/**
 * Which players earned the bonus since the last call. `prev` holds each player's last seen state and
 * `fired` the (scope, player) pairs already shown this session; both are updated.
 *  - first sight of a player is a baseline (an existing bonus plays nothing),
 *  - false → true fires once per scope and player,
 *  - a card back below the bonus re-arms it (a new game on the same screen).
 */
export function detectBonuses(prev: Map<string, boolean>, fired: Set<string>, scope: string, players: { id: string; card: Card }[]): string[] {
  const out: string[] = [];
  for (const p of players) {
    const achieved = bonus(p.card) > 0;
    const key = scope + ":" + p.id;
    if (!prev.has(p.id)) {
      prev.set(p.id, achieved);
      if (achieved) fired.add(key);
      continue;
    }
    if (!achieved) fired.delete(key);
    else if (!prev.get(p.id) && !fired.has(key)) {
      fired.add(key);
      out.push(p.id);
    }
    prev.set(p.id, achieved);
  }
  return out;
}

/**
 * The upper-bonus moment (A2.2): "BONUS! +35" pops over the table, a burst of the shared special-effect
 * renderer (FxBurst, kind "bonus") and a short coin-chime. Triggered ONLY by a player's card going from
 * "no bonus" to "bonus" while this component is mounted:
 *   - the first card it sees is a baseline (opening a screen, a reload or a reconnect on an existing
 *     bonus plays nothing),
 *   - once per player per match (`scope`), also across remounts in the same session,
 *   - a new game (card back below 63, or a new scope) re-arms it.
 * Works the same for the viewer's own card, opponents, hot-seat seats and spectators because it reads the
 * cards every screen already has. Presentation only: it never scores, never blocks input (pointer-events
 * none) and respects "효과 줄이기" (static label, no particles) and the sound settings (playSfx).
 */
export function BonusMoments({ players, scope, soundEnabled = true }: { players: BonusPlayer[]; scope: string; soundEnabled?: boolean }) {
  const { reducedEffects, opponentFx } = useSettings();
  const prev = useRef(new Map<string, boolean>());
  const lastScope = useRef(scope);
  const seq = useRef(0);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const [shown, setShown] = useState<Shown[]>([]);
  useEffect(() => {
    if (lastScope.current !== scope) {
      lastScope.current = scope;
      prev.current.clear();
    }
    const entries: Shown[] = [];
    for (const id of detectBonuses(prev.current, fired, scope, players)) {
      const p = players.find((x) => x.id === id)!;
      const { fx, level } = bonusFxOf(p.look, p.mine || opponentFx);
      entries.push({ key: ++seq.current, id: p.id, name: p.name, mine: p.mine, fx, level });
      log({ id: p.id, scope });
    }
    if (!entries.length) return;
    if (soundEnabled) playSfx("bonusHit", { intensity: entries.some((e) => e.mine) ? 1 : 0.6 });
    setShown((s) => [...s, ...entries].slice(-2));
    for (const e of entries) timers.current.push(window.setTimeout(() => setShown((s) => s.filter((x) => x.key !== e.key)), SHOW_MS));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players.map((p) => p.id + ":" + (bonus(p.card) > 0 ? 1 : 0)).join(","), scope]);
  if (!shown.length) return null;
  return (
    <div className={"bonus-moment" + (reducedEffects ? " static" : "")} role="status" aria-live="polite">
      {shown.map((e) => (
        <div key={e.key} className={"bonus-pop" + (e.mine ? " mine" : "")}>
          <span className="bonus-title"><Award size={20} aria-hidden="true" /> BONUS!</span>
          <b>+{BONUS_POINTS}점</b>
          {!e.mine && <small>{e.name}</small>}
          <FxBurst fx={e.fx} level={e.level} seed={"bonus-" + e.key} sound={false} kind="bonus" />
        </div>
      ))}
    </div>
  );
}
