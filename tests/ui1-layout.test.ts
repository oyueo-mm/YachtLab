import { describe, expect, it } from "vitest";
import { sheetLayout, SHEET_TIERS } from "../src/ui/sheet-layout";
import { anchorPoint, clampPoint, defaultPoint } from "../src/ui/floating";

const seats = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("UI-1 score sheet layout", () => {
  it("keeps seat order and no scroll when every column fits", () => {
    const l = sheetLayout({ width: 1200, seats: seats(4), pinned: 2 });
    expect(l).toMatchObject({ order: [0, 1, 2, 3], scroll: false, pinned: null });
  });
  it("pins the given seat first and scrolls when columns cannot fit (2–20 players)", () => {
    for (const n of [2, 4, 8, 12, 20]) for (const width of [320, 360, 390, 430, 768, 1024, 1280, 1440, 1920]) {
      const l = sheetLayout({ width, seats: seats(n), pinned: n - 1 });
      const need = SHEET_TIERS.tight.category + n * SHEET_TIERS.tight.column;
      expect(l.scroll).toBe(need > width);
      if (!l.scroll) expect(l.category + n * l.column).toBeLessThanOrEqual(width);
      if (l.scroll) expect(l.order[0]).toBe(n - 1);
      expect([...l.order].sort((a, b) => a - b)).toEqual(seats(n));
      expect(l.column).toBeGreaterThanOrEqual(50); // 44px button + 3px padding each side
      expect(l.category).toBeGreaterThanOrEqual(88);
    }
  });
  it("uses the roomiest tier that fits (A4: 2–4 players fit a 320px phone without scrolling)", () => {
    expect(sheetLayout({ width: 1200, seats: seats(4) }).tier).toBe("wide");
    expect(sheetLayout({ width: 364, seats: seats(2) }).tier).toBe("wide");
    expect(sheetLayout({ width: 294, seats: seats(4) })).toMatchObject({ tier: "tight", scroll: false });
    expect(sheetLayout({ width: 1000, seats: seats(20), pinned: 3 })).toMatchObject({ tier: "mid", scroll: true, order: [3, ...seats(20).filter((s) => s !== 3)] });
  });
  it("does not decide before the width is known", () => {
    expect(sheetLayout({ width: 0, seats: seats(20), pinned: 5 })).toMatchObject({ scroll: false, order: seats(20) });
  });
  it("ignores a pinned seat that is not shown", () => {
    expect(sheetLayout({ width: 320, seats: [3], pinned: 1 }).order).toEqual([3]);
  });
});

describe("UI-1 floating popup position", () => {
  const vp = { width: 390, height: 844 };
  const box = { width: 300, height: 160 };
  it("clamps inside the screen with a margin", () => {
    expect(clampPoint({ x: -100, y: 9999 }, box, vp)).toEqual({ x: 8, y: 844 - 160 - 8 });
    expect(clampPoint({ x: 9999, y: -5 }, box, vp)).toEqual({ x: 390 - 300 - 8, y: 8 });
  });
  it("defaults to the bottom-right corner (above the phone bottom bar)", () => {
    const p = defaultPoint(box, vp);
    expect(p.x).toBe(390 - 300 - 16);
    expect(p.y).toBe(844 - 160 - 88);
    const d = defaultPoint(box, { width: 1440, height: 900 });
    expect(d).toEqual({ x: 1440 - 300 - 16, y: 900 - 160 - 16 });
  });
  it("restores a saved corner after a resize, still on screen", () => {
    const p = anchorPoint({ fx: 1, fy: 1 }, box, { width: 320, height: 568 });
    expect(p.x + box.width).toBeLessThanOrEqual(320);
    expect(p.y + box.height).toBeLessThanOrEqual(568);
  });
});
