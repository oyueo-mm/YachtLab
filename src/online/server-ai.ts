import { available, categories, score, type Card, type Category } from "../engine";

/**
 * Server AI for server-verified AI matches (Phase 4.5). Runs inside the room's Durable Object, so it
 * must stay far below the Workers Free CPU limit (10 ms per invocation) and must not pull model files
 * into the Worker bundle. It reimplements the game's "보통" opponent (Greedy in src/ai.ts: compare the
 * best score now with the expected best score after one more re-roll) using only engine scoring —
 * measured ≈1 ms per decision (worst ≈5 ms incl. warm-up) in Node; "어려움" (Expectimax) took ≈100 ms
 * and is not offered on the server. Docs: docs/online/SERVER-AI-MATCH.md.
 *
 * Observation boundary: it sees only its own dice, roll count and score card (what a player sees) —
 * never the dice source, so it cannot predict future dice.
 */
export const SERVER_AI_LEVEL = "보통";
export type AiMove = { type: "roll"; keep: number[] } | { type: "score"; category: Category };

function holds(values: number[]): number[][] {
  const out: number[][] = [];
  const visit = (face: number, held: number[]) => {
    if (face === 7) return void out.push(held);
    const n = values.filter((v) => v === face).length;
    for (let k = 0; k <= n; k++) visit(face + 1, [...held, ...Array(k).fill(face)]);
  };
  visit(1, []);
  return out;
}
const outcomeCache = new Map<number, { values: number[]; p: number }[]>();
const fact = [1, 1, 2, 6, 24, 120];
function outcomes(n: number) {
  const cached = outcomeCache.get(n);
  if (cached) return cached;
  const out: { values: number[]; p: number }[] = [];
  const visit = (start: number, values: number[]) => {
    if (values.length === n) {
      const counts = Array(7).fill(0);
      values.forEach((v) => counts[v]++);
      out.push({ values, p: fact[n] / counts.reduce((a, c) => a * fact[c], 1) / 6 ** n });
      return;
    }
    for (let v = start; v <= 6; v++) visit(v, [...values, v]);
  };
  visit(1, []);
  outcomeCache.set(n, out);
  return out;
}
const bestNow = (values: number[], card: Card) => {
  let best: { category: Category; value: number } | null = null;
  for (const c of available(card)) {
    const v = score(values, c);
    if (!best || v > best.value) best = { category: c, value: v };
  }
  return best ?? { category: categories[0], value: 0 };
};

/** One decision for the current turn (rolls ≥ 1). */
export function serverAiMove(dice: number[], rolls: number, card: Card): AiMove {
  const now = bestNow(dice, card);
  if (rolls >= 3) return { type: "score", category: now.category };
  let bestHold: number[] | null = null;
  let bestValue = now.value;
  for (const held of holds(dice)) {
    if (held.length >= 5) continue;
    let e = 0;
    for (const o of outcomes(5 - held.length)) e += o.p * bestNow([...held, ...o.values], card).value;
    if (e > bestValue + 1e-9) {
      bestValue = e;
      bestHold = held;
    }
  }
  if (!bestHold) return { type: "score", category: now.category };
  // Held values → dice positions (0..4).
  const left = [...bestHold];
  const keep: number[] = [];
  dice.forEach((v, i) => {
    const j = left.indexOf(v);
    if (j >= 0) {
      left.splice(j, 1);
      keep.push(i);
    }
  });
  return { type: "roll", keep };
}
