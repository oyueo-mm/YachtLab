// Exact Policy PMF bank (v5 research, method 1/2).
//
// For a *stationary own-state policy* pi -- one whose choices depend only on its
// own (remaining-category mask, capped upper sum, dice, rolls left) -- the
// distribution of future points from any scorecard state is a function of
// (mask, u) only. We compute it exactly (up to Float64 rounding) by backward
// induction over masks and exact forward propagation of the 3-roll chance chain.
//
// The policy is "greedy with respect to a continuation value W(mask, u)":
//   - stop:  pick the first category maximising gain + W(next state)
//   - roll:  pick the first hold whose expected stop/roll value is strictly
//            better than scoring now (same ordering as src/dp.ts dpDecision)
// With W = DP Expert table this is DP Expert. With W = 0 it is a myopic
// "maximise this turn's points" policy. A PMF of such a policy is NOT the
// distribution of an opponent that reacts to our scorecard (e.g. Win DP v2 in
// its last two categories); for those it is only an approximation.
import {
  FULL, PROB, POINTS, HOLD_START, HOLD_LIST, CHILD, OFFSET,
  chance, popcount, gainOf, nextUpper, canonicalUpper, UPPER_CAP,
} from "./kernel";

export type ContinuationValue = (mask: number, u: number) => number;

export type TurnOutcomes = {
  /** probability of (category c, raw points p) at index c*64+p */
  prob: Float64Array;
  keys: Int32Array;
};

/** Exact distribution of the scoring outcome of one turn under the W-greedy policy. */
export function turnOutcomes(mask: number, u: number, W: ContinuationValue, scratch?: TurnScratch): TurnOutcomes {
  const s = scratch ?? new TurnScratch();
  const { stopVal, stopCat, v1, v2, act1, act2, massA, out } = s;
  // Continuation values of every (category, raw points) pair: points range is 0..50.
  const cont = s.cont;
  for (let c = 0; c < 12; c++) {
    if (!(mask & (1 << c))) continue;
    const next = mask ^ (1 << c);
    for (let p = 0; p <= 50; p++) cont[c * 64 + p] = NaN;
    for (let d = 0; d < FULL; d++) {
      const p = POINTS[d * 12 + c];
      if (Number.isNaN(cont[c * 64 + p])) cont[c * 64 + p] = W(next, canonicalUpper(next, nextUpper(c, p, u)));
    }
  }
  for (let d = 0; d < FULL; d++) {
    let best = -Infinity, bc = -1;
    for (let c = 0; c < 12; c++) {
      if (!(mask & (1 << c))) continue;
      const p = POINTS[d * 12 + c];
      const v = gainOf(d, c, u) + cont[c * 64 + p];
      if (v > best) { best = v; bc = c; }
    }
    stopVal[d] = best; stopCat[d] = bc;
  }
  const backup = (prev: Float64Array, dst: Float64Array, act: Int16Array) => {
    const e = chance(prev, s.chanceBuf);
    for (let d = 0; d < FULL; d++) {
      let best = stopVal[d], a = -1;
      // the final entry of each hold list is the "keep all five" hold, never chosen (dp.ts skips it)
      for (let i = HOLD_START[d], end = HOLD_START[d + 1] - 1; i < end; i++) {
        const h = HOLD_LIST[i];
        if (e[h] > best) { best = e[h]; a = h; }
      }
      dst[d] = best; act[d] = a;
    }
  };
  backup(stopVal, v1, act1);
  backup(v1, v2, act2);
  out.fill(0);
  massA.set(PROB);
  const part = s.partMass;
  for (const act of [act2, act1]) {
    part.fill(0);
    for (let d = 0; d < FULL; d++) {
      const m = massA[d];
      if (m === 0) continue;
      const a = act[d];
      if (a < 0) { const c = stopCat[d]; out[c * 64 + POINTS[d * 12 + c]] += m; continue; }
      part[a] += m;
    }
    // push partial-hold mass down the exact chance tree: each missing die is a fair face
    for (let h = 0; h < OFFSET; h++) {
      const m = part[h];
      if (m === 0) continue;
      const q = m / 6, b = h * 6;
      part[CHILD[b]] += q; part[CHILD[b + 1]] += q; part[CHILD[b + 2]] += q;
      part[CHILD[b + 3]] += q; part[CHILD[b + 4]] += q; part[CHILD[b + 5]] += q;
    }
    for (let d = 0; d < FULL; d++) massA[d] = part[OFFSET + d];
  }
  for (let d = 0; d < FULL; d++) {
    const m = massA[d];
    if (m === 0) continue;
    const c = stopCat[d];
    out[c * 64 + POINTS[d * 12 + c]] += m;
  }
  const keys: number[] = [];
  for (let k = 0; k < out.length; k++) if (out[k] > 0) keys.push(k);
  return { prob: Float64Array.from(keys, (k) => out[k]), keys: Int32Array.from(keys) };
}

export class TurnScratch {
  stopVal = new Float64Array(FULL);
  stopCat = new Int16Array(FULL);
  v1 = new Float64Array(FULL);
  v2 = new Float64Array(FULL);
  act1 = new Int16Array(FULL);
  act2 = new Int16Array(FULL);
  massA = new Float64Array(FULL);
  massB = new Float64Array(FULL);
  out = new Float64Array(12 * 64);
  cont = new Float64Array(12 * 64);
  chanceBuf = new Float64Array(462);
  partMass = new Float64Array(462);
}

export type BankStats = { states: number; canonicalStates: number; floats: number; seconds: number; maxMassError: number };

/** Dense PMF bank over all canonical (mask, u) states for one W-greedy policy. */
export class PolicyPmfBank {
  readonly pmf: (Float64Array | undefined)[] = new Array(4096 * 64);
  readonly mean = new Float64Array(4096 * 64).fill(NaN);
  stats: BankStats = { states: 0, canonicalStates: 0, floats: 0, seconds: 0, maxMassError: 0 };
  constructor(readonly name: string, readonly W: ContinuationValue) {}

  /** PMF of future points (incl. bonus) from scorecard state (mask, u). */
  get(mask: number, u: number): Float64Array {
    const k = mask * 64 + canonicalUpper(mask, u);
    const v = this.pmf[k];
    if (!v) throw Error(`PMF state ${mask}:${u} not built`);
    return v;
  }
  meanOf(mask: number, u: number) { return this.mean[mask * 64 + canonicalUpper(mask, u)]; }

  /** Build every canonical state (or only those with popcount <= maxRemaining). */
  build(maxRemaining = 12): this {
    const t0 = performance.now();
    const scratch = new TurnScratch();
    const masks = Array.from({ length: 4096 }, (_, m) => m).filter((m) => popcount(m) <= maxRemaining).sort((a, b) => popcount(a) - popcount(b) || a - b);
    let canonical = 0, floats = 0, maxErr = 0;
    for (const mask of masks) {
      for (let u = 0; u <= UPPER_CAP; u++) {
        if (canonicalUpper(mask, u) !== u) continue;
        const key = mask * 64 + u;
        if (mask === 0) { this.pmf[key] = Float64Array.of(1); this.mean[key] = 0; canonical++; floats++; continue; }
        const t = turnOutcomes(mask, u, this.W, scratch);
        // determine support length
        let len = 1;
        const parts: { child: Float64Array; shift: number; p: number }[] = [];
        for (let i = 0; i < t.keys.length; i++) {
          const k = t.keys[i], c = k >> 6, raw = k & 63;
          const next = mask ^ (1 << c), u2 = canonicalUpper(next, nextUpper(c, raw, u));
          const child = this.pmf[next * 64 + u2]!;
          const shift = raw + (c < 6 && u < UPPER_CAP && u + raw >= UPPER_CAP ? 35 : 0);
          parts.push({ child, shift, p: t.prob[i] });
          len = Math.max(len, shift + child.length);
        }
        const out = new Float64Array(len);
        let mass = 0, mu = 0;
        for (const { child, shift, p } of parts) {
          for (let g = 0; g < child.length; g++) out[shift + g] += p * child[g];
        }
        for (let g = 0; g < len; g++) { mass += out[g]; mu += g * out[g]; }
        maxErr = Math.max(maxErr, Math.abs(mass - 1));
        this.pmf[key] = out; this.mean[key] = mu; canonical++; floats += len;
      }
      // alias non-canonical u to canonical arrays
      for (let u = 0; u <= UPPER_CAP; u++) {
        const cu = canonicalUpper(mask, u);
        if (cu !== u) { this.pmf[mask * 64 + u] = this.pmf[mask * 64 + cu]; this.mean[mask * 64 + u] = this.mean[mask * 64 + cu]; }
      }
    }
    this.stats = { states: masks.length * 64, canonicalStates: canonical, floats, seconds: (performance.now() - t0) / 1000, maxMassError: maxErr };
    return this;
  }
}

/** Win credit table: credit[x + off] = P(opp < x) + 0.5 P(opp = x) for my final total x. */
export function creditTable(oppBase: number, oppPmf: Float64Array) {
  // x ranges over [oppBase - 1, oppBase + len] ; outside: 0 / 1
  const len = oppPmf.length;
  const table = new Float64Array(len + 2);
  let below = 0;
  for (let g = 0; g < len; g++) { table[g + 1] = below + oppPmf[g] / 2; below += oppPmf[g]; }
  table[len + 1] = 1;
  const lo = oppBase - 1; // index 0 -> x = oppBase - 1 (credit 0)
  return {
    credit(x: number) { const i = x - lo; return i <= 0 ? 0 : i >= len + 1 ? 1 : table[i]; },
    lo, table, len,
  };
}

/** P(win)+0.5P(tie) of (myBase + G_me) vs (oppBase + G_opp), independent. */
export function winCredit(myBase: number, myPmf: Float64Array, oppBase: number, oppPmf: Float64Array): number {
  const t = creditTable(oppBase, oppPmf);
  let s = 0;
  for (let g = 0; g < myPmf.length; g++) if (myPmf[g] !== 0) s += myPmf[g] * t.credit(myBase + g);
  return s;
}
export { popcount };

