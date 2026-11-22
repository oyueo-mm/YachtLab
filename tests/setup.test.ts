import { describe, expect, it } from "vitest";
import {
  aiMatchConfig,
  cleanName,
  defaultAiSetup,
  draftName,
  duplicateNames,
  finalizeNames,
  getAiSetup,
  getLocalSetup,
  orderPlayers,
  resolveHumanSeat,
  sanitizeAiSetup,
  sanitizeLocalSetup,
  updateAiSetup,
  updateLocalSetup,
} from "../src/setup";
import { isPlayableRuleset, rulesets } from "../src/rulesets";

describe("offline game setup", () => {
  it("only the 12-category ruleset is playable", () => {
    expect(rulesets.filter((r) => r.available).map((r) => r.id)).toEqual(["yacht-12"]);
    expect(isPlayableRuleset("yahtzee-13")).toBe(false);
    expect(sanitizeAiSetup({ ruleset: "yahtzee-13" }).ruleset).toBe("yacht-12");
    expect(sanitizeLocalSetup({ ruleset: "yahtzee-13" }).ruleset).toBe("yacht-12");
  });

  it("sanitizes stored AI setup and keeps public difficulties separate from research models", () => {
    expect(sanitizeAiSetup({ difficulty: "DP Expert" }).difficulty).toBe(defaultAiSetup.difficulty); // not a public level
    expect(sanitizeAiSetup({ difficulty: "Win DP v4-D" }).difficulty).toBe("Win DP v4-D");
    expect(sanitizeAiSetup({ first: "nobody", speed: "warp" })).toMatchObject({ first: "me", speed: "normal" });
    expect(aiMatchConfig({ ...defaultAiSetup, research: true, researchAlgorithm: "DP Expert" }).algorithm).toBe("DP Expert");
    expect(aiMatchConfig({ ...defaultAiSetup, difficulty: "Random" }).algorithm).toBe("Random");
    expect(aiMatchConfig({ ...defaultAiSetup, name: "   " }).humanName).toBe("나");
  });

  it("drafts keep spaces while typing; final names are cleaned", () => {
    expect(draftName("민 ")).toBe("민 ");
    expect(draftName("a\u0000b")).toBe("ab");
    expect(cleanName("  민   수  ")).toBe("민 수");
    expect(cleanName("x".repeat(40))).toHaveLength(24);
  });

  it("fills empty names and makes duplicates distinguishable", () => {
    expect(finalizeNames(["민수", "", "민수", "  민수 "], 4)).toEqual(["민수", "플레이어 2", "민수 (2)", "민수 (3)"]);
    expect(duplicateNames(["a", "a"], 2)).toBe(true);
    expect(duplicateNames(["a", "a"], 1)).toBe(false);
  });

  it("random start order is a real permutation; input order is kept otherwise", () => {
    const names = ["A", "B", "C", "D"];
    expect(orderPlayers(names, "input")).toEqual(names);
    const seq = [0, 0, 0];
    const shuffled = orderPlayers(names, "random", () => seq.shift() ?? 0);
    expect([...shuffled].sort()).toEqual(names);
    expect(shuffled).not.toEqual(names);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(orderPlayers(names, "random").join(""));
    expect(seen.size).toBeGreaterThan(10);
  });

  it("first player maps to the human seat", () => {
    expect(resolveHumanSeat("me")).toBe(0);
    expect(resolveHumanSeat("ai")).toBe(1);
    expect(resolveHumanSeat("random", () => 1)).toBe(1);
    expect(resolveHumanSeat("random", () => 0)).toBe(0);
  });

  it("keeps names when the player count shrinks and grows, and caps the count at 2–50", () => {
    updateLocalSetup({ count: 4, names: ["가", "나", "다", "라", ...Array(46).fill("")] });
    updateLocalSetup({ count: 2 });
    updateLocalSetup({ count: 4 });
    expect(getLocalSetup().names.slice(0, 4)).toEqual(["가", "나", "다", "라"]);
    updateLocalSetup({ count: 99 });
    expect(getLocalSetup().count).toBe(50);
    updateLocalSetup({ count: 1 });
    expect(getLocalSetup().count).toBe(2);
    updateAiSetup({ name: "테스터" });
    expect(getAiSetup().name).toBe("테스터");
  });
});
