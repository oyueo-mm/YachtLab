import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE, canonicalOrientation, finalValue, playRate, qAngle, qMul, qConj, qRotate, simulateThrow, topFace, type Quat, type ThrowProfile } from "../src/dice3d/physics";
import { carryPose } from "../src/dice3d/table";
import { SURFACES, surfaceOf } from "../src/sound";
import { BOARD_FX } from "../src/board-fx";
import { SCENE_IDS, createScene, strengthOf } from "../src/play/board-scene";
import { ITEMS } from "../src/economy/live/catalog";

/** A1 (2026-11-27): 5th-pass throw physics, hold carry, board surfaces and board scenes. */
const run = (profile: ThrowProfile, W: number, H: number, n = 40) =>
  Array.from({ length: n }, (_, k) => {
    const seed = k + 1;
    const values = [0, 1, 2, 3, 4].map((id) => 1 + ((seed * 5 + id) % 6));
    const held = seed % 4 === 0 ? [2] : [];
    return { values, held, sim: simulateThrow({ width: W, height: H, direction: seed % 2 ? 1 : -1, seed: seed * 7919, landing: "free", maxAttempts: 14, profile, dice: values.map((value, id) => ({ id, value, held: held.includes(id), x: W / 2 + (id - 2) * 1.2, z: H * 0.5 })) }) };
  });
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

describe("5th pass: impulse throws", () => {
  it("is the default and plays in real time (no fast-forward)", () => {
    expect(DEFAULT_PROFILE).toBe("impulse");
    expect(playRate("impulse")).toBe(1);
    expect(playRate("vigorous")).toBe(1.25);
  });
  for (const [name, W, H] of [["desktop", 9.5, 5.5], ["mobile", 5.2, 5.6]] as const)
    it(`hits harder, collides more and stays exact (${name})`, () => {
      const old = run("vigorous", W, H), now = run("impulse", W, H);
      // physical speed (not playback speed) and collisions
      expect(mean(now.map((r) => r.sim.stats.peakSpeed))).toBeGreaterThan(mean(old.map((r) => r.sim.stats.peakSpeed)) * 1.1);
      expect(mean(now.map((r) => r.sim.stats.impactCount))).toBeGreaterThan(mean(old.map((r) => r.sim.stats.impactCount)) * 1.3);
      // on screen: no slower than before at the median (rate 1 vs 1.25)
      const shown = (rs: typeof now, rate: number) => median(rs.map((r) => r.sim.frameCount / 60 / rate));
      expect(shown(now, 1)).toBeLessThan(shown(old, 1.25) * 1.15);
      expect(shown(now, 1)).toBeLessThan(1.3);
      let ok = 0;
      for (const { values, held, sim } of now) {
        if (sim.ok) ok++;
        expect(sim.tracks.map((t) => t.id).sort()).toEqual([0, 1, 2, 3, 4].filter((id) => !held.includes(id)));
        for (const t of sim.tracks) expect(finalValue(t, sim.frameCount)).toBe(values[t.id]);
        expect(sim.stats.inBounds).toBe(true);
        expect(sim.stats.minDistance).toBeGreaterThan(0.95);
        expect(sim.stats.maxEndStepDeg).toBeLessThan(12);
      }
      expect(ok / now.length).toBeGreaterThanOrEqual(0.97);
    }, 90000);

  it("dice leave the hand tumbling the way they fly (spin axis across the flight)", () => {
    const across = (profile: ThrowProfile) =>
      mean(
        run(profile, 9.5, 5.5, 24).flatMap(({ sim }) =>
          sim.tracks.map((t) => {
            const f = t.frames, q = (i: number) => Array.from(f.subarray(i * 7 + 3, i * 7 + 7)) as Quat;
            // rotation between frames 1 and 3 (in flight), as an axis in world space
            const rel = qMul(q(3), qConj(q(1)));
            const axis = [rel[0], rel[1], rel[2]], n = Math.hypot(...axis) || 1;
            const v = [f[3 * 7] - f[7], 0, f[3 * 7 + 2] - f[7 + 2]], vn = Math.hypot(...v) || 1;
            return 1 - Math.abs((axis[0] * v[0] + axis[2] * v[2]) / (n * vn)); // 1 = axis ⟂ travel
          }),
        ),
      );
    expect(across("impulse")).toBeGreaterThan(across("vigorous"));
    expect(across("impulse")).toBeGreaterThan(0.75);
  }, 60000);

  it("same input → same throw (deterministic), values only relabel faces", () => {
    const a = run("impulse", 9.5, 5.5, 3), b = run("impulse", 9.5, 5.5, 3);
    for (let i = 0; i < a.length; i++) expect(Array.from(a[i].sim.tracks[0].frames.subarray(0, 70))).toEqual(Array.from(b[i].sim.tracks[0].frames.subarray(0, 70)));
  });
});

describe("hold / release carry", () => {
  it("starts and ends exactly, lifts in an arc, tips at most ~7°, keeps the top face", () => {
    for (const value of [1, 2, 3, 4, 5, 6]) {
      const q = canonicalOrientation(value);
      const from = { x: 2, y: 0.5, z: 3, quat: q }, to = { x: 6.5, y: 0.5, z: 6, quat: q };
      expect(carryPose(from, to, 0)).toMatchObject({ x: 2, z: 3 });
      expect(carryPose(from, to, 1)).toEqual(to);
      let maxTilt = 0, maxLift = 0;
      for (let k = 0; k <= 40; k++) {
        const p = carryPose(from, to, k / 40);
        maxLift = Math.max(maxLift, p.y - 0.5);
        maxTilt = Math.max(maxTilt, qAngle(p.quat, q));
        expect(topFace(p.quat).value).toBe(value);
        const up = qRotate(p.quat, [0, 1, 0]);
        expect(Number.isFinite(up[0])).toBe(true);
      }
      expect(maxLift).toBeGreaterThan(0.3);
      expect((maxTilt * 180) / Math.PI).toBeLessThan(7.5);
    }
  });
});

describe("board surfaces (collision sound)", () => {
  it("every board maps to a surface; families share their material", () => {
    for (const id of [...Object.keys(BOARD_FX), "board.charcoal"]) expect(SURFACES[surfaceOf(id)], id).toBeTruthy();
    expect(surfaceOf("board.charcoal")).toBe("matte");
    expect(surfaceOf(undefined)).toBe("matte");
    expect(surfaceOf("board.felt_red")).toBe("felt");
    expect(surfaceOf("board.wood_walnut")).toBe("wood");
    expect(surfaceOf("board.marble")).toBe("stone");
    expect(surfaceOf("board.ice")).toBe("ice");
    expect(surfaceOf("board.gold_table")).toBe("metal");
    expect(surfaceOf("board.deep_sea")).toBe("water");
    // soft surfaces swallow highs, hard ones do not
    expect(SURFACES.felt.cutoff).toBeLessThan(SURFACES.stone.cutoff);
    expect(SURFACES.water.cutoff).toBeLessThan(SURFACES.ice.cutoff);
  });
});

describe("board scenes (Lv.2 environment / Lv.3 reactions)", () => {
  it("every upgradable board in the catalog has its own scene", () => {
    const boards = ITEMS.filter((i) => i.category === "board" && i.maxLevel >= 3).map((i) => i.id).sort();
    expect(SCENE_IDS.slice().sort()).toEqual(boards);
    expect(Object.keys(BOARD_FX).sort()).toEqual(boards);
  });
  it("reactions follow the real hit: nothing before, something after, more for harder hits", () => {
    expect(strengthOf(2)).toBeLessThan(strengthOf(14));
    expect(strengthOf(100)).toBeLessThanOrEqual(1.3);
    for (const id of SCENE_IDS) {
      const soft = createScene(id, 1)!, hard = createScene(id, 1)!;
      soft.layout(420, 260);
      hard.layout(420, 260);
      expect(soft.busy(), id).toBe(false);
      soft.hit(200, 120, strengthOf(3), "impact");
      hard.hit(200, 120, strengthOf(18), "impact");
      expect(soft.busy() || hard.busy(), id).toBe(true);
    }
    // the storm splits into more bolts for a harder hit
    const a = createScene("board.storm", 1) as unknown as { layout(w: number, h: number): void; hit(x: number, y: number, s: number, k: "impact"): void; things: unknown[] };
    const b = createScene("board.storm", 1) as unknown as typeof a;
    a.layout(400, 300);
    b.layout(400, 300);
    a.hit(100, 100, 0.25, "impact");
    b.hit(100, 100, 1.2, "impact");
    expect(b.things.length).toBeGreaterThan(a.things.length);
  });
});
