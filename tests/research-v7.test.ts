import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import manifest from "../src/dp-manifest.json";
import { createGame, transition, categories, total, upper, type Game, type Card } from "../src/engine";
import { setDPTable, dpDecision } from "../src/dp";
import { PolicyPmfBank } from "../src/research-v5/policy-pmf";
import { canonicalUpper, nextUpper, UPPER_CAP } from "../src/research-v5/kernel";
import { endgameValue, maskOf, type V5Config } from "../src/research-v5/apex";
import { winDPv2Decision } from "../src/competitive-v2";
import { RiskPolicy, buildRiskBank, DISTINCT, bonusGain } from "../src/research-v6/risk";
import { winDPv6Decision, clearV6Cache } from "../src/research-v6/apex6";
import { fillStopValues, matrixGameValue, type V7Banks, type V7Kind } from "../src/research-v7/interactive";
import { winDPv7Decision, clearV7Cache } from "../src/research-v7/apex7";

const buf = gunzipSync(readFileSync("public/ai/" + manifest.asset));
const T = new Float64Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
setDPTable(T.buffer.slice(0) as ArrayBuffer);
const W = (m: number, u: number) => T[m * 64 + u];
const K = 4;
let dpBank: PolicyPmfBank;
let B: V7Banks, B1: V7Banks;
let v5: V5Config;
beforeAll(() => {
  dpBank = new PolicyPmfBank("DP Expert", W).build(K);
  const banks = [dpBank, ...[-0.04, 0.04].map((lam) => buildRiskBank(new RiskPolicy(lam).build(K), `exp(${lam})`, K))];
  B = { banks, dp: dpBank };
  B1 = { banks: [dpBank], dp: dpBank };
  v5 = { bank: dpBank, dpValue: W, endgame: "none", v2: winDPv2Decision, dpDecision };
}, 120_000);

function card(open: string[], fill: (i: number) => number): Card {
  return Object.fromEntries(categories.filter((c) => !open.includes(c)).map((c) => [c, fill(categories.indexOf(c))])) as Card;
}
function state(seed: number, me: Card, opp: Card, player: 0 | 1): Game {
  let s = createGame(seed, true);
  s = { ...s, player };
  s = transition(s, { type: "roll" });
  s.cards = player === 0 ? [me, opp] : [opp, me];
  return s;
}
const OPEN = [["aces", "fours", "full"], ["sixes", "yacht", "choice"], ["deuces", "large", "four", "threes"], ["fives", "small"], ["yacht"], ["threes"]];
const states = () => {
  const out: Game[] = [];
  for (let i = 0; i < 24; i++) {
    const mine = OPEN[i % 4], theirs = OPEN[(i + 1) % 4];
    out.push(state(2000 + i, card(mine, (j) => (j < 6 ? (j + 1) * 3 : 18 + ((i * 7 + j) % 9))), card(theirs, (j) => (j < 6 ? (j + 1) * 3 : 17 + ((i * 5 + j) % 11))), (i % 2) as 0 | 1));
  }
  return out;
};
const sides = (s: Game) => {
  const me = s.player, op = 1 - me;
  const m = maskOf(s.cards[me]), o = maskOf(s.cards[op]);
  return {
    me: { mask: m, u: canonicalUpper(m, Math.min(UPPER_CAP, upper(s.cards[me]))), x: total(s.cards[me]) },
    op: { mask: o, u: canonicalUpper(o, Math.min(UPPER_CAP, upper(s.cards[op]))), x: total(s.cards[op]) },
  };
};
const fill = (kind: V7Kind, BB: V7Banks, s: Game) => { const { me, op } = sides(s); return fillStopValues(kind, BB, me, op, new Float64Array(12 * 64).fill(NaN)); };
const each = (mask: number, f: (c: number, p: number) => void) => { for (let c = 0; c < 12; c++) if (mask & (1 << c)) for (const p of DISTINCT[c]) f(c, p); };

describe("v7 matrix game LP", () => {
  it("solves pure saddle points and mixed games exactly", () => {
    expect(matrixGameValue([[3, 1], [4, 2]])).toBeCloseTo(2, 12); // pure saddle
    expect(matrixGameValue([[1, 0], [0, 1]])).toBeCloseTo(0.5, 12); // matching pennies
    expect(matrixGameValue([[0, -1, 1], [1, 0, -1], [-1, 1, 0]])).toBeCloseTo(0, 12); // RPS
    expect(matrixGameValue([[0.3]])).toBeCloseTo(0.3, 12);
    // value lies between maximin and minimax for random matrices
    let r = 7;
    const rnd = () => ((r = (r * 1103515245 + 12345) >>> 0) / 2 ** 32);
    for (let t = 0; t < 50; t++) {
      const M = Array.from({ length: 7 }, () => Array.from({ length: 7 }, rnd));
      const v = matrixGameValue(M);
      const lo = Math.max(...M.map((row) => Math.min(...row)));
      const hi = Math.min(...M[0].map((_, j) => Math.max(...M.map((row) => row[j]))));
      expect(v).toBeGreaterThanOrEqual(lo - 1e-12);
      expect(v).toBeLessThanOrEqual(hi + 1e-12);
    }
  });
});

describe("v7 stop-value estimators", () => {
  it("v7 engine with estimator P makes the same decision and value as v6-P", () => {
    for (const s of states()) {
      clearV6Cache(); clearV7Cache();
      const a = winDPv6Decision(s, { ...v5, banks: B.banks }), b = winDPv7Decision(s, { ...v5, v7: B, kind: "P" });
      expect(b.type).toBe(a.type);
      expect(b.value).toBeCloseTo(a.value, 12);
      if (a.type === "score" && b.type === "score") expect(b.category).toBe(a.category);
      if (a.type === "reroll" && b.type === "reroll") expect([...b.ids].sort()).toEqual([...a.ids].sort());
    }
  });
  it("all estimators return win credits in [0, 1] for every open (category, points)", () => {
    for (const s of states().slice(0, 8)) for (const kind of ["R", "P", "L", "Lm", "N", "MM", "I1", "I1D", "I1R", "I1O", "I1RO"] as V7Kind[]) {
      const v = fill(kind, B, s);
      each(sides(s).me.mask, (c, p) => { expect(v[c * 64 + p]).toBeGreaterThanOrEqual(-1e-12); expect(v[c * 64 + p]).toBeLessThanOrEqual(1 + 1e-12); });
    }
  });
  it("ordering: L = maximin <= MM and L <= N <= MM", () => {
    for (const s of states().slice(0, 8)) {
      const L = fill("L", B, s), N = fill("N", B, s), MM = fill("MM", B, s);
      each(sides(s).me.mask, (c, p) => { const i = c * 64 + p; expect(N[i]).toBeGreaterThanOrEqual(L[i] - 1e-10); expect(N[i]).toBeLessThanOrEqual(MM[i] + 1e-10); });
    }
  });
  it("with a single (DP Expert) policy: I1 = I1R = I1O = I1RO (leaf is linear in the opponent distribution)", () => {
    for (const s of states().slice(0, 8)) {
      const a = fill("I1", B1, s), b = fill("I1R", B1, s), c1 = fill("I1O", B1, s), d = fill("I1RO", B1, s);
      each(sides(s).me.mask, (c, p) => { const i = c * 64 + p; expect(b[i]).toBeCloseTo(a[i], 12); expect(c1[i]).toBeCloseTo(a[i], 12); expect(d[i]).toBeCloseTo(a[i], 12); });
    }
  });
  it("one category left on both sides: I1 / I1R / I1O / I1RO equal the exact interactive value", () => {
    let n = 0;
    for (let i = 0; i < 12; i++) {
      const s = state(3000 + i, card([categories[i]], (j) => 10 + ((j * 7 + i) % 13)), card([categories[(i + 5) % 12]], (j) => 11 + ((j * 5 + i) % 13)), (i % 2) as 0 | 1);
      const { me, op } = sides(s), D = me.x - op.x;
      for (const kind of ["I1", "I1R", "I1O", "I1RO"] as V7Kind[]) {
        const v = fill(kind, B, s);
        each(me.mask, (c, p) => {
          const g = bonusGain(c, p, me.u);
          const exact = 1 - endgameValue(op.mask, op.u, 0, nextUpper(c, p, me.u), -(D + g));
          expect(v[c * 64 + p]).toBeCloseTo(exact, 12);
          n++;
        });
      }
    }
    expect(n).toBeGreaterThan(100);
  });
  it("never reads the RNG: changing seed / rng leaves v7-I1 decisions unchanged", () => {
    for (const s of states().slice(0, 6)) {
      clearV7Cache();
      const a = winDPv7Decision(s, { ...v5, v7: B, kind: "I1" });
      clearV7Cache();
      const b = winDPv7Decision({ ...s, seed: 4242, rng: [3, 5] }, { ...v5, v7: B, kind: "I1" });
      expect(b).toEqual(a);
    }
  });
});

describe("v7 two-ply reaction (I2) and single-bank derivative", () => {
  it("I1RO1 equals I1RO computed with the DP bank alone", () => {
    for (const s of states().slice(0, 6)) {
      const a = fill("I1RO1", B, s), b = fill("I1RO", B1, s);
      each(sides(s).me.mask, (c, p) => expect(a[c * 64 + p]).toBe(b[c * 64 + p]));
    }
  });
  it("I2 / I2R return win credits in [0, 1] (2/1 states)", () => {
    for (let i = 0; i < 6; i++) {
      const s = state(4000 + i, card([categories[i], categories[(i + 3) % 12]], (j) => 10 + ((j * 7 + i) % 13)), card([categories[(i + 5) % 12]], (j) => 11 + ((j * 5 + i) % 13)), (i % 2) as 0 | 1);
      for (const kind of ["I2", "I2R"] as V7Kind[]) {
        const v = fill(kind, B, s);
        each(sides(s).me.mask, (c, p) => { expect(v[c * 64 + p]).toBeGreaterThanOrEqual(0); expect(v[c * 64 + p]).toBeLessThanOrEqual(1); });
      }
    }
  });
  it("I2R with one category left on both sides after my turn is close to the exact interactive value (2/1 states)", () => {
    // me 2 open, opp 1 open: after my score -> opp's last turn, then my last turn (exact with P stop values).
    // Only the opponent's objective (vs my DP future, not my actual reaction) is approximate.
    let err = 0, n = 0;
    for (let i = 0; i < 6; i++) {
      const s = state(5000 + i, card([categories[i], categories[(i + 4) % 12]], (j) => 12 + ((j * 3 + i) % 11)), card([categories[(i + 7) % 12]], (j) => 12 + ((j * 5 + i) % 11)), (i % 2) as 0 | 1);
      const { me, op } = sides(s), D = me.x - op.x, v = fill("I2R", B, s);
      each(me.mask, (c, p) => {
        const g = bonusGain(c, p, me.u), next = me.mask ^ (1 << c);
        const exact = 1 - endgameValue(op.mask, op.u, next, nextUpper(c, p, me.u), -(D + g));
        err += Math.abs(v[c * 64 + p] - exact); n++;
      });
    }
    expect(err / n).toBeLessThan(0.02);
  });
  it("single-bank product kinds: I2R1 = I2R(DP only) = I2(DP only); I2RO1 = I2RO(DP only); I2R1 != I2RO1 in general", () => {
    let differ = 0;
    for (const s of states().slice(0, 4)) {
      const a = fill("I2R1", B, s), b = fill("I2R", B1, s), c2 = fill("I2", B1, s), d = fill("I2RO1", B, s), e = fill("I2RO", B1, s);
      each(sides(s).me.mask, (c, p) => {
        const k = c * 64 + p;
        expect(a[k]).toBe(b[k]); expect(c2[k]).toBeCloseTo(b[k], 12); expect(d[k]).toBe(e[k]);
        expect(d[k]).toBeGreaterThanOrEqual(0); expect(d[k]).toBeLessThanOrEqual(1);
        if (Math.abs(a[k] - d[k]) > 1e-9) differ++;
      });
    }
    expect(differ).toBeGreaterThan(0);
  });
});
