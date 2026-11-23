import { describe, expect, it } from "vitest";
import { comboDiceIds } from "../src/combo";
import { buildScoreFx } from "../src/score-fx";
import { categories, score, type Category } from "../src/engine";

const dice = (values: number[], ids = [0, 1, 2, 3, 4]) => values.map((value, i) => ({ id: ids[i], value }));
const valuesOf = (list: { id: number; value: number }[], ids: number[]) => ids.map((id) => list.find((d) => d.id === id)!.value).sort();

describe("which dice make a combination", () => {
  it("small straight 1-2-3-4-1: exactly four dice, one of the two 1s (lowest id)", () => {
    const d = dice([1, 2, 3, 4, 1]);
    const ids = comboDiceIds(d, "small");
    expect(ids).toEqual([0, 1, 2, 3]);
    expect(valuesOf(d, ids)).toEqual([1, 2, 3, 4]);
    // The other 1 (id 4) is not highlighted.
    expect(ids).not.toContain(4);
  });

  it("is keyed by die id: order and id assignment do not change which dice are chosen", () => {
    // Same faces, different ids: the duplicate 1 with the lower id is the one used.
    const d = dice([1, 2, 3, 4, 1], [4, 0, 1, 2, 3]); // ids: 4→1, 0→2, 1→3, 2→4, 3→1
    expect(comboDiceIds(d, "small")).toEqual([0, 1, 2, 3]);
    const shuffled = [d[3], d[0], d[4], d[2], d[1]];
    expect(comboDiceIds(shuffled, "small")).toEqual([0, 1, 2, 3]);
  });

  it("every category on a representative roll", () => {
    const check = (values: number[], category: Category, faces: number[]) => {
      const d = dice(values);
      const ids = comboDiceIds(d, category);
      expect(valuesOf(d, ids)).toEqual([...faces].sort());
    };
    check([1, 1, 3, 1, 5], "aces", [1, 1, 1]);
    check([2, 2, 2, 5, 6], "deuces", [2, 2, 2]);
    check([3, 3, 1, 3, 6], "threes", [3, 3, 3]);
    check([4, 4, 4, 4, 2], "fours", [4, 4, 4, 4]);
    check([5, 5, 1, 2, 3], "fives", [5, 5]);
    check([6, 6, 6, 2, 1], "sixes", [6, 6, 6]);
    check([6, 5, 4, 3, 6], "choice", [6, 5, 4, 3, 6]);
    check([5, 5, 5, 5, 2], "four", [5, 5, 5, 5]); // four dice build it ...
    check([3, 3, 3, 6, 6], "full", [3, 3, 3, 6, 6]);
    check([1, 2, 3, 4, 6], "small", [1, 2, 3, 4]);
    check([3, 4, 5, 6, 3], "small", [3, 4, 5, 6]);
    check([2, 3, 4, 5, 6], "large", [2, 3, 4, 5, 6]);
    check([4, 4, 4, 4, 4], "yacht", [4, 4, 4, 4, 4]);
  });

  it("four of a kind highlights four dice even when five match, but points still come from the engine (sum of five)", () => {
    const d = dice([5, 5, 5, 5, 5]);
    expect(comboDiceIds(d, "four")).toHaveLength(4);
    const fx = buildScoreFx(d, "four");
    expect(fx.points).toBe(score([5, 5, 5, 5, 5], "four"));
    expect(fx.points).toBe(25);
    expect(fx.ids).toHaveLength(4);
    const fx2 = buildScoreFx(dice([5, 5, 5, 5, 2]), "four");
    expect(fx2.points).toBe(22); // all five count for points, four are highlighted
    expect(fx2.ids).toHaveLength(4);
  });

  it("a straight inside 1-2-3-4-5 prefers the lowest run for small, all five for large", () => {
    const d = dice([5, 4, 3, 2, 1]);
    expect(valuesOf(d, comboDiceIds(d, "small"))).toEqual([1, 2, 3, 4]);
    expect(comboDiceIds(d, "large")).toHaveLength(5);
  });

  it("zero points means no celebration, in every category", () => {
    expect(comboDiceIds(dice([1, 1, 2, 2, 3]), "yacht")).toEqual([]);
    expect(comboDiceIds(dice([1, 2, 3, 3, 5]), "small")).toEqual([]);
    expect(comboDiceIds(dice([1, 2, 3, 4, 6]), "large")).toEqual([]);
    expect(comboDiceIds(dice([4, 4, 4, 6, 6]), "four")).toEqual([]);
    expect(comboDiceIds(dice([4, 4, 4, 4, 4]), "full")).toEqual([]); // five of a kind is not a full house
    expect(comboDiceIds(dice([2, 3, 3, 4, 6]), "aces")).toEqual([]);
    const fx = buildScoreFx(dice([1, 1, 2, 2, 3]), "yacht");
    expect(fx).toMatchObject({ points: 0, ids: [], grand: false });
  });

  it("exhaustive: for all 7,776 rolls × 12 categories the highlight is consistent with the engine", () => {
    for (let n = 0; n < 6 ** 5; n++) {
      const values = Array.from({ length: 5 }, (_, i) => 1 + (Math.floor(n / 6 ** i) % 6));
      const d = dice(values);
      for (const category of categories) {
        const points = score(values, category);
        const ids = comboDiceIds(d, category);
        if (points === 0) {
          expect(ids).toEqual([]);
          continue;
        }
        expect(ids.length).toBeGreaterThan(0);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.every((id) => id >= 0 && id < 5)).toBe(true);
        const faces = ids.map((id) => values[id]);
        if (category === "small") expect([...faces].sort()).toEqual([0, 1, 2, 3].map((k) => Math.min(...faces) + k));
        if (category === "large") expect([...faces].sort()).toEqual([0, 1, 2, 3, 4].map((k) => Math.min(...faces) + k));
        if (category === "four") expect(new Set(faces).size).toBe(1);
        if (["aces", "deuces", "threes", "fours", "fives", "sixes"].includes(category)) expect(faces.length).toBe(values.filter((v) => v === faces[0]).length);
        if (["choice", "full", "yacht"].includes(category)) expect(ids).toHaveLength(5);
      }
    }
  });

  it("only large straight and yacht are grand effects, and only with points", () => {
    expect(buildScoreFx(dice([2, 3, 4, 5, 6]), "large").grand).toBe(true);
    expect(buildScoreFx(dice([3, 3, 3, 3, 3]), "yacht").grand).toBe(true);
    expect(buildScoreFx(dice([1, 2, 3, 4, 6]), "small").grand).toBe(false);
    expect(buildScoreFx(dice([1, 2, 3, 4, 6]), "large").grand).toBe(false);
  });
});
