import { describe, expect, it } from "vitest";
import { ITEMS, lookAt } from "../src/economy/live/catalog";
import { diceMaterialSpec, liteSpec, motionGlow, stepEnergy, MOTION_DECAY_S, type MotionResponse } from "../src/dice3d/dice-material";
import { diceMaterial, dieSounds } from "../src/sound-packs";
import { createRoundRobin, ROUND_ROBIN_TAKES, velocityPitch } from "../src/sound";

const dice = ITEMS.filter((i) => i.category === "dice");

describe("FX-1 dice materials", () => {
  it("every die resolves to a material, and its sound voice exists", () => {
    for (const d of dice)
      for (let lv = 1; lv <= d.maxLevel; lv++) {
        const look = lookAt(d, lv).dice!;
        const s = diceMaterialSpec(look, d.id);
        expect(s.roughness).toBeGreaterThan(0);
        expect(s.roughness).toBeLessThanOrEqual(1);
        expect(s.opacity).toBeGreaterThan(0.7); // see-through bodies keep readable pips
        const voice = diceMaterial(d.id, look);
        expect(voice === "plastic" || voice in dieSounds).toBe(true);
      }
  });
  it("materials are differentiated by family (not colour only)", () => {
    const cls = (id: string) => diceMaterialSpec(lookAt(dice.find((d) => d.id === id)!, 1).dice!, id).class;
    expect(cls("dice.classic")).toBe("plastic");
    expect(cls("dice.wood_oak")).toBe("wood");
    expect(cls("dice.marble_white")).toBe("stone");
    expect(cls("dice.frost")).toBe("ice");
    expect(cls("dice.carbon")).toBe("composite");
    expect(cls("dice.ruby")).toBe("gem");
    expect(cls("dice.glass_blue")).toBe("glass");
    expect(cls("dice.gold")).toBe("metal");
    expect(cls("dice.lava")).toBe("lava");
    expect(cls("dice.sakura")).toBe("porcelain");
    // 11 classes in use across the catalog
    expect(new Set(dice.map((d) => diceMaterialSpec(lookAt(d, 1).dice!, d.id).class)).size).toBeGreaterThanOrEqual(9);
  });
  it("sound mappings that existed before FX-1 are unchanged", () => {
    const voice = (id: string) => diceMaterial(id, lookAt(dice.find((d) => d.id === id)!, 1).dice);
    expect(voice("dice.gold")).toBe("gold");
    expect(voice("dice.wood_walnut")).toBe("wood");
    expect(voice("dice.marble_black")).toBe("stone");
    expect(voice("dice.frost")).toBe("ice");
    expect(voice("dice.carbon")).toBe("metal");
    expect(voice("dice.silver")).toBe("metal");
    expect(voice("dice.emerald")).toBe("crystal");
    expect(voice("dice.lava")).toBe("lava");
    expect(voice("dice.aurora")).toBe("magic");
    expect(voice("dice.hologram")).toBe("magic");
    expect(voice("dice.galaxy")).toBe("space");
    expect(voice("dice.neon_green")).toBe("space");
    expect(voice("dice.glass_amber")).toBe("glass");
    expect(voice("dice.classic")).toBe("plastic");
    expect(voice("dice.mint")).toBe("plastic");
    expect(voice("dice.thunder")).toBe("resin"); // was plastic (no mapping)
  });
  it("only metals are metallic; glowing patterns never light the pips at Lv.1", () => {
    for (const d of dice) {
      const s = diceMaterialSpec(lookAt(d, 1).dice!, d.id);
      if (s.metalness > 0) expect(s.class).toBe("metal");
      if (s.selfGlow > 0) expect(["lava", "lightning", "abyss"]).toContain(lookAt(d, 1).dice!.pattern);
    }
  });
  it("lite spec drops the physical layers but keeps the identity", () => {
    const s = diceMaterialSpec(lookAt(dice.find((d) => d.id === "dice.hologram")!, 1).dice!);
    const l = liteSpec(s);
    expect([l.clearcoat, l.iridescence, l.sheen]).toEqual([0, 0, 0]);
    expect(l.class).toBe(s.class);
  });
  it("motion response rises with speed and hits, lingers, then fades to nothing", () => {
    for (const kind of ["charge", "heat", "shimmer", "pulse"] as MotionResponse[]) {
      let e = 0;
      for (let i = 0; i < 30; i++) e = stepEnergy(kind, e, 1 / 60, 10, i % 10 === 0 ? 8 : 0);
      expect(e).toBeGreaterThan(0.05);
      expect(motionGlow(kind, e, 0.3)).toBeGreaterThan(1);
      const peak = e;
      e = stepEnergy(kind, e, 1 / 60, 0, 0);
      expect(e).toBeLessThan(peak); // no abrupt jump after the dice stop
      expect(e).toBeGreaterThan(peak * 0.85);
      for (let i = 0; i < 60 * 12; i++) e = stepEnergy(kind, e, 1 / 60, 0, 0);
      expect(e).toBeLessThan(0.01);
    }
    expect(MOTION_DECAY_S.heat).toBeGreaterThan(MOTION_DECAY_S.charge); // lava cools slowly, sparks die fast
    expect(stepEnergy("none", 0.5, 0.1, 10, 10)).toBe(0);
    expect(motionGlow("none", 1, 0)).toBe(1);
  });
});

describe("FX-1 sound variation", () => {
  it("round robin never plays the same take twice in a row and uses every take", () => {
    let seed = 7;
    const rr = createRoundRobin(ROUND_ROBIN_TAKES.length, () => ((seed = (seed * 16807) % 2147483647) / 2147483647));
    const seen = new Set<number>();
    let prev = -1;
    for (let i = 0; i < 400; i++) {
      const t = rr("glass.impact");
      expect(t).not.toBe(prev);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(ROUND_ROBIN_TAKES.length);
      seen.add(t);
      prev = t;
    }
    expect(seen.size).toBe(ROUND_ROBIN_TAKES.length);
  });
  it("harder hits are pitched slightly higher, within a few percent", () => {
    expect(velocityPitch(1)).toBeGreaterThan(velocityPitch(0.2));
    expect(velocityPitch(1) / velocityPitch(0)).toBeLessThan(1.08);
    expect(velocityPitch(5)).toBe(velocityPitch(1));
  });
});
