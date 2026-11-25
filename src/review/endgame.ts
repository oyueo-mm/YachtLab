import kernel from "../dp-kernel.json";
import { chanceValues } from "../dp";
import { categories, score, total, upper } from "../engine";
import { endgameValue } from "../research-v5/apex";
import type { Position } from "./model";

const fullDice = kernel.states.slice(210);
const fullIndex = new Map(fullDice.map((dice, index) => [dice.join(""), index]));
const partialIndex = new Map(kernel.states.map((dice, index) => [dice.join(""), index]));

/** Exact v5 win-credit analysis in a small, alternation-safe window without a PMF bank. */
export function finalTurnWinCredit(position: Position): number[] | null {
  if (position.simultaneous) return null;
  const own = position.cards[position.player];
  const opponent = position.cards[1 - position.player];
  const open = categories.filter((category) => own[category] === undefined);
  const otherOpen = categories.filter((category) => opponent[category] === undefined);
  if (open.length !== 1 || otherOpen.length > 1) return null;

  const category = open[0];
  const otherMask = otherOpen.length ? 1 << categories.indexOf(otherOpen[0]) : 0;
  const otherUpper = upper(opponent);
  const otherTotal = total(opponent);
  const stop = Float64Array.from(fullDice, (dice) => {
    const ownFinal = total({ ...own, [category]: score(dice, category) });
    return 1 - endgameValue(otherMask, otherUpper, 0, 0, otherTotal - ownFinal);
  });
  const values = Array(44).fill(-Infinity);
  const diceIndex = fullIndex.get(position.dice.map((die) => die.value).sort().join(""))!;
  values[32 + categories.indexOf(category)] = stop[diceIndex];
  if (position.rolls === 3) return values;
  const next = chanceValues(stop);
  const remaining = position.rolls === 2 ? next : chanceValues(Float64Array.from(stop, (record, index) =>
    Math.max(record, ...kernel.holds[index].map((id) => next[id]))));
  for (let mask = 0; mask < 32; mask++) {
    const faces = position.dice.filter((die) => mask & (1 << die.id)).map((die) => die.value).sort().join("");
    values[mask] = Math.max(0, Math.min(1, remaining[partialIndex.get(faces)!]));
  }
  return values;
}
