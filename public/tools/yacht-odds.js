/**
 * Exact single-turn odds for the 12-category Yacht Dice used by Online Yacht (no Yahtzee bonus/joker).
 * Plain ES module, no dependencies: used by /probability/ and checked by tests/yacht-odds.test.ts
 * against src/engine.ts and brute-force enumeration.
 *
 * Policy: for each category separately, the kept dice before every remaining re-roll are chosen to
 * maximise that category's goal (exact dynamic programming over the 252 dice multisets). Two goals:
 *   - "hit":   probability the category's pattern is complete at the end of the turn
 *              (upper rows: at least three of that face, the 63-point bonus pace);
 *   - "score": expected points written in that category.
 * Each category is computed on its own; the rows are not a single plan and overlap.
 */
export const CATEGORIES = ["aces", "deuces", "threes", "fours", "fives", "sixes", "choice", "four", "full", "small", "large", "yacht"];
export const NAMES = { aces: "에이스 (1)", deuces: "듀스 (2)", threes: "트리플 (3)", fours: "쿼드 (4)", fives: "펜타 (5)", sixes: "헥사 (6)", choice: "초이스", four: "포커", full: "풀 하우스", small: "스몰 스트레이트", large: "라지 스트레이트", yacht: "요트" };

const counts = (dice) => { const c = [0, 0, 0, 0, 0, 0, 0]; for (const v of dice) c[v]++; return c; };
export function score(dice, category) {
  const c = counts(dice);
  const sum = dice.reduce((a, b) => a + b, 0);
  const i = CATEGORIES.indexOf(category);
  if (i < 6) return c[i + 1] * (i + 1);
  switch (category) {
    case "choice": return sum;
    case "four": return Math.max(...c) >= 4 ? sum : 0;
    case "full": return c.includes(3) && c.includes(2) ? sum : 0;
    case "small": return [1, 2, 3].some((s) => c[s] && c[s + 1] && c[s + 2] && c[s + 3]) ? 15 : 0;
    case "large": return [1, 2].some((s) => c[s] && c[s + 1] && c[s + 2] && c[s + 3] && c[s + 4]) ? 30 : 0;
    case "yacht": return Math.max(...c) === 5 ? 50 : 0;
  }
  throw new Error("unknown category " + category);
}
export function hit(dice, category) {
  const i = CATEGORIES.indexOf(category);
  if (i < 6) return counts(dice)[i + 1] >= 3;
  if (category === "choice") return dice.reduce((a, b) => a + b, 0) >= 24;
  return score(dice, category) > 0;
}

const key = (dice) => [...dice].sort((a, b) => a - b).join("");
const fact = [1, 1, 2, 6, 24, 120];
/** All multisets of n dice with their probabilities. */
const outcomeCache = new Map();
function outcomes(n) {
  if (outcomeCache.has(n)) return outcomeCache.get(n);
  const list = [];
  const rec = (start, left, acc) => {
    if (left === 0) {
      const c = counts(acc);
      let ways = fact[n];
      for (let v = 1; v <= 6; v++) ways /= fact[c[v]];
      list.push({ dice: acc.slice(), p: ways / 6 ** n });
      return;
    }
    for (let v = start; v <= 6; v++) { acc.push(v); rec(v, left - 1, acc); acc.pop(); }
  };
  rec(1, n, []);
  outcomeCache.set(n, list);
  return list;
}
/** Distinct kept sub-multisets of a sorted hand. */
function keeps(dice) {
  const seen = new Map();
  for (let mask = 0; mask < 32; mask++) {
    const kept = dice.filter((_, i) => mask & (1 << i));
    const k = key(kept);
    if (!seen.has(k)) seen.set(k, kept.map(Number).sort((a, b) => a - b));
  }
  return [...seen.values()];
}

const valueCache = new Map();
/** Best achievable expectation of f with `rolls` re-rolls left, starting from `dice` (5 dice). */
function best(dice, rolls, goal, category) {
  const k = goal + category + rolls + key(dice);
  if (valueCache.has(k)) return valueCache.get(k);
  const f = goal === "hit" ? (d) => (hit(d, category) ? 1 : 0) : (d) => score(d, category);
  let v = f(dice);
  if (rolls > 0) for (const kept of keeps(dice)) v = Math.max(v, afterKeep(kept, rolls, goal, category));
  valueCache.set(k, v);
  return v;
}
/** Expectation after keeping `kept` and re-rolling the rest once, then playing on optimally. */
export function afterKeep(kept, rolls, goal, category) {
  if (rolls <= 0) throw new Error("no re-roll left");
  let total = 0;
  for (const o of outcomes(5 - kept.length)) total += o.p * best([...kept, ...o.dice], rolls - 1, goal, category);
  return total;
}
/** Best value over every choice of keep (including keeping all five = stopping). */
export function optimal(dice, rolls, goal, category) {
  return best(dice.map(Number), rolls, goal, category);
}
/** Value from a fresh turn (three rolls; the first roll keeps nothing). */
export function fromStart(goal, category) {
  return afterKeep([], 3, goal, category);
}
/** The keep that reaches `optimal` (ties: keep more dice, then higher faces). */
export function bestKeep(dice, rolls, goal, category) {
  let top = { kept: dice.map(Number), value: goal === "hit" ? (hit(dice, category) ? 1 : 0) : score(dice, category) };
  if (rolls <= 0) return top;
  for (const kept of keeps(dice.map(Number))) {
    if (kept.length === 5) continue;
    const value = afterKeep(kept, rolls, goal, category);
    if (value > top.value + 1e-12) top = { kept, value };
  }
  return top;
}
