import { describe, expect, it } from "vitest";
import { MAX_THROW_MS, planThrow, setThrowDirection, takeThrowDirection } from "../src/dice-motion";
import { helpEntries } from "../src/CategoryHelp";
import { categories, score, type Category } from "../src/engine";
import { defaultSettings, getSettings, motionLevel, updateSettings } from "../src/settings";
import { isRoute, labTools, routes } from "../src/routes";

describe("dice throw choreography", () => {
  it("is deterministic per roll and different per die", () => {
    const a = planThrow(7, 2, 2, 1, "full", 5)!;
    expect(planThrow(7, 2, 2, 1, "full", 5)).toEqual(a);
    const others = [0, 1, 3, 4].map((id) => JSON.stringify(planThrow(7, id, id, 1, "full", 5)!.keyframes));
    expect(new Set([JSON.stringify(a.keyframes), ...others]).size).toBe(5);
    expect(JSON.stringify(planThrow(8, 2, 2, 1, "full", 5)!.keyframes)).not.toBe(JSON.stringify(a.keyframes));
  });

  it("stays short, lands at rest and reveals the engine face before stopping", () => {
    for (let token = 1; token < 200; token++)
      for (let id = 0; id < 5; id++) {
        const finalFace = 1 + ((token + id) % 6);
        const plan = planThrow(token, id, id, token % 2 ? 1 : -1, "full", finalFace)!;
        expect(plan.endAt).toBeLessThanOrEqual(MAX_THROW_MS);
        expect(plan.keyframes.at(-1)!.transform).toBe("translate3d(0.0px, 0.0px, 0) rotate(0.0deg) scale(1.000, 1.000)");
        expect(plan.keyframes[0].offset).toBe(0);
        expect(plan.keyframes.at(-1)!.offset).toBe(1);
        // Tumbling faces are cosmetic and never fake a stop on another value.
        for (const t of plan.tumbleFaces) {
          expect(t.face).not.toBe(finalFace);
          expect(t.at).toBeLessThan(plan.revealAt);
        }
        expect(plan.revealAt).toBeLessThan(plan.endAt);
        // Impacts (and their sounds) happen while the die is moving.
        for (const hit of plan.impacts) {
          expect(hit.at).toBeGreaterThan(plan.delay);
          expect(hit.at).toBeLessThanOrEqual(plan.endAt);
        }
      }
  });

  it("follows the throw direction", () => {
    const left = planThrow(3, 0, 0, -1, "full", 1)!;
    const right = planThrow(3, 0, 0, 1, "full", 1)!;
    const startX = (p: typeof left) => Number(/translate3d\((-?[\d.]+)px/.exec(p.keyframes[0].transform as string)![1]);
    expect(startX(left)).toBeGreaterThan(0); // thrown toward the left, so it enters from the right
    expect(startX(right)).toBeLessThan(0);
  });

  it("has a light variant and no motion when motion is reduced", () => {
    const lite = planThrow(5, 1, 1, 1, "lite", 3)!;
    expect(lite.endAt).toBeLessThan(400);
    expect(lite.tumbleFaces).toEqual([]);
    expect(planThrow(5, 1, 1, 1, "none", 3)).toBeNull();
  });

  it("uses a gesture direction exactly once per roll token", () => {
    setThrowDirection(-1);
    expect(takeThrowDirection(100)).toBe(-1);
    expect(takeThrowDirection(100)).toBe(-1); // StrictMode re-render of the same roll
    expect(takeThrowDirection(101)).toBe(-1 * -1); // no fresh gesture: alternate by token
  });
});

describe("category help", () => {
  it("covers all 12 categories plus the upper bonus", () => {
    expect(Object.keys(helpEntries).sort()).toEqual([...categories, "bonus"].sort());
  });
  it("shows example points that the real engine produces", () => {
    const expected: Record<Category, number> = {
      aces: 3, deuces: 6, threes: 9, fours: 16, fives: 10, sixes: 18,
      choice: 24, four: 22, full: 21, small: 15, large: 30, yacht: 50,
    };
    for (const category of categories) expect(score(helpEntries[category].example!, category)).toBe(expected[category]);
  });
});

describe("presentation settings", () => {
  it("sanitizes values and works without browser storage", () => {
    expect(getSettings()).toEqual(defaultSettings);
    updateSettings({ volume: 4 });
    expect(getSettings().volume).toBe(1);
    updateSettings({ volume: -1, muted: true });
    expect(getSettings()).toMatchObject({ volume: 0, muted: true });
    updateSettings({ ...defaultSettings });
    expect(motionLevel()).toBe("none"); // no window in the test runtime
  });
});

describe("routes", () => {
  it("keeps every existing deep link and groups research tools as the lab tier", () => {
    for (const legacy of ["home", "play", "pvp", "records", "watch", "tournament", "analysis"]) expect(isRoute(legacy)).toBe(true);
    for (const tool of labTools) expect(routes[tool]).toMatchObject({ tier: "lab", shell: "lab" });
    expect(routes.play.tier).toBe("core");
    expect(isRoute("__proto__")).toBe(false);
  });
});
