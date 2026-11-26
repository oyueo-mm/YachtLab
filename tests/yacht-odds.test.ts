import { describe, expect, it } from "vitest";
import { categories, score as engineScore } from "../src/engine";
// @ts-expect-error plain ESM tool shipped as a static file
import { afterKeep, bestKeep, CATEGORIES, fromStart, hit, optimal, score } from "../public/tools/yacht-odds.js";

const all5: number[][] = [];
for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) for (let d = 1; d <= 6; d++) for (let e = 1; e <= 6; e++) all5.push([a, b, c, d, e]);

describe("/probability/ exact odds (yacht-odds.js)", () => {
  it("scores exactly like the game engine on all 7,776 rolls", () => {
    expect(CATEGORIES).toEqual([...categories]);
    for (const d of all5) for (const c of categories) expect(score(d, c)).toBe(engineScore(d, c));
  });
  it("matches the published single-roll counts (guide page)", () => {
    const count = (c: string) => all5.filter((d) => hit(d, c)).length;
    expect(count("four")).toBe(156);
    expect(count("full")).toBe(300);
    expect(count("small")).toBe(1200);
    expect(count("large")).toBe(240);
    expect(count("yacht")).toBe(6);
    // One roll from scratch = afterKeep([], 1) with no further choices.
    expect(afterKeep([], 1, "hit", "yacht")).toBeCloseTo(6 / 7776, 12);
    expect(afterKeep([], 1, "hit", "large")).toBeCloseTo(240 / 7776, 12);
  });
  it("agrees with direct enumeration for one re-roll", () => {
    // Keep 2·3·4·5, one re-roll: large straight with a 1 or a 6 = 2/6 (also stated on the guide).
    expect(afterKeep([2, 3, 4, 5], 1, "hit", "large")).toBeCloseTo(2 / 6, 12);
    // Keep four 6s, one re-roll: yacht 1/6.
    expect(afterKeep([6, 6, 6, 6], 1, "hit", "yacht")).toBeCloseTo(1 / 6, 12);
    // Keep three of a kind, two dice re-rolled once: yacht 1/36.
    expect(afterKeep([3, 3, 3], 1, "hit", "yacht")).toBeCloseTo(1 / 36, 12);
  });
  it("reproduces the classic three-roll yacht chance (about 4.6%)", () => {
    const p = fromStart("hit", "yacht");
    expect(p).toBeGreaterThan(0.0459);
    expect(p).toBeLessThan(0.0462);
  });
  it("never values a keep above the optimum and prefers the obvious keep", () => {
    expect(optimal([6, 6, 6, 6, 1], 1, "hit", "yacht")).toBeCloseTo(1 / 6, 12);
    expect(bestKeep([6, 6, 6, 6, 1], 1, "hit", "yacht").kept).toEqual([6, 6, 6, 6]);
    expect(bestKeep([2, 3, 4, 5, 5], 2, "hit", "large").kept).toEqual([2, 3, 4, 5]);
  });
});
