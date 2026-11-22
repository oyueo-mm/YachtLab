import { describe, expect, it } from "vitest";
import {
  FACE_NORMAL,
  FACE_UP,
  canonicalOrientation,
  finalValue,
  qAngle,
  qAxisAngle,
  qMul,
  qRotate,
  simulateThrow,
  topFace,
  type Quat,
  type SimInput,
} from "../src/dice3d/physics";

const trays = [
  { name: "desktop", width: 9.5, height: 5.5 },
  { name: "mobile", width: 5.2, height: 5.6 },
];
function input(width: number, height: number, values: number[], held: number[], seed: number, direction: 1 | -1 = 1): SimInput {
  const gap = Math.min(1.25, (width - 0.6) / 5);
  return { width, height, direction, seed, dice: values.map((value, id) => ({ id, value, held: held.includes(id), x: width / 2 + (id - 2) * gap, z: height * 0.45 })) };
}
const frameQuat = (frames: Float32Array, f: number) => Array.from(frames.subarray(f * 7 + 3, f * 7 + 7)) as Quat;

describe("3D dice orientation math", () => {
  it("canonical orientation shows each value on top with its pips upright on screen", () => {
    for (const v of [1, 2, 3, 4, 5, 6]) {
      const q = canonicalOrientation(v);
      expect(topFace(q)).toMatchObject({ value: v });
      expect(topFace(q).flatness).toBeCloseTo(1, 6);
      const up = qRotate(q, FACE_UP[v]);
      expect(up[2]).toBeCloseTo(-1, 6); // texture up → screen up (world −z)
    }
    expect(qAngle(canonicalOrientation(1), [0, 0, 0, 1])).toBeCloseTo(0, 6);
  });
  it("opposite faces sum to seven", () => {
    for (const v of [1, 2, 3]) expect(FACE_NORMAL[v].map((c, i) => c + FACE_NORMAL[7 - v][i])).toEqual([0, 0, 0]);
  });
});

describe("pre-simulated throws land exactly on the engine values", () => {
  for (const tray of trays)
    it(`every value 1–6 on every die position (${tray.name})`, () => {
      let ok = 0;
      let runs = 0;
      for (let seed = 1; seed <= 36; seed++) {
        const values = [0, 1, 2, 3, 4].map((id) => 1 + ((seed + id * 2) % 6));
        const held = seed % 4 === 0 ? [1, 4] : [];
        const sim = simulateThrow(input(tray.width, tray.height, values, held, seed * 977, seed % 2 ? 1 : -1));
        runs++;
        if (sim.ok) ok++;
        expect(sim.tracks.map((t) => t.id).sort()).toEqual([0, 1, 2, 3, 4].filter((id) => !held.includes(id)));
        for (const t of sim.tracks) {
          // 1. Final top face == engine value.
          expect(finalValue(t, sim.frameCount)).toBe(values[t.id]);
          // 2. The die ends exactly in its row slot, flat on the floor.
          const end = (sim.frameCount - 1) * 7;
          const slot = input(tray.width, tray.height, values, held, 0).dice[t.id];
          expect(t.frames[end]).toBeCloseTo(slot.x, 4);
          expect(t.frames[end + 1]).toBeCloseTo(0.5, 4);
          expect(t.frames[end + 2]).toBeCloseTo(slot.z, 4);
          // 3. …with the same pip orientation as the 2D die it hands over to (allowing symmetric turns).
          const last = frameQuat(t.frames, sim.frameCount - 1);
          const turns = [1, 4, 5].includes(values[t.id]) ? [0, 1, 2, 3] : [0, 2];
          const best = Math.min(...turns.map((k) => qAngle(last, qMul(qAxisAngle([0, 1, 0], (k * Math.PI) / 2), canonicalOrientation(values[t.id])))));
          expect(best).toBeLessThan(1e-3);
          // 4. The visual label never changes mid-throw: visual = body × constant label.
          expect(t.label.length).toBe(4);
        }
        // 5. No snapping near the end, no overlap, nothing leaves the tray.
        expect(sim.stats.maxEndStepDeg).toBeLessThan(12);
        expect(sim.stats.minDistance).toBeGreaterThan(0.97);
        expect(sim.stats.inBounds).toBe(true);
        expect(sim.frameCount).toBeLessThanOrEqual(130);
      }
      expect(ok / runs).toBeGreaterThanOrEqual(0.95);
    }, 60000);

  it("is deterministic for the same input and seed", () => {
    const a = simulateThrow(input(9.5, 5.5, [6, 6, 6, 6, 6], [], 42));
    const b = simulateThrow(input(9.5, 5.5, [6, 6, 6, 6, 6], [], 42));
    expect(Array.from(a.tracks[0].frames)).toEqual(Array.from(b.tracks[0].frames));
    expect(a.impacts).toEqual(b.impacts);
  });

  it("dice settle at different times and report impacts for the sound engine", () => {
    const sim = simulateThrow(input(9.5, 5.5, [1, 2, 3, 4, 5], [], 7));
    expect(new Set(sim.tracks.map((t) => t.restFrame)).size).toBeGreaterThan(1);
    expect(sim.impacts.length).toBeGreaterThan(5);
    expect(sim.impacts.every((i) => i.frame >= 0 && i.frame < sim.glideStart && i.strength > 0)).toBe(true);
    expect(new Set(sim.impacts.map((i) => i.kind)).has("floor")).toBe(true);
  });

  it("held dice are static obstacles and are never animated", () => {
    const sim = simulateThrow(input(5.2, 5.6, [3, 3, 3, 3, 3], [0, 2, 4], 99));
    expect(sim.tracks.map((t) => t.id)).toEqual([1, 3]);
  });
});
