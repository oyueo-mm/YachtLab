// npx tsx scripts/review/compare.ts [--v6] > c2-review-comparison.json
// Bounded decision benchmark. --v6 additionally builds/loads the existing seven research banks.
import { readFileSync } from "node:fs";
import { decide } from "../../src/ai";
import { choiceIndex, dpFutureValue, setDPTable, type Choice } from "../../src/dp";
import { createGame, total, transition, type Game } from "../../src/engine";
import { winDPv5Decision, type V5Decision } from "../../src/research-v5/apex";
import { winDPv6Decision } from "../../src/research-v6/apex6";
import { bankFromWasm, buildBankWasm } from "../../src/research-v6/wasm-pmf";
import { productV7Decision } from "../../src/research-v7/product";
import { analyzeProductSituation } from "../../src/review/product-analysis";
import { loadDPTable } from "../research-v5/load-dp";
import { DEFAULT_LAMBDAS, loadRiskBanks } from "../research-v6/banks";

const table = loadDPTable();
setDPTable(table.buffer as ArrayBuffer);
const wasm = readFileSync(new URL("../../training/v6-wasm/pmf.wasm", import.meta.url));

const action = (d: ReturnType<typeof decide>): Choice => d.type === "score" ?
  { type: "score", category: d.category } : { type: "reroll", ids: d.ids };
const key = (state: Game, a: Choice) => a.type === "score" ? a.category :
  state.dice.filter(({ id }) => a.ids.includes(id)).map(({ value }) => value).sort().join("");
const actionValues = (state: Game, d: V5Decision) => new Map(d.analysis.map((a) => [key(state,
  a.kind === "score" ? { type: "score", category: a.category! } : { type: "reroll", ids: a.ids! }), a.winCredit]));

async function main() {
  const started = performance.now();
  const compiled = await buildBankWasm(wasm, table, { f32: true });
  const config = { bank: bankFromWasm(compiled), dpValue: dpFutureValue, endgame: "none" as const };
  const initMs = performance.now() - started;
  const banks = process.argv.includes("--v6") ? loadRiskBanks(DEFAULT_LAMBDAS) : undefined;
  const candidates = {
    "DP Expert": (s: Game) => decide(s, "DP Expert"),
    "Win DP v4-D": (s: Game) => decide(s, "Win DP v4-D"),
    "v5-R": (s: Game) => winDPv5Decision(s, config),
    I2RO1: (s: Game) => productV7Decision(s, config),
    I2R1: (s: Game) => productV7Decision(s, config, "I2R1"),
    ...(banks ? { "v6-P": (s: Game) => winDPv6Decision(s, { ...config, banks, bank: banks[3] }) } : {}),
  };
  const seeds = [304, 801, 2517, 4079];
  const positions: { state: Game; phase: string }[] = [];
  for (const [i, seed] of seeds.entries()) {
    let state = createGame(seed, true);
    while (!state.done) {
      const before = state;
      if (!before.rolls) {
        state = transition(state, { type: "roll" });
        continue;
      }
      if ([2, 6, 10, 11, 12].includes(before.round) && before.rolls === i % 3 + 1) {
        positions.push({ state: { ...before, seed: 0, rng: [0, 0] }, phase: before.round <= 4 ? "early" : before.round <= 8 ? "middle" : "late" });
      }
      // Always observe all three roll levels; use DP Expert's first keep if it would record early.
      const played = action(decide(before, "DP Expert"));
      if (before.rolls === 3) state = transition(before, played.type === "score" ? played : { type: "score", category: "choice" });
      else state = transition(transition(before, { type: "hold", ids: played.type === "reroll" ? played.ids : [] }), { type: "roll" });
    }
  }
  const samples = positions.map(({ state, phase }) => {
    const refStart = performance.now();
    const exact = phase === "late" ? winDPv5Decision(state, { ...config, endgame: "minimax", minimaxWindow: 3 }) : undefined;
    const exactMs = exact && performance.now() - refStart;
    const reference = exact ?? winDPv5Decision(state, config);
    const ref = actionValues(state, reference);
    const best = Math.max(...ref.values());
    const reviews = Object.fromEntries(Object.entries(candidates).map(([name, select]) => {
      const t0 = performance.now();
      const decision = select(state);
      const ms = performance.now() - t0;
      const chosen = action(decision);
      const chosenValue = ref.get(key(state, chosen));
      const error = "analysis" in decision && exact ? [...actionValues(state, decision as V5Decision)].flatMap(([id, value]) =>
        ref.has(id) ? [Math.abs(value - ref.get(id)!) * 100] : []) : [];
      const gap = chosenValue === undefined ? null : Math.max(0, best - chosenValue) * 100;
      return [name, { ms, exactRegret: exact ? gap : null, actionMae: mean(error), agrees: gap !== null && gap <= 1e-6 }];
    }));
    const { player, cards, dice, rolls, round } = state;
    const startAnalysis = performance.now();
    const row = analyzeProductSituation({ before: { player, cards, dice, rolls, round }, action: action(reference) }, 0, config);
    const analysisMs = performance.now() - startAnalysis;
    const actualMatches = choiceIndex(row.actual.action) === choiceIndex(action(reference));
    return { phase, round, gap: total(cards[player]) - total(cards[1 - player]), exactCredit: exact ? best : null,
      exactMs, analysisMs, actualMatches, reviews };
  });
  const groups = {
    early: samples.filter((s) => s.phase === "early"),
    middle: samples.filter((s) => s.phase === "middle"),
    late: samples.filter((s) => s.phase === "late"),
    closeScore: samples.filter((s) => s.phase === "late" && Math.abs(s.gap) <= 15),
    wideScore: samples.filter((s) => s.phase === "late" && Math.abs(s.gap) > 15),
    closeCredit: samples.filter((s) => s.exactCredit !== null && Math.abs(s.exactCredit - 0.5) <= 0.2),
  };
  const summary = Object.fromEntries(Object.entries(groups).map(([group, rows]) => [group, {
    n: rows.length, analysisMs: mean(rows.map(({ analysisMs }) => analysisMs)),
    exactMs: mean(rows.flatMap(({ exactMs }) => exactMs === undefined ? [] : [exactMs])),
    models: Object.fromEntries(Object.keys(candidates).map((name) => {
      const numbers = rows.map((s) => s.reviews[name]);
      return [name, { regretPP: mean(numbers.flatMap((r) => r.exactRegret === null ? [] : [r.exactRegret])),
        maePP: mean(numbers.flatMap((r) => r.actionMae === null ? [] : [r.actionMae])),
        agreement: mean(numbers.map((r) => Number(r.agrees))), ms: mean(numbers.map((r) => r.ms)) }];
    })),
  }]));
  console.log(JSON.stringify({ seeds, initMs, maxRssKiB: process.resourceUsage().maxRSS, summary, samples }, null, 2));
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

void main();
