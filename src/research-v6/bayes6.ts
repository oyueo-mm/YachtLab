// Expanded exact-likelihood Bayesian opponent filter over the v6 exp-utility policy family
// (techniques 38/39). Same observation model as src/research-v5/bayes.ts (public category +
// points of each completed opponent turn), but the likelihood of hypothesis lambda uses the
// exact turn-outcome distribution of THAT exp-utility policy (RiskPolicy stop values), not
// the expected-points policy. Optional discount (forgetting) tracks strategy switches.
// Hypotheses are model classes, not models of human play (no human data).
import { categories, upper, type Card } from "../engine";
import { canonicalUpper } from "../research-v5/kernel";
import type { PolicyPmfBank } from "../research-v5/policy-pmf";
import type { RiskPolicy } from "./risk";
import { TurnBuffers, turnOutcomesFromVal } from "./turn";

export type RiskHypothesis = { name: string; policy: RiskPolicy; bank: PolicyPmfBank };
const maskOfCard = (c: Card) => categories.reduce((m, k, i) => (c[k] === undefined ? m | (1 << i) : m), 0);

export class RiskOpponentFilter {
  logw: number[];
  observations = 0;
  private lastCard: Card | null = null;
  private cache = new Map<string, Map<number, number>>();
  private bufs = new TurnBuffers();
  private val = new Float64Array(12 * 64);
  constructor(readonly hyps: RiskHypothesis[], readonly opts: { epsilon?: number; discount?: number } = {}) { this.logw = hyps.map(() => -Math.log(hyps.length)); }
  reset() { this.logw = this.hyps.map(() => -Math.log(this.hyps.length)); this.lastCard = null; this.observations = 0; }
  posterior() { const m = Math.max(...this.logw), e = this.logw.map((x) => Math.exp(x - m)), s = e.reduce((a, b) => a + b, 0); return e.map((x) => x / s); }
  private prob(h: number, mask: number, u: number, key: number) {
    const cu = canonicalUpper(mask, u), ck = `${h}:${mask}:${cu}`;
    let m = this.cache.get(ck);
    if (!m) {
      this.hyps[h].policy.fillVal(mask, cu, this.val);
      const t = turnOutcomesFromVal(mask, this.val, this.bufs);
      m = new Map(); for (let i = 0; i < t.keys.length; i++) m.set(t.keys[i], t.prob[i]);
      if (this.cache.size > 50000) this.cache.clear();
      this.cache.set(ck, m);
    }
    return m.get(key) ?? 0;
  }
  observe(card: Card) {
    const filled = (c: Card) => categories.filter((k) => c[k] !== undefined).length;
    if (!this.lastCard || filled(card) < filled(this.lastCard)) { this.reset(); this.lastCard = {}; }
    const prev = this.lastCard!;
    const added = categories.filter((c) => card[c] !== undefined && prev[c] === undefined);
    if (added.length === 1) {
      const c = categories.indexOf(added[0]), p = card[added[0]]!, mask = maskOfCard(prev), u = Math.min(63, upper(prev));
      const eps = this.opts.epsilon ?? 0.02, lam = this.opts.discount ?? 1;
      for (let h = 0; h < this.hyps.length; h++) this.logw[h] = lam * this.logw[h] + Math.log((1 - eps) * this.prob(h, mask, u, c * 64 + p) + eps * 0.01);
      this.observations++;
    }
    this.lastCard = { ...card };
  }
  mixture(mask: number, u: number): Float64Array {
    const w = this.posterior(), parts = this.hyps.map((h) => h.bank.get(mask, u));
    const out = new Float64Array(Math.max(...parts.map((p) => p.length)));
    parts.forEach((p, i) => { if (w[i] > 1e-12) for (let g = 0; g < p.length; g++) out[g] += w[i] * p[g]; });
    return out;
  }
}
