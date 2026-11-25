import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import manifest from "../src/dp-manifest.json";
import { createGame, transition, categories, total, type Game, type Card } from "../src/engine";
import { setDPTable, dpFutureValue, dpDecision } from "../src/dp";
import { winDPDecision } from "../src/win-dp";
import { analyzeExactLastTurn } from "../src/research-last-turn-br";
import { PolicyPmfBank, turnOutcomes, winCredit } from "../src/research-v5/policy-pmf";
import { canonicalUpper, popcount } from "../src/research-v5/kernel";
import { endgameValue, winDPv5Decision, clearEndgameMemo, maxGain, type V5Config } from "../src/research-v5/apex";
import { winDPv2Decision } from "../src/competitive-v2";

const buf = gunzipSync(readFileSync("public/ai/" + manifest.asset));
const T = new Float64Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
setDPTable(T.buffer.slice(0) as ArrayBuffer);
const W = (m: number, u: number) => T[m * 64 + u];
let bank: PolicyPmfBank;
let cfg: V5Config;
beforeAll(() => {
  bank = new PolicyPmfBank("DP Expert", W).build(4);
  cfg = { bank, dpValue: W, endgame: "minimax", minimaxWindow: 3, v2: winDPv2Decision, dpDecision };
}, 60_000);

/** Scorecard with exactly `open` categories empty; others filled with `fill(i)`. */
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
const maskOf = (c: Card) => categories.reduce((m, k, i) => (c[k] === undefined ? m | (1 << i) : m), 0);

describe("v5 exact policy PMF bank", () => {
  it("canonical upper compression never changes the DP Expert value", () => {
    for (let m = 0; m < 4096; m += 7) for (let u = 0; u < 64; u++) expect(T[m * 64 + canonicalUpper(m, u)]).toBe(T[m * 64 + u]);
  });
  it("every built PMF sums to 1 and its mean equals the DP Expert expected future value", () => {
    let maxMass = 0, maxMean = 0, n = 0;
    for (let m = 0; m < 4096; m++) {
      if (popcount(m) > 4) continue;
      for (let u = 0; u < 64; u += 3) {
        const p = bank.get(m, u);
        let s = 0, mu = 0;
        for (let g = 0; g < p.length; g++) { s += p[g]; mu += g * p[g]; expect(p[g]).toBeGreaterThanOrEqual(0); }
        maxMass = Math.max(maxMass, Math.abs(s - 1)); maxMean = Math.max(maxMean, Math.abs(mu - dpFutureValue(m, u))); n++;
      }
    }
    expect(n).toBeGreaterThan(3000);
    expect(maxMass).toBeLessThan(1e-12);
    expect(maxMean).toBeLessThan(1e-9);
  });
  it("one-turn outcome distribution is a probability distribution over legal categories", () => {
    const mask = (1 << 6) | (1 << 11) | (1 << 2);
    const t = turnOutcomes(mask, 40, W);
    let s = 0;
    for (let i = 0; i < t.keys.length; i++) { s += t.prob[i]; expect(mask & (1 << (t.keys[i] >> 6))).toBeTruthy(); }
    expect(Math.abs(s - 1)).toBeLessThan(1e-13);
  });
  it("win credit of two identical independent PMFs is exactly 0.5", () => {
    const p = bank.get((1 << 6) | (1 << 11), 0);
    expect(winCredit(100, p, 100, p)).toBeCloseTo(0.5, 12);
  });
});

describe("v5 exact interactive endgame solver", () => {
  it("is symmetric for mirrored last-category positions with yacht (no information advantage)", () => {
    clearEndgameMemo();
    expect(endgameValue(1 << 11, 0, 1 << 11, 0, 0)).toBeCloseTo(0.5, 12);
  });
  it("prunes only decided positions", () => {
    expect(endgameValue(1 << 6, 0, 1 << 9, 0, 16)).toBe(1); // opponent can add at most 15
    expect(endgameValue(1 << 9, 0, 1 << 6, 0, -16)).toBe(0); // mover can add at most 15
    expect(maxGain((1 << 0) | (1 << 5), 30)).toBe(35 + 35);
    expect(maxGain((1 << 0) | (1 << 5), 10)).toBe(35);
  });
  it("matches the independent exact final-turn BR (research-last-turn-br) for player 0 in 1v1", () => {
    for (const seed of [11, 222, 3333, 44444]) {
      const s = state(seed, card(["choice"], (i) => (i < 6 ? 3 * (i + 1) : 20)), card(["full"], (i) => (i < 6 ? 3 * (i + 1) : 18)), 0);
      const ref = analyzeExactLastTurn(s)!;
      const v5 = winDPv5Decision(s, cfg);
      expect(v5.stage).toBe("minimax");
      expect(Math.abs(v5.value - ref.optimalWin)).toBeLessThan(1e-9);
    }
  });
  it("matches Win DP (v1) on player 1's last turn: same win value", () => {
    for (const seed of [5, 55, 555]) {
      const s = state(seed, card(["four"], (i) => (i < 6 ? 3 * (i + 1) : 21)), card([], (i) => (i < 6 ? 3 * (i + 1) : 24)), 1);
      const ref = winDPDecision(s)!;
      const v5 = winDPv5Decision(s, cfg);
      expect(Math.abs(v5.value - ref.value)).toBeLessThan(1e-9);
    }
  });
  it("Monte Carlo of self-play agrees with the exact 2v2 value", () => {
    clearEndgameMemo();
    const me = card(["choice", "small"], (i) => (i < 6 ? 3 * (i + 1) : 20)), opp = card(["four", "large"], (i) => (i < 6 ? 3 * (i + 1) : 20));
    const exact = endgameValue(maskOf(me), 63, maskOf(opp), 63, total(me) - total(opp));
    let credit = 0;
    const N = 1500;
    for (let i = 0; i < N; i++) {
      let s = createGame(1000 + i, true);
      s.cards = [{ ...me }, { ...opp }];
      while (!s.done) {
        if (!s.rolls) { s = transition(s, { type: "roll" }); continue; }
        const d = winDPv5Decision(s, cfg);
        s = d.type === "score" ? transition(s, { type: "score", category: d.category }) : transition(transition(s, { type: "hold", ids: d.ids }), { type: "roll" });
      }
      const a = total(s.cards[0]), b = total(s.cards[1]);
      credit += a > b ? 1 : a === b ? 0.5 : 0;
    }
    const se = Math.sqrt(exact * (1 - exact) / N);
    expect(Math.abs(credit / N - exact)).toBeLessThan(4 * se + 0.005);
  }, 60_000);
});

describe("v5 decision fairness and analysis interface", () => {
  it("ignores hidden seed / RNG state", () => {
    const s = state(99, card(["choice", "yacht", "sixes"], (i) => (i < 6 ? 3 * (i + 1) : 20)), card(["four", "large", "fives"], (i) => (i < 6 ? 3 * (i + 1) : 19)), 0);
    const a = winDPv5Decision(s, cfg), b = winDPv5Decision({ ...s, seed: 12345, rng: [7, 8] }, cfg);
    expect(JSON.stringify(a.analysis)).toBe(JSON.stringify(b.analysis));
  });
  it("rollout stage lists all legal actions with win credit, expected final and loss vs best", () => {
    const s = state(7, card(["choice", "yacht", "sixes", "full"], (i) => (i < 6 ? 3 * (i + 1) : 20)), card(["four", "large", "fives", "small"], (i) => (i < 6 ? 3 * (i + 1) : 19)), 0);
    const d = winDPv5Decision(s, cfg);
    expect(d.stage).toBe("rollout");
    expect(d.analysis.filter((a) => a.kind === "score").length).toBe(4);
    for (const a of d.analysis) { expect(a.winCredit).toBeGreaterThanOrEqual(-1e-12); expect(a.winCredit).toBeLessThanOrEqual(1 + 1e-12); expect(a.lossVsBest!).toBeGreaterThanOrEqual(0); }
    expect(d.analysis[0].lossVsBest).toBe(0);
  });
});

import { analyzePosition, rerollDistribution } from "../src/research-v5/analysis";
describe("v5 review analysis interface", () => {
  it("reports actions, played-action loss, exact score-difference PMF and accuracy label", () => {
    const s = state(31, card(["choice", "yacht", "sixes"], (i) => (i < 6 ? 3 * (i + 1) : 20)), card(["four", "large", "fives"], (i) => (i < 6 ? 3 * (i + 1) : 19)), 0);
    const a = analyzePosition(s, cfg, undefined, { type: "score", category: "choice" });
    expect(a.stage).toBe("minimax");
    expect(a.accuracy.kind).toBe("exact");
    expect(a.played!.winCreditLoss).toBeGreaterThanOrEqual(0);
    const mass = a.scoreDiff.pmf.reduce((x, y) => x + y, 0);
    expect(Math.abs(mass - 1)).toBeLessThan(1e-12);
    const mean = a.scoreDiff.pmf.reduce((x, p, i) => x + p * (a.scoreDiff.offset + i), 0);
    expect(mean).toBeCloseTo(a.expectedFinal.me - a.expectedFinal.opponent, 9);
  });
  it("exact re-roll distribution sums to one", () => {
    const d = rerollDistribution([6, 6]);
    expect(d.reduce((x, y) => x + y.p, 0)).toBeCloseTo(1, 14);
    expect(d.find((x) => x.dice.join("") === "66666")!.p).toBeCloseTo(1 / 216, 14);
  });
});
