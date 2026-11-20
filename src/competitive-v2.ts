import kernel from "./dp-kernel.json";
import { chanceValues, dpFutureValue } from "./dp";
import { lastTurnDPDistribution, winDPDecision } from "./win-dp";
import { available, categories, total, upper, type Game } from "./engine";
import type { Candidate, Decision } from "./ai";

// Competitive v2: exact two-category own-target DP against the final-score
// distribution of an opponent committed to DP Expert, with exact chance nodes.
// It is NOT a full-information game-theoretic equilibrium or a world SOTA claim.
const EPS = 1e-12;
const MAX_GAIN = 86;
const fullIndex = new Map(kernel.states.slice(210).map((d, i) => [d.join(""), i]));
const transitionsCache = new Map<number, Array<[number, number]>>();
const opponentDistributions = new Map<string, Float64Array>();
const planCache = new Map<string, { win: Float64Array[]; points: Float64Array[]; picks: Int16Array[] }>();

type Plan = { win: Float64Array[]; points: Float64Array[]; picks: Int16Array[] };
type Distribution = { base: number; probabilities: Float64Array; assumedDP: boolean };
const count = (mask: number) => { let n = 0; while (mask) { mask &= mask - 1; n++; } return n; };
const cardMask = (state: Game, player: number) => categories.reduce((mask, category, i) => mask | (state.cards[player][category] === undefined ? 1 << i : 0), 0);
const incr = (d: number, c: number, u: number) => { const points = kernel.points[d][c]; return points + (c < 6 && u < 63 && u + points >= 63 ? 35 : 0); };
const nextUpper = (c: number, points: number, u: number) => c < 6 ? Math.min(63, u + points) : u;
const prefer = (w: number, p: number, bestW: number, bestP: number) => w > bestW + EPS || (Math.abs(w - bestW) <= EPS && p > bestP + EPS);

function holdTransition(h: number): Array<[number, number]> {
  if (h >= 210) return [[h - 210, 1]];
  const cached = transitionsCache.get(h);
  if (cached) return cached;
  const result = new Map<number, number>();
  for (const child of kernel.children[h]) for (const [d, p] of holdTransition(child))
    result.set(d, (result.get(d) ?? 0) + p / 6);
  const entries = [...result.entries()];
  transitionsCache.set(h, entries);
  return entries;
}

// All future scores of one particular DP Expert *policy*, not a collection of
// independently target-optimal policies. Two remaining categories at most.
export function dpOpponentGains(mask: number, startUpper: number): Float64Array {
  if (count(mask) > 2) throw Error("상대 분포 정확 계산은 남은 두 카테고리까지만 지원합니다.");
  if (!mask) return Float64Array.from([1]);
  if (count(mask) === 1) return lastTurnDPDistribution(categories[Math.log2(mask)], startUpper);
  const u = Math.min(63, startUpper), key = mask + ":" + u;
  const hit = opponentDistributions.get(key);
  if (hit) return hit;
  const stop = new Float64Array(252);
  const choices = new Int16Array(252);
  for (let d = 0; d < 252; d++) {
    let best = -Infinity, bestC = -1;
    for (let c = 0; c < 12; c++) if (mask & (1 << c)) {
      const p = kernel.points[d][c], nextU = nextUpper(c, p, u);
      const v = incr(d, c, u) + dpFutureValue(mask ^ (1 << c), nextU);
      if (v > best + EPS) { best = v; bestC = c; }
    }
    stop[d] = best;
    choices[d] = bestC;
  }
  const value = [stop], selection = [new Int16Array(252).fill(-1)];
  for (let r = 1; r <= 2; r++) {
    const chance = chanceValues(value[r - 1]);
    const next = new Float64Array(252), pick = new Int16Array(252).fill(-1);
    for (let d = 0; d < 252; d++) {
      let best = stop[d];
      for (const h of kernel.holds[d]) {
        if (h >= 210) continue;
        if (chance[h] > best + EPS) { best = chance[h]; pick[d] = h; }
      }
      next[d] = best;
    }
    value.push(next);
    selection.push(pick);
  }
  const memo: Array<Array<Map<number, number> | undefined>> = Array.from({ length: 3 }, () => Array(252));
  function terminalOutcomes(d: number, left: number): Map<number, number> {
    const known = memo[left][d];
    if (known) return known;
    const action = selection[left][d], out = new Map<number, number>();
    if (left === 0 || action < 0) {
      const c = choices[d];
      out.set(c * 128 + incr(d, c, u), 1);
    } else {
      for (const [next, weight] of holdTransition(action)) {
        for (const [key, mass] of terminalOutcomes(next, left - 1))
          out.set(key, (out.get(key) ?? 0) + weight * mass);
      }
    }
    memo[left][d] = out;
    return out;
  }
  const firstTurn = new Map<number, number>();
  for (let d = 0; d < 252; d++)
    for (const [key, mass] of terminalOutcomes(d, 2))
      firstTurn.set(key, (firstTurn.get(key) ?? 0) + kernel.probabilities[d] * mass);
  const distribution = new Float64Array(MAX_GAIN * 2);
  for (const [key, probability] of firstTurn) {
    const c = Math.floor(key / 128), added = key % 128;
    const points = c < 6 && added >= 35 ? added - 35 : added;
    const remaining = mask ^ (1 << c), u2 = nextUpper(c, points, u);
    const last = lastTurnDPDistribution(categories[Math.log2(remaining)], u2);
    for (let gain = 0; gain < last.length; gain++)
      distribution[added + gain] += probability * last[gain];
  }
  if (opponentDistributions.size >= 48) opponentDistributions.clear();
  opponentDistributions.set(key, distribution);
  return distribution;
}

function opponentModel(state: Game): Distribution | null {
  const player = 1 - state.player, mask = cardMask(state, player);
  if (count(mask) > 2) return null;
  return { base: total(state.cards[player]), probabilities: dpOpponentGains(mask, upper(state.cards[player])), assumedDP: mask !== 0 };
}

function makePlan(mask: number, u: number, base: number, payoff: (final: number) => number, memo: Map<string, Plan>): Plan {
  const key = mask + ":" + u + ":" + base;
  const hit = memo.get(key);
  if (hit) return hit;
  const w0 = new Float64Array(252), p0 = new Float64Array(252), pick0 = new Int16Array(252);
  for (let d = 0; d < 252; d++) {
    let bestWin = -Infinity, bestPoints = -Infinity, bestC = -1;
    for (let c = 0; c < 12; c++) if (mask & (1 << c)) {
      const points = kernel.points[d][c], gain = incr(d, c, u), newBase = base + gain, next = mask ^ (1 << c);
      let win = payoff(newBase), futurePoints = newBase;
      if (next) {
        const nextPlan = makePlan(next, nextUpper(c, points, u), newBase, payoff, memo);
        win = kernel.probabilities.reduce((sum, mass, i) => sum + mass * nextPlan.win[2][i], 0);
        futurePoints = kernel.probabilities.reduce((sum, mass, i) => sum + mass * nextPlan.points[2][i], 0);
      }
      if (prefer(win, futurePoints, bestWin, bestPoints)) { bestWin = win; bestPoints = futurePoints; bestC = c; }
    }
    w0[d] = bestWin; p0[d] = bestPoints; pick0[d] = bestC;
  }
  const win = [w0], points = [p0], picks = [pick0];
  for (let r = 1; r <= 2; r++) {
    const chanceWin = chanceValues(win[r - 1]), chancePoints = chanceValues(points[r - 1]);
    const ww = new Float64Array(252), pp = new Float64Array(252), chosen = new Int16Array(252);
    for (let d = 0; d < 252; d++) {
      let bestWin = w0[d], bestPoints = p0[d], bestAction = pick0[d];
      for (const hold of kernel.holds[d]) if (hold < 210) {
        if (prefer(chanceWin[hold], chancePoints[hold], bestWin, bestPoints)) {
          bestWin = chanceWin[hold]; bestPoints = chancePoints[hold]; bestAction = 12 + hold;
        }
      }
      ww[d] = bestWin; pp[d] = bestPoints; chosen[d] = bestAction;
    }
    win.push(ww); points.push(pp); picks.push(chosen);
  }
  const plan = { win, points, picks };
  memo.set(key, plan);
  return plan;
}

function planKey(state: Game, opponent: Distribution, mask: number) {
  const other = 1 - state.player;
  return [mask, Math.min(63, upper(state.cards[state.player])), total(state.cards[state.player]),
    cardMask(state, other), Math.min(63, upper(state.cards[other])), opponent.base].join(":");
}

export function winDPv2Decision(state: Game): Decision | null {
  if (state.done || !state.rolls) throw Error("Win DP v2 판단에는 이미 굴린 주사위가 필요합니다.");
  const mask = cardMask(state, state.player), remaining = count(mask);
  if (remaining === 1) return winDPDecision(state);
  if (remaining !== 2) return null;
  const opponent = opponentModel(state);
  if (!opponent) return null;
  const key = planKey(state, opponent, mask);
  let plan = planCache.get(key);
  if (!plan) {
    const prefix = new Float64Array(opponent.probabilities.length + 1);
    for (let i = 0; i < opponent.probabilities.length; i++) prefix[i + 1] = prefix[i] + opponent.probabilities[i];
    const payoff = (final: number) => {
      const diff = final - opponent.base;
      if (diff < 0) return 0;
      if (diff >= opponent.probabilities.length) return 1;
      return prefix[diff] + opponent.probabilities[diff] / 2;
    };
    plan = makePlan(mask, Math.min(63, upper(state.cards[state.player])), total(state.cards[state.player]), payoff, new Map());
    if (planCache.size >= 24) planCache.clear();
    planCache.set(key, plan);
  }
  const d = fullIndex.get(state.dice.map(die => die.value).sort((a,b)=>a-b).join(""))!;
  const left = 3 - state.rolls, action = plan.picks[left][d], candidates: Candidate[] = [];
  candidates.push({ label: categories[plan.picks[0][d]] + " (최선 점수 기록)", value: plan.win[0][d] });
  if (left > 0) {
    const chance = chanceValues(plan.win[left - 1]);
    for (const h of kernel.holds[d]) if (h < 210) candidates.push({ label: "고정 " + (kernel.states[h].join("·") || "없음"), value: chance[h] });
  }
  candidates.sort((a,b)=>b.value-a.value);
  const common = { value: plan.win[left][d], candidates, note: "Win DP v2 · 마지막 두 카테고리 확률 DP · 상대 DP Expert 점수분포 가정 · 승리 1 / 무승부 0.5" };
  if (action < 12) return { type: "score", category: categories[action], ...common };
  const kept = [...kernel.states[action - 12]], ids = state.dice.filter(die => {
    const index = kept.indexOf(die.value);
    if (index < 0) return false;
    kept.splice(index, 1);
    return true;
  }).map(die=>die.id);
  return { type: "reroll", ids, ...common };
}
