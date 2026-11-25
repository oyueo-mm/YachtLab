// YachtLab v6 research: exponential-utility (risk-sensitive) stationary policies
// and their exact future-score PMF banks.
//
// Why this family: for U(x) = exp(lambda x) the objective E[U(s + G)] =
// exp(lambda s) E[exp(lambda G)] separates, so the optimal policy for that utility
// depends only on the own scorecard state (remaining mask, capped upper sum) and
// NOT on the points already banked. It is therefore a stationary own-state policy
// whose exact future-score PMF can be computed for every (mask, u) state, exactly
// like the DP Expert bank of v5 (lambda = 0 is DP Expert itself).
//   lambda > 0 : risk-seeking (maximise E[exp(lambda G)])
//   lambda < 0 : risk-averse  (minimise E[exp(lambda G)])
// The v6 Policy-Set Rollout lets "future me" pick the best lambda per state.
import { FULL, POINTS, popcount, nextUpper, canonicalUpper, UPPER_CAP } from "../research-v5/kernel";
import { PolicyPmfBank } from "../research-v5/policy-pmf";
import { TurnBuffers, turnStartValue, turnOutcomesFromVal } from "./turn";

export const DISTINCT: number[][] = Array.from({ length: 12 }, (_, c) => {
  const s = new Set<number>();
  for (let d = 0; d < FULL; d++) s.add(POINTS[d * 12 + c]);
  return [...s].sort((a, b) => a - b);
});
export const bonusGain = (c: number, p: number, u: number) => p + (c < 6 && u < UPPER_CAP && u + p >= UPPER_CAP ? 35 : 0);
const MASKS_BY_SIZE = Array.from({ length: 4096 }, (_, m) => m).sort((a, b) => popcount(a) - popcount(b) || a - b);

export class RiskPolicy {
  /** lambda != 0: Z = E[exp(lambda G)] of the optimal policy; lambda = 0: expected future points. Indexed mask*64+u (all u, aliased). */
  readonly Z = new Float64Array(4096 * 64).fill(NaN);
  seconds = 0;
  constructor(readonly lambda: number) {}

  /** Stop values val[c*64+p] at (mask, u): larger is better (same policy as the bank). */
  fillVal(mask: number, u: number, val: Float64Array) {
    const lam = this.lambda, sg = Math.sign(lam);
    for (let c = 0; c < 12; c++) {
      if (!(mask & (1 << c))) continue;
      const next = mask ^ (1 << c);
      for (const p of DISTINCT[c]) {
        const g = bonusGain(c, p, u);
        const z = this.Z[next * 64 + canonicalUpper(next, nextUpper(c, p, u))];
        val[c * 64 + p] = lam === 0 ? g + z : sg * Math.exp(lam * g) * z;
      }
    }
  }

  /** Build all states, or only masks with popcount <= maxRemaining (tests). */
  build(maxRemaining = 12): this {
    const t0 = performance.now();
    const b = new TurnBuffers(), val = new Float64Array(12 * 64);
    const lam = this.lambda, sg = Math.sign(lam);
    for (const mask of MASKS_BY_SIZE) {
      if (popcount(mask) > maxRemaining) break;
      for (let u = 0; u <= UPPER_CAP; u++) {
        if (canonicalUpper(mask, u) !== u) continue;
        if (mask === 0) { this.Z[u] = lam === 0 ? 0 : 1; continue; }
        this.fillVal(mask, u, val);
        const v = turnStartValue(mask, val, b);
        this.Z[mask * 64 + u] = lam === 0 ? v : sg * v;
      }
      for (let u = 0; u <= UPPER_CAP; u++) this.Z[mask * 64 + u] = this.Z[mask * 64 + canonicalUpper(mask, u)];
    }
    this.seconds = (performance.now() - t0) / 1000;
    return this;
  }
  /** Certainty equivalent in points (lambda != 0) or expected points (lambda = 0). */
  certaintyEquivalent(mask: number, u: number) {
    const z = this.Z[mask * 64 + canonicalUpper(mask, u)];
    return this.lambda === 0 ? z : Math.log(z) / this.lambda;
  }
}

/** Exact future-score PMF bank of a RiskPolicy (same layout as the v5 PolicyPmfBank). */
export function buildRiskBank(policy: RiskPolicy, name = `risk(${policy.lambda})`, maxRemaining = 12): PolicyPmfBank {
  const t0 = performance.now();
  const bank = new PolicyPmfBank(name, (m, u) => policy.certaintyEquivalent(m, u));
  const b = new TurnBuffers(), val = new Float64Array(12 * 64);
  let canonical = 0, floats = 0, maxErr = 0;
  for (const mask of MASKS_BY_SIZE) {
    if (popcount(mask) > maxRemaining) break;
    for (let u = 0; u <= UPPER_CAP; u++) {
      if (canonicalUpper(mask, u) !== u) continue;
      const key = mask * 64 + u;
      if (mask === 0) { bank.pmf[key] = Float64Array.of(1); bank.mean[key] = 0; canonical++; floats++; continue; }
      policy.fillVal(mask, u, val);
      const t = turnOutcomesFromVal(mask, val, b);
      let len = 1;
      const parts: { child: Float64Array; shift: number; p: number }[] = [];
      for (let i = 0; i < t.keys.length; i++) {
        const k = t.keys[i], c = k >> 6, raw = k & 63;
        const next = mask ^ (1 << c), u2 = canonicalUpper(next, nextUpper(c, raw, u));
        const child = bank.pmf[next * 64 + u2]!;
        const shift = bonusGain(c, raw, u);
        parts.push({ child, shift, p: t.prob[i] });
        len = Math.max(len, shift + child.length);
      }
      const out = new Float64Array(len);
      for (const { child, shift, p } of parts) for (let g = 0; g < child.length; g++) out[shift + g] += p * child[g];
      let mass = 0, mu = 0;
      for (let g = 0; g < len; g++) { mass += out[g]; mu += g * out[g]; }
      maxErr = Math.max(maxErr, Math.abs(mass - 1));
      bank.pmf[key] = out; bank.mean[key] = mu; canonical++; floats += len;
    }
    for (let u = 0; u <= UPPER_CAP; u++) {
      const cu = canonicalUpper(mask, u);
      if (cu !== u) { bank.pmf[mask * 64 + u] = bank.pmf[mask * 64 + cu]; bank.mean[mask * 64 + u] = bank.mean[mask * 64 + cu]; }
    }
  }
  bank.stats = { states: 4096 * 64, canonicalStates: canonical, floats, seconds: (performance.now() - t0) / 1000, maxMassError: maxErr };
  return bank;
}
