import { useState } from "react";
import { Dices } from "lucide-react";
import { Dice } from "../Dice";
import { names, score, type Category, type Die } from "../engine";
import { useThrowGesture } from "../game-feel";
import { useDiceBusy } from "../useDiceBusy";
import { playSfx } from "../sound";

const face = () => 1 + (crypto.getRandomValues(new Uint32Array(1))[0] % 6);
const combos: Category[] = ["yacht", "large", "four", "full", "small"];

/**
 * Lobby "try the dice" tray. Purely local and cosmetic: it never touches a game, a replay or the AI.
 * It reuses the real dice component, so the same 3D/2.5D motion, hold, reorder and sounds apply.
 */
export function HomeDice() {
  const [dice, setDice] = useState<Die[]>(() => [6, 5, 4, 3, 2].map((value, id) => ({ id, value, held: false })));
  const [order, setOrder] = useState([0, 1, 2, 3, 4]);
  const [rollEvent, setRollEvent] = useState(0);
  const busy = useDiceBusy();
  const roll = () => {
    if (busy) return;
    const next = dice.map((d) => (d.held ? d : { ...d, value: face() }));
    setDice(next);
    setRollEvent((n) => n + 1);
    const values = next.map((d) => d.value);
    if (score(values, "yacht") === 50) playSfx("yacht", { delay: 1.1 });
  };
  const gesture = useThrowGesture(!busy, roll);
  const values = dice.map((d) => d.value);
  const combo = rollEvent > 0 && !busy ? combos.find((c) => score(values, c) > 0) : undefined;
  const allHeld = dice.every((d) => d.held);
  return (
    <section className="home-dice" aria-label="주사위 굴려 보기">
      <div className="game-board throw-tray home-dice-tray" {...gesture}>
        <Dice
          state={{ dice, order, rolls: 1 }}
          interactive={!busy}
          animate
          rollEvent={rollEvent}
          onToggle={(id) => setDice((list) => list.map((d) => (d.id === id ? { ...d, held: !d.held } : d)))}
          onOrder={setOrder}
        />
        <div className="home-dice-bar">
          <span className="home-dice-combo" aria-live="polite">
            {combo ? names[combo] : ""}
          </span>
          <button type="button" className="secondary home-dice-roll" onClick={roll} disabled={busy || allHeld}>
            <Dices size={18} /> 굴려 보기
          </button>
        </div>
      </div>
    </section>
  );
}
