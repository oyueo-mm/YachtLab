import { choiceIndex, dpActionValues, type Choice } from "../dp";
import { dpOpponentGains } from "../competitive-v2";
import { categories, createGame, score, total, upper, type Card } from "../engine";
import { finalTurnWinCredit } from "./endgame";
import type { Assessment, Position, Situation, Value } from "./model";

const legalValues = (position: Position) => dpActionValues({ ...createGame(0), ...position });
export const valueTolerance = 1e-8;

function choiceAt(index: number): Choice {
  if (index >= 32) return { type: "score", category: categories[index - 32] };
  return { type: "reroll", ids: [0, 1, 2, 3, 4].filter((id) => index & (1 << id)) };
}

function remaining(card: Card) {
  return categories.reduce((mask, category, index) => mask | (card[category] === undefined ? 1 << index : 0), 0);
}

function scoreDifference(own: Card, other: Card) {
  // A bounded DP Expert follow-up model for the final turns. Both distributions are
  // exact for that policy. The player who just recorded has no current dice left.
  if (Object.keys(own).length < 10 || Object.keys(other).length < 10) return undefined;
  const ownGains = dpOpponentGains(remaining(own), upper(own));
  const otherGains = dpOpponentGains(remaining(other), upper(other));
  const base = total(own) - total(other);
  const dist = new Map<number, number>();
  ownGains.forEach((x, n) => {
    if (!x) return;
    otherGains.forEach((y, m) => {
      if (!y) return;
      const difference = base + n - m;
      dist.set(difference, (dist.get(difference) ?? 0) + x * y);
    });
  });
  return [...dist].sort((a, b) => a[0] - b[0]).map(([difference, mass]) => ({ difference, mass }));
}

export function assessSituation(situation: Situation, index: number): Assessment {
  const { before, action, afterRoll } = situation;
  const q = legalValues(before);
  const endgame = finalTurnWinCredit(before);
  const actualIndex = choiceIndex(action);
  if (!Number.isFinite(q[actualIndex])) throw Error("기보에 평가할 수 없는 행동이 있어요.");
  let distribution: Assessment["distribution"];
  const options = q.flatMap((expected, id): Value[] => {
    if (!Number.isFinite(expected)) return [];
    const candidate = choiceAt(id);
    if (!before.simultaneous && id === actualIndex && candidate.type === "score") {
      const card = { ...before.cards[before.player], [candidate.category]: score(before.dice.map((die) => die.value), candidate.category) };
      distribution = scoreDifference(card, before.cards[1 - before.player]);
    }
    return [{ action: candidate, expected, winCredit: endgame?.[id] }];
  }).sort((a, b) => b.expected - a.expected);
  const actual = options.find((option) => choiceIndex(option.action) === actualIndex)!;
  const delta = options[0].expected - actual.expected;
  return {
    index, options, actual, loss: delta > valueTolerance ? delta : 0, distribution,
    ...(afterRoll && action.type === "reroll" ? { luck: Math.max(...legalValues(afterRoll)) - actual.expected } : {}),
  };
}
