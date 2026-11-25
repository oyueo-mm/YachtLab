// YachtLab v6 research: generic exact single-turn solver over stop values.
//
// A "stop-value" array val[c*64 + p] gives the (larger-is-better) value of
// scoring category c with raw points p from the current scorecard state. Given
// it, the within-turn policy (3 rolls, exact chance backups) is fully
// determined. This generalises src/research-v5/policy-pmf.ts turnOutcomes
// (which hard-codes val = gain + W(next)) so that any stationary own-state
// policy -- e.g. exponential-utility (risk-sensitive) policies -- gets an exact
// PMF with the SAME tie-break rules:
//   - stop: first category (index order) with the strictly largest value
//   - roll: first hold (kernel order) strictly better than the best so far,
//           starting from the stop value; the "keep all five" hold is skipped.
// Research-only; not used by the product AI list.
import { FULL, PROB, POINTS, HOLD_START, HOLD_LIST, CHILD, OFFSET, chance } from "../research-v5/kernel";

export class TurnBuffers {
  stopVal = new Float64Array(FULL);
  stopCat = new Int16Array(FULL);
  v1 = new Float64Array(FULL);
  v2 = new Float64Array(FULL);
  act1 = new Int16Array(FULL);
  act2 = new Int16Array(FULL);
  mass = new Float64Array(FULL);
  part = new Float64Array(462);
  e = new Float64Array(462);
  out = new Float64Array(12 * 64);
}

function stopValues(mask: number, val: Float64Array, b: TurnBuffers) {
  for (let d = 0; d < FULL; d++) {
    let best = -Infinity, bc = -1;
    for (let c = 0; c < 12; c++) {
      if (!(mask & (1 << c))) continue;
      const v = val[c * 64 + POINTS[d * 12 + c]];
      if (v > best) { best = v; bc = c; }
    }
    b.stopVal[d] = best; b.stopCat[d] = bc;
  }
}

function backup(prev: Float64Array, dst: Float64Array, act: Int16Array | null, b: TurnBuffers) {
  const e = chance(prev, b.e);
  for (let d = 0; d < FULL; d++) {
    let best = b.stopVal[d], a = -1;
    for (let i = HOLD_START[d], end = HOLD_START[d + 1] - 1; i < end; i++) {
      const h = HOLD_LIST[i];
      if (e[h] > best) { best = e[h]; a = h; }
    }
    dst[d] = best;
    if (act) act[d] = a;
  }
}

/** Expected value (in val units) at the start of a turn (before the first roll). */
export function turnStartValue(mask: number, val: Float64Array, b: TurnBuffers): number {
  stopValues(mask, val, b);
  backup(b.stopVal, b.v1, null, b);
  backup(b.v1, b.v2, null, b);
  let s = 0;
  for (let d = 0; d < FULL; d++) s += PROB[d] * b.v2[d];
  return s;
}

/**
 * Exact distribution of the turn's scoring outcome (category c, raw points p) under
 * the policy induced by `val`. Returns sparse keys c*64+p and probabilities.
 */
export function turnOutcomesFromVal(mask: number, val: Float64Array, b: TurnBuffers): { keys: Int32Array; prob: Float64Array; value: number } {
  stopValues(mask, val, b);
  backup(b.stopVal, b.v1, b.act1, b);
  backup(b.v1, b.v2, b.act2, b);
  let value = 0;
  for (let d = 0; d < FULL; d++) value += PROB[d] * b.v2[d];
  const out = b.out, mass = b.mass, part = b.part;
  out.fill(0);
  mass.set(PROB);
  for (const act of [b.act2, b.act1]) {
    part.fill(0);
    for (let d = 0; d < FULL; d++) {
      const m = mass[d];
      if (m === 0) continue;
      const a = act[d];
      if (a < 0) { const c = b.stopCat[d]; out[c * 64 + POINTS[d * 12 + c]] += m; continue; }
      part[a] += m;
    }
    for (let h = 0; h < OFFSET; h++) {
      const m = part[h];
      if (m === 0) continue;
      const q = m / 6, k = h * 6;
      part[CHILD[k]] += q; part[CHILD[k + 1]] += q; part[CHILD[k + 2]] += q;
      part[CHILD[k + 3]] += q; part[CHILD[k + 4]] += q; part[CHILD[k + 5]] += q;
    }
    for (let d = 0; d < FULL; d++) mass[d] = part[OFFSET + d];
  }
  for (let d = 0; d < FULL; d++) {
    const m = mass[d];
    if (m === 0) continue;
    const c = b.stopCat[d];
    out[c * 64 + POINTS[d * 12 + c]] += m;
  }
  const keys: number[] = [];
  for (let k = 0; k < out.length; k++) if (out[k] > 0) keys.push(k);
  return { keys: Int32Array.from(keys), prob: Float64Array.from(keys, (k) => out[k]), value };
}
