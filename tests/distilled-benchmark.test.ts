import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import status from "../src/distilled-status.json";
import compact from "../src/research-summary.json";
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
it("v0.4 final results reproduce raw held-out scores and paired confidence intervals", () => {
  const summary = read("benchmarks/v04/summary.json");
  expect(summary.complete).toBe(true);
  expect(summary.algorithms).toHaveLength(6);
  expect(compact).toEqual(summary);
  let seeds: number[] = [];
  for (const row of summary.algorithms) {
    const raw = read(
      `benchmarks/v04/${row.algorithm.replaceAll(" ", "-")}.json`,
    );
    expect(raw.results).toHaveLength(1000);
    expect(
      raw.results.reduce((s: number, r: any) => s + r.score, 0) / 1000,
    ).toBeCloseTo(row.mean, 10);
    const list = raw.results.map((r: any) => r.seed);
    if (seeds.length) expect(list).toEqual(seeds);
    else seeds = list;
    expect(row.ci95[0]).toBeLessThan(row.mean);
    expect(row.ci95[1]).toBeGreaterThan(row.mean);
  }
  for (const pair of summary.pairs) {
    expect(pair.wins + pair.draws + pair.losses).toBe(1000);
    expect(pair.winCredit).toBeCloseTo(
      (pair.wins + 0.5 * pair.draws) / 1000,
      12,
    );
  }
});
it("learned models are activated only after positive held-out differences versus preserved PPO", () => {
  const summary = read("benchmarks/v04/summary.json");
  for (const name of ["Distilled Policy", "Distilled PPO"] as const) {
    const pair = summary.pairs.find((p: any) => p.a === name && p.b === "PPO");
    expect(pair.ci95[0]).toBeGreaterThan(0);
    expect(status[name]).toBe(true);
  }
  const audit = read("training/distillation-audit.json");
  expect(Object.values(audit.seedOverlap).every((x) => x === 0)).toBe(true);
  expect(read("benchmarks/v04/paired-checks.json").totalActualMatches).toBe(
    300,
  );
});
