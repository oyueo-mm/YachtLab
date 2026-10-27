import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import summary from "../benchmarks/summary.json";
import compact from "../src/benchmark-summary.json";
import manifest from "../src/dp-manifest.json";
it("벤치마크 요약은 공통 1000개 평가 시드의 실제 원시 점수와 일치", () => {
  const seeds: number[][] = [];
  for (const row of summary.algorithms) {
    const raw = JSON.parse(
      readFileSync(
        `benchmarks/${row.algorithm.replaceAll(" ", "-").toLowerCase()}.json`,
        "utf8",
      ),
    ) as { results: { seed: number; side: number; score: number }[] };
    expect(raw.results).toHaveLength(1000);
    seeds.push(raw.results.map((r) => r.seed));
    expect(raw.results.every((r, i) => r.side === i % 2)).toBe(true);
    expect(raw.results.reduce((s, r) => s + r.score, 0) / 1000).toBeCloseTo(
      row.mean,
      10,
    );
    expect(row.meanCI95[0]).toBeLessThan(row.mean);
    expect(row.meanCI95[1]).toBeGreaterThan(row.mean);
  }
  expect(new Set(seeds[0]).size).toBe(1000);
  for (const s of seeds) expect(s).toEqual(seeds[0]);
});
it("최고 성능 표시는 검증한 모델과 모든 상대의 양의 점수 차이에 근거", () => {
  expect(compact.dpTableSha256).toBe(manifest.sha256);
  expect(compact.bestAlgorithm).toBe(summary.bestAlgorithm);
  expect(summary.pairedProjectionChecks).toBe(100);
  for (const pair of summary.pairs) {
    expect(pair.wins + pair.draws + pair.losses).toBe(1000);
    expect(pair.winCreditRate).toBeCloseTo(
      (pair.wins + 0.5 * pair.draws) / 1000,
      12,
    );
    expect(pair.winCreditCI95[0]).toBeLessThanOrEqual(pair.winCreditRate);
    expect(pair.winCreditCI95[1]).toBeGreaterThanOrEqual(pair.winCreditRate);
    expect(pair.winCreditCI95[1] - pair.winCreditCI95[0]).toBeGreaterThan(0);
    if (pair.a === compact.bestAlgorithm)
      expect(pair.meanDifferenceCI95[0]).toBeGreaterThan(0);
    if (pair.b === compact.bestAlgorithm)
      expect(pair.meanDifferenceCI95[1]).toBeLessThan(0);
  }
});
