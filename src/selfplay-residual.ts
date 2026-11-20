import { available, categories, score, total, upper, type Game } from "./engine";
import { choiceIndex, dpActionValues, dpDecision, dpFutureValue } from "./dp";
import { winDPv2Decision } from "./competitive-v2";
import type { Decision } from "./ai";

// A deliberately compact *full twelve-category* opponent-aware residual policy.
// No game seed, PRNG stream or future die is read. Evolution strategies and
// REINFORCE training use real full-game victory rewards, not Choice-only scores.
export const FEATURE_NAMES = [
  "reroll_volatility", "reroll_if_behind", "reroll_if_ahead", "take_upper",
  "take_yacht_or_straight", "take_immediate_points", "score_now",
  "held_high_dice", "late_reroll_if_behind", "late_reroll_if_ahead",
  "upper_bonus_pressure", "score_choice_or_four",
] as const;
export type ResidualWeights = number[];
export type ResidualCandidate = { index: number; q: number; features: number[] };
export type ResidualSelection = { decision: Decision; gradient: number[]; probability: number };
const EPS = 1e-10;
const DIM = FEATURE_NAMES.length;
export const ZERO_RESIDUAL_WEIGHTS = Array(DIM).fill(0);

const cardMask = (state: Game, player: number) =>
  categories.reduce((m, c, i) => m | (state.cards[player][c] === undefined ? 1 << i : 0), 0);

export function publicProjectedGap(state: Game, opponentBias = 0): number {
  const mine = state.cards[state.player], other = state.cards[1 - state.player];
  const own = total(mine) + dpFutureValue(cardMask(state, state.player), Math.min(63, upper(mine)));
  const theirs = total(other) + dpFutureValue(cardMask(state, 1 - state.player), Math.min(63, upper(other)));
  return own - theirs - opponentBias;
}
export function residualCandidates(state: Game, maxPointLoss = 3.5, opponentBias = 0): ResidualCandidate[] {
  if (!state.rolls || state.done) throw Error("A residual decision requires a visible rolled state.");
  const q = dpActionValues(state);
  const best = Math.max(...q);
  const gap = Math.tanh(publicProjectedGap(state, opponentBias) / 24);
  const behind = Math.max(0, -gap), ahead = Math.max(0, gap);
  const rem = available(state.cards[state.player]).length;
  const late = Math.max(0, Math.min(1, (8 - rem) / 5));
  const bonusPressure = Math.max(0, Math.min(1, (63 - upper(state.cards[state.player])) / 36));
  const values = state.dice.map(d => d.value);
  const result: ResidualCandidate[] = [];
  const usedHold = new Set<string>();
  for (let i = 0; i < q.length; i++) {
    if (!Number.isFinite(q[i]) || best - q[i] > maxPointLoss + EPS) continue;
    if (i < 32) {
      const held = state.dice.filter(d => i & (1 << d.id)).map(d => d.value);
      const key = [...held].sort((a, b) => a - b).join("");
      if (usedHold.has(key)) continue;
      usedHold.add(key);
      const vol = Math.sqrt((5 - held.length) / 5);
      const high = held.filter(v => v >= 5).length / 5;
      result.push({ index: i, q: q[i], features: [
        vol, vol * behind, vol * ahead, 0, 0, 0, 0, high,
        late * vol * behind, late * vol * ahead, 0, 0,
      ] });
    } else {
      const c = i - 32, isUpper = c < 6, points = score(values, categories[c]);
      result.push({ index: i, q: q[i], features: [
        0, 0, 0, isUpper ? 1 : 0,
        c === 9 || c === 10 || c === 11 ? 1 : 0,
        points / 50, 1, 0, 0, 0,
        isUpper ? bonusPressure : 0,
        c === 6 || c === 7 ? 1 : 0,
      ] });
    }
  }
  if (!result.length) throw Error("No legal candidate action found.");
  return result;
}
function decisionFromIndex(state: Game, index: number, q: number): Decision {
  const common = {
    value: q,
    candidates: [],
    note: "Full-game league self-play residual: DP expected-score anchor + learned opponent-aware preferences; value is projected points, not win probability",
  };
  if (index >= 32) return { type: "score", category: categories[index - 32], ...common };
  return { type: "reroll", ids: state.dice.filter(d => index & (1 << d.id)).map(d => d.id), ...common };
}
export function residualDecision(
  state: Game,
  weights: ResidualWeights,
  options: { sample?: boolean; rng?: () => number; temperature?: number; maxPointLoss?: number; opponentBias?: number; useEndgameDP?: boolean } = {},
): ResidualSelection {
  if (weights.length !== DIM || weights.some(w => !Number.isFinite(w))) throw Error("Invalid residual weight vector.");
  if (options.useEndgameDP !== false && available(state.cards[state.player]).length <= 2) {
    return { decision: winDPv2Decision(state) ?? dpDecision(state), gradient: Array(DIM).fill(0), probability: 1 };
  }
  const candidates = residualCandidates(state, options.maxPointLoss ?? 3.5, options.opponentBias ?? 0);
  const bestQ = Math.max(...candidates.map(c => c.q));
  const temperature = Math.max(.15, options.temperature ?? .8);
  const logits = candidates.map(c =>
    (c.q - bestQ) / temperature + c.features.reduce((sum, f, i) => sum + f * weights[i], 0)
  );
  const highest = Math.max(...logits);
  const exps = logits.map(x => Math.exp(x - highest)), norm = exps.reduce((a, b) => a + b, 0);
  const probabilities = exps.map(x => x / norm);
  let chosen = 0;
  if (options.sample) {
    let sample = (options.rng?.() ?? .5);
    for (let i = 0; i < probabilities.length; i++) {
      sample -= probabilities[i];
      if (sample <= 0 || i === probabilities.length - 1) { chosen = i; break; }
    }
  } else {
    for (let i = 1; i < logits.length; i++)
      if (logits[i] > logits[chosen] + EPS) chosen = i;
  }
  const expectation = Array(DIM).fill(0);
  for (let i = 0; i < candidates.length; i++)
    for (let j = 0; j < DIM; j++) expectation[j] += probabilities[i] * candidates[i].features[j];
  return {
    decision: decisionFromIndex(state, candidates[chosen].index, candidates[chosen].q),
    gradient: candidates[chosen].features.map((f, i) => f - expectation[i]),
    probability: probabilities[chosen],
  };
}
