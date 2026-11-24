/**
 * Economy study — generate real game data with the existing engine + DP-based skill-tier policies.
 * Output: src/economy/data/match-events.json (per-tier per-match event probabilities, score
 * histograms, cross-tier win matrix). Reproducible: fixed seeds, no wall-clock randomness.
 *
 * Usage: npx tsx scripts/economy/generate-match-data.ts [mirrorGames=20000] [crossGames=3000]
 * Seeds: economy-study development seeds 71,000,000+ (NOT a holdout; used for design only).
 */
import { writeFileSync } from "node:fs";
import { createGame, transition, total, upper, categories, type Game } from "../../src/engine";
import { loadDPTable, policyRng, softDPAction, type Tier } from "./policies";

export const TIERS: Tier[] = [
  { id: "beginner", label: "입문", tau: 2.5 },
  { id: "casual", label: "초급", tau: 1.6 },
  { id: "intermediate", label: "중급", tau: 1.0 },
  { id: "strong", label: "숙련", tau: 0.5 },
  { id: "expert", label: "전문가(DP Expert)", tau: 0 },
];
const mirrorGames = Number(process.argv[2] ?? 20000);
const crossGames = Number(process.argv[3] ?? 3000);
const SEED_BASE = 71_000_000;

type Rec = Record<string, number>;
const isYacht = (v: number[]) => v.every((x) => x === v[0]);
const isLarge = (v: number[]) => { const s = [...v].sort().join(""); return s === "12345" || s === "23456"; };

function playMatch(seed: number, tiers: [Tier, Tier], rand: () => number): [Rec, Rec] {
  let s: Game = createGame(seed, true);
  const rec: Rec[] = [0, 1].map(() => ({ firstRollYacht: 0, yachtSeen: 0, oneRollScores: 0, largeFirstRoll: 0, yachtFace: 0, finalRoundYacht: 0 }));
  let seenThisTurn = false;
  let diffAfter9: number | null = null;
  while (!s.done) {
    const p = s.player;
    if (!s.rolls) {
      s = transition(s, { type: "roll" });
      const v = s.dice.map((d) => d.value);
      seenThisTurn = false;
      if (isYacht(v)) { rec[p].firstRollYacht++; rec[p].yachtSeen++; seenThisTurn = true; }
      if (isLarge(v)) rec[p].largeFirstRoll++;
      continue;
    }
    const a = softDPAction(s, tiers[p].tau, rand);
    if (a.kind === "score") {
      const v = s.dice.map((d) => d.value);
      if (s.rolls === 1) rec[p].oneRollScores++;
      if (a.category === "yacht" && isYacht(v)) { rec[p].yachtFace = v[0]; if (s.round === 12) rec[p].finalRoundYacht = 1; }
      s = transition(s, { type: "score", category: a.category });
      if (p === 1 && diffAfter9 === null && Object.keys(s.cards[1]).length === 9) diffAfter9 = total(s.cards[0]) - total(s.cards[1]);
    } else {
      s = transition(s, { type: "hold", ids: a.ids });
      s = transition(s, { type: "roll" });
      if (!seenThisTurn && isYacht(s.dice.map((d) => d.value))) { rec[p].yachtSeen++; seenThisTurn = true; }
    }
  }
  const tot = [total(s.cards[0]), total(s.cards[1])];
  for (const p of [0, 1] as const) {
    const c = s.cards[p], r = rec[p], o = 1 - p;
    const margin = tot[p] - tot[o];
    const behind9 = diffAfter9 === null ? 0 : p === 0 ? -diffAfter9 : diffAfter9;
    r.total = tot[p];
    r.margin = margin;
    r.win = margin > 0 ? 1 : 0;
    r.draw = margin === 0 ? 1 : 0;
    r.upperSum = upper(c);
    r.upperBonus = upper(c) >= 63 ? 1 : 0;
    r.upperPerfectPath = categories.slice(0, 6).every((k, i) => (c[k] ?? 0) >= 3 * (i + 1)) ? 1 : 0;
    r.yachtScored = (c.yacht ?? 0) > 0 ? 1 : 0;
    r.largeScored = (c.large ?? 0) > 0 ? 1 : 0;
    r.smallScored = (c.small ?? 0) > 0 ? 1 : 0;
    r.fullScored = (c.full ?? 0) > 0 ? 1 : 0;
    r.fourScored = (c.four ?? 0) > 0 ? 1 : 0;
    r.sixesMax = (c.sixes ?? 0) === 30 ? 1 : 0;
    r.choice28 = (c.choice ?? 0) >= 28 ? 1 : 0;
    r.zeros = categories.filter((k) => c[k] === 0).length;
    r.noZero = r.zeros === 0 ? 1 : 0;
    r.comeback30 = r.win && behind9 >= 30 ? 1 : 0;
    r.behind30at9 = behind9 >= 30 ? 1 : 0;
    r.tightWin = r.win && margin <= 5 ? 1 : 0;
    r.winBy100 = margin >= 100 ? 1 : 0;
    for (const t of [150, 180, 200, 220, 250, 270, 290]) r["t" + t] = tot[p] >= t ? 1 : 0;
  }
  return [rec[0], rec[1]];
}

const EVENT_KEYS = [
  "win", "draw", "upperBonus", "upperPerfectPath", "yachtScored", "largeScored", "smallScored", "fullScored", "fourScored",
  "sixesMax", "choice28", "noZero", "comeback30", "behind30at9", "tightWin", "winBy100",
  "t150", "t180", "t200", "t220", "t250", "t270", "t290", "finalRoundYacht",
] as const;
const COUNT_KEYS = ["firstRollYacht", "yachtSeen", "oneRollScores", "largeFirstRoll", "zeros"] as const;

function summarize(recs: Rec[]) {
  const n = recs.length;
  const events: Record<string, { p: number; hits: number; ci95: [number, number] }> = {};
  for (const k of EVENT_KEYS) {
    const hits = recs.reduce((a, r) => a + r[k], 0), p = hits / n;
    // Wilson interval (valid for small hit counts)
    const z = 1.96, d = 1 + (z * z) / n, c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
    events[k] = { p, hits, ci95: [Math.max(0, c - h), Math.min(1, c + h)] };
  }
  const counts: Record<string, { mean: number; atLeast1: number; atLeast2: number }> = {};
  for (const k of COUNT_KEYS) counts[k] = { mean: recs.reduce((a, r) => a + r[k], 0) / n, atLeast1: recs.filter((r) => r[k] >= 1).length / n, atLeast2: recs.filter((r) => r[k] >= 2).length / n };
  const totals = recs.map((r) => r.total).sort((a, b) => a - b);
  const q = (x: number) => totals[Math.min(n - 1, Math.floor(x * n))];
  const mean = totals.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(totals.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const hist: number[] = Array(34).fill(0); // 10-point bins 0..339
  for (const t of totals) hist[Math.min(33, Math.floor(t / 10))]++;
  const yachtFaces = [1, 2, 3, 4, 5, 6].map((f) => recs.filter((r) => r.yachtFace === f).length / n);
  return { n, meanTotal: mean, sdTotal: sd, quantiles: { p01: q(0.01), p10: q(0.1), p50: q(0.5), p90: q(0.9), p99: q(0.99), max: totals[n - 1] }, events, counts, hist, yachtFacePerMatch: yachtFaces };
}

loadDPTable();
const started = performance.now();
const tierResults: Record<string, ReturnType<typeof summarize>> = {};
let pairIndex = 0;
for (const t of TIERS) {
  const rand = policyRng(SEED_BASE + pairIndex * 7919 + 1);
  const recs: Rec[] = [];
  for (let g = 0; g < mirrorGames; g++) {
    const [a, b] = playMatch(SEED_BASE + pairIndex * 1_000_000 + g, [t, t], rand);
    recs.push(a, b);
  }
  tierResults[t.id] = summarize(recs);
  console.log(t.id, tierResults[t.id].meanTotal.toFixed(2), ((performance.now() - started) / 1000).toFixed(0) + "s");
  pairIndex++;
}
const cross: Record<string, Record<string, { games: number; scoreRate: number; ci95: [number, number]; meanMargin: number; winBy100: number }>> = {};
for (let i = 0; i < TIERS.length; i++) for (let j = i + 1; j < TIERS.length; j++) {
  const A = TIERS[i], B = TIERS[j];
  const rand = policyRng(SEED_BASE + pairIndex * 7919 + 1);
  let sA = 0, mA = 0, w100A = 0, w100B = 0;
  const xs: number[] = [];
  for (let g = 0; g < crossGames; g++) {
    const swap = g % 2 === 1; // alternate seats (first/second player)
    const [r0, r1] = playMatch(SEED_BASE + pairIndex * 1_000_000 + g, swap ? [B, A] : [A, B], rand);
    const ra = swap ? r1 : r0;
    const x = ra.win + 0.5 * ra.draw;
    xs.push(x); sA += x; mA += ra.margin; w100A += ra.winBy100; w100B += (swap ? r0 : r1).winBy100;
  }
  const p = sA / crossGames, sd = Math.sqrt(xs.reduce((a, x) => a + (x - p) ** 2, 0) / (crossGames - 1));
  const h = 1.96 * sd / Math.sqrt(crossGames);
  (cross[A.id] ??= {})[B.id] = { games: crossGames, scoreRate: p, ci95: [p - h, p + h], meanMargin: mA / crossGames, winBy100: w100A / crossGames };
  (cross[B.id] ??= {})[A.id] = { games: crossGames, scoreRate: 1 - p, ci95: [1 - p - h, 1 - p + h], meanMargin: -mA / crossGames, winBy100: w100B / crossGames };
  console.log(A.id, "vs", B.id, p.toFixed(3));
  pairIndex++;
}
const out = {
  generatedBy: "scripts/economy/generate-match-data.ts",
  rules: "YachtLab-12 (Nintendo-style Yacht Dice, 12 categories, upper 63 → +35)",
  engine: "src/engine.ts createGame(seed, independentPlayers=true)",
  policy: "softmax over DP Expert action values (src/dp.ts dpActionValues), temperature tau; tau=0 is DP Expert",
  seeds: { base: SEED_BASE, note: "economy-study development seeds; not a holdout", mirrorGamesPerTier: mirrorGames, crossGamesPerPair: crossGames },
  tiers: TIERS,
  mirror: tierResults,
  cross,
  runtimeSeconds: (performance.now() - started) / 1000,
};
writeFileSync("src/economy/data/match-events.json", JSON.stringify(out, (_k, v) => (typeof v === "number" && !Number.isInteger(v) ? Number(v.toPrecision(6)) : v)));
console.log("done", out.runtimeSeconds.toFixed(0) + "s");
