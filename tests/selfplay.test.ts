import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import manifest from "../src/dp-manifest.json";
import { dpActionValue, dpDecision, setDPTable } from "../src/dp";
import { categories, available, createGame, transition, type Card, type Game } from "../src/engine";
import { FEATURE_NAMES, ZERO_RESIDUAL_WEIGHTS, residualDecision, residualCandidates, publicProjectedGap } from "../src/selfplay-residual";
import { opponentForecastPayoff, winDPv3Decision } from "../src/competitive-v3";

beforeAll(() => {
  const b = gunzipSync(readFileSync("public/ai/" + manifest.asset));
  setDPTable(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

describe("full-game self-play residual policy", () => {
  it("must use exactly public observations; invalid private random stream does not affect it", () => {
    const state = transition(createGame(4321, true), { type: "roll" });
    const weights = Array.from({ length: FEATURE_NAMES.length }, (_, i) => .25 * Math.sin(i * 7));
    const first = residualDecision(state, weights);
    const changed = { ...state, rng: [99999, 1234] as [number, number], seed: 8642 };
    expect(residualDecision(changed, weights)).toEqual(first);
    expect(residualCandidates(changed)).toEqual(residualCandidates(state));
    expect(publicProjectedGap(changed)).toEqual(publicProjectedGap(state));
    const q = dpActionValue(state, first.decision);
    expect(Number.isFinite(q)).toBe(true);
    expect(first.gradient).toHaveLength(FEATURE_NAMES.length);
    expect(first.probability).toBeGreaterThan(0);
  });
  it("zero weights preserve DP score-optimal choices within the model's legal action budget", () => {
    for (const seed of [12, 13, 14]) {
      let state = transition(createGame(seed, true), { type: "roll" });
      for (const rolls of [1, 2, 3]) {
        const s: Game = { ...state, rolls };
        const result = residualDecision(s, ZERO_RESIDUAL_WEIGHTS, { useEndgameDP: false });
        expect(dpActionValue(s, result.decision)).toBeCloseTo(dpDecision(s).value, 7);
      }
    }
  });
  it("stochastic REINFORCE action returns finite policy gradient of correct dimension", () => {
    const s = transition(createGame(202612, true), { type: "roll" });
    const weights = ZERO_RESIDUAL_WEIGHTS.map((x, i) => x + .1 * i);
    const result = residualDecision(s, weights, { sample: true, rng: () => .251 });
    expect(result.gradient).toHaveLength(FEATURE_NAMES.length);
    expect(result.gradient.every(Number.isFinite)).toBe(true);
    expect(result.probability).toBeGreaterThan(0);
    expect(result.probability).toBeLessThanOrEqual(1);
    expect(Number.isFinite(dpActionValue(s, result.decision))).toBe(true);
    expect(() => residualDecision(s, weights.slice(0, 3))).toThrow();
  });
});

describe("Win DP v3 research solver", () => {
  it("Gaussian opponent forecast is bounded, monotone and independent of private RNG", () => {
    const own:Card = Object.fromEntries(categories.filter(c => !["yacht", "choice", "large"].includes(c)).map(c => [c, 0]));
    const other:Card = Object.fromEntries(categories.filter(c => !["choice", "sixes", "full"].includes(c)).map(c => [c, 0]));
    const state:Game = { ...createGame(10, true), cards: [own, other], player: 0, round: 10, rolls: 1,
      dice: [1, 2, 3, 4, 6].map((value, id) => ({ id, value, held: false })) };
    const model = opponentForecastPayoff(state);
    expect(model.sigma).toBeGreaterThan(0);
    expect(model.payoff(100)).toBeLessThanOrEqual(model.payoff(200));
    expect(model.payoff(100)).toBeGreaterThanOrEqual(0);
    expect(model.payoff(200)).toBeLessThanOrEqual(1);
    const altered = { ...state, seed: 200, rng: [11, 12] as [number, number] };
    expect(opponentForecastPayoff(altered).mean).toBeCloseTo(model.mean, 10);
  });
  it("exact last-three-category own Bellman returns a legal decision", () => {
    const own:Card = Object.fromEntries(categories.filter(c => !["choice", "small", "yacht"].includes(c)).map(c => [c, 0]));
    const other:Card = Object.fromEntries(categories.filter(c => !["deuces", "four", "large"].includes(c)).map(c => [c, 0]));
    const state:Game = { ...createGame(116, true), cards: [own, other], player: 0, round: 10, rolls: 1,
      dice: [1, 3, 4, 5, 6].map((value, id) => ({ id, value, held: false })) };
    const result = winDPv3Decision(state)!;
    expect(result.note).toContain("Win DP v3");
    expect(result.value).toBeGreaterThanOrEqual(0);
    expect(result.value).toBeLessThanOrEqual(1);
    if (result.type === "score") expect(available(own)).toContain(result.category);
    else expect(result.ids.every(id => id >= 0 && id < 5)).toBe(true);
    const second = winDPv3Decision({ ...state, seed: 999, rng: [999, 777] });
    expect(second).toEqual(result);
  }, 90000);
});
