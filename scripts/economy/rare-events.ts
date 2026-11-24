/**
 * Economy study — rare-achievement probabilities that plain Monte Carlo cannot observe.
 *  1) exact closed forms / binomial (first-roll yacht counts, etc.)
 *  2) exact turn-level and whole-game pattern DP (src/economy/dice-exact.ts)
 *  3) importance sampling with a cross-entropy-tuned face distribution for P(total ≥ T) under DP Expert,
 *     validated against plain Monte Carlo at thresholds where MC has hits.
 * Output: src/economy/data/rare-events.json. Usage: npx tsx scripts/economy/rare-events.ts [isGames=20000]
 */
import { writeFileSync } from "node:fs";
import { categories, score, total, type Card, type Game } from "../../src/engine";
import { dpActionValues } from "../../src/dp";
import * as X from "../../src/economy/dice-exact";
import { loadDPTable, policyRng } from "./policies";

const IS_GAMES = Number(process.argv[2] ?? 20000);
loadDPTable();
const started = performance.now();
const yacht = (m: number[]) => m.every((v) => v === m[0]);
const all = (f: number) => (m: number[]) => m.every((v) => v === f);

// ---------- 1+2: exact ----------
const pFirstYacht = X.firstRollProbability(yacht); // 6/7776
const exact = {
  firstRollYacht: { perRoll: pFirstYacht, perGameAtLeast1: X.binomTail(12, pFirstYacht, 1), perGameAtLeast2: X.binomTail(12, pFirstYacht, 2), perGameAtLeast3: X.binomTail(12, pFirstYacht, 3), note: "12 first rolls per game, independent of policy" },
  firstRollLarge: { perRoll: X.firstRollProbability((m) => score(m, "large") === 30) },
  firstRollSixesYacht: { perRoll: X.firstRollProbability(all(6)) },
  turnYachtOptimal: X.turnTargetProbability(yacht),
  turnLargeOptimal: X.turnTargetProbability((m) => score(m, "large") === 30),
  turnSixesYachtOptimal: X.turnTargetProbability(all(6)),
  perfectGame323: X.gamePatternProbability({
    aces: all(1), deuces: all(2), threes: all(3), fours: all(4), fives: all(5), sixes: all(6),
    choice: all(6), four: all(6), full: (m) => score(m, "full") === 28, small: (m) => score(m, "small") === 15, large: (m) => score(m, "large") === 30, yacht,
  }),
  perfectUpper105: X.gamePatternProbability({
    aces: all(1), deuces: all(2), threes: all(3), fours: all(4), fives: all(5), sixes: all(6),
    choice: () => true, four: () => true, full: () => true, small: () => true, large: () => true, yacht: () => true,
  }),
  noZeroGameOptimal: X.gamePatternProbability({
    aces: (m) => m.includes(1), deuces: (m) => m.includes(2), threes: (m) => m.includes(3), fours: (m) => m.includes(4), fives: (m) => m.includes(5), sixes: (m) => m.includes(6),
    choice: () => true, four: (m) => score(m, "four") > 0, full: (m) => score(m, "full") > 0, small: (m) => score(m, "small") > 0, large: (m) => score(m, "large") > 0, yacht,
  }),
  allSpecialsOptimal: X.gamePatternProbability({
    aces: () => true, deuces: () => true, threes: () => true, fours: () => true, fives: () => true, sixes: () => true, choice: () => true,
    four: (m) => score(m, "four") > 0, full: (m) => score(m, "full") > 0, small: (m) => score(m, "small") > 0, large: (m) => score(m, "large") > 0, yacht,
  }),
  perfectTotal: X.PERFECT_TOTAL,
  note: "*Optimal values are the maximum probability achievable by a player who plays only for that goal; a normal (score-maximizing) player has a lower probability.",
};
console.log("exact done", ((performance.now() - started) / 1000).toFixed(1) + "s");

// ---------- 3: importance sampling under DP Expert ----------
function rollFace(q: number[], r: number) { let c = 0; for (let f = 0; f < 6; f++) { c += q[f]; if (r < c) return f + 1; } return 6; }
/** One solo DP Expert game (score-maximizing) with dice drawn from q; returns total and log likelihood ratio. */
function soloGame(q: number[], rand: () => number) {
  const card: Card = {};
  let logW = 0;
  const counts = [0, 0, 0, 0, 0, 0];
  const lr = q.map((x) => Math.log(1 / 6 / x));
  const roll = () => { const f = rollFace(q, rand()); logW += lr[f - 1]; counts[f - 1]++; return f; };
  for (let turn = 0; turn < 12; turn++) {
    let dice = [0, 1, 2, 3, 4].map(() => roll());
    let rolls = 1;
    for (;;) {
      const g = { dice: dice.map((value, id) => ({ id, value, held: false })), cards: [card, {}], player: 0, rolls, done: false } as unknown as Game;
      const v = dpActionValues(g);
      let best = 0;
      for (let i = 1; i < v.length; i++) if (v[i] > v[best]) best = i;
      if (best >= 32) { const c = categories[best - 32]; card[c] = score(dice, c); break; }
      dice = dice.map((d, i) => (best & (1 << i) ? d : roll()));
      rolls++;
    }
  }
  return { total: total(card), logW, counts };
}
const THRESHOLDS = [220, 250, 270, 290, 300, 310];
const uniform = [1, 1, 1, 1, 1, 1].map(() => 1 / 6);
// plain MC reference
const mcRand = policyRng(91_000_001);
const mcN = IS_GAMES;
const mcTotals: number[] = [];
for (let i = 0; i < mcN; i++) mcTotals.push(soloGame(uniform, mcRand).total);
const mc = Object.fromEntries(THRESHOLDS.map((t) => { const h = mcTotals.filter((x) => x >= t).length; return [t, { p: h / mcN, hits: h, games: mcN }]; }));
console.log("mc done", ((performance.now() - started) / 1000).toFixed(1) + "s", mc);
// cross-entropy tuning of the face distribution, per target threshold
const isResults: Record<string, unknown> = {};
for (const T of [250, 270, 290]) {
  let q = [...uniform];
  const ceRand = policyRng(92_000_000 + T);
  const ceLog: { q: number[]; level: number }[] = [];
  for (let it = 0; it < 8; it++) {
    const samples = Array.from({ length: 2000 }, () => soloGame(q, ceRand));
    const sorted = samples.map((s) => s.total).sort((a, b) => b - a);
    const level = Math.min(T, sorted[Math.floor(0.1 * samples.length)]);
    const counts = Array(6).fill(1e-12);
    for (const s of samples) {
      if (s.total < level) continue;
      const w = Math.exp(s.logW);
      s.counts.forEach((c, f) => (counts[f] += w * c));
    }
    const z = counts.reduce((a, b) => a + b, 0);
    q = q.map((old, f) => 0.3 * old + 0.7 * (counts[f] / z));
    q = q.map((x) => Math.max(x, 0.02));
    const zz = q.reduce((a, b) => a + b, 0);
    q = q.map((x) => x / zz);
    ceLog.push({ q: q.map((x) => Number(x.toFixed(4))), level });
  }
  const isRand = policyRng(94_000_000 + T);
  let s1 = 0, s2 = 0, hits = 0;
  for (let i = 0; i < IS_GAMES; i++) {
    const g = soloGame(q, isRand);
    const w = g.total >= T ? Math.exp(g.logW) : 0;
    if (w > 0) hits++;
    s1 += w; s2 += w * w;
  }
  const p = s1 / IS_GAMES, se = Math.sqrt(Math.max(0, s2 / IS_GAMES - p * p) / IS_GAMES);
  isResults[T] = { p, se, relErr: p > 0 ? se / p : null, ci95: [Math.max(0, p - 1.96 * se), p + 1.96 * se], hitsUnderQ: hits, games: IS_GAMES, q: q.map((x) => Number(x.toFixed(4))), ceLog };
  console.log("IS", T, p, se, ((performance.now() - started) / 1000).toFixed(1) + "s");
}
const out = {
  generatedBy: "scripts/economy/rare-events.ts",
  policyForTail: "DP Expert (score-maximizing, solo) — tail probability of a single player's total",
  exact,
  monteCarlo: mc,
  importanceSampling: isResults,
  method: "Cross-entropy method tunes a non-uniform face distribution q (6 params, floor 0.02); estimate = mean of 1{total≥T}·Π(1/6)/q(face). Policy still assumes fair dice, so it is unchanged. Validation: compare IS vs MC at T=250/270 where MC has hits.",
  seeds: "policyRng 91,000,001 (MC), 92–94,000,000+T (CE/IS); economy-study development seeds, not a holdout",
  runtimeSeconds: (performance.now() - started) / 1000,
};
writeFileSync("src/economy/data/rare-events.json", JSON.stringify(out, null, 1));
console.log("done", out.runtimeSeconds);
