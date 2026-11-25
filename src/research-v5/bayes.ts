// Exact-likelihood Bayesian opponent filter (v5 method 7/8).
//
// Observation model: only the PUBLIC scorecard change of each completed
// opponent turn (category c, raw points p) given the opponent's scorecard state
// (mask, u) before the turn. For every hypothesis policy pi with an exact PMF
// bank, P_pi(c, p | mask, u) is computed exactly by turnOutcomes(). Hold/re-roll
// choices inside the opponent's turn are not used (they are not part of the
// state the AI receives), so identification is slow by construction.
//
// Robustness: likelihood is mixed with an epsilon floor (model misspecification),
// and log-weights can be discounted each turn (lambda < 1) to track a policy
// switch (a simple forgetting filter, a cheap stand-in for a regime HMM).
import { categories, upper, type Card } from "../engine";
import { turnOutcomes, type PolicyPmfBank, TurnScratch } from "./policy-pmf";
import { canonicalUpper } from "./kernel";

export type Hypothesis = { name: string; bank: PolicyPmfBank };
export type FilterOptions = { epsilon?: number; discount?: number; prior?: number[] };

const maskOfCard = (c: Card) => categories.reduce((m, k, i) => (c[k] === undefined ? m | (1 << i) : m), 0);

export class OpponentFilter {
  logw: number[];
  observations = 0;
  private lastCard: Card | null = null;
  private cache = new Map<string, Map<number, number>>();
  private scratch = new TurnScratch();
  constructor(readonly hyps: Hypothesis[], readonly opts: FilterOptions = {}) {
    const prior = opts.prior ?? hyps.map(() => 1 / hyps.length);
    this.logw = prior.map(Math.log);
  }
  reset() { const prior = this.opts.prior ?? this.hyps.map(() => 1 / this.hyps.length); this.logw = prior.map(Math.log); this.lastCard = null; this.observations = 0; }
  posterior(): number[] { const m = Math.max(...this.logw), e = this.logw.map((x) => Math.exp(x - m)), s = e.reduce((a, b) => a + b, 0); return e.map((x) => x / s); }

  private outcomeProb(h: number, mask: number, u: number, c: number, p: number) {
    const key = h + ":" + mask + ":" + canonicalUpper(mask, u);
    let m = this.cache.get(key);
    if (!m) {
      const t = turnOutcomes(mask, canonicalUpper(mask, u), this.hyps[h].bank.W, this.scratch);
      m = new Map(); for (let i = 0; i < t.keys.length; i++) m.set(t.keys[i], t.prob[i]);
      if (this.cache.size > 20000) this.cache.clear();
      this.cache.set(key, m);
    }
    return m.get(c * 64 + p) ?? 0;
  }

  /** Feed the opponent's current public scorecard; updates once per newly scored category. */
  observe(card: Card) {
    const filled = categories.filter((c) => card[c] !== undefined).length;
    if (!this.lastCard || filled < categories.filter((c) => this.lastCard![c] !== undefined).length) { this.reset(); this.lastCard = {}; }
    const prev = this.lastCard!;
    const added = categories.filter((c) => card[c] !== undefined && prev[c] === undefined);
    if (added.length === 1) {
      const c = categories.indexOf(added[0]), p = card[added[0]]!;
      const mask = maskOfCard(prev), u = Math.min(63, upper(prev));
      const eps = this.opts.epsilon ?? 0.02, lam = this.opts.discount ?? 1;
      for (let h = 0; h < this.hyps.length; h++) {
        const like = (1 - eps) * this.outcomeProb(h, mask, u, c, p) + eps * 0.01;
        this.logw[h] = lam * this.logw[h] + Math.log(like);
      }
      this.observations++;
    }
    this.lastCard = { ...card };
  }

  /** Posterior-mixture future-score PMF of the opponent from (mask, u). */
  mixture(mask: number, u: number): Float64Array {
    const w = this.posterior();
    const parts = this.hyps.map((h) => h.bank.get(mask, u));
    const out = new Float64Array(Math.max(...parts.map((p) => p.length)));
    parts.forEach((p, i) => { if (w[i] > 0) for (let g = 0; g < p.length; g++) out[g] += w[i] * p[g]; });
    return out;
  }
}
