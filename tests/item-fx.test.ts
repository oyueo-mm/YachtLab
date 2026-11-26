import { describe, expect, it } from "vitest";
import { ITEMS, lookAt } from "../src/economy/live/catalog";
import { DICE_FX } from "../src/dice3d/dice-fx";
import { BOARD_FX } from "../src/board-fx";
import { EMOTE_FX, EMOTE_LEVEL_TEXT } from "../src/emote-fx";
import { EMOTE_VOICES } from "../src/sound";
import { BOARD_FX_TEXT, DICE_FX_TEXT } from "../src/fx-texts";

const of = (c: string) => ITEMS.filter((i) => i.category === c && i.tier !== "basic");

describe("cosmetic upgrade effects (2026-11-26)", () => {
  it("level texts in the main bundle match the effect profiles", () => {
    expect(DICE_FX_TEXT).toEqual(Object.fromEntries(Object.entries(DICE_FX).map(([k, v]) => [k, [v.lv2, v.lv3]])));
    expect(BOARD_FX_TEXT).toEqual(Object.fromEntries(Object.entries(BOARD_FX).map(([k, v]) => [k, [v.lv2, v.lv3]])));
  });
  it("every non-basic die has its own Lv.2/Lv.3 profile and keeps its body colours", () => {
    const dice = of("dice");
    expect(dice.length).toBe(30);
    for (const d of dice) {
      expect(DICE_FX[d.id], d.id).toBeTruthy();
      expect(d.maxLevel).toBe(3);
      const l1 = lookAt(d, 1).dice!, l3 = lookAt(d, 3).dice!;
      expect([l3.face, l3.pip, l3.edge, l3.pattern]).toEqual([l1.face, l1.pip, l1.edge, l1.pattern]);
      expect(lookAt(d, 2).dice!.fxLevel).toBe(2);
      expect(l3.fxLevel).toBe(3);
    }
    // descriptions are unique per item (not one generic effect recoloured)
    expect(new Set(dice.map((d) => d.levels![1])).size).toBe(dice.length);
  });
  it("neon dice stay black with a coloured rim at every level", () => {
    for (const id of ["dice.neon_pink", "dice.neon_green"]) {
      const d = ITEMS.find((i) => i.id === id)!;
      for (const lv of [1, 2, 3]) expect(lookAt(d, lv).dice!.face).toMatch(/^#1[0-9a-f]{5}$|^#0[0-9a-f]{5}$/);
    }
  });
  it("all non-basic boards are upgradable with a profile; ids, tiers and prices are unchanged", () => {
    const boards = of("board");
    expect(boards.length).toBe(20);
    for (const b of boards) {
      expect(BOARD_FX[b.id], b.id).toBeTruthy();
      expect(b.maxLevel).toBe(3);
      expect(lookAt(b, 3).css).toContain("bd-lv3");
    }
  });
  it("every emote has a distinct motion; upgradable ones have Lv.3 voices and level texts", () => {
    const emotes = ITEMS.filter((i) => i.category === "emote");
    for (const e of emotes) {
      expect(EMOTE_FX[e.id], e.id).toBeTruthy();
      expect(EMOTE_VOICES[EMOTE_FX[e.id].voice], e.id).toBeTypeOf("function");
      if (e.maxLevel === 3) expect(EMOTE_LEVEL_TEXT[e.id], e.id).toBeTruthy();
    }
    expect(new Set(emotes.map((e) => EMOTE_FX[e.id].anim)).size).toBe(emotes.length);
  });
});
