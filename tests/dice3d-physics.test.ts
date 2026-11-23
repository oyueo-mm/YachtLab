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

describe("free landing (3rd pass): dice stay where physics leaves them", () => {
  for (const tray of [
    { name: "desktop", width: 10, height: 5 },
    { name: "mobile", width: 6.4, height: 4.8 },
  ])
    it(`no alignment, engine faces, inside the tray, smooth re-roll start (${tray.name})`, () => {
      let rowLike = 0;
      for (let seed = 1; seed <= 30; seed++) {
        const values = [0, 1, 2, 3, 4].map((id) => 1 + ((seed * 5 + id) % 6));
        const moving = seed % 3 === 0 ? [1, 2, 4] : [0, 1, 2, 3, 4];
        const reroll = seed % 2 === 0;
        const starts = reroll
          ? Object.fromEntries(moving.map((id, k) => [id, { x: 1 + k * 1.3, z: tray.height / 2 + (k % 2 ? 0.8 : -0.8), quat: canonicalOrientation(values[id]) as Quat }]))
          : undefined;
        const sim = simulateThrow({
          width: tray.width,
          height: tray.height,
          direction: seed % 2 ? 1 : -1,
          seed: seed * 31,
          landing: "free",
          maxAttempts: 14,
          starts,
          dice: moving.map((id) => ({ id, value: values[id], held: false, x: tray.width / 2, z: tray.height / 2 })),
        });
        const last = sim.frameCount - 1;
        const ends = sim.tracks.map((t) => ({ x: t.frames[last * 7], y: t.frames[last * 7 + 1], z: t.frames[last * 7 + 2] }));
        for (const t of sim.tracks) expect(finalValue(t, sim.frameCount)).toBe(values[t.id]);
        for (const e of ends) {
          expect(e.x).toBeGreaterThanOrEqual(0.45);
          expect(e.x).toBeLessThanOrEqual(tray.width - 0.45);
          expect(e.z).toBeGreaterThanOrEqual(0.45);
          expect(e.z).toBeLessThanOrEqual(tray.height - 0.45);
        }
        for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) expect(Math.hypot(ends[i].x - ends[j].x, ends[i].z - ends[j].z)).toBeGreaterThan(0.95);
        // Not lined up in one row (the old presentation glided every die to y=row).
        const zs = ends.map((e) => e.z);
        if (Math.max(...zs) - Math.min(...zs) < 0.05) rowLike++;
        if (reroll)
          for (const t of sim.tracks) {
            // Frame 0 is the die's current resting pose → no jump when a re-roll starts.
            const s = starts![t.id];
            expect(Math.hypot(t.frames[0] - s.x, t.frames[2] - s.z)).toBeLessThan(0.5);
            expect(qAngle(Array.from(t.frames.subarray(3, 7)) as Quat, s.quat)).toBeLessThan(0.6);
          }
        expect(sim.stats.maxEndStepDeg).toBeLessThan(12);
      }
      expect(rowLike).toBe(0);
    }, 60000);
});

describe("4th pass: vigorous throws", () => {
  const run = (profile: "legacy" | "vigorous", W: number, H: number) => {
    const rows = [];
    for (let seed = 1; seed <= 40; seed++) {
      const values = [0, 1, 2, 3, 4].map((id) => 1 + ((seed * 3 + id) % 6));
      rows.push({
        values,
        sim: simulateThrow({ width: W, height: H, direction: seed % 2 ? 1 : -1, seed: seed * 911, landing: "free", maxAttempts: 14, profile, dice: values.map((value, id) => ({ id, value, held: false, x: W / 2, z: H / 2 })) }),
      });
    }
    return rows;
  };
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

  for (const [name, W, H] of [["desktop", 10, 5.4], ["mobile", 6.4, 4.8]] as const)
    it(`is measurably more dynamic than the 3rd-pass profile and still exact (${name})`, () => {
      const old = run("legacy", W, H),
        now = run("vigorous", W, H);
      // More speed, more spin, harder first hit, more collisions…
      expect(mean(now.map((r) => r.sim.stats.peakSpeed))).toBeGreaterThan(mean(old.map((r) => r.sim.stats.peakSpeed)) * 1.25);
      expect(mean(now.map((r) => r.sim.stats.spinDeg))).toBeGreaterThan(mean(old.map((r) => r.sim.stats.spinDeg)) * 1.4);
      expect(mean(now.map((r) => r.sim.stats.firstImpact))).toBeGreaterThan(mean(old.map((r) => r.sim.stats.firstImpact)) * 1.4);
      expect(mean(now.map((r) => r.sim.stats.impactCount))).toBeGreaterThan(mean(old.map((r) => r.sim.stats.impactCount)));
      // …without hurting correctness, containment or length.
      let ok = 0;
      for (const { values, sim } of now) {
        if (sim.ok) ok++;
        for (const t of sim.tracks) expect(finalValue(t, sim.frameCount)).toBe(values[t.id]);
        expect(sim.stats.inBounds).toBe(true);
        expect(sim.stats.minDistance).toBeGreaterThan(0.95);
        expect(sim.stats.maxEndStepDeg).toBeLessThan(12);
        expect(sim.frameCount).toBeLessThanOrEqual(135);
      }
      expect(ok / now.length).toBeGreaterThanOrEqual(0.97);
    }, 60000);

  it("dice leave the hand with different speeds and spins, and land spread over the tray", () => {
    const rows = run("vigorous", 10, 5.4);
    const zs = rows.flatMap((r) => r.sim.tracks.map((t) => t.frames[(r.sim.frameCount - 1) * 7 + 2] / 5.4));
    const top = zs.filter((z) => z < 0.33).length / zs.length,
      bottom = zs.filter((z) => z > 0.66).length / zs.length;
    expect(top).toBeLessThan(0.55); // not piled against the far wall
    expect(bottom).toBeGreaterThan(0.08);
    // different dice in the same throw settle at different times
    const spread = rows.filter((r) => new Set(r.sim.tracks.map((t) => t.restFrame)).size > 1).length;
    expect(spread / rows.length).toBeGreaterThan(0.9);
  });
});
