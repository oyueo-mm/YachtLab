import { describe, expect, it } from "vitest";
import { CATALOG_REV, ITEMS, itemById, lookAt, sellableOn } from "../src/economy/live/catalog";
import { COLLECTIONS, collectionProgress, collectionsOf, synergyOf } from "../src/economy/live/collections";
import { DRAW_TIERS, drawItems } from "../src/economy/live/draw";
import { DICE_FX } from "../src/dice3d/dice-fx";
import { BOARD_FX } from "../src/board-fx";
import { contrast } from "../src/dice3d/face-paint";

describe("테마 컬렉션 (2026-11-27)", () => {
  it("모든 컬렉션은 실제 상품의 주사위와 보드판을 가지고, 우선 테마 10개를 덮는다", () => {
    expect(COLLECTIONS.map((c) => c.id)).toEqual(["lightning", "meadow", "bloom", "sakura", "forest", "abyss", "lava", "frost", "cosmos", "aurora"]);
    for (const c of COLLECTIONS) {
      expect(c.dice.length, c.id).toBeGreaterThan(0);
      expect(c.boards.length, c.id).toBeGreaterThan(0);
      for (const id of [...c.dice, ...c.boards, ...c.extras]) expect(itemById(id), `${c.id}: ${id}`).not.toBeNull();
      for (const id of c.dice) expect(itemById(id)!.category).toBe("dice");
      for (const id of c.boards) expect(itemById(id)!.category).toBe("board");
    }
  });
  it("신규 상품은 고유 연출·판매 전용(뽑기 확률 불변)·카탈로그 2판", () => {
    const fresh = ITEMS.filter((i) => i.rev === 2);
    expect(fresh.map((i) => i.id).sort()).toEqual(["board.flower_field", "board.forest", "board.meadow", "board.sakura", "board.storm", "board.volcano", "dice.abyss", "dice.flower", "dice.meadow", "dice.sakura", "dice.thunder"]);
    for (const i of fresh) {
      expect(i.drawExcluded, i.id).toBe(true);
      expect(i.maxLevel).toBe(3);
      expect(collectionsOf(i.id).length, i.id).toBeGreaterThan(0);
      if (i.category === "dice") {
        expect(DICE_FX[i.id], i.id).toBeTruthy();
        const l = lookAt(i, 1).dice!;
        expect(contrast(l.face, l.pip), i.id).toBeGreaterThan(4.5); // pips stay readable
      } else expect(BOARD_FX[i.id], i.id).toBeTruthy();
    }
    // pale dice keep dark, readable pips at every level (no pip glow)
    for (const id of ["dice.meadow", "dice.flower", "dice.sakura"]) expect(lookAt(itemById(id), 3).dice!.glow, id).toBeUndefined();
    // the random draw pools contain exactly the launch items (odds of existing items unchanged)
    for (const tier of DRAW_TIERS) expect(drawItems("standard", tier).some((i) => i.rev === 2)).toBe(false);
    expect(CATALOG_REV).toBe(2);
    // an older server (no revision) cannot sell them; a revision-2 server can
    const thunder = itemById("dice.thunder")!;
    expect(sellableOn(thunder, undefined)).toBe(false);
    expect(sellableOn(thunder, 2)).toBe(true);
    expect(sellableOn(itemById("dice.lava")!, undefined)).toBe(true);
  });
  it("시너지는 같은 컬렉션의 주사위와 보드판을 함께 장착했을 때만", () => {
    expect(synergyOf("dice.thunder", "board.storm")?.kind).toBe("lightning");
    expect(synergyOf("dice.lava", "board.volcano")?.kind).toBe("lava");
    expect(synergyOf("dice.galaxy", "board.space")?.kind).toBe("cosmos");
    expect(synergyOf("dice.thunder", "board.space")).toBeNull();
    expect(synergyOf("dice.classic", "board.charcoal")).toBeNull();
    const c = COLLECTIONS.find((x) => x.id === "lava")!;
    expect(collectionProgress(c, new Set(["dice.lava"]))).toMatchObject({ have: 1, synergyReady: false });
    expect(collectionProgress(c, new Set(["dice.lava", "board.volcano"]))).toMatchObject({ synergyReady: true });
  });
});

import { SEASONS, remainingText, seasonActive, seasonUpcoming } from "../src/economy/live/seasons";
describe("기간 한정 판매 (서버 시간 기준)", () => {
  const s = SEASONS["christmas-2026"];
  it("판매 전·중·후를 서버 시각으로 구분하고, 끝난 뒤에도 거짓 연장 없이 종료로 본다", () => {
    expect(seasonActive("christmas-2026", s.start - 1)).toBe(false);
    expect(seasonUpcoming("christmas-2026", s.start - 86_400_000)).toBe(true);
    expect(seasonUpcoming("christmas-2026", s.start - 30 * 86_400_000)).toBe(false); // announced at most 14 days ahead
    expect(seasonActive("christmas-2026", s.start)).toBe(true);
    expect(remainingText("christmas-2026", s.end - 3 * 86_400_000 - 2 * 3_600_000)).toBe(" · 남은 기간 3일 2시간");
    expect(seasonActive("christmas-2026", s.end)).toBe(false);
    expect(remainingText("christmas-2026", s.end + 1)).toBe("");
    expect(s.rerun).toMatch(/재판매/);
  });
});
