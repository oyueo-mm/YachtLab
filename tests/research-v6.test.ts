import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import manifest from "../src/dp-manifest.json";
import { createGame, transition, categories, type Game, type Card } from "../src/engine";
import { setDPTable, dpDecision } from "../src/dp";
import { PolicyPmfBank } from "../src/research-v5/policy-pmf";
import { canonicalUpper, popcount } from "../src/research-v5/kernel";
import { winDPv5Decision, type V5Config } from "../src/research-v5/apex";
import { winDPv2Decision } from "../src/competitive-v2";
import { RiskPolicy, buildRiskBank } from "../src/research-v6/risk";
import { winDPv6Decision, clearV6Cache, type V6Config } from "../src/research-v6/apex6";
import { analyzeV6 } from "../src/research-v6/analysis6";

const buf = gunzipSync(readFileSync("public/ai/" + manifest.asset));
const T = new Float64Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
setDPTable(T.buffer.slice(0) as ArrayBuffer);
const W = (m: number, u: number) => T[m * 64 + u];
const K = 4;
let dpBank: PolicyPmfBank;
const risk: Record<string, { pol: RiskPolicy; bank: PolicyPmfBank }> = {};
let v5: V5Config;
let v6: V6Config;
beforeAll(() => {
  dpBank = new PolicyPmfBank("DP Expert", W).build(K);
  for (const lam of [0, -0.04, 0.04]) {
    const pol = new RiskPolicy(lam).build(K);
    risk[lam] = { pol, bank: buildRiskBank(pol, `exp(${lam})`, K) };
  }
  v5 = { bank: dpBank, dpValue: W, endgame: "none", v2: winDPv2Decision, dpDecision };
  v6 = { ...v5, banks: [dpBank, risk[-0.04].bank, risk[0.04].bank] };
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
const OPEN = [["aces", "fours", "full"], ["sixes", "yacht", "choice"], ["deuces", "large", "four", "threes"], ["fives", "small"]];
const maskOfCard = (c: Card) => categories.reduce((m, k, i) => (c[k] === undefined ? m | (1 << i) : m), 0);
const randomStates = () => {
  const out: Game[] = [];
  for (let i = 0; i < 24; i++) {
    const mine = OPEN[i % 4], theirs = OPEN[(i + 1) % 4];
    const st = state(1000 + i, card(mine, (j) => (j < 6 ? (j + 1) * 3 : 18 + ((i * 7 + j) % 9))), card(theirs, (j) => (j < 6 ? (j + 1) * 3 : 17 + ((i * 5 + j) % 11))), (i % 2) as 0 | 1);
    expect(popcount(maskOfCard(st.cards[st.player]))).toBe(mine.length);
    out.push(st);
  }
  return out;
};

describe("v6 exponential-utility policy family", () => {
  it("lambda = 0 reproduces the DP Expert table and PMF bank bit for bit", () => {
    const { pol, bank } = risk[0];
    let n = 0;
    for (let m = 0; m < 4096; m++) {
      if (popcount(m) > K) continue;
      for (let u = 0; u < 64; u++) {
        expect(pol.Z[m * 64 + u]).toBe(T[m * 64 + u]);
        const a = bank.get(m, u), b = dpBank.get(m, u);
        expect(a.length).toBe(b.length);
        for (let g = 0; g < a.length; g++) expect(a[g]).toBe(b[g]);
        n++;
      }
    }
    expect(n).toBeGreaterThan(30000);
  });
  it("risk banks are distributions whose exp-moment equals the policy value and is optimal", () => {
    for (const lam of [-0.04, 0.04]) {
      const { pol, bank } = risk[lam];
      let maxRel = 0, viol = 0;
      for (let m = 1; m < 4096; m++) {
        if (popcount(m) > K) continue;
        for (let u = 0; u < 64; u += 5) {
          if (canonicalUpper(m, u) !== u) continue;
          const p = bank.get(m, u), q = dpBank.get(m, u);
          let mass = 0, mom = 0, momDP = 0;
          for (let g = 0; g < p.length; g++) { expect(p[g]).toBeGreaterThanOrEqual(0); mass += p[g]; mom += p[g] * Math.exp(lam * g); }
          for (let g = 0; g < q.length; g++) momDP += q[g] * Math.exp(lam * g);
          expect(Math.abs(mass - 1)).toBeLessThan(1e-12);
          maxRel = Math.max(maxRel, Math.abs(mom / pol.Z[m * 64 + u] - 1));
          // the lambda policy is optimal for its own utility: never worse than DP Expert under that utility
          if (Math.sign(lam) * (mom - momDP) < -1e-12 * momDP) viol++;
        }
      }
      expect(maxRel).toBeLessThan(1e-10);
      expect(viol).toBe(0);
    }
  });
});

describe("v6 decision engine", () => {
  it("policy-set rollout with only the DP Expert bank is identical to v5-R", () => {
    for (const s of randomStates()) {
      clearV6Cache();
      const a = winDPv5Decision(s, v5), b = winDPv6Decision(s, { ...v5, banks: [dpBank] });
      expect(b.type).toBe(a.type);
      expect(b.value).toBe(a.value);
      if (a.type === "score" && b.type === "score") expect(b.category).toBe(a.category);
    }
  });
  it("model values are ordered: v5-R <= policy-set <= full-horizon best response", () => {
    for (const s of randomStates()) {
      clearV6Cache();
      const r = winDPv5Decision(s, v5).value;
      clearV6Cache();
      const p = winDPv6Decision(s, v6).value;
      clearV6Cache();
      const br = winDPv6Decision(s, { ...v6, brWindow: 12 }).value;
      expect(p).toBeGreaterThanOrEqual(r - 1e-12);
      expect(br).toBeGreaterThanOrEqual(p - 1e-12);
      expect(br).toBeLessThanOrEqual(1 + 1e-12);
    }
  });
  it("never reads the RNG: changing seed / rng leaves the decision unchanged", () => {
    for (const s of randomStates().slice(0, 6)) {
      clearV6Cache();
      const a = winDPv6Decision(s, { ...v6, brWindow: 12 });
      clearV6Cache();
      const b = winDPv6Decision({ ...s, seed: 12345, rng: [7, 9] }, { ...v6, brWindow: 12 });
      expect(b).toEqual(a);
    }
  });
  it("versioned v6 analysis lists every legal action with model, exactness and loss", () => {
    const s = randomStates()[2];
    const r = analyzeV6(s, { ...v6, brWindow: 12 }, { name: "test", depth: 1, brWindow: 12, minimaxWindow: 0, budgetMs: 1000 });
    expect(r.schema).toBe("yachtlab-analysis-v6");
    expect(r.actions.length).toBeGreaterThan(3);
    expect(r.actions[0].lossVsBest).toBe(0);
    for (const a of r.actions) expect(a.winCredit).toBeGreaterThanOrEqual(0);
    expect(r.exactness.kind).toBe("exact-vs-fixed-opponent-distribution");
    expect(r.best.tiedActions.length).toBeGreaterThanOrEqual(1);
    for (const a of r.actions) {
      expect(a.pWin! + a.pTie! + a.pLoss!).toBeCloseTo(1, 10);
      expect(a.pWin! + a.pTie! / 2).toBeCloseTo(a.winCredit, 10);
    }
    expect(r.preRollValue).toBeGreaterThan(0);
  });
});
