import kernel from "./dp-kernel.json";
import { chanceValues } from "./dp";
import { available, categories, total, upper, type Game } from "./engine";
import type { Candidate, Decision } from "./ai";

// A last-round *competitive* solver, not a new full-game solution.
// At earlier rounds the caller uses DP Expert. When the opponent has one
// category left, the opponent model is the deterministic DP Expert policy.
// This model never reads the engine RNG state; only visible scorecards/dice.
const fullIndex = new Map(kernel.states.slice(210).map((dice, i) => [dice.join(""), i]));
const holdOutcomes = new Map<number, [number, number][]>();
const opponentCache = new Map<string, Float64Array>();
const planCache = new Map<string, Plan>();
const eps = 1e-12;
const scoreCap = 86; // Maximum incremental category score, including 35-point bonus.

type Plan = { win: Float64Array[]; points: Float64Array[]; picks: Int16Array[] };
type OpponentModel = { probabilities: Float64Array; baseScore: number; exact: boolean };

function transitions(hold: number): [number, number][] {
  if (hold >= 210) return [[hold - 210, 1]];
  const cached = holdOutcomes.get(hold);
  if (cached) return cached;
  const probabilities = new Map<number, number>();
  for (const child of kernel.children[hold]) {
    for (const [outcome, probability] of transitions(child))
      probabilities.set(outcome, (probabilities.get(outcome) ?? 0) + probability / 6);
  }
  const result = [...probabilities.entries()];
  holdOutcomes.set(hold, result);
  return result;
}

function increments(category: (typeof categories)[number], currentUpper: number) {
  const index = categories.indexOf(category);
  return Float64Array.from(kernel.points, (points) => {
    const value = points[index];
    return value + (index < 6 && currentUpper < 63 && currentUpper + value >= 63 ? 35 : 0);
  });
}

function prefer(primary: number, secondary: number, bestPrimary: number, bestSecondary: number) {
  return primary > bestPrimary + eps || (Math.abs(primary - bestPrimary) <= eps && secondary > bestSecondary + eps);
}

// Obtain the exact final-turn points distribution for a DP Expert opponent.
export function lastTurnDPDistribution(category: (typeof categories)[number], upperScore: number): Float64Array {
  const key = category + ":" + Math.min(63, upperScore);
  const cached = opponentCache.get(key);
  if (cached) return cached;
  const terminal = increments(category, upperScore);
  const picks: Int16Array[] = [new Int16Array(252).fill(-1)];
  let values = terminal;
  for (let r = 1; r <= 2; r++) {
    const chance = chanceValues(values);
    const next = new Float64Array(252), selected = new Int16Array(252).fill(-1);
    for (let d = 0; d < 252; d++) {
      let best = terminal[d];
      for (const h of kernel.holds[d]) {
        if (h >= 210) continue;
        if (chance[h] > best + eps) { best = chance[h]; selected[d] = h; }
      }
      next[d] = best;
    }
    values = next;
    picks.push(selected);
  }
  const memo: Array<Array<Float64Array | undefined>> = Array.from({ length: 3 }, () => Array(252));
  function after(d: number, left: number): Float64Array {
    const cached = memo[left][d];
    if (cached) return cached;
    const histogram = new Float64Array(scoreCap);
    const h = picks[left][d];
    if (left === 0 || h < 0) histogram[terminal[d]] = 1;
    else {
      for (const [next, probability] of transitions(h)) {
        const child = after(next, left - 1);
        for (let p = 0; p < scoreCap; p++) histogram[p] += probability * child[p];
      }
    }
    memo[left][d] = histogram;
    return histogram;
  }
  const distribution = new Float64Array(scoreCap);
  for (let d = 0; d < 252; d++) {
    const outcome = after(d, 2), weight = kernel.probabilities[d];
    for (let p = 0; p < scoreCap; p++) distribution[p] += outcome[p] * weight;
  }
  if (opponentCache.size > 64) opponentCache.clear();
  opponentCache.set(key, distribution);
  return distribution;
}

function opponentModel(state: Game): OpponentModel | null {
  const other = state.cards[1 - state.player];
  const remaining = available(other);
  if (remaining.length === 0) {
    const distribution = new Float64Array(scoreCap);
    distribution[0] = 1;
    return { probabilities: distribution, baseScore: total(other), exact: true };
  }
  // In a normal two-player game only player 0 can finish first.
  if (state.player === 0 && remaining.length === 1)
    return {
      probabilities: lastTurnDPDistribution(remaining[0], upper(other)),
      baseScore: total(other),
      exact: false,
    };
  return null;
}

function solvePlan(myIncrement: Float64Array, winPayoffs: Float64Array): Plan {
  const win = [winPayoffs], points = [myIncrement], picks = [new Int16Array(252).fill(-1)];
  for (let r = 1; r <= 2; r++) {
    const expectedWin = chanceValues(win[r - 1]);
    const expectedPoints = chanceValues(points[r - 1]);
    const w = new Float64Array(252), p = new Float64Array(252), selected = new Int16Array(252).fill(-1);
    for (let d = 0; d < 252; d++) {
      let bestWin = winPayoffs[d], bestPoints = myIncrement[d];
      for (const h of kernel.holds[d]) {
        if (h >= 210) continue;
        if (prefer(expectedWin[h], expectedPoints[h], bestWin, bestPoints)) {
          bestWin = expectedWin[h]; bestPoints = expectedPoints[h]; selected[d] = h;
        }
      }
      w[d] = bestWin; p[d] = bestPoints;
    }
    win.push(w); points.push(p); picks.push(selected);
  }
  return { win, points, picks };
}

export function canUseWinDP(state: Game): boolean {
  return !state.done && state.rolls > 0 && available(state.cards[state.player]).length === 1 && opponentModel(state) !== null;
}

export function winDPDecision(state: Game): Decision | null {
  if (state.done || !state.rolls) throw Error("Win DP 판단에는 굴린 주사위가 필요합니다.");
  const mine = state.cards[state.player], remaining = available(mine);
  if (remaining.length !== 1) return null;
  const opponent = opponentModel(state);
  if (!opponent) return null;
  const category = remaining[0], myBase = total(mine), myUpper = upper(mine);
  const key = [category, Math.min(63, myUpper), myBase, opponent.baseScore,
    opponent.exact ? "final" : available(state.cards[1 - state.player])[0],
    opponent.exact ? "" : Math.min(63, upper(state.cards[1 - state.player]))].join(":");
  let plan = planCache.get(key);
  const inc = increments(category, myUpper);
  if (!plan) {
    const payoff = new Float64Array(252);
    for (let d = 0; d < 252; d++) {
      const myFinal = myBase + inc[d];
      let probability = 0;
      for (let p = 0; p < scoreCap; p++) {
        const opponentFinal = opponent.baseScore + p, mass = opponent.probabilities[p];
        if (myFinal > opponentFinal) probability += mass;
        else if (myFinal === opponentFinal) probability += mass / 2;
      }
      payoff[d] = probability;
    }
    plan = solvePlan(inc, payoff);
    if (planCache.size > 32) planCache.clear();
    planCache.set(key, plan);
  }
  const d = fullIndex.get(state.dice.map((die) => die.value).sort((a, b) => a - b).join(""))!;
  const left = 3 - state.rolls, chosen = plan.picks[left][d];
  const candidates: Candidate[] = [{ label: category, value: plan.win[0][d] }];
  if (left > 0) {
    const win = chanceValues(plan.win[left - 1]);
    for (const hold of kernel.holds[d]) {
      if (hold < 210) candidates.push({
        label: "고정 " + (kernel.states[hold].join("·") || "없음"),
        value: win[hold],
      });
    }
  }
  candidates.sort((a, b) => b.value - a.value);
  const common = {
    value: plan.win[left][d],
    candidates,
    note: opponent.exact
      ? "마지막 턴 승리 확률 정확 DP · 승리 1 / 무승부 0.5"
      : "마지막 턴 승리 확률 DP · 상대의 마지막 한 턴은 DP Expert 정책으로 모델링",
  };
  if (chosen < 0) return { type: "score", category, ...common };
  const kept = [...kernel.states[chosen]];
  const ids = state.dice.filter((die) => {
    const index = kept.indexOf(die.value);
    if (index < 0) return false;
    kept.splice(index, 1);
    return true;
  }).map((die) => die.id);
  return { type: "reroll", ids, ...common };
}
